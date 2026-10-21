// CSS 变换 ↔ SVG：解析关键帧里的变换函数、对齐成同构列表、量变换原点与百分比参照框
import { mul, inv, isId, ID_M, fromDom, matrixAttr } from './path.ts';

const ANG = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
const angle = s => { const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|grad|rad|turn)?$/.exec(s.trim()); return m && (m[2] || +m[1] === 0) ? +m[1] * ANG[m[2] || 'deg'] : null; };
const factor = s => { const m = /^(-?[\d.]+(?:e-?\d+)?)(%)?$/.exec(s.trim()); return m ? +m[1] / (m[2] ? 100 : 1) : null; };
/** 长度 → user units；box 是百分比参照框 { bw, bh }，fs 是字号 */
function length(s, axis, box, fs) {
  const m = /^(-?[\d.]+(?:e-?\d+)?)(px|%|em)?$/.exec(s.trim());
  if (!m) return null;
  const n = +m[1];
  if (!m[2]) return n === 0 ? 0 : null;
  if (m[2] === 'px') return n;
  if (m[2] === 'em') return n * fs;
  return n / 100 * (axis === 'x' ? box.bw : box.bh);
}

/** 变换函数列表 → [{ t: translate|scale|rotate|skewX|skewY, a: [...] }]；有 SMIL 表达不了的函数返回 null */
export function parseFns(str, box, fs) {
  const s = (str || '').trim();
  if (!s || s === 'none') return [];
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  if (s.replace(re, '').trim()) return null;
  const out = [];
  for (const [, f, body] of s.matchAll(re)) {
    const a = body.split(',').map(x => x.trim());
    const L = (v, ax) => length(v, ax, box, fs);
    let r = null;
    if (f === 'translate') r = { t: 'translate', a: [L(a[0], 'x'), a[1] != null ? L(a[1], 'y') : 0] };
    else if (f === 'translateX') r = { t: 'translate', a: [L(a[0], 'x'), 0] };
    else if (f === 'translateY') r = { t: 'translate', a: [0, L(a[0], 'y')] };
    else if (f === 'scale') r = { t: 'scale', a: [factor(a[0]), a[1] != null ? factor(a[1]) : factor(a[0])] };
    else if (f === 'scaleX') r = { t: 'scale', a: [factor(a[0]), 1] };
    else if (f === 'scaleY') r = { t: 'scale', a: [1, factor(a[0])] };
    else if (f === 'rotate' || f === 'rotateZ') r = { t: 'rotate', a: [angle(a[0])] };
    else if (f === 'skewX' || f === 'skewY') r = { t: f, a: [angle(a[0])] };
    else if (f === 'skew') {
      const x = angle(a[0]), y = a[1] != null ? angle(a[1]) : 0;
      r = y === 0 ? { t: 'skewX', a: [x] } : x === 0 ? { t: 'skewY', a: [y] } : null;
    }
    if (!r || r.a.some(v => v == null || !Number.isFinite(v))) return null;
    out.push(r);
  }
  return out;
}
/** 单独的 translate / rotate / scale 属性值（空格分隔） */
export function parseProp(prop, v, box, fs) {
  v = (v || '').trim();
  if (!v || v === 'none') return [];
  const p = v.split(/\s+/);
  if (prop === 'translate') {
    if (p.length > 2 && length(p[2], 'x', box, fs) !== 0) return null;
    const x = length(p[0], 'x', box, fs), y = p[1] != null ? length(p[1], 'y', box, fs) : 0;
    return x == null || y == null ? null : [{ t: 'translate', a: [x, y] }];
  }
  if (prop === 'scale') {
    if (p.length > 2 && factor(p[2]) !== 1) return null;
    const x = factor(p[0]), y = p[1] != null ? factor(p[1]) : x;
    return x == null || y == null ? null : [{ t: 'scale', a: [x, y] }];
  }
  if (prop === 'rotate') {
    const a = p.length === 1 ? angle(p[0]) : p.length === 2 && p[0] === 'z' ? angle(p[1]) : null;
    return a == null ? null : [{ t: 'rotate', a: [a] }];
  }
  return null;
}

const IDENT = { translate: [0, 0], scale: [1, 1], rotate: [0], skewX: [0], skewY: [0] };
/** 各帧的函数列表补成同构（短的补单位变换）；同一位置类型不同返回 null（浏览器会退回矩阵插值，SMIL 做不到） */
export function align(lists) {
  const n = Math.max(0, ...lists.map(l => l.length)), types = [];
  for (let i = 0; i < n; i++) {
    let t = null;
    for (const l of lists) if (l[i]) { if (t && t !== l[i].t) return null; t = l[i].t; }
    types.push(t);
  }
  return { types, args: lists.map(l => types.map((t, i) => l[i] ? l[i].a : IDENT[t])) };
}
function one({ t, a }) {
  if (t === 'translate') return [1, 0, 0, 1, a[0], a[1]];
  if (t === 'scale') return [a[0], 0, 0, a[1], 0, 0];
  const r = a[0] * Math.PI / 180;
  if (t === 'rotate') return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  if (t === 'skewX') return [1, 0, Math.tan(r), 1, 0, 0];
  return [1, Math.tan(r), 0, 1, 0, 0];
}
export const fnMatrix = list => list.reduce((m, f) => mul(m, one(f)), ID_M);
export function computedMatrix(s) {
  if (!s || s === 'none') return ID_M;
  const m = /^matrix\(([^)]+)\)$/.exec(s);
  return m ? m[1].split(',').map(Number) : null;
}

const TF = ['transform', 'translate', 'rotate', 'scale'];
/** 去掉元素自身变换后的 CTM；tf 给定时临时套上这个 CSS transform */
function ctmWith(el, tf?: string) {
  const s = el.style, saved = s.cssText, attr = el.getAttribute('transform');
  el.removeAttribute('transform');
  for (const k of TF) s.setProperty(k, 'none', 'important');
  if (tf) s.setProperty('transform', tf, 'important');
  const m = fromDom(el.getCTM());
  s.cssText = saved;
  if (attr != null) el.setAttribute('transform', attr);
  return m;
}
/** 变换原点 (ox, oy) 与百分比参照框 (bw, bh)，都在元素自身的坐标系：套 scale(2) 与 translate(100%,100%) 让浏览器算 */
export function measureBox(el) {
  const m0 = ctmWith(el), m1 = ctmWith(el, 'scale(2)'), m2 = ctmWith(el, 'translate(100%, 100%)');
  if (!m0 || !m1 || !m2) return null;
  const P = inv(m0), d1 = mul(P, m1), d2 = mul(P, m2);
  return { ox: -d1[4], oy: -d1[5], bw: d2[4], bh: d2[5] };
}
/** style 里的 CSS 变换（含原点）折算成 transform 属性上的矩阵：style 里的 transform 会压过 animateTransform */
export function bakeStyleTransform(el) {
  const s = el.style;
  if (!TF.some(k => s.getPropertyValue(k) && s.getPropertyValue(k) !== 'none')) return true;
  const m1 = fromDom(el.getCTM()), m0 = ctmWith(el);
  if (!m0 || !m1) return false;
  const own = mul(inv(m0), m1);
  for (const k of [...TF, 'transform-origin', 'transform-box']) s.removeProperty(k);
  if (isId(own)) el.removeAttribute('transform'); else el.setAttribute('transform', matrixAttr(own));
  return true;
}
