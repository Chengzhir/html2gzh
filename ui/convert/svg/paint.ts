// 有动画、不能画成位图的元素：裁切改写成嵌套 svg 视口或 CSS clip-path:path()，滤镜改写成 CSS 滤镜函数，渐变取平均色
import { SVG_NS, hrefOf, refId, isSvg, isAnim, isGraphics, inResource, ownAnims, URL_REF, mk, wrapG } from './dom.ts';
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
import type { Matrix, PathSeg } from './path.ts';
import { bakeStyleTransform } from './transform.ts';
import { attrOf } from '../util.ts';
import type { Report } from './dom.ts';

type Rgba = number[];
/** clipPath 里的一个形状及其到被裁切元素自身坐标系的矩阵 */
interface ClipShape {
  el: SVGElement;
  m: Matrix;
}

const parseColor = (text: string | null): Rgba | null => {
  const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(text || '');
  return match ? [+match[1], +match[2], +match[3], match[4] == null ? 1 : +match[4]] : null;
};
const ownTf = (el: Element): Matrix => {
  const transform = (el as SVGGraphicsElement).transform;
  const base = transform && transform.baseVal.consolidate();
  return base ? fromDom(base.matrix) : ID_M;
};

/** 渐变的平均色（按色标区间加权）；跟着 href 继承色标 */
function averageStops(gradient: Element, ids: Map<string, Element>, win: Window): Rgba | null {
  let stops: Element[] = [];
  for (let node: Element | undefined = gradient, i = 0; node && !stops.length && i < 8; i++) {
    stops = [...node.children].filter(stop => stop.localName === 'stop');
    const href: string | null = refId(hrefOf(node));
    node = href ? ids.get(href) : undefined;
  }
  if (!stops.length) return null;
  // offset 可以写成 0–1 的数或百分数，DOM 里的 offset.baseVal 已换算成 0–1；比前一个小的按前一个算（与绘制时一致）
  let previous = 0;
  const points = stops.map(stop => {
    const computed = win.getComputedStyle(stop),
      color = parseColor(computed.stopColor) || [0, 0, 0, 1];
    previous = Math.max(previous, Math.min(1, (stop as SVGStopElement).offset.baseVal));
    return { o: previous, c: [...color.slice(0, 3), color[3] * +computed.stopOpacity] };
  });
  if (points.length === 1) return points[0].c;
  const acc = [0, 0, 0, 0];
  const segment = (a: Rgba, b: Rgba, w: number) => {
    for (let k = 0; k < 4; k++) acc[k] += ((a[k] + b[k]) / 2) * w;
  };
  segment(points[0].c, points[0].c, points[0].o);
  for (let i = 0; i + 1 < points.length; i++)
    segment(points[i].c, points[i + 1].c, Math.max(0, points[i + 1].o - points[i].o));
  const last = points[points.length - 1];
  segment(last.c, last.c, 1 - last.o);
  return acc;
}
/** 元素自己声明的 url(#…) 填充/描边：渐变换成平均色，其余换成写在后面的备用色（没有就不画） */
function approxPaint(el: SVGElement, ids: Map<string, Element>, win: Window, rep: Report) {
  for (const prop of ['fill', 'stroke']) {
    const value = el.style.getPropertyValue(prop) || el.getAttribute(prop) || '';
    const match = URL_REF.exec(value);
    if (!match) continue;
    const server = ids.get(decodeURIComponent(match[1]));
    const color = server && server.localName.endsWith('Gradient') ? averageStops(server, ids, win) : null;
    const fallback = value.slice(match.index + match[0].length).trim();
    el.removeAttribute(prop);
    el.style.setProperty(
      prop,
      color
        ? `rgba(${color.slice(0, 3).map(Math.round).join(',')},${Math.round(color[3] * 1000) / 1000})`
        : fallback || 'none',
    );
    rep(color ? 'paint:avg' : 'paint:lost', el);
  }
}

/** feGaussianBlur 与常见的投影组合 → CSS blur()/drop-shadow()；其他滤镜返回 null */
function filterToCss(filter: Element, win: Window): string | null {
  if (filter.getAttribute('primitiveUnits') === 'objectBoundingBox') return null;
  const prims = [...filter.children].filter(isSvg);
  const std = (prim: Element): number | null => {
    const values = (prim.getAttribute('stdDeviation') || '0')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return values.length > 1 && values[0] !== values[1] ? null : values[0];
  };
  if (
    prims.length === 1 &&
    prims[0].localName === 'feGaussianBlur' &&
    /^(|SourceGraphic)$/.test(prims[0].getAttribute('in') || '')
  ) {
    const deviation = std(prims[0]);
    return deviation == null ? null : `blur(${deviation}px)`;
  }
  const merge = prims[prims.length - 1];
  if (!merge || merge.localName !== 'feMerge') return null;
  const nodes = [...merge.children].map(node => node.getAttribute('in'));
  if (nodes.length !== 2 || nodes[1] !== 'SourceGraphic') return null;
  let blur = 0,
    dx = 0,
    dy = 0,
    color: string | null = null,
    alpha = 1,
    src: string | null = null;
  for (const prim of prims.slice(0, -1)) {
    const tag = prim.localName;
    if (tag === 'feGaussianBlur') {
      const deviation = std(prim);
      if (deviation == null) return null;
      blur = Math.hypot(blur, deviation);
      src ||= prim.getAttribute('in') || 'SourceGraphic';
    } else if (tag === 'feOffset') {
      dx += +(prim.getAttribute('dx') || 0);
      dy += +(prim.getAttribute('dy') || 0);
      src ||= prim.getAttribute('in') || 'SourceGraphic';
    } else if (tag === 'feFlood') {
      color = win.getComputedStyle(prim).floodColor;
      alpha = +win.getComputedStyle(prim).floodOpacity;
    } else if (tag === 'feComposite') {
      if ((prim.getAttribute('operator') || 'over') !== 'in') return null;
    } else if (tag === 'feColorMatrix') {
      const values = (prim.getAttribute('values') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        prim.getAttribute('type') !== 'matrix' ||
        values.length !== 20 ||
        values.slice(0, 15).some(x => x !== 0) ||
        values.slice(15, 18).some(x => x !== 0) ||
        values[19] !== 0
      )
        return null;
      alpha *= values[18];
      color ||= 'rgb(0,0,0)';
    } else return null;
  }
  // 只认用 SourceAlpha 做影子的写法；拿 SourceGraphic 本身模糊的"发光"颜色跟着图形走，CSS 表达不了
  const rgba = src === 'SourceAlpha' && parseColor(color || 'rgb(0,0,0)');
  if (!rgba) return null;
  return `drop-shadow(${dx}px ${dy}px ${Math.round(blur * 2 * 1000) / 1000}px rgba(${rgba.slice(0, 3).join(',')},${Math.round(rgba[3] * alpha * 1000) / 1000}))`;
}

const GEOM = /^(x|y|width|height|r|rx|ry|cx|cy|d|points|x1|x2|y1|y2)$/;
/** 子树里有没有会改变 el 包围盒（el 自身坐标系）的动画：el 自己的变换不算，子孙的变换算 */
const boxMoves = (el: Element): boolean =>
  [el, ...el.querySelectorAll('*')].some(
    node =>
      isSvg(node) &&
      ownAnims(node).some(anim => {
        const name = anim.getAttribute('attributeName') || '';
        const moves =
          anim.localName === 'animateMotion' || anim.localName === 'animateTransform' || name === 'transform';
        return node === el ? !moves && GEOM.test(name) : moves || GEOM.test(name);
      }),
  );
const vbOriginZero = (el: SVGElement): boolean => {
  const viewBox = el.ownerSVGElement && el.ownerSVGElement.viewBox.baseVal;
  return !viewBox || !viewBox.width || (viewBox.x === 0 && viewBox.y === 0);
};
/** clipPath 里的形状及其到元素自身坐标系的矩阵；有文字、use 之类转不了的返回 null */
function clipShapes(clipPath: Element, el: SVGGraphicsElement): ClipShape[] | null {
  let m0 = ownTf(clipPath);
  if (clipPath.getAttribute('clipPathUnits') === 'objectBoundingBox') {
    let bbox: DOMRect;
    try {
      bbox = el.getBBox();
    } catch {
      return null;
    }
    m0 = mul([bbox.width, 0, 0, bbox.height, bbox.x, bbox.y], m0);
  }
  if (clipPath.hasAttribute('clip-path')) return null;
  const out: ClipShape[] = [];
  for (const kid of clipPath.children) {
    if (!isSvg(kid) || isAnim(kid) || /^(title|desc|metadata)$/.test(kid.localName)) continue;
    if (kid.getAttribute('display') === 'none' || kid.style.display === 'none') continue;
    if (!/^(rect|circle|ellipse|line|polyline|polygon|path)$/.test(kid.localName)) return null;
    out.push({ el: kid, m: mul(m0, ownTf(kid)) });
  }
  return out;
}

/** 不旋转的单个矩形裁切 → 嵌套 svg 视口；矩形的 x/y/width/height 动画搬到视口上（实测与 clipPath 逐像素一致） */
function rectClip(doc: Document, el: SVGGraphicsElement, shapes: ClipShape[]): boolean {
  if (shapes.length !== 1 || shapes[0].el.localName !== 'rect') return false;
  const { el: rect, m } = shapes[0],
    g = geometryReader(rect);
  if (g('rx') || g('ry') || m[1] || m[2] || m[0] <= 0 || m[3] <= 0) return false;
  const anims = ownAnims(rect);
  if (
    anims.some(
      a =>
        !/^(animate|set)$/.test(a.localName) ||
        !/^(x|y|width|height)$/.test(attrOf(a, 'attributeName')) ||
        a.hasAttribute('by') ||
        a.getAttribute('additive') === 'sum',
    )
  )
    return false;
  if (anims.filter(a => /^(x|y)$/.test(attrOf(a, 'attributeName'))).length > 1 || !bakeStyleTransform(el)) return false;
  const x = m[0] * (g('x') || 0) + m[4],
    y = m[3] * (g('y') || 0) + m[5];
  // 裁切区域在元素自身变换之后的坐标系里：元素的变换（含变换动画）挪到最外层
  const outer = wrapG(el, { transform: el.getAttribute('transform') });
  el.removeAttribute('transform');
  for (const a of ownAnims(el)) if (/^(animateMotion|animateTransform)$/.test(a.localName)) outer.appendChild(a);
  const viewport = mk(doc, 'svg', {
    x,
    y,
    width: Math.max(0, m[0] * (g('width') || 0)),
    height: Math.max(0, m[3] * (g('height') || 0)),
    overflow: 'hidden',
  });
  const inner = mk(doc, 'g', { transform: `translate(${-x} ${-y})` });
  outer.appendChild(viewport);
  viewport.appendChild(inner);
  inner.appendChild(el);
  for (const a of anims) {
    const attrName = a.getAttribute('attributeName'),
      sx = attrName === 'x' || attrName === 'width';
    const map = (value: string) =>
      (sx ? m[0] : m[3]) * parseFloat(value) + (attrName === 'x' ? m[4] : attrName === 'y' ? m[5] : 0);
    const copy = a.cloneNode(false) as Element;
    for (const k of ['values', 'from', 'to'])
      if (copy.hasAttribute(k))
        copy.setAttribute(
          k,
          attrOf(copy, k)
            .split(';')
            .map(value => map(value.trim()))
            .join(';'),
        );
    viewport.appendChild(copy);
    if (attrName !== 'x' && attrName !== 'y') continue;
    // 视口挪动时内容要反向平移，才能留在原处
    const translate = mk(doc, 'animateTransform', { attributeName: 'transform', type: 'translate' });
    for (const k of a.getAttributeNames())
      if (!/^(attributeName|values|from|to|additive|accumulate)$/.test(k)) translate.setAttribute(k, attrOf(a, k));
    for (const k of ['values', 'from', 'to'])
      if (copy.hasAttribute(k))
        translate.setAttribute(
          k,
          attrOf(copy, k)
            .split(';')
            .map(v => (attrName === 'x' ? `${-Number(v)} ${-y}` : `${-x} ${-Number(v)}`))
            .join(';'),
        );
    if (a.localName === 'set') {
      translate.setAttribute('values', attrOf(translate, 'to'));
      translate.removeAttribute('to');
    }
    inner.appendChild(translate);
  }
  return true;
}

/** 引用的 clipPath 改写为不依赖 id 的写法；没有形状时整个裁掉。改写不了返回 false */
function replaceClip(doc: Document, el: SVGGraphicsElement, clipPath: Element, win: Window, rep: Report): boolean {
  const shapes = clipShapes(clipPath, el);
  if (!shapes) return false;
  if (!shapes.length) {
    el.style.setProperty('clip-path', 'inset(50%)');
    return true;
  }
  return rectClip(doc, el, shapes) || pathClip(el, shapes, win, rep);
}

/** 其余形状合成一条路径 → clip-path:path()。参照框用 view-box（实测等于 userSpaceOnUse）；视口原点不在 0,0 时改用 fill-box 并按包围盒平移 */
function pathClip(el: SVGGraphicsElement, shapes: ClipShape[], win: Window, rep: Report): boolean {
  let segs: PathSeg[] = [];
  for (const { el: shape, m } of shapes) {
    const shapePath = shapeSegs(shape, geometryReader(shape));
    if (!shapePath) return false;
    const parts = subpaths(transformPath(shapePath, m));
    // 几个形状并成一条路径用 nonzero 填充：外轮廓统一绕向，重叠处才不会互相抵消
    const area = parts.reduce((n, part) => n + signedArea(part), 0);
    for (const part of parts) segs.push(...(area < 0 ? reverseSubpath(part) : part));
  }
  const rules = shapes.map(({ el: shape }) => win.getComputedStyle(shape).clipRule);
  if (shapes.length > 1 && rules.includes('evenodd')) rep('clip:approx', el);
  const fillRule = shapes.length === 1 && rules[0] === 'evenodd' ? 'evenodd, ' : '';
  let box = 'view-box';
  if (!vbOriginZero(el)) {
    if (boxMoves(el)) return false;
    const bbox = el.getBBox();
    segs = transformPath(segs, [1, 0, 0, 1, -bbox.x, -bbox.y]);
    box = 'fill-box';
  }
  el.style.setProperty('clip-path', `path(${fillRule}'${serializePath(segs)}') ${box}`);
  return true;
}

/**
 * 画成位图之后还依赖 id 的元素（多半是有动画的）：裁切、滤镜就地改写，渐变取平均色，蒙版去掉，标记与 textPath 报出来。
 * style 里的 filter 函数挪到属性上：公众号删 style 里的 filter，留 filter 属性
 */
export function fixRefs(
  root: Element,
  ids: Map<string, Element>,
  win: Window,
  rep: Report,
): { clip: number; filter: number } {
  const doc = root.ownerDocument,
    n = { clip: 0, filter: 0 };
  for (const el of [...root.getElementsByTagNameNS(SVG_NS, '*')] as SVGElement[]) {
    if (!el.isConnected || isAnim(el) || inResource(el)) continue;
    const styleFilter = el.style.getPropertyValue('filter');
    if (styleFilter && !URL_REF.test(styleFilter)) {
      el.style.removeProperty('filter');
      el.setAttribute('filter', styleFilter);
    }
    approxPaint(el, ids, win, rep);
    const clipValue = el.style.getPropertyValue('clip-path') || el.getAttribute('clip-path') || '';
    let match = URL_REF.exec(clipValue);
    if (match) {
      const clipPath = ids.get(decodeURIComponent(match[1]));
      el.removeAttribute('clip-path');
      el.style.removeProperty('clip-path');
      if (clipPath && clipPath.localName === 'clipPath') {
        if (isGraphics(el) && replaceClip(doc, el, clipPath, win, rep)) n.clip++;
        else rep('ref:clip', el);
      }
    }
    const filterValue = el.getAttribute('filter') || '';
    match = URL_REF.exec(filterValue) || URL_REF.exec(el.style.getPropertyValue('filter'));
    if (match) {
      const filter = ids.get(decodeURIComponent(match[1]));
      const css = filter && filter.localName === 'filter' && filterToCss(filter, win);
      el.style.removeProperty('filter');
      if (css) {
        el.setAttribute('filter', css);
        n.filter++;
      } else {
        el.removeAttribute('filter');
        if (filter) rep('ref:filter', el);
      }
    }
    const computed = win.getComputedStyle(el);
    if (URL_REF.test(computed.getPropertyValue('mask'))) {
      el.removeAttribute('mask');
      el.style.removeProperty('mask');
      rep('ref:mask', el);
    }
    if (['marker-start', 'marker-mid', 'marker-end'].some(prop => URL_REF.test(computed.getPropertyValue(prop))))
      rep('ref:marker', el);
    if (el.localName === 'textPath') rep('ref:textPath', el);
  }
  return n;
}
