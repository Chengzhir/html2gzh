// CSS 动画 → SMIL：公众号没有样式表，@keyframes 无处安放；SVG 里的动画改写成 <animate>/<animateTransform>
import { SVG_NS, isSvg, inResource, mk, wrapG, hrefOf, refId, ownAnims } from './dom.ts';
import type { Report } from './dom.ts';
import { parseEasing, reverseEasing, compile, compileDiscrete, KINDS } from './easing.ts';
import type { Easing, Keyframe, CompiledSeries, ValueKind } from './easing.ts';
import { parseFns, parseProp, align, fnMatrix, computedMatrix, measureBox, bakeStyleTransform } from './transform.ts';
import type { TransformBox } from './transform.ts';
import { mul, isId, matrixAttr, geometryReader } from './path.ts';
import type { Matrix } from './path.ts';
import { displayToVisibility } from './whitelist.ts';
import { wrapRoot, rootDecorated, rootTransformed, rootBox, moveClip, moveOpacity } from './root.ts';
import type { RootBox } from './root.ts';
import { viewOf } from '../util.ts';

/** captureCss 读到的一条 CSS 动画 */
interface CssAnimRecord {
  name: string;
  timing: EffectTiming;
  kf: ComputedKeyframe[];
  paused: boolean;
  composite: CompositeOperation;
}
/** 元素 → 它上面的 CSS 动画（同名只记一次） */
export type CssAnims = Map<SVGElement, CssAnimRecord[]>;
/** 关键帧里某个属性的原始值；e 为 null 表示 easing 认不出 */
interface RawFrame {
  off: number;
  raw: string;
  e: Easing | null;
}
/** easing 都认得出的帧 */
type Frame = RawFrame & { e: Easing };
const easingKnown = (frames: RawFrame[]): frames is Frame[] => frames.every(frame => frame.e);
interface Timing {
  dur: number;
  delay: number;
  iters: number;
  dir: PlaybackDirection;
  fill: FillMode;
}
interface LayerAnim {
  frames: Frame[];
  tm: Timing;
}
type GetPropertyValue = Pick<CSSStyleDeclaration, 'getPropertyValue'>;

const r4 = (n: number) => {
  const rounded = Math.round(n * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const sec = (seconds: number) => r4(seconds) + 's';
const LIN: Easing = { kind: 'linear' };

/** 读下页面里 SVG 元素上正在跑的 CSS 动画（样式表删掉之前调用）。被 <use> 引用、自身不画出来的内容临时复制一份到页面里再读 */
export function captureCss(doc: Document, ids: Map<string, Element>): CssAnims {
  const win = viewOf(doc),
    out: CssAnims = new Map();
  const take = (resolve: (target: Element | null) => Element | null | undefined) => {
    for (const animation of doc.getAnimations()) {
      if (!(animation instanceof win.CSSAnimation) || (animation.effect as KeyframeEffect).pseudoElement) continue;
      const effect = animation.effect as KeyframeEffect;
      const src = resolve(effect.target);
      if (!src || !isSvg(src)) continue;
      const list = out.getOrInsertComputed(src, () => []);
      if (list.some(record => record.name === animation.animationName)) continue;
      list.push({
        name: animation.animationName,
        timing: effect.getTiming(),
        kf: effect.getKeyframes(),
        paused: animation.playState === 'paused',
        composite: effect.composite,
      });
    }
  };
  take(target => target);
  // use 影子树里的动画 getAnimations 拿不到：把没画出来的被引用元素复制进一个看不见的 svg，让动画在那里跑起来再读
  const box = mk(doc, 'svg', { width: 0, height: 0, style: 'position:absolute;visibility:hidden' });
  const back = new Map<Element, Element>(),
    seen = new Set<Element>();
  for (const useEl of doc.getElementsByTagNameNS(SVG_NS, 'use')) {
    const referenced = ids.get(refId(hrefOf(useEl)) || '');
    if (!isSvg(referenced) || seen.has(referenced) || referenced.getClientRects().length) continue;
    seen.add(referenced);
    const clone = referenced.cloneNode(true) as SVGElement,
      sourceNodes = [referenced, ...referenced.querySelectorAll('*')],
      cloneNodes = [clone, ...clone.querySelectorAll('*')];
    sourceNodes.forEach((source, i) => back.set(cloneNodes[i], source));
    let host: Element = clone;
    if (referenced.localName === 'symbol') {
      host = mk(doc, 'g', { id: referenced.id || null });
      while (clone.firstChild) host.appendChild(clone.firstChild);
      back.set(host, referenced);
    }
    box.appendChild(host);
  }
  if (box.firstChild) {
    doc.body.appendChild(box);
    take(target => target && back.get(target));
    box.remove();
  }
  return out;
}

const SIMPLE: Record<string, [attr: string, kind: keyof typeof KINDS]> = {
  opacity: ['opacity', 'number'],
  fill: ['fill', 'color'],
  strokeWidth: ['stroke-width', 'number'],
  strokeDashoffset: ['stroke-dashoffset', 'number'],
  r: ['r', 'number'],
  x: ['x', 'number'],
  y: ['y', 'number'],
  width: ['width', 'number'],
  height: ['height', 'number'],
  d: ['d', 'path'],
};
const GEOM = new Set<string>(['r', 'x', 'y', 'width', 'height', 'd']);
const LAYERS = ['translate', 'rotate', 'scale', 'transform'];
const META = new Set<string>(['offset', 'computedOffset', 'easing', 'composite']);

/** 反向播放：帧倒序，每段 easing 取反 */
const rev = <V>(frames: Keyframe<V>[]): Keyframe<V>[] =>
  frames.map((_frame, j, all) => {
    const k = all.length - 1 - j;
    return { off: 1 - all[k].off, v: all[k].v, e: k ? reverseEasing(all[k - 1].e) : LIN };
  });
const join = <V>(a: Keyframe<V>[], b: Keyframe<V>[]): Keyframe<V>[] => [
  ...a.slice(0, -1).map(frame => ({ ...frame, off: frame.off / 2 })),
  ...b.map(frame => ({ ...frame, off: 0.5 + frame.off / 2 })),
];
/** animation-direction 化进关键帧；alternate 把一来一回拼成一个周期（时长 ×2、次数 ÷2） */
function directed<V>(frames: Keyframe<V>[], dir: PlaybackDirection): { kf: Keyframe<V>[]; k: number } {
  if (dir === 'reverse') return { kf: rev(frames), k: 1 };
  if (dir === 'alternate') return { kf: join(frames, rev(frames)), k: 2 };
  if (dir === 'alternate-reverse') return { kf: join(rev(frames), frames), k: 2 };
  return { kf: frames, k: 1 };
}
function smilTiming(tm: Timing, k: number) {
  const attrs: Record<string, string | number> = { dur: sec(tm.dur * k) };
  if (tm.delay) attrs.begin = sec(tm.delay);
  if (tm.iters === Infinity) attrs.repeatCount = 'indefinite';
  else if (tm.iters / k !== 1) attrs.repeatCount = r4(tm.iters / k);
  if (tm.fill === 'forwards' || tm.fill === 'both') attrs.fill = 'freeze';
  return attrs;
}
const leadIn = (tm: Timing) => tm.delay > 0 && (tm.fill === 'backwards' || tm.fill === 'both');
const series = <V>(compiled: CompiledSeries<V>, str: (value: V) => string | number) => ({
  values: compiled.values.map(str).join(';'),
  keyTimes: compiled.times.map(r4).join(';'),
  calcMode: compiled.splines ? 'spline' : null,
  keySplines: compiled.splines ? compiled.splines.join(';') : null,
});

function simple(
  doc: Document,
  el: SVGElement,
  [attr, kind]: [attr: string, kind: keyof typeof KINDS],
  frames: Frame[],
  tm: Timing,
) {
  // 三种值各自的 parse/lerp/str 互相配套，这里按同一个未知值类型统一处理
  const K = KINDS[kind] as unknown as ValueKind<unknown>;
  const parsed: Keyframe<unknown>[] = frames.map(frame => ({ off: frame.off, v: K.parse(frame.raw), e: frame.e }));
  if (parsed.some(frame => frame.v == null)) return false;
  const { kf, k } = directed(parsed, tm.dir);
  // 几何属性写在 style 里时 SMIL 压不过它：挪到属性上
  if (GEOM.has(attr) && el.style.getPropertyValue(attr)) {
    const value = geometryReader(el)(attr);
    el.style.removeProperty(attr);
    if (value != null) el.setAttribute(attr, String(value));
  }
  if (leadIn(tm))
    el.appendChild(mk(doc, 'set', { attributeName: attr, to: K.str(kf[0].v), begin: '0s', dur: sec(tm.delay) }));
  el.appendChild(
    mk(doc, 'animate', { attributeName: attr, ...series(compile(kf, K.lerp), K.str), ...smilTiming(tm, k) }),
  );
  return true;
}
function discrete(doc: Document, el: SVGElement, p: string, frames: Frame[], tm: Timing) {
  if (p === 'display' && !displayToVisibility(el)) return false;
  const vis = (value: string) =>
    p === 'display' ? (value === 'none' ? 'hidden' : 'visible') : value === 'visible' ? 'visible' : 'hidden';
  const { kf, k } = directed(
    frames.map(frame => ({ off: frame.off, v: vis(frame.raw.trim()), e: frame.e })),
    tm.dir,
  );
  const compiled = compileDiscrete(kf, (a: string, b: string) =>
    a === 'visible' || b === 'visible' ? 'visible' : 'hidden',
  );
  if (leadIn(tm))
    el.appendChild(mk(doc, 'set', { attributeName: 'visibility', to: kf[0].v, begin: '0s', dur: sec(tm.delay) }));
  el.appendChild(
    mk(doc, 'animate', {
      attributeName: 'visibility',
      calcMode: 'discrete',
      values: compiled.values.join(';'),
      keyTimes: compiled.times.map(r4).join(';'),
      ...smilTiming(tm, k),
    }),
  );
  return true;
}
/** 圆心 cx/cy 不在白名单里：换成相对原位置的平移 */
function shift(doc: Document, el: SVGCircleElement | SVGEllipseElement, p: string, frames: Frame[], tm: Timing) {
  if (!bakeStyleTransform(el)) return false;
  const base = geometryReader(el)(p) || 0;
  const values = frames.map(frame => KINDS.number.parse(frame.raw));
  if (!values.every(value => value != null)) return false;
  const { kf, k } = directed(
    frames.map((frame, i) => ({ off: frame.off, v: values[i] - base, e: frame.e })),
    tm.dir,
  );
  const str = (value: number) => (p === 'cx' ? `${r4(value)} 0` : `0 ${r4(value)}`);
  const T = { attributeName: 'transform', type: 'translate', additive: 'sum' };
  if (leadIn(tm))
    el.appendChild(mk(doc, 'animateTransform', { ...T, values: str(kf[0].v), begin: '0s', dur: sec(tm.delay) }));
  el.appendChild(
    mk(doc, 'animateTransform', { ...T, ...series(compile(kf, KINDS.number.lerp), str), ...smilTiming(tm, k) }),
  );
  return true;
}
/** 一层的静态矩阵（不含原点） */
function staticM(computed: CSSStyleDeclaration, layer: string, box: TransformBox, fontSize: number): Matrix | null {
  if (layer === 'transform') return computedMatrix(computed.transform);
  const fns = parseProp(layer, computed.getPropertyValue(layer), box, fontSize);
  return fns && fnMatrix(fns);
}
/**
 * 变换动画挪到外面套的 <g> 上：style 里的 transform 会压过 animateTransform，而且 CSS 的
 * 原点(translate→rotate→scale→transform)原点⁻¹ 正好对应一层层嵌套的 g。每层 g 的 transform 属性是静态值，
 * 动画用 replace 盖住它，所以动画没在跑的时候显示静态值，和 CSS 一致
 */
function buildLayers(
  doc: Document,
  el: SVGElement,
  layers: Map<string, LayerAnim[]>,
  box: TransformBox,
  fontSize: number,
  rep: Report,
) {
  if (ownAnims(el).some(anim => anim.localName === 'animateTransform' || anim.localName === 'animateMotion')) {
    rep('css:mixed', el);
    return false;
  }
  const computed = viewOf(el.ownerDocument).getComputedStyle(el);
  const spec: { m: number[]; nodes?: Element[] }[] = [{ m: [1, 0, 0, 1, box.ox, box.oy] }];
  for (const layer of LAYERS) {
    const base = staticM(computed, layer, box, fontSize);
    if (!base) {
      rep('css:transform', el);
      return false;
    }
    const anims = layers.get(layer);
    if (!anims) {
      if (!isId(base)) spec.push({ m: base });
      continue;
    }
    const nodes: Element[] = [];
    for (const { frames, tm } of anims) {
      const lists = frames.map(frame =>
        layer === 'transform' ? parseFns(frame.raw, box, fontSize) : parseProp(layer, frame.raw, box, fontSize),
      );
      const aligned = lists.every(list => list != null) && align(lists);
      if (!aligned) {
        rep('css:transform', el);
        return false;
      }
      const types: string[] = aligned.types.length ? aligned.types : ['translate'];
      const args: number[][][] = aligned.types.length ? aligned.args : aligned.args.map(() => [[0, 0]]);
      const { kf, k } = directed(
        frames.map((frame, i) => ({ off: frame.off, v: args[i], e: frame.e })),
        tm.dir,
      );
      types.forEach((type, j) => {
        const str = (value: number[][]) => value[j].map(r4).join(' ');
        const lerp = (a: number[][], b: number[][], progress: number) =>
          a.map((fnArgs, q) => (q === j ? fnArgs.map((n, w) => n + (b[q][w] - n) * progress) : fnArgs));
        const attrs = { attributeName: 'transform', type, additive: j ? 'sum' : 'replace' };
        if (leadIn(tm))
          nodes.push(mk(doc, 'animateTransform', { ...attrs, values: str(kf[0].v), begin: '0s', dur: sec(tm.delay) }));
        nodes.push(
          mk(doc, 'animateTransform', {
            ...attrs,
            ...series(compile(kf, lerp), str),
            ...smilTiming(tm, k),
          }),
        );
      });
      if (anims.length > 1) rep('css:overlap', el);
    }
    spec.push({ m: base, nodes });
  }
  spec.push({ m: [1, 0, 0, 1, -box.ox, -box.oy] });
  // 相邻的静态层乘成一个
  const merged: typeof spec = [];
  for (const layerSpec of spec) {
    const last = merged[merged.length - 1];
    if (!layerSpec.nodes && last && !last.nodes) last.m = mul(last.m, layerSpec.m);
    else merged.push({ ...layerSpec });
  }
  for (const prop of [...LAYERS, 'transform-origin', 'transform-box']) el.style.removeProperty(prop);
  el.removeAttribute('transform');
  const inner = merged[merged.length - 1];
  if (!inner.nodes) {
    merged.pop();
    if (!isId(inner.m)) el.setAttribute('transform', matrixAttr(inner.m));
  }
  let cur: Element = el;
  for (let i = merged.length - 1; i >= 0; i--) {
    const layerSpec = merged[i];
    if (!layerSpec.nodes && isId(layerSpec.m)) continue;
    cur = wrapG(cur, { transform: isId(layerSpec.m) ? null : matrixAttr(layerSpec.m) });
    for (const node of layerSpec.nodes || []) cur.appendChild(node);
  }
  return true;
}

/** 某个属性的各帧 { off, raw, e }；首尾缺帧时补上元素的静态值 */
function framesOf(keyframes: ComputedKeyframe[], p: string, computed: GetPropertyValue): RawFrame[] {
  const out: RawFrame[] = keyframes
    .filter(keyframe => p in keyframe)
    .map(keyframe => ({ off: keyframe.computedOffset, raw: keyframe[p] as string, e: parseEasing(keyframe.easing) }));
  const still = () => computed.getPropertyValue(p.replace(/[A-Z]/g, char => '-' + char.toLowerCase()));
  if (!out.length || out[0].off > 0) out.unshift({ off: 0, raw: still(), e: out.length ? out[0].e : LIN });
  if (out[out.length - 1].off < 1) out.push({ off: 1, raw: still(), e: LIN });
  return out;
}

/** 把 captureCss 读到的动画写成 SMIL；写不了的按原因记进 rep */
export function cssToSmil(doc: Document, anims: CssAnims, rep: Report): number {
  const win = viewOf(doc);
  let done = 0;
  for (const [svgEl, recs] of anims) {
    if (!svgEl.isConnected || inResource(svgEl)) continue;
    const computed = win.getComputedStyle(svgEl),
      fontSize = parseFloat(computed.fontSize) || 16;
    // 最外层 svg 上的动画写到包住它全部内容的 g 上（见 root.ts）；g 在第一次用到时才建
    const root = isSvg(svgEl.parentElement) ? null : (svgEl as SVGSVGElement);
    const rootOpacity = computed.opacity;
    let wrapped: SVGGElement | null = null,
      opacityMoved = false;
    const host = (): SVGElement => (root ? (wrapped ??= wrapRoot(root)) : svgEl);
    const rootBlocked = (p: string) =>
      root &&
      (GEOM.has(p) ||
        p === 'display' ||
        ((LAYERS.includes(p) || p === 'opacity' || p === 'visibility') && rootDecorated(computed)) ||
        (LAYERS.includes(p) && rootTransformed(computed)));
    let box: TransformBox | RootBox | null = null,
      ok = false;
    const layers = new Map<string, LayerAnim[]>(),
      shifts: [p: string, frames: Frame[], tm: Timing][] = [];
    // 最外层 svg 的静态透明度在写第一条透明度动画时挪到 g 上；之后各帧补的静态值仍取挪动前的
    const base: GetPropertyValue = root
      ? { getPropertyValue: (q: string) => (q === 'opacity' ? rootOpacity : computed.getPropertyValue(q)) }
      : computed;
    for (const record of recs) {
      if (record.paused) {
        rep('css:paused', svgEl);
        continue;
      }
      if (record.composite && record.composite !== 'replace') {
        rep('css:composite', svgEl);
        continue;
      }
      const timing = record.timing;
      const tm: Timing = {
        dur: (Number(timing.duration) || 0) / 1000,
        delay: (timing.delay || 0) / 1000,
        iters: timing.iterations ?? Infinity,
        dir: timing.direction ?? 'normal',
        fill: timing.fill ?? 'auto',
      };
      if (!tm.iters) continue;
      if (!tm.dur) {
        rep('css:zero', svgEl);
        continue;
      }
      const props = [...new Set<string>(record.kf.flatMap(keyframe => Object.keys(keyframe)))].filter(
        p => !META.has(p),
      );
      for (const p of props) {
        const frames = framesOf(record.kf, p, base);
        if (!easingKnown(frames)) {
          rep('css:easing', svgEl);
          continue;
        }
        if (rootBlocked(p)) {
          rep('css:root', svgEl);
          continue;
        }
        if (LAYERS.includes(p)) {
          if (svgEl.localName === 'tspan' || svgEl.localName === 'textPath') {
            rep('css:prop:' + p, svgEl);
            continue;
          }
          box ||= root ? rootBox(root, computed) : measureBox(svgEl as SVGGraphicsElement);
          if (!box) {
            rep(root ? 'css:root' : 'css:transform', svgEl);
            continue;
          }
          layers.getOrInsertComputed(p, () => []).push({ frames, tm });
        } else if (SIMPLE[p]) {
          if (root && p === 'opacity' && !opacityMoved) {
            moveOpacity(root, host() as SVGGElement, computed);
            opacityMoved = true;
          }
          if (simple(doc, host(), SIMPLE[p], frames, tm)) ok = true;
          else rep('css:prop:' + p, svgEl);
        } else if (p === 'visibility' || p === 'display') {
          if (discrete(doc, host(), p, frames, tm)) ok = true;
          else rep('css:prop:' + p, svgEl);
        } else if ((p === 'cx' || p === 'cy') && (svgEl.localName === 'circle' || svgEl.localName === 'ellipse'))
          shifts.push([p, frames, tm]);
        else rep('css:prop:' + p, svgEl);
      }
    }
    // 有 layers 时 box 一定量到了：root 时是 rootBox 的结果
    if (layers.size && box) {
      if (root) moveClip(root, host() as SVGGElement, computed, box as RootBox);
      if (buildLayers(doc, host(), layers, box, fontSize, rep)) ok = true;
    }
    // 平移放在最后：建层之后元素自己的 transform 属性就是最内层的静态矩阵，平移叠加在它后面，等同于挪圆心
    for (const [p, frames, tm] of shifts)
      if (shift(doc, svgEl as SVGCircleElement | SVGEllipseElement, p, frames, tm)) ok = true;
      else rep('css:prop:' + p, svgEl);
    if (ok) done++;
  }
  return done;
}
