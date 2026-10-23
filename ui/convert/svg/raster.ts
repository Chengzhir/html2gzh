// 依赖 id 的静态部分（渐变、图案、滤镜、蒙版、裁切、标记、textPath）画成位图：公众号删 id 之后这些引用全部失效
import {
  SVG_NS,
  isSvg,
  isAnim,
  isGraphics,
  hasAnim,
  inResource,
  ownAnims,
  URL_REF,
  fixUrls,
  mk,
  wrapG,
  RESOURCE,
  hrefOf,
  refId,
} from './dom.ts';
import { inv, fromDom, mul, ID_M, isId, matrixAttr } from './path.ts';
import { bakeStyleTransform } from './transform.ts';
import { attrOf } from '../util.ts';
import type { Report } from './dom.ts';

/** convertSvgs 的 ctx 里本文件用到的部分 */
export interface RasterContext {
  /** 位图 data URI → 正文里用的地址；不可用时为 null */
  raster?: ((dataUri: string) => Promise<string>) | null;
  /** 区域与内容相同的位图复用：键见 rasterize */
  rasterCache: Map<string, RasterHit>;
  copyText?: boolean;
}
/** 画好的位图（user units 里的位置与尺寸）；empty 表示画出来是空的 */
export type RasterHit = { empty: true } | { empty?: false; src: string; x: number; y: number; w: number; h: number };
type ReadyContext = RasterContext & { raster: (dataUri: string) => Promise<string> };
const context2d = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas 2d context unavailable');
  return context;
};
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 1 user unit 合多少位图像素 */
  k: number;
  parent: SVGElement;
}

const DPR = 3,
  PHONE = 390,
  MAX_PX = 6e6;
const INHERIT = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'dominant-baseline',
  'direction',
  'writing-mode',
  'paint-order',
  'marker-start',
  'marker-mid',
  'marker-end',
  'clip-rule',
  'color-interpolation',
  'color-interpolation-filters',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
];
const OWN = ['filter', 'mask', 'clip-path', 'marker-start', 'marker-mid', 'marker-end'];
const PAINT = ['fill', 'stroke'];
// 动画改了这些可继承属性时，子孙画成位图就不对了
const INHERITED_ANIM = /^(fill|stroke|color|font-size|stroke-width|stroke-dasharray|stroke-dashoffset)/;

const usesOwn = (el: Element, computed: CSSStyleDeclaration) =>
  OWN.some(prop => URL_REF.test(computed.getPropertyValue(prop))) || el.localName === 'textPath';
const usesPaint = (computed: CSSStyleDeclaration) => PAINT.some(prop => URL_REF.test(computed.getPropertyValue(prop)));
const inheritedAnim = (el: Element) => {
  for (let ancestor = el.parentElement; ancestor && isSvg(ancestor); ancestor = ancestor.parentElement)
    if (ownAnims(ancestor).some(anim => INHERITED_ANIM.test(anim.getAttribute('attributeName') || ''))) return true;
  return false;
};
const usesIds = (el: Element, win: Window) => {
  for (const node of [el, ...el.querySelectorAll('*')])
    if (isSvg(node)) {
      const computed = win.getComputedStyle(node);
      if (usesOwn(node, computed) || usesPaint(computed)) return true;
    }
  return false;
};
/**
 * 子树用到的滤镜、蒙版、裁切、标记里有动画：画成位图会把动画冻住。
 * 渐变、图案里的动画不算：公众号删 id 之后填充引用不到它们，动画本来就播放不了，画成位图时取 0 秒时的值（frozenClone）
 */
function refsAnimated(el: Element, win: Window, ids: Map<string, Element>): boolean {
  for (const node of [el, ...el.querySelectorAll('*')]) {
    if (!isSvg(node)) continue;
    const computed = win.getComputedStyle(node);
    for (const prop of OWN) {
      const match = URL_REF.exec(computed.getPropertyValue(prop));
      const res = match && ids.get(decodeURIComponent(match[1]));
      if (res && hasAnim(res)) return true;
    }
  }
  return false;
}
/** 子树的填充或描边用到的渐变、图案（含经 href 继承的）里有动画 */
function paintAnimated(el: Element, win: Window, ids: Map<string, Element>): boolean {
  for (const node of [el, ...el.querySelectorAll('*')]) {
    if (!isSvg(node)) continue;
    const computed = win.getComputedStyle(node);
    for (const prop of PAINT) {
      const match = URL_REF.exec(computed.getPropertyValue(prop));
      let res = match ? ids.get(decodeURIComponent(match[1])) : undefined;
      for (let i = 0; res && i < 8; i++) {
        if (hasAnim(res)) return true;
        res = ids.get(refId(hrefOf(res)) || '');
      }
    }
  }
  return false;
}

type SvgWindow = Window & typeof globalThis;
const camel = (name: string) => name.replace(/-(\w)/g, (_, char: string) => char.toUpperCase());
/** SVGAnimated* 的当前值写成属性值；枚举、字符串、viewBox 这类没有对应写法的返回 null */
function animString(prop: { animVal: unknown }, win: SvgWindow): string | null {
  if (prop instanceof win.SVGAnimatedEnumeration) return null;
  const value = prop.animVal;
  if (typeof value === 'number') return String(value);
  if (value instanceof win.SVGTransformList) {
    let m = ID_M;
    for (let i = 0; i < value.numberOfItems; i++) m = mul(m, fromDom(value.getItem(i).matrix));
    return matrixAttr(m);
  }
  if (value instanceof win.SVGLength || value instanceof win.SVGAngle) return value.valueAsString;
  if (value instanceof win.SVGLengthList || value instanceof win.SVGNumberList) {
    const out: string[] = [];
    for (let i = 0; i < value.numberOfItems; i++) {
      const item = value.getItem(i);
      out.push(item instanceof win.SVGLength ? item.valueAsString : String(item.value));
    }
    return out.join(' ');
  }
  return null;
}
/** 把 el 上属性 name 在当前时刻的值写到副本 copy 上 */
function freezeValue(el: SVGElement, copy: SVGElement, name: string, win: SvgWindow) {
  const computed = win.getComputedStyle(el);
  if (name === 'd') {
    const match = /^path\("(.*)"\)$/.exec(computed.getPropertyValue('d'));
    if (match) copy.setAttribute('d', match[1]);
    return;
  }
  const props = el as unknown as Record<string, unknown>;
  let attr = name,
    prop = props[camel(name)];
  if (name === 'transform' && !prop) {
    attr = el.localName === 'pattern' ? 'patternTransform' : 'gradientTransform';
    prop = props[attr];
  }
  if (prop && typeof prop === 'object' && 'animVal' in prop) {
    const value = animString(prop, win);
    if (value == null) return;
    copy.setAttribute(attr, value);
    // x、width、r 这类几何属性在 Chrome 里也是 CSS 属性，副本 style 里的旧值会盖过属性
    copy.style.removeProperty(name);
    return;
  }
  const value = computed.getPropertyValue(name);
  if (value) copy.style.setProperty(name, value);
}
/**
 * 资源的副本，动画改变的属性写成当前时刻（文档已暂停在 0 秒）的值。
 * 画位图时会去掉全部动画，不写下来的话，副本会回到属性的初始值，与页面刚打开时的样子不同
 */
function frozenClone(res: Element, win: SvgWindow): Element {
  const copy = res.cloneNode(true) as Element;
  if (!hasAnim(res)) return copy;
  const to = [copy, ...copy.querySelectorAll('*')];
  [res, ...res.querySelectorAll('*')].forEach((el, i) => {
    if (!isSvg(el)) return;
    for (const a of ownAnims(el)) {
      const name = a.getAttribute('attributeName');
      if (name) freezeValue(el as SVGElement, to[i] as SVGElement, name, win);
    }
  });
  return copy;
}

const RIGID = new Set(['transform', 'opacity', 'visibility']);
const rigidAnim = (a: Element) =>
  a.localName === 'animateMotion' || a.localName === 'animateTransform' || RIGID.has(attrOf(a, 'attributeName'));

/**
 * 自身只有整体动画（transform、位移路径、opacity、visibility）而内容静态、又依赖 id 的元素：
 * 这些动画连同静态的 transform/opacity/visibility 挪到外面套的 g 上，元素本身就成了静态的，可以画成位图
 */
export function liftRigid(root: Element, win: Window, ids: Map<string, Element>): number {
  let n = 0;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!isGraphics(el) || inResource(el) || el.localName === 'svg' || el.closest('foreignObject')) continue;
    const own = ownAnims(el);
    if (
      !own.length ||
      !own.every(rigidAnim) ||
      [...el.querySelectorAll('*')].some(node => isAnim(node) && (node.parentElement as Element) !== el)
    )
      continue;
    if (!usesIds(el, win) || refsAnimated(el, win, ids) || !bakeStyleTransform(el)) continue;
    const g = wrapG(el);
    for (const prop of ['transform', 'opacity', 'visibility']) {
      const value = el.style.getPropertyValue(prop) || el.getAttribute(prop);
      if (value) g.setAttribute(prop, value);
      el.style.removeProperty(prop);
      el.removeAttribute(prop);
    }
    for (const a of own) g.appendChild(a);
    n++;
  }
  return n;
}

interface SubtreeFlags {
  own: boolean;
  paint: boolean;
  anim: boolean;
  refAnim: boolean;
  fo: boolean;
  uses?: boolean;
}
const SHAPE_KID = (kid: Element) => isSvg(kid) && !isAnim(kid) && !/^(title|desc|metadata)$/.test(kid.localName);
/** 要画成位图的连续兄弟元素（静态、依赖 id）：[[el, el…], …] */
export function findUnits(root: Element, win: Window, ids: Map<string, Element>): Element[][] {
  // 自下而上算一遍每个元素子树的标志，免得逐层重复遍历（大插画有上千个元素）
  const info = new Map<Element, SubtreeFlags>(),
    resAnim = new Map<Element, boolean>();
  const animRes = (res: Element) => {
    if (!resAnim.has(res)) resAnim.set(res, hasAnim(res));
    return resAnim.get(res);
  };
  const visit = (el: Element): SubtreeFlags => {
    const computed = win.getComputedStyle(el);
    const flags: SubtreeFlags = {
      own: usesOwn(el, computed),
      paint: usesPaint(computed),
      anim: isAnim(el),
      refAnim: false,
      fo: el.localName === 'foreignObject',
    };
    flags.uses = flags.own || flags.paint;
    for (const prop of OWN) {
      const match = URL_REF.exec(computed.getPropertyValue(prop));
      const res = match && ids.get(decodeURIComponent(match[1]));
      if (res && animRes(res)) flags.refAnim = true;
    }
    for (const kid of el.children)
      if (isSvg(kid)) {
        const kidFlags = visit(kid);
        flags.anim ||= kidFlags.anim;
        flags.uses ||= kidFlags.uses;
        flags.refAnim ||= kidFlags.refAnim;
        flags.fo ||= kidFlags.fo;
      }
    info.set(el, flags);
    return flags;
  };
  visit(root);
  const runs: Element[][] = [];
  const walk = (parent: Element) => {
    let run: Element[] | null = null;
    for (const el of [...parent.children]) {
      const flags = info.get(el);
      if (
        !flags ||
        RESOURCE.has(el.localName) ||
        el.localName === 'defs' ||
        isAnim(el) ||
        !el.getClientRects().length
      ) {
        run = null;
        continue;
      }
      const stat = !flags.anim && !flags.fo && !flags.refAnim && !inheritedAnim(el);
      // 自己有滤镜/蒙版/裁切这类整体效果，或者是叶子元素（含文字）：整个画；否则往下找
      const whole =
        stat &&
        (flags.own ||
          (flags.paint && ![...el.children].some(SHAPE_KID)) ||
          (/^(text|image)$/.test(el.localName) && flags.uses));
      if (whole) {
        if (!run) runs.push((run = []));
        run.push(el);
        continue;
      }
      run = null;
      if (el.localName !== 'text' && el.localName !== 'foreignObject' && flags.uses) walk(el);
    }
  };
  walk(root);
  return runs;
}

function region(run: Element[], win: Window): Region | null {
  const parent = run[0].parentElement as Element as SVGGraphicsElement,
    doc = parent.ownerDocument;
  const g = mk(doc, 'g');
  run[0].before(g);
  for (const el of run) g.appendChild(el);
  let bbox: DOMRect | null = null;
  try {
    bbox = (g as SVGGraphicsElement).getBBox();
  } catch {
    /* 没画出来 */
  } finally {
    for (const el of [...g.childNodes]) g.before(el);
    g.remove();
  }
  const screenCtm = fromDom(parent.getScreenCTM());
  if (!bbox || !screenCtm) return null;
  const unit = Math.max(Math.hypot(screenCtm[0], screenCtm[1]), Math.hypot(screenCtm[2], screenCtm[3]));
  // getBBox 不含描边、标记、滤镜：四周放宽，最后按不透明像素裁掉。放宽量只用 user units，两个宽度下区域相同、位图能复用
  const pad = Math.max(bbox.width, bbox.height) * 0.5 + 8;
  let rect = { x: bbox.x - pad, y: bbox.y - pad, w: bbox.width + 2 * pad, h: bbox.height + 2 * pad };
  const rootSvg = (() => {
    let svg: Element = parent;
    while (isSvg(svg.parentElement)) svg = svg.parentElement;
    return svg;
  })();
  // 祖先有动画（会把画面外的部分挪进来）时不按视口裁
  let still = true;
  for (let ancestor: Element | null = parent; ancestor && isSvg(ancestor); ancestor = ancestor.parentElement)
    if (ownAnims(ancestor).length) still = false;
  if (still && win.getComputedStyle(rootSvg).overflow !== 'visible') {
    const viewRect = rootSvg.getBoundingClientRect(),
      P = inv(screenCtm);
    const points = [
      [viewRect.left, viewRect.top],
      [viewRect.right, viewRect.top],
      [viewRect.left, viewRect.bottom],
      [viewRect.right, viewRect.bottom],
    ].map(([x, y]) => [P[0] * x + P[2] * y + P[4], P[1] * x + P[3] * y + P[5]]);
    const xs = points.map(point => point[0]),
      ys = points.map(point => point[1]);
    const x0 = Math.max(rect.x, Math.min(...xs)),
      y0 = Math.max(rect.y, Math.min(...ys)),
      x1 = Math.min(rect.x + rect.w, Math.max(...xs)),
      y1 = Math.min(rect.y + rect.h, Math.max(...ys));
    rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (!(rect.w > 0 && rect.h > 0)) return null;
  const boost = Math.max(1, PHONE / (doc.documentElement.clientWidth || PHONE));
  let k = unit * DPR * boost;
  if (rect.w * rect.h * k * k > MAX_PX) k = Math.sqrt(MAX_PX / (rect.w * rect.h));
  return { ...rect, k, parent };
}
async function dataUri(win: SvgWindow, url: string | null): Promise<string | null> {
  if (!url || /^data:/i.test(url)) return url;
  try {
    const blob = await (await win.fetch(url)).blob();
    return await new Promise<string>((ok, bad) => {
      const reader = new win.FileReader();
      reader.onload = () => ok(reader.result as string);
      reader.onerror = bad;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * 一组连续兄弟元素画成位图，换成同一位置的 foreignObject + 背景图。
 * 在父元素的坐标系里画（祖先的 transform、opacity、裁切照旧作用在它上面），只带可继承的样式与全部资源定义
 */
async function rasterize(
  run: Element[],
  ctx: ReadyContext,
  win: SvgWindow,
  ids: Map<string, Element>,
  rep: Report,
): Promise<boolean> {
  const doc = run[0].ownerDocument,
    R = region(run, win);
  if (!R) {
    rep('raster:fail', run[0]);
    return false;
  }
  const { parent, k } = R;
  const pw = Math.max(1, Math.round(R.w * k)),
    ph = Math.max(1, Math.round(R.h * k));
  const svg = mk(doc, 'svg', {
    xmlns: SVG_NS,
    width: pw,
    height: ph,
    viewBox: `${R.x} ${R.y} ${R.w} ${R.h}`,
    preserveAspectRatio: 'none',
  });
  const defs = mk(doc, 'defs');
  for (const res of doc.querySelectorAll('linearGradient,radialGradient,pattern,filter,mask,clipPath,marker,symbol'))
    if (isSvg(res)) defs.appendChild(frozenClone(res, win));
  svg.appendChild(defs);
  const parentStyle = win.getComputedStyle(parent),
    wrap = mk(doc, 'g');
  for (const prop of INHERIT) {
    const value = parentStyle.getPropertyValue(prop);
    if (value) wrap.style.setProperty(prop, fixUrls(value));
  }
  for (const el of run) wrap.appendChild(el.cloneNode(true));
  svg.appendChild(wrap);
  for (const node of svg.querySelectorAll('*')) {
    if (isAnim(node)) {
      node.remove();
      continue;
    }
    for (const attr of [...node.attributes])
      if (/url\(/.test(attr.value)) node.setAttribute(attr.name, fixUrls(attr.value));
  }
  for (const image of svg.getElementsByTagNameNS(SVG_NS, 'image')) {
    const uri = await dataUri(win, image.getAttribute('href'));
    if (uri) image.setAttribute('href', uri);
    else rep('raster:image', run[0]);
  }
  const key = `${R.x.toFixed(2)},${R.y.toFixed(2)},${R.w.toFixed(2)},${R.h.toFixed(2)}|${new win.XMLSerializer().serializeToString(wrap)}`;
  let hit = ctx.rasterCache.get(key);
  if (!hit) {
    const url = win.URL.createObjectURL(
      new win.Blob([new win.XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
    );
    try {
      const img = new win.Image();
      img.src = url;
      await img.decode();
      const canvas = doc.createElement('canvas');
      canvas.width = pw;
      canvas.height = ph;
      const context = context2d(canvas);
      context.drawImage(img, 0, 0, pw, ph);
      const px = context.getImageData(0, 0, pw, ph).data;
      let x0 = pw,
        y0 = ph,
        x1 = -1,
        y1 = -1,
        opaque = true;
      for (let y = 0; y < ph; y++)
        for (let i = 0; i < pw; i++) {
          const alpha = px[(y * pw + i) * 4 + 3];
          if (!alpha) continue;
          if (alpha < 255) opaque = false;
          if (i < x0) x0 = i;
          if (i > x1) x1 = i;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      if (x1 < 0) hit = { empty: true };
      else {
        x0 = Math.max(0, x0 - 1);
        y0 = Math.max(0, y0 - 1);
        x1 = Math.min(pw - 1, x1 + 1);
        y1 = Math.min(ph - 1, y1 + 1);
        const cw = x1 - x0 + 1,
          ch = y1 - y0 + 1,
          out = doc.createElement('canvas');
        out.width = cw;
        out.height = ch;
        context2d(out).drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
        // 每边都画满（整块铺底）用 JPEG，体积小得多
        const full = opaque && x0 === 0 && y0 === 0 && x1 === pw - 1 && y1 === ph - 1;
        const src = await ctx.raster(full ? out.toDataURL('image/jpeg', 0.92) : out.toDataURL('image/png'));
        hit = { src, x: R.x + (x0 / pw) * R.w, y: R.y + (y0 / ph) * R.h, w: (cw / pw) * R.w, h: (ch / ph) * R.h };
      }
      ctx.rasterCache.set(key, hit);
    } catch {
      rep('raster:fail', run[0]);
      return false;
    } finally {
      win.URL.revokeObjectURL(url);
    }
  }
  const text = run.some(el => el.localName === 'text' || el.querySelector('text'));
  // 画出来是空的：多半是位图里没渲染成功（原元素本来就看不见的情况很少），保留原样并报出来
  if (hit.empty) {
    rep('raster:fail', run[0]);
    return false;
  }
  if (run.some(el => paintAnimated(el, win, ids))) rep('paint:frozen', run[0]);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const fo = mk(doc, 'foreignObject', { x: r3(hit.x), y: r3(hit.y), width: r3(hit.w), height: r3(hit.h) });
  const section = doc.createElementNS('http://www.w3.org/1999/xhtml', 'section') as HTMLElement;
  section.style.cssText = `width:100%;height:100%;margin:0;padding:0;background-image:url("${hit.src}");background-size:100% 100%;background-repeat:no-repeat`;
  fo.appendChild(section);
  run[0].before(fo);
  const copies = text && ctx.copyText ? textCopies(run, parent, win) : null;
  if (copies) fo.after(...copies.nodes);
  for (const el of run) el.remove();
  if (text) rep(copies && !copies.skipped ? 'raster:textCopy' : 'raster:text', fo);
  return true;
}

const TEXT_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'dominant-baseline',
  'baseline-shift',
  'direction',
  'writing-mode',
];
/**
 * 画成位图的文字：每个 <text> 复制一份透明的放在位图上方，读者仍可选中、复制。
 * 副本放在 parent 里，变换写成原文字到 parent 的相对矩阵；继承来的字体属性逐个写明，填充、描边与效果都去掉。
 * 沿路径排列的文字（textPath）引用不到路径，跳过
 */
function textCopies(run: Element[], parent: Element, win: SvgWindow) {
  const P = fromDom((parent as SVGGraphicsElement).getScreenCTM());
  const nodes: Element[] = [];
  let skipped = 0;
  for (const text of run.flatMap(el => (el.localName === 'text' ? [el] : [...el.querySelectorAll('text')]))) {
    const M = fromDom((text as SVGTextElement).getScreenCTM());
    if (!P || !M || text.querySelector('textPath')) {
      skipped++;
      continue;
    }
    const copy = text.cloneNode(true) as SVGTextElement;
    const from = [text, ...text.querySelectorAll('*')],
      to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((el, i) => {
      const target = to[i] as SVGElement;
      if (isAnim(target)) {
        target.remove();
        return;
      }
      for (const attr of ['id', 'class', 'style', 'fill', 'stroke', 'filter', 'mask', 'clip-path', 'data-wxc'])
        target.removeAttribute(attr);
      // 只写与副本所在位置继承来的值不同的属性：副本的上一层是 parent，tspan 的上一层是副本里对应的元素
      const computed = win.getComputedStyle(el),
        up = win.getComputedStyle(i ? (el.parentElement ?? parent) : parent);
      for (const prop of TEXT_PROPS) {
        const value = computed.getPropertyValue(prop);
        // baseline-shift 不继承，与初始值比
        if (value !== (prop === 'baseline-shift' ? '0px' : up.getPropertyValue(prop)))
          target.style.setProperty(prop, value);
      }
      // 属性与 style 各写一份：路径上方的透明文字用的是 fill-opacity 属性（2026-10-20 实测存得住）
      for (const [prop, value] of [
        ['fill', '#000'],
        ['fill-opacity', '0'],
        ['stroke', 'none'],
      ]) {
        target.setAttribute(prop, value);
        target.style.setProperty(prop, value);
      }
    });
    const rel = mul(inv(P), M);
    if (isId(rel)) copy.removeAttribute('transform');
    else copy.setAttribute('transform', matrixAttr(rel));
    nodes.push(copy);
  }
  return { nodes, skipped };
}

/** 依赖 id 的静态部分逐组画成位图；ctx.raster 不可用时跳过（改由 paint 近似） */
export async function rasterAll(
  root: Element,
  ctx: RasterContext,
  win: SvgWindow,
  ids: Map<string, Element>,
  rep: Report,
): Promise<number> {
  const raster = ctx.raster;
  if (!raster) return 0;
  let n = 0;
  for (const run of findUnits(root, win, ids)) if (await rasterize(run, { ...ctx, raster }, win, ids, rep)) n++;
  return n;
}
