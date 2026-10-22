// 有动画、不能画成位图的元素：裁切改写成嵌套 svg 视口或 CSS clip-path:path()，滤镜改写成 CSS 滤镜函数，渐变取平均色
import { SVG_NS, isSvg, isAnim, inResource, ownAnims, URL_REF, mk, wrapG } from './dom.ts';
import {
  shapeSegs,
  geometryReader,
  transformPath,
  serializePath,
  subpaths,
  signedArea,
  reverseSubpath,
  mul,
  fromDom,
  ID_M,
} from './path.ts';
import { bakeStyleTransform } from './transform.ts';

const parseColor = s => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s || '');
  return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null;
};
const ownTf = el => {
  const b = el.transform && el.transform.baseVal.consolidate();
  return b ? fromDom(b.matrix) : ID_M;
};

/** 渐变的平均色（按色标区间加权）；跟着 href 继承色标 */
function averageStops(g, ids, win) {
  let stops = [];
  for (let n = g, i = 0; n && !stops.length && i < 8; i++) {
    stops = [...n.children].filter(s => s.localName === 'stop');
    const h = (n.getAttribute('href') || '').replace(/^#/, '');
    n = h ? ids.get(h) : null;
  }
  if (!stops.length) return null;
  const pts = stops.map(s => {
    const cs = win.getComputedStyle(s),
      c = parseColor(cs.stopColor) || [0, 0, 0, 1];
    return {
      o: Math.min(1, Math.max(0, parseFloat(s.getAttribute('offset')) || 0)),
      c: [...c.slice(0, 3), c[3] * +cs.stopOpacity],
    };
  });
  if (pts.length === 1) return pts[0].c;
  const acc = [0, 0, 0, 0];
  const seg = (a, b, w) => {
    for (let k = 0; k < 4; k++) acc[k] += ((a[k] + b[k]) / 2) * w;
  };
  seg(pts[0].c, pts[0].c, pts[0].o);
  for (let i = 0; i + 1 < pts.length; i++) seg(pts[i].c, pts[i + 1].c, Math.max(0, pts[i + 1].o - pts[i].o));
  const last = pts[pts.length - 1];
  seg(last.c, last.c, 1 - last.o);
  return acc;
}
/** 元素自己声明的 url(#…) 填充/描边：渐变换成平均色，其余换成写在后面的备用色（没有就不画） */
function approxPaint(el, ids, win, rep) {
  for (const p of ['fill', 'stroke']) {
    const v = el.style.getPropertyValue(p) || el.getAttribute(p) || '';
    const m = URL_REF.exec(v);
    if (!m) continue;
    const g = ids.get(decodeURIComponent(m[1]));
    const c = g && /Gradient$/.test(g.localName) ? averageStops(g, ids, win) : null;
    const fb = v.slice(m.index + m[0].length).trim();
    el.removeAttribute(p);
    el.style.setProperty(
      p,
      c ? `rgba(${c.slice(0, 3).map(Math.round).join(',')},${Math.round(c[3] * 1000) / 1000})` : fb || 'none',
    );
    rep(c ? 'paint:avg' : 'paint:lost', el);
  }
}

/** feGaussianBlur 与常见的投影组合 → CSS blur()/drop-shadow()；其他滤镜返回 null */
function filterToCss(f, win) {
  if (f.getAttribute('primitiveUnits') === 'objectBoundingBox') return null;
  const prims = [...f.children].filter(isSvg);
  const std = p => {
    const v = (p.getAttribute('stdDeviation') || '0')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return v.length > 1 && v[0] !== v[1] ? null : v[0];
  };
  if (
    prims.length === 1 &&
    prims[0].localName === 'feGaussianBlur' &&
    /^(|SourceGraphic)$/.test(prims[0].getAttribute('in') || '')
  ) {
    const s = std(prims[0]);
    return s == null ? null : `blur(${s}px)`;
  }
  const merge = prims[prims.length - 1];
  if (!merge || merge.localName !== 'feMerge') return null;
  const nodes = [...merge.children].map(n => n.getAttribute('in'));
  if (nodes.length !== 2 || nodes[1] !== 'SourceGraphic') return null;
  let blur = 0,
    dx = 0,
    dy = 0,
    color = null,
    alpha = 1,
    src = null;
  for (const p of prims.slice(0, -1)) {
    const t = p.localName;
    if (t === 'feGaussianBlur') {
      const s = std(p);
      if (s == null) return null;
      blur = Math.hypot(blur, s);
      src = src || p.getAttribute('in') || 'SourceGraphic';
    } else if (t === 'feOffset') {
      dx += +(p.getAttribute('dx') || 0);
      dy += +(p.getAttribute('dy') || 0);
      src = src || p.getAttribute('in') || 'SourceGraphic';
    } else if (t === 'feFlood') {
      color = win.getComputedStyle(p).floodColor;
      alpha = +win.getComputedStyle(p).floodOpacity;
    } else if (t === 'feComposite') {
      if ((p.getAttribute('operator') || 'over') !== 'in') return null;
    } else if (t === 'feColorMatrix') {
      const v = (p.getAttribute('values') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        p.getAttribute('type') !== 'matrix' ||
        v.length !== 20 ||
        v.slice(0, 15).some(x => x !== 0) ||
        v.slice(15, 18).some(x => x !== 0) ||
        v[19] !== 0
      )
        return null;
      alpha *= v[18];
      color = color || 'rgb(0,0,0)';
    } else return null;
  }
  // 只认用 SourceAlpha 做影子的写法；拿 SourceGraphic 本身模糊的"发光"颜色跟着图形走，CSS 表达不了
  const c = src === 'SourceAlpha' && parseColor(color || 'rgb(0,0,0)');
  if (!c) return null;
  return `drop-shadow(${dx}px ${dy}px ${Math.round(blur * 2 * 1000) / 1000}px rgba(${c.slice(0, 3).join(',')},${Math.round(c[3] * alpha * 1000) / 1000}))`;
}

const GEOM = /^(x|y|width|height|r|rx|ry|cx|cy|d|points|x1|x2|y1|y2)$/;
/** 子树里有没有会改变 el 包围盒（el 自身坐标系）的动画：el 自己的变换不算，子孙的变换算 */
const boxMoves = el =>
  [el, ...el.querySelectorAll('*')].some(
    d =>
      isSvg(d) &&
      ownAnims(d).some(a => {
        const name = a.getAttribute('attributeName') || '';
        const moves = a.localName === 'animateMotion' || a.localName === 'animateTransform' || name === 'transform';
        return d === el ? !moves && GEOM.test(name) : moves || GEOM.test(name);
      }),
  );
const vbOriginZero = el => {
  const v = el.ownerSVGElement && el.ownerSVGElement.viewBox.baseVal;
  return !v || !v.width || (v.x === 0 && v.y === 0);
};
/** clipPath 里的形状及其到元素自身坐标系的矩阵；有文字、use 之类转不了的返回 null */
function clipShapes(cp, el) {
  let m0 = ownTf(cp);
  if (cp.getAttribute('clipPathUnits') === 'objectBoundingBox') {
    let b;
    try {
      b = el.getBBox();
    } catch {
      return null;
    }
    m0 = mul([b.width, 0, 0, b.height, b.x, b.y], m0);
  }
  if (cp.hasAttribute('clip-path')) return null;
  const out = [];
  for (const k of cp.children) {
    if (!isSvg(k) || isAnim(k) || /^(title|desc|metadata)$/.test(k.localName)) continue;
    if (k.getAttribute('display') === 'none' || k.style.display === 'none') continue;
    if (!/^(rect|circle|ellipse|line|polyline|polygon|path)$/.test(k.localName)) return null;
    out.push({ el: k, m: mul(m0, ownTf(k)) });
  }
  return out;
}

/** 不旋转的单个矩形裁切 → 嵌套 svg 视口；矩形的 x/y/width/height 动画搬到视口上（实测与 clipPath 逐像素一致） */
function rectClip(doc, el, sh) {
  if (sh.length !== 1 || sh[0].el.localName !== 'rect') return false;
  const { el: r, m } = sh[0],
    g = geometryReader(r);
  if (g('rx') || g('ry') || m[1] || m[2] || m[0] <= 0 || m[3] <= 0) return false;
  const anims = ownAnims(r);
  if (
    anims.some(
      a =>
        !/^(animate|set)$/.test(a.localName) ||
        !/^(x|y|width|height)$/.test(a.getAttribute('attributeName')) ||
        a.hasAttribute('by') ||
        a.getAttribute('additive') === 'sum',
    )
  )
    return false;
  if (anims.filter(a => /^(x|y)$/.test(a.getAttribute('attributeName'))).length > 1 || !bakeStyleTransform(el))
    return false;
  const x = m[0] * (g('x') || 0) + m[4],
    y = m[3] * (g('y') || 0) + m[5];
  // 裁切区域在元素自身变换之后的坐标系里：元素的变换（含变换动画）挪到最外层
  const outer = wrapG(el, { transform: el.getAttribute('transform') });
  el.removeAttribute('transform');
  for (const a of ownAnims(el)) if (/^(animateMotion|animateTransform)$/.test(a.localName)) outer.appendChild(a);
  const vp = mk(doc, 'svg', {
    x,
    y,
    width: Math.max(0, m[0] * (g('width') || 0)),
    height: Math.max(0, m[3] * (g('height') || 0)),
    overflow: 'hidden',
  });
  const inner = mk(doc, 'g', { transform: `translate(${-x} ${-y})` });
  outer.appendChild(vp);
  vp.appendChild(inner);
  inner.appendChild(el);
  for (const a of anims) {
    const p = a.getAttribute('attributeName'),
      sx = p === 'x' || p === 'width';
    const map = s => (sx ? m[0] : m[3]) * parseFloat(s) + (p === 'x' ? m[4] : p === 'y' ? m[5] : 0);
    const c = a.cloneNode(false);
    for (const k of ['values', 'from', 'to'])
      if (c.hasAttribute(k))
        c.setAttribute(
          k,
          c
            .getAttribute(k)
            .split(';')
            .map(s => map(s.trim()))
            .join(';'),
        );
    vp.appendChild(c);
    if (p !== 'x' && p !== 'y') continue;
    // 视口挪动时内容要反向平移，才能留在原处
    const t = mk(doc, 'animateTransform', { attributeName: 'transform', type: 'translate' });
    for (const k of a.getAttributeNames())
      if (!/^(attributeName|values|from|to|additive|accumulate)$/.test(k)) t.setAttribute(k, a.getAttribute(k));
    for (const k of ['values', 'from', 'to'])
      if (c.hasAttribute(k))
        t.setAttribute(
          k,
          c
            .getAttribute(k)
            .split(';')
            .map(v => (p === 'x' ? `${-v} ${-y}` : `${-x} ${-v}`))
            .join(';'),
        );
    if (a.localName === 'set') {
      t.setAttribute('values', t.getAttribute('to'));
      t.removeAttribute('to');
    }
    inner.appendChild(t);
  }
  return true;
}

/** 其余形状合成一条路径 → clip-path:path()。参照框用 view-box（实测等于 userSpaceOnUse）；视口原点不在 0,0 时改用 fill-box 并按包围盒平移 */
function pathClip(el, sh, win, rep) {
  let segs = [];
  for (const { el: k, m } of sh) {
    const s = shapeSegs(k, geometryReader(k));
    if (!s) return false;
    const sp = subpaths(transformPath(s, m));
    // 几个形状并成一条路径用 nonzero 填充：外轮廓统一绕向，重叠处才不会互相抵消
    const area = sp.reduce((n, p) => n + signedArea(p), 0);
    segs = segs.concat(...(area < 0 ? sp.map(reverseSubpath) : sp));
  }
  const rules = sh.map(({ el: k }) => win.getComputedStyle(k).clipRule);
  if (sh.length > 1 && rules.includes('evenodd')) rep('clip:approx', el);
  const fr = sh.length === 1 && rules[0] === 'evenodd' ? 'evenodd, ' : '';
  let box = 'view-box';
  if (!vbOriginZero(el)) {
    if (boxMoves(el)) return false;
    const b = el.getBBox();
    segs = transformPath(segs, [1, 0, 0, 1, -b.x, -b.y]);
    box = 'fill-box';
  }
  el.style.setProperty('clip-path', `path(${fr}'${serializePath(segs)}') ${box}`);
  return true;
}

/**
 * 画成位图之后还依赖 id 的元素（多半是有动画的）：裁切、滤镜就地改写，渐变取平均色，蒙版去掉，标记与 textPath 报出来。
 * style 里的 filter 函数挪到属性上：公众号删 style 里的 filter，留 filter 属性
 */
export function fixRefs(root, ids, win, rep) {
  const doc = root.ownerDocument,
    n = { clip: 0, filter: 0 };
  for (const el of [...root.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (!el.isConnected || isAnim(el) || inResource(el)) continue;
    const sf = el.style.getPropertyValue('filter');
    if (sf && !URL_REF.test(sf)) {
      el.style.removeProperty('filter');
      el.setAttribute('filter', sf);
    }
    approxPaint(el, ids, win, rep);
    const cv = el.style.getPropertyValue('clip-path') || el.getAttribute('clip-path') || '';
    let m = URL_REF.exec(cv);
    if (m) {
      const cp = ids.get(decodeURIComponent(m[1]));
      el.removeAttribute('clip-path');
      el.style.removeProperty('clip-path');
      if (cp && cp.localName === 'clipPath') {
        const sh = clipShapes(cp, el);
        if (sh && !sh.length) {
          el.style.setProperty('clip-path', 'inset(50%)');
          n.clip++;
        } else if (sh && (rectClip(doc, el, sh) || pathClip(el, sh, win, rep))) n.clip++;
        else rep('ref:clip', el);
      }
    }
    const fv = el.getAttribute('filter') || '';
    m = URL_REF.exec(fv) || URL_REF.exec(el.style.getPropertyValue('filter'));
    if (m) {
      const f = ids.get(decodeURIComponent(m[1]));
      const css = f && f.localName === 'filter' && filterToCss(f, win);
      el.style.removeProperty('filter');
      if (css) {
        el.setAttribute('filter', css);
        n.filter++;
      } else {
        el.removeAttribute('filter');
        if (f) rep('ref:filter', el);
      }
    }
    const cs = win.getComputedStyle(el);
    if (URL_REF.test(cs.getPropertyValue('mask'))) {
      el.removeAttribute('mask');
      el.style.removeProperty('mask');
      rep('ref:mask', el);
    }
    if (['marker-start', 'marker-mid', 'marker-end'].some(p => URL_REF.test(cs.getPropertyValue(p))))
      rep('ref:marker', el);
    if (el.localName === 'textPath') rep('ref:textPath', el);
  }
  return n;
}
