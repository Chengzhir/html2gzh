// CSS 动画 → SMIL：公众号没有样式表，@keyframes 无处安放；SVG 里的动画改写成 <animate>/<animateTransform>
import { SVG_NS, isSvg, inResource, mk, wrapG, hrefOf, refId, ownAnims } from './dom.js';
import { parseEasing, reverseEasing, compile, compileDiscrete, KINDS } from './easing.js';
import { parseFns, parseProp, align, fnMatrix, computedMatrix, measureBox, bakeStyleTransform } from './transform.js';
import { mul, isId, matrixAttr, geometryReader } from './path.js';
import { displayToVisibility } from './whitelist.js';

const r4 = n => { const r = Math.round(n * 10000) / 10000; return Object.is(r, -0) ? 0 : r; };
const sec = t => r4(t) + 's';
const LIN = { kind: 'linear' };

/** 读下页面里 SVG 元素上正在跑的 CSS 动画（样式表删掉之前调用）。被 <use> 引用、自身不画出来的内容临时复制一份到页面里再读 */
export function captureCss(doc, ids) {
  const win = doc.defaultView, out = new Map();
  const take = map => {
    for (const a of doc.getAnimations()) {
      if (!(a instanceof win.CSSAnimation) || a.effect.pseudoElement) continue;
      const src = map(a.effect.target);
      if (!src || !isSvg(src)) continue;
      let list = out.get(src);
      if (!list) out.set(src, list = []);
      if (list.some(r => r.name === a.animationName)) continue;
      list.push({ name: a.animationName, timing: a.effect.getTiming(), kf: a.effect.getKeyframes(), paused: a.playState === 'paused', composite: a.effect.composite });
    }
  };
  take(t => t);
  // use 影子树里的动画 getAnimations 拿不到：把没画出来的被引用元素复制进一个看不见的 svg，让动画在那里跑起来再读
  const box = mk(doc, 'svg', { width: 0, height: 0, style: 'position:absolute;visibility:hidden' });
  const back = new Map(), seen = new Set();
  for (const u of doc.getElementsByTagNameNS(SVG_NS, 'use')) {
    const t = ids.get(refId(hrefOf(u)) || '');
    if (!isSvg(t) || seen.has(t) || t.getClientRects().length) continue;
    seen.add(t);
    const c = t.cloneNode(true), sn = [t, ...t.querySelectorAll('*')], cn = [c, ...c.querySelectorAll('*')];
    sn.forEach((s, i) => back.set(cn[i], s));
    let host = c;
    if (t.localName === 'symbol') { host = mk(doc, 'g', { id: t.id || null }); while (c.firstChild) host.appendChild(c.firstChild); back.set(host, t); }
    box.appendChild(host);
  }
  if (box.firstChild) { doc.body.appendChild(box); take(t => back.get(t)); box.remove(); }
  return out;
}

const SIMPLE = { opacity: ['opacity', 'number'], fill: ['fill', 'color'], strokeWidth: ['stroke-width', 'number'], strokeDashoffset: ['stroke-dashoffset', 'number'],
  r: ['r', 'number'], x: ['x', 'number'], y: ['y', 'number'], width: ['width', 'number'], height: ['height', 'number'], d: ['d', 'path'] };
const GEOM = new Set(['r', 'x', 'y', 'width', 'height', 'd']);
const LAYERS = ['translate', 'rotate', 'scale', 'transform'];
const META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

/** 反向播放：帧倒序，每段 easing 取反 */
const rev = fs => fs.map((f, j, a) => { const k = a.length - 1 - j; return { off: 1 - a[k].off, v: a[k].v, e: k ? reverseEasing(a[k - 1].e) : LIN }; });
const join = (a, b) => [...a.slice(0, -1).map(f => ({ ...f, off: f.off / 2 })), ...b.map(f => ({ ...f, off: 0.5 + f.off / 2 }))];
/** animation-direction 化进关键帧；alternate 把一来一回拼成一个周期（时长 ×2、次数 ÷2） */
function directed(frames, dir) {
  if (dir === 'reverse') return { kf: rev(frames), k: 1 };
  if (dir === 'alternate') return { kf: join(frames, rev(frames)), k: 2 };
  if (dir === 'alternate-reverse') return { kf: join(rev(frames), frames), k: 2 };
  return { kf: frames, k: 1 };
}
function smilTiming(tm, k) {
  const a = { dur: sec(tm.dur * k) };
  if (tm.delay) a.begin = sec(tm.delay);
  if (tm.iters === Infinity) a.repeatCount = 'indefinite'; else if (tm.iters / k !== 1) a.repeatCount = r4(tm.iters / k);
  if (tm.fill === 'forwards' || tm.fill === 'both') a.fill = 'freeze';
  return a;
}
const leadIn = tm => tm.delay > 0 && (tm.fill === 'backwards' || tm.fill === 'both');
const series = (c, str) => ({ values: c.values.map(str).join(';'), keyTimes: c.times.map(r4).join(';'), calcMode: c.splines ? 'spline' : null, keySplines: c.splines ? c.splines.join(';') : null });

function simple(doc, el, [attr, kind], frames, tm, spline) {
  const K = KINDS[kind];
  const parsed = frames.map(f => ({ off: f.off, v: K.parse(f.raw), e: f.e }));
  if (parsed.some(f => f.v == null)) return false;
  const { kf, k } = directed(parsed, tm.dir);
  // 几何属性写在 style 里时 SMIL 压不过它：挪到属性上
  if (GEOM.has(attr) && el.style.getPropertyValue(attr)) {
    const v = geometryReader(el)(attr);
    el.style.removeProperty(attr);
    if (v != null) el.setAttribute(attr, String(v));
  }
  if (leadIn(tm)) el.appendChild(mk(doc, 'set', { attributeName: attr, to: K.str(kf[0].v), begin: '0s', dur: sec(tm.delay) }));
  el.appendChild(mk(doc, 'animate', { attributeName: attr, ...series(compile(kf, K.lerp, spline), K.str), ...smilTiming(tm, k) }));
  return true;
}
function discrete(doc, el, p, frames, tm) {
  if (p === 'display' && !displayToVisibility(el)) return false;
  const vis = v => p === 'display' ? (v === 'none' ? 'hidden' : 'visible') : v === 'visible' ? 'visible' : 'hidden';
  const { kf, k } = directed(frames.map(f => ({ off: f.off, v: vis(String(f.raw).trim()), e: f.e })), tm.dir);
  const c = compileDiscrete(kf, (a, b) => a === 'visible' || b === 'visible' ? 'visible' : 'hidden');
  if (leadIn(tm)) el.appendChild(mk(doc, 'set', { attributeName: 'visibility', to: kf[0].v, begin: '0s', dur: sec(tm.delay) }));
  el.appendChild(mk(doc, 'animate', { attributeName: 'visibility', calcMode: 'discrete', values: c.values.join(';'), keyTimes: c.times.map(r4).join(';'), ...smilTiming(tm, k) }));
  return true;
}
/** 圆心 cx/cy 不在白名单里：换成相对原位置的平移 */
function shift(doc, el, p, frames, tm) {
  if (!bakeStyleTransform(el)) return false;
  const base = geometryReader(el)(p) || 0;
  const parsed = frames.map(f => ({ off: f.off, v: KINDS.number.parse(f.raw), e: f.e }));
  if (parsed.some(f => f.v == null)) return false;
  const { kf, k } = directed(parsed.map(f => ({ ...f, v: f.v - base })), tm.dir);
  const str = v => p === 'cx' ? `${r4(v)} 0` : `0 ${r4(v)}`;
  const T = { attributeName: 'transform', type: 'translate', additive: 'sum' };
  if (leadIn(tm)) el.appendChild(mk(doc, 'animateTransform', { ...T, values: str(kf[0].v), begin: '0s', dur: sec(tm.delay) }));
  el.appendChild(mk(doc, 'animateTransform', { ...T, ...series(compile(kf, KINDS.number.lerp, true), str), ...smilTiming(tm, k) }));
  return true;
}
/** 一层的静态矩阵（不含原点） */
function staticM(cs, lay, box, fs) {
  if (lay === 'transform') return computedMatrix(cs.transform);
  const p = parseProp(lay, cs.getPropertyValue(lay), box, fs);
  return p && fnMatrix(p);
}
/**
 * 变换动画挪到外面套的 <g> 上：style 里的 transform 会压过 animateTransform，而且 CSS 的
 * 原点(translate→rotate→scale→transform)原点⁻¹ 正好对应一层层嵌套的 g。每层 g 的 transform 属性是静态值，
 * 动画用 replace 盖住它，所以动画没在跑的时候显示静态值，和 CSS 一致
 */
function buildLayers(doc, el, layers, box, fs, spline, rep) {
  if (ownAnims(el).some(a => a.localName === 'animateTransform' || a.localName === 'animateMotion')) { rep('css:mixed', el); return false; }
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const spec = [{ m: [1, 0, 0, 1, box.ox, box.oy] }];
  for (const lay of LAYERS) {
    const base = staticM(cs, lay, box, fs);
    if (!base) { rep('css:transform', el); return false; }
    const anims = layers.get(lay);
    if (!anims) { if (!isId(base)) spec.push({ m: base }); continue; }
    const nodes = [];
    for (const { frames, tm } of anims) {
      const lists = frames.map(f => lay === 'transform' ? parseFns(f.raw, box, fs) : parseProp(lay, f.raw, box, fs));
      const al = !lists.includes(null) && align(lists);
      if (!al) { rep('css:transform', el); return false; }
      const types = al.types.length ? al.types : ['translate'];
      const args = al.types.length ? al.args : al.args.map(() => [[0, 0]]);
      const { kf, k } = directed(frames.map((f, i) => ({ off: f.off, v: args[i], e: f.e })), tm.dir);
      types.forEach((t, j) => {
        const str = v => v[j].map(r4).join(' ');
        const lerp = (a, b, p) => a.map((x, q) => q === j ? x.map((n, w) => n + (b[q][w] - n) * p) : x);
        const T = { attributeName: 'transform', type: t, additive: j ? 'sum' : 'replace' };
        if (leadIn(tm)) nodes.push(mk(doc, 'animateTransform', { ...T, values: str(kf[0].v), begin: '0s', dur: sec(tm.delay) }));
        nodes.push(mk(doc, 'animateTransform', { ...T, ...series(compile(kf, lerp, true), str), ...smilTiming(tm, k) }));
      });
      if (anims.length > 1) rep('css:overlap', el);
    }
    spec.push({ m: base, nodes });
  }
  spec.push({ m: [1, 0, 0, 1, -box.ox, -box.oy] });
  // 相邻的静态层乘成一个
  const merged = [];
  for (const s of spec) {
    const last = merged[merged.length - 1];
    if (!s.nodes && last && !last.nodes) last.m = mul(last.m, s.m); else merged.push({ ...s });
  }
  for (const k of [...LAYERS, 'transform-origin', 'transform-box']) el.style.removeProperty(k);
  el.removeAttribute('transform');
  const inner = merged[merged.length - 1];
  if (!inner.nodes) { merged.pop(); if (!isId(inner.m)) el.setAttribute('transform', matrixAttr(inner.m)); }
  let cur = el;
  for (let i = merged.length - 1; i >= 0; i--) {
    const s = merged[i];
    if (!s.nodes && isId(s.m)) continue;
    cur = wrapG(cur, { transform: isId(s.m) ? null : matrixAttr(s.m) });
    for (const n of s.nodes || []) cur.appendChild(n);
  }
  return true;
}

/** 某个属性的各帧 { off, raw, e }；首尾缺帧时补上元素的静态值 */
function framesOf(kfs, p, cs) {
  const out = kfs.filter(f => p in f).map(f => ({ off: f.computedOffset, raw: f[p], e: parseEasing(f.easing) }));
  const still = () => cs.getPropertyValue(p.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
  if (!out.length || out[0].off > 0) out.unshift({ off: 0, raw: still(), e: out.length ? out[0].e : LIN });
  if (out[out.length - 1].off < 1) out.push({ off: 1, raw: still(), e: LIN });
  return out;
}

/** 把 captureCss 读到的动画写成 SMIL；写不了的按原因记进 rep */
export function cssToSmil(doc, anims, { spline, rep }) {
  const win = doc.defaultView;
  let done = 0;
  for (const [el, recs] of anims) {
    if (!el.isConnected) continue;
    if (!isSvg(el.parentElement)) { rep('css:root', el); continue; }
    if (inResource(el)) continue;
    const cs = win.getComputedStyle(el), fs = parseFloat(cs.fontSize) || 16;
    let box = null, ok = false;
    const layers = new Map(), shifts = [];
    for (const r of recs) {
      if (r.paused) { rep('css:paused', el); continue; }
      if (r.composite && r.composite !== 'replace') { rep('css:composite', el); continue; }
      const t = r.timing;
      const tm = { dur: (+t.duration || 0) / 1000, delay: (t.delay || 0) / 1000, iters: t.iterations == null ? Infinity : t.iterations, dir: t.direction, fill: t.fill };
      if (!tm.iters) continue;
      if (!tm.dur) { rep('css:zero', el); continue; }
      const props = [...new Set(r.kf.flatMap(f => Object.keys(f)))].filter(p => !META.has(p));
      for (const p of props) {
        const frames = framesOf(r.kf, p, cs);
        if (frames.some(f => !f.e)) { rep('css:easing', el); continue; }
        if (LAYERS.includes(p)) {
          if (el.localName === 'tspan' || el.localName === 'textPath') { rep('css:prop:' + p, el); continue; }
          box = box || measureBox(el);
          if (!box) { rep('css:transform', el); continue; }
          if (!layers.has(p)) layers.set(p, []);
          layers.get(p).push({ frames, tm });
        } else if (SIMPLE[p]) { if (simple(doc, el, SIMPLE[p], frames, tm, spline)) ok = true; else rep('css:prop:' + p, el); }
        else if (p === 'visibility' || p === 'display') { if (discrete(doc, el, p, frames, tm)) ok = true; else rep('css:prop:' + p, el); }
        else if ((p === 'cx' || p === 'cy') && (el.localName === 'circle' || el.localName === 'ellipse')) shifts.push([p, frames, tm]);
        else rep('css:prop:' + p, el);
      }
    }
    if (layers.size && buildLayers(doc, el, layers, box, fs, spline, rep)) ok = true;
    // 平移放在最后：建层之后元素自己的 transform 属性就是最内层的静态矩阵，平移叠加在它后面，等同于挪圆心
    for (const [p, frames, tm] of shifts) if (shift(doc, el, p, frames, tm)) ok = true; else rep('css:prop:' + p, el);
    if (ok) done++;
  }
  return done;
}
