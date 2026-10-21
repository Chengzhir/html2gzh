// <animate>/<set> 的 attributeName 不在公众号白名单里时整条被删：常见的几种换成等价写法
import { SVG_NS, WX_ANIM_OK, isSvg, mk, targetOf, ownAnims } from './dom.ts';
import { bakeStyleTransform } from './transform.ts';
import { geometryReader } from './path.ts';

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const TIMING = ['begin', 'end', 'dur', 'repeatCount', 'repeatDur', 'fill', 'restart', 'min', 'max', 'calcMode', 'keyTimes', 'keySplines', 'accumulate'];
/** values/from/to/by 逐项映射，返回新属性；不能映射（f 返回 null）时返回 null */
function mapForm(a, f) {
  const out: Record<string, string> = {};
  for (const k of ['values', 'from', 'to', 'by']) {
    if (!a.hasAttribute(k)) continue;
    const parts = a.getAttribute(k).split(';').map(s => s.trim()).filter(Boolean);
    const m = parts.map(s => f(s, k));
    if (m.some(x => x == null)) return null;
    out[k] = m.join(';');
  }
  return Object.keys(out).length ? out : null;
}
/** 换掉一条动画：新元素继承时间属性，放在原位置 */
function replace(a, tag, attrs) {
  const n = mk(a.ownerDocument, tag, attrs);
  for (const k of TIMING) if (a.hasAttribute(k) && !(k in attrs)) n.setAttribute(k, a.getAttribute(k));
  a.replaceWith(n);
  return n;
}

/** display:none → visibility:hidden。文字片段与子孙自己写了 visibility 的不换（行为不同），返回 false */
export function displayToVisibility(el) {
  if (/^(tspan|textPath)$/.test(el.localName)) return false;
  for (const d of el.querySelectorAll('*')) if (isSvg(d) && (d.hasAttribute('visibility') || d.style.visibility)) return false;
  const none = el.style.display === 'none' || el.getAttribute('display') === 'none';
  el.style.removeProperty('display'); el.removeAttribute('display');
  if (none) el.setAttribute('visibility', 'hidden');
  return true;
}

function cxcy(a, el) {
  if (!/^(circle|ellipse)$/.test(el.localName) || !bakeStyleTransform(el)) return false;
  if (ownAnims(el).some(o => o.localName === 'animateTransform' && o.getAttribute('additive') !== 'sum')) return false;
  const p = a.getAttribute('attributeName'), sum = a.getAttribute('additive') === 'sum', base = sum ? 0 : geometryReader(el)(p) || 0;
  const form = mapForm(a, (s, k) => { const v = parseFloat(s); if (Number.isNaN(v)) return null; const d = k === 'by' ? v : v - base; return p === 'cx' ? `${d} 0` : `0 ${d}`; });
  if (!form) return false;
  if (a.localName === 'set') { form.values = form.to; delete form.to; }
  replace(a, 'animateTransform', { attributeName: 'transform', type: 'translate', additive: 'sum', ...form });
  return true;
}
function display(a, el) {
  if (!displayToVisibility(el)) return false;
  const form = mapForm(a, (s, k) => k === 'by' ? null : s === 'none' ? 'hidden' : 'visible');
  if (!form) return false;
  replace(a, a.localName, { attributeName: 'visibility', ...form });
  return true;
}
/** 只有填充（或只有描边）的形状：fill-opacity / stroke-opacity 等同于整体 opacity */
function paintOpacity(a, el) {
  const p = a.getAttribute('attributeName'), cs = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!SHAPES.has(el.localName) || (p === 'fill-opacity' ? cs.stroke : cs.fill) !== 'none' || +cs.opacity !== 1) return false;
  if (ownAnims(el).some(o => o !== a && o.getAttribute('attributeName') === 'opacity')) return false;
  const form = mapForm(a, s => Number.isNaN(parseFloat(s)) ? null : s);
  if (!form) return false;
  const still = p === 'fill-opacity' ? cs.fillOpacity : cs.strokeOpacity;
  el.style.removeProperty(p); el.removeAttribute(p);
  if (+still !== 1) el.setAttribute('opacity', still);
  replace(a, a.localName, { attributeName: 'opacity', ...form });
  return true;
}
/** "画线"：stroke-dasharray 从 "0 L" 变到 "L 0"（每帧两段之和相同且不短于路径）等同于固定 "S S"、动 dashoffset */
function dash(a, el) {
  if (!el.getTotalLength || ownAnims(el).some(o => o.getAttribute('attributeName') === 'stroke-dashoffset')) return false;
  const pairs = [];
  const form0 = mapForm(a, (s, k) => { if (k === 'by') return null; const n = s.split(/[\s,]+/).map(parseFloat); if (n.length !== 2 || n.some(Number.isNaN)) return null; pairs.push(n); return s; });
  if (!form0 || !pairs.length) return false;
  const S = pairs[0][0] + pairs[0][1];
  const L = el.hasAttribute('pathLength') ? +el.getAttribute('pathLength') : el.getTotalLength();
  if (pairs.some(([d, g]) => Math.abs(d + g - S) > 1e-6) || S < L - 1e-6) return false;
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const base = cs.strokeDasharray === 'none' ? null : cs.strokeDasharray.split(/[\s,]+/).map(parseFloat);
  if (parseFloat(cs.strokeDashoffset) !== 0 || base && (base.length !== 2 || Math.abs(base[0] + base[1] - S) > 1e-6)) return false;
  const form = mapForm(a, s => { const [d] = s.split(/[\s,]+/).map(parseFloat); return String(S - d); });
  el.style.removeProperty('stroke-dasharray'); el.style.removeProperty('stroke-dashoffset');
  el.setAttribute('stroke-dasharray', `${S} ${S}`);
  el.setAttribute('stroke-dashoffset', String(base ? S - base[0] : 0));
  replace(a, a.localName, { attributeName: 'stroke-dashoffset', ...form });
  return true;
}
const FIX = { cx: cxcy, cy: cxcy, display, 'fill-opacity': paintOpacity, 'stroke-opacity': paintOpacity, 'stroke-dasharray': dash };

/** 逐条检查 <animate>/<set>；换不了的按 attributeName 记进 rep */
export function fixWhitelist(root, ids, rep) {
  let fixed = 0;
  for (const a of [...root.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (a.localName !== 'animate' && a.localName !== 'set') continue;
    const p = a.getAttribute('attributeName');
    if (!p || WX_ANIM_OK.has(p)) continue;
    const el = targetOf(a, ids);
    if (el && FIX[p] && FIX[p](a, el)) fixed++; else rep('anim:' + p, el || a);
  }
  return fixed;
}
