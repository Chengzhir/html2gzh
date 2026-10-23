// CSS 变换 ↔ SVG：解析关键帧里的变换函数、对齐成同构列表、量变换原点与百分比参照框
import { mul, inv, isId, ID_M, fromDom, matrixAttr } from './path.ts';
import type { Matrix } from './path.ts';

/** SMIL 的 animateTransform 能写的变换类型 */
export type TransformType = 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY';
/** 一个变换函数：t 是类型，a 是参数（长度 user units，角度 deg） */
export interface TransformFn {
  t: TransformType;
  a: number[];
}
/** 百分比参照框 { bw, bh }（user units）；unit 是 1 CSS px 合多少 user units，没有时按 1 */
export interface PercentBox {
  bw: number;
  bh: number;
  unit?: number;
}
/** measureBox 的结果：变换原点 (ox, oy) 与百分比参照框 (bw, bh)，都在元素自身的坐标系 */
export interface TransformBox extends PercentBox {
  ox: number;
  oy: number;
}

const ANG: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
const angle = (text: string): number | null => {
  const match = /^(-?[\d.]+(?:e-?\d+)?)(deg|grad|rad|turn)?$/.exec(text.trim());
  return match && (match[2] || +match[1] === 0) ? +match[1] * ANG[match[2] || 'deg'] : null;
};
const factor = (text: string): number | null => {
  const match = /^(-?[\d.]+(?:e-?\d+)?)(%)?$/.exec(text.trim());
  return match ? +match[1] / (match[2] ? 100 : 1) : null;
};
/** 长度 → user units；box 是百分比参照框 { bw, bh }，box.unit 是 1 CSS px 合多少 user units（最外层 svg 有 viewBox 时不为 1），fontSize 是字号 */
function length(text: string, axis: 'x' | 'y', box: PercentBox, fontSize: number): number | null {
  const match = /^(-?[\d.]+(?:e-?\d+)?)(px|%|em)?$/.exec(text.trim());
  if (!match) return null;
  const n = +match[1];
  if (!match[2]) return n === 0 ? 0 : null;
  if (match[2] === 'px') return n * (box.unit ?? 1);
  if (match[2] === 'em') return n * fontSize * (box.unit ?? 1);
  return (n / 100) * (axis === 'x' ? box.bw : box.bh);
}

/** 变换函数列表 → [{ t: translate|scale|rotate|skewX|skewY, a: [...] }]；有 SMIL 表达不了的函数返回 null */
export function parseFns(str: string | null | undefined, box: PercentBox, fontSize: number): TransformFn[] | null {
  const text = (str || '').trim();
  if (!text || text === 'none') return [];
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  if (text.replace(re, '').trim()) return null;
  const out: TransformFn[] = [];
  for (const [, name, body] of text.matchAll(re)) {
    const args = body.split(',').map(part => part.trim());
    const lengthOf = (value: string, axis: 'x' | 'y') => length(value, axis, box, fontSize);
    let fn: TransformFn | null = null;
    if (name === 'translate')
      fn = { t: 'translate', a: [lengthOf(args[0], 'x'), args[1] != null ? lengthOf(args[1], 'y') : 0] };
    else if (name === 'translateX') fn = { t: 'translate', a: [lengthOf(args[0], 'x'), 0] };
    else if (name === 'translateY') fn = { t: 'translate', a: [0, lengthOf(args[0], 'y')] };
    else if (name === 'scale')
      fn = { t: 'scale', a: [factor(args[0]), args[1] != null ? factor(args[1]) : factor(args[0])] };
    else if (name === 'scaleX') fn = { t: 'scale', a: [factor(args[0]), 1] };
    else if (name === 'scaleY') fn = { t: 'scale', a: [1, factor(args[0])] };
    else if (name === 'rotate' || name === 'rotateZ') fn = { t: 'rotate', a: [angle(args[0])] };
    else if (name === 'skewX' || name === 'skewY') fn = { t: name, a: [angle(args[0])] };
    else if (name === 'skew') {
      const x = angle(args[0]),
        y = args[1] != null ? angle(args[1]) : 0;
      fn = y === 0 ? { t: 'skewX', a: [x] } : x === 0 ? { t: 'skewY', a: [y] } : null;
    }
    if (!fn || fn.a.some(value => value == null || !Number.isFinite(value))) return null;
    out.push(fn);
  }
  return out;
}
/** 单独的 translate / rotate / scale 属性值（空格分隔） */
export function parseProp(
  prop: string,
  value: string | null | undefined,
  box: PercentBox,
  fontSize: number,
): TransformFn[] | null {
  value = (value || '').trim();
  if (!value || value === 'none') return [];
  const parts = value.split(/\s+/);
  if (prop === 'translate') {
    if (parts.length > 2 && length(parts[2], 'x', box, fontSize) !== 0) return null;
    const x = length(parts[0], 'x', box, fontSize),
      y = parts[1] != null ? length(parts[1], 'y', box, fontSize) : 0;
    return x == null || y == null ? null : [{ t: 'translate', a: [x, y] }];
  }
  if (prop === 'scale') {
    if (parts.length > 2 && factor(parts[2]) !== 1) return null;
    const x = factor(parts[0]),
      y = parts[1] != null ? factor(parts[1]) : x;
    return x == null || y == null ? null : [{ t: 'scale', a: [x, y] }];
  }
  if (prop === 'rotate') {
    const deg = parts.length === 1 ? angle(parts[0]) : parts.length === 2 && parts[0] === 'z' ? angle(parts[1]) : null;
    return deg == null ? null : [{ t: 'rotate', a: [deg] }];
  }
  return null;
}

const IDENT: Record<TransformType, number[]> = {
  translate: [0, 0],
  scale: [1, 1],
  rotate: [0],
  skewX: [0],
  skewY: [0],
};
/** 各帧的函数列表补成同构（短的补单位变换）；同一位置类型不同返回 null（浏览器会退回矩阵插值，SMIL 做不到） */
export function align(lists: TransformFn[][]): { types: TransformType[]; args: number[][][] } | null {
  const n = Math.max(0, ...lists.map(list => list.length)),
    types: TransformType[] = [];
  for (let i = 0; i < n; i++) {
    let type: TransformType | null = null;
    for (const list of lists)
      if (list[i]) {
        if (type && type !== list[i].t) return null;
        type = list[i].t;
      }
    types.push(type);
  }
  return { types, args: lists.map(list => types.map((type, i) => (list[i] ? list[i].a : IDENT[type]))) };
}
function one({ t: type, a: args }: TransformFn): Matrix {
  if (type === 'translate') return [1, 0, 0, 1, args[0], args[1]];
  if (type === 'scale') return [args[0], 0, 0, args[1], 0, 0];
  const rad = (args[0] * Math.PI) / 180;
  if (type === 'rotate') return [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
  if (type === 'skewX') return [1, 0, Math.tan(rad), 1, 0, 0];
  return [1, Math.tan(rad), 0, 1, 0, 0];
}
export const fnMatrix = (list: TransformFn[]): Matrix => list.reduce((matrix, fn) => mul(matrix, one(fn)), ID_M);
export function computedMatrix(text: string | null | undefined): Matrix | null {
  if (!text || text === 'none') return ID_M;
  const match = /^matrix\(([^)]+)\)$/.exec(text);
  return match ? match[1].split(',').map(Number) : null;
}

const TF = ['transform', 'translate', 'rotate', 'scale'];
/** 去掉元素自身变换后的 CTM；tf 给定时临时套上这个 CSS transform */
function ctmWith(el: SVGGraphicsElement, tf?: string): Matrix | null {
  const style = el.style,
    saved = style.cssText,
    attr = el.getAttribute('transform');
  el.removeAttribute('transform');
  for (const prop of TF) style.setProperty(prop, 'none', 'important');
  if (tf) style.setProperty('transform', tf, 'important');
  const matrix = fromDom(el.getCTM());
  style.cssText = saved;
  if (attr != null) el.setAttribute('transform', attr);
  return matrix;
}
/** 变换原点 (ox, oy) 与百分比参照框 (bw, bh)，都在元素自身的坐标系：套 scale(2) 与 translate(100%,100%) 让浏览器算 */
export function measureBox(el: SVGGraphicsElement): TransformBox | null {
  const m0 = ctmWith(el),
    m1 = ctmWith(el, 'scale(2)'),
    m2 = ctmWith(el, 'translate(100%, 100%)');
  if (!m0 || !m1 || !m2) return null;
  const P = inv(m0),
    d1 = mul(P, m1),
    d2 = mul(P, m2);
  return { ox: -d1[4], oy: -d1[5], bw: d2[4], bh: d2[5] };
}
/** style 里的 CSS 变换（含原点）折算成 transform 属性上的矩阵：style 里的 transform 会压过 animateTransform */
export function bakeStyleTransform(el: SVGGraphicsElement): boolean {
  const style = el.style;
  if (!TF.some(prop => style.getPropertyValue(prop) && style.getPropertyValue(prop) !== 'none')) return true;
  const m1 = fromDom(el.getCTM()),
    m0 = ctmWith(el);
  if (!m0 || !m1) return false;
  const own = mul(inv(m0), m1);
  for (const prop of [...TF, 'transform-origin', 'transform-box']) style.removeProperty(prop);
  if (isId(own)) el.removeAttribute('transform');
  else el.setAttribute('transform', matrixAttr(own));
  return true;
}
