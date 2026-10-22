// SVG 转换共用的小工具与公众号规则（规则来自草稿存储实测，见 tools/wxprobe.mjs）

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

export const isSvg = n => n && n.nodeType === 1 && n.namespaceURI === SVG_NS;
export const isAnim = n => isSvg(n) && ANIM.has(n.localName);
export const hrefOf = el => el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href');
export const refId = s => {
  const m = /^\s*#(.+?)\s*$/.exec(s || '');
  return m ? decodeURIComponent(m[1]) : null;
};
/** 同一文档的 url(#id) 引用：计算样式里会被补成 url("about:srcdoc#id") 之类的绝对地址 */
export const URL_REF = /url\(\s*["']?(?:[^"')#]*)#([^"')]+)["']?\s*\)/;
export const fixUrls = s => s.replace(/url\(\s*["']?[^"')#]*#([^"')]+)["']?\s*\)/g, 'url(#$1)');

/** 动画作用的元素：href 指向的元素，否则父元素 */
export function targetOf(a, ids) {
  const h = refId(hrefOf(a));
  return h ? ids.get(h) || null : a.parentElement;
}
/** 在不画出来的容器里（defs、symbol、渐变……） */
export function inResource(el) {
  for (let a = el.parentElement; a && isSvg(a); a = a.parentElement) if (NON_RENDER.has(a.localName)) return true;
  return false;
}
export const outerSvg = el => {
  let r = null;
  for (let a = el; a && isSvg(a); a = a.parentElement) if (a.localName === 'svg') r = a;
  return r;
};
export const svgKids = el => [...el.children].filter(isSvg);
export const ownAnims = el => svgKids(el).filter(k => ANIM.has(k.localName));
export const hasAnim = el => [...el.getElementsByTagNameNS(SVG_NS, '*')].some(n => ANIM.has(n.localName));

/**
 * x/y 的 <animate>/<set>（元素换成没有 x/y 的 g 或 foreignObject 外层时用）→ 相对原位置平移的 animateTransform；
 * base 是静态的 x/y。by 本来就是增量；additive="sum" 的保持增量
 */
export function xyToTranslate(a, base) {
  const p = a.getAttribute('attributeName'),
    sum = a.getAttribute('additive') === 'sum';
  const at = mk(a.ownerDocument, 'animateTransform', {
    attributeName: 'transform',
    type: 'translate',
    additive: 'sum',
  });
  for (const k of a.getAttributeNames())
    if (!/^(attributeName|attributeType|values|from|to|by|additive)$/.test(k)) at.setAttribute(k, a.getAttribute(k));
  for (const k of ['values', 'from', 'to', 'by']) {
    if (!a.hasAttribute(k)) continue;
    at.setAttribute(
      k,
      a
        .getAttribute(k)
        .split(';')
        .filter(s => s.trim())
        .map(s => {
          const d = parseFloat(s) - (k === 'by' || sum ? 0 : base);
          return p === 'x' ? `${d} 0` : `0 ${d}`;
        })
        .join(';'),
    );
  }
  if (a.localName === 'set') {
    at.setAttribute('values', at.getAttribute('to'));
    at.removeAttribute('to');
  }
  return at;
}

export function mk(doc: Document, tag: string, attrs: Record<string, unknown> = {}) {
  const e = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
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
  const m = new Map<string, { n: number; roots: Set<Element> }>();
  const add = (key: string, el: Element | null, n = 1) => {
    let t = m.get(key);
    if (!t) m.set(key, (t = { n: 0, roots: new Set() }));
    t.n += n;
    const r = el && outerSvg(el);
    if (r) t.roots.add(r);
  };
  return {
    m,
    add,
    n: k => (m.get(k) || { n: 0 }).n,
    roots: (k: string): Element[] => [...((m.get(k) || ({} as { roots?: Set<Element> })).roots || [])],
  };
}
