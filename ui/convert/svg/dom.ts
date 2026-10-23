// SVG 转换共用的小工具与公众号规则（规则来自草稿存储实测，见 tools/wxprobe.mjs）

import { attrOf } from '../util.ts';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
export const ANIM = new Set(['animate', 'set', 'animateTransform', 'animateMotion']);
/** 存储后还在的 <animate>/<set> attributeName；其余的整条被删 */
export const WX_ANIM_OK = new Set([
  'x',
  'y',
  'width',
  'height',
  'r',
  'points',
  'd',
  'fill',
  'opacity',
  'stroke-width',
  'stroke-dashoffset',
  'visibility',
  'transform',
]);
/** 不画出来、只被引用的容器 */
export const RESOURCE = new Set([
  'linearGradient',
  'radialGradient',
  'pattern',
  'filter',
  'mask',
  'clipPath',
  'marker',
  'symbol',
]);
const NON_RENDER = new Set([...RESOURCE, 'defs']);

export const isSvg = (node: Node | null | undefined): node is SVGElement =>
  !!node && node.nodeType === 1 && (node as Element).namespaceURI === SVG_NS;
/** 属性值；没有这个属性时为空串（用在已知有这个属性的地方，如 hasAttribute、getAttributeNames 之后） */
export const isAnim = (node: Node | null | undefined): node is SVGAnimationElement =>
  isSvg(node) && ANIM.has(node.localName);
/** 能取变换矩阵的图形元素（图形、容器、文字）；按方法判断，iframe 里的元素 instanceof 不认外层的类 */
export const isGraphics = (node: Node | null | undefined): node is SVGGraphicsElement =>
  isSvg(node) && typeof (node as SVGGraphicsElement).getCTM === 'function';
export const hrefOf = (el: Element): string | null => el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href');
export const refId = (text: string | null | undefined): string | null => {
  const match = /^\s*#(.+?)\s*$/.exec(text || '');
  return match ? decodeURIComponent(match[1]) : null;
};
/** 同一文档的 url(#id) 引用：计算样式里会被补成 url("about:srcdoc#id") 之类的绝对地址 */
export const URL_REF = /url\(\s*["']?(?:[^"')#]*)#([^"')]+)["']?\s*\)/;
export const fixUrls = (text: string): string => text.replace(/url\(\s*["']?[^"')#]*#([^"')]+)["']?\s*\)/g, 'url(#$1)');

/** 动画作用的元素：href 指向的元素，否则父元素 */
export function targetOf(anim: Element, ids: Map<string, Element>): Element | null {
  const href = refId(hrefOf(anim));
  return href ? ids.get(href) || null : anim.parentElement;
}
/** 在不画出来的容器里（defs、symbol、渐变……） */
export function inResource(el: Element): boolean {
  for (let ancestor = el.parentElement; ancestor && isSvg(ancestor); ancestor = ancestor.parentElement)
    if (NON_RENDER.has(ancestor.localName)) return true;
  return false;
}
export const outerSvg = (el: Element): Element | null => {
  let outer: Element | null = null;
  for (let ancestor: Element | null = el; ancestor && isSvg(ancestor); ancestor = ancestor.parentElement)
    if (ancestor.localName === 'svg') outer = ancestor;
  return outer;
};
export const svgKids = (el: Element): SVGElement[] => [...el.children].filter(isSvg);
export const ownAnims = (el: Element): SVGElement[] => svgKids(el).filter(kid => ANIM.has(kid.localName));
export const hasAnim = (el: Element): boolean =>
  [...el.getElementsByTagNameNS(SVG_NS, '*')].some(node => ANIM.has(node.localName));

/**
 * x/y 的 <animate>/<set>（元素换成没有 x/y 的 g 或 foreignObject 外层时用）→ 相对原位置平移的 animateTransform；
 * base 是静态的 x/y。by 本来就是增量；additive="sum" 的保持增量
 */
export function xyToTranslate(anim: Element, base: number): Element {
  const attrName = anim.getAttribute('attributeName'),
    sum = anim.getAttribute('additive') === 'sum';
  const animTransform = mk(anim.ownerDocument, 'animateTransform', {
    attributeName: 'transform',
    type: 'translate',
    additive: 'sum',
  });
  for (const name of anim.getAttributeNames())
    if (!/^(attributeName|attributeType|values|from|to|by|additive)$/.test(name))
      animTransform.setAttribute(name, attrOf(anim, name));
  for (const name of ['values', 'from', 'to', 'by']) {
    if (!anim.hasAttribute(name)) continue;
    animTransform.setAttribute(
      name,
      attrOf(anim, name)
        .split(';')
        .filter(value => value.trim())
        .map(value => {
          const delta = parseFloat(value) - (name === 'by' || sum ? 0 : base);
          return attrName === 'x' ? `${delta} 0` : `0 ${delta}`;
        })
        .join(';'),
    );
  }
  if (anim.localName === 'set') {
    animTransform.setAttribute('values', attrOf(animTransform, 'to'));
    animTransform.removeAttribute('to');
  }
  return animTransform;
}

export function mk(doc: Document, tag: string, attrs: Record<string, unknown> = {}) {
  const e = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) if (value != null) e.setAttribute(name, String(value));
  return e;
}
/** 用一个 <g> 把元素包起来，返回这个 g */
export function wrapG(el: Element, attrs?: Record<string, unknown>) {
  const g = mk(el.ownerDocument, 'g', attrs);
  el.before(g);
  g.appendChild(el);
  return g;
}

/** 汇总要报给用户的情况：同类合并计数，记下所在的最外层 svg */
export function tally() {
  const counts = new Map<string, { n: number; roots: Set<Element> }>();
  const add = (key: string, el: Element | null, n = 1) => {
    const entry = counts.getOrInsertComputed(key, () => ({ n: 0, roots: new Set<Element>() }));
    entry.n += n;
    const root = el && outerSvg(el);
    if (root) entry.roots.add(root);
  };
  return {
    m: counts,
    add,
    n: (key: string) => (counts.get(key) || { n: 0 }).n,
    roots: (key: string): Element[] => [...(counts.get(key)?.roots ?? [])],
  };
}
export type Report = ReturnType<typeof tally>['add'];
