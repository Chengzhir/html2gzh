// <animate>/<set> 的 attributeName 不在公众号白名单里时整条被删：常见的几种换成等价写法
import { SVG_NS, WX_ANIM_OK, isSvg, mk, targetOf, ownAnims } from './dom.ts';
import { bakeStyleTransform } from './transform.ts';
import { geometryReader } from './path.ts';
import type { Report } from './dom.ts';

type FormKey = 'values' | 'from' | 'to' | 'by';
// dash 先判断 getTotalLength 在不在，非几何元素上没有
type FixTarget = SVGGraphicsElement & { getTotalLength?: () => number };
type Fix = (anim: SVGAnimationElement, el: FixTarget) => boolean;

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const TIMING = [
  'begin',
  'end',
  'dur',
  'repeatCount',
  'repeatDur',
  'fill',
  'restart',
  'min',
  'max',
  'calcMode',
  'keyTimes',
  'keySplines',
  'accumulate',
];
/** values/from/to/by 逐项映射，返回新属性；不能映射（map 返回 null）时返回 null */
function mapForm(anim: Element, map: (value: string, k: FormKey) => string | null): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const k of ['values', 'from', 'to', 'by'] as const) {
    if (!anim.hasAttribute(k)) continue;
    const parts = anim
      .getAttribute(k)
      .split(';')
      .map(value => value.trim())
      .filter(Boolean);
    const mapped = parts.map(value => map(value, k));
    if (mapped.some(value => value == null)) return null;
    out[k] = mapped.join(';');
  }
  return Object.keys(out).length ? out : null;
}
/** 换掉一条动画：新元素继承时间属性，放在原位置 */
function replace(anim: Element, tag: string, attrs: Record<string, string>): SVGElement {
  const replacement = mk(anim.ownerDocument, tag, attrs);
  for (const k of TIMING) if (anim.hasAttribute(k) && !(k in attrs)) replacement.setAttribute(k, anim.getAttribute(k));
  anim.replaceWith(replacement);
  return replacement;
}

/** display:none → visibility:hidden。文字片段与子孙自己写了 visibility 的不换（行为不同），返回 false */
export function displayToVisibility(el: SVGElement): boolean {
  if (/^(tspan|textPath)$/.test(el.localName)) return false;
  for (const descendant of el.querySelectorAll('*'))
    if (isSvg(descendant) && (descendant.hasAttribute('visibility') || descendant.style.visibility)) return false;
  const none = el.style.display === 'none' || el.getAttribute('display') === 'none';
  el.style.removeProperty('display');
  el.removeAttribute('display');
  if (none) el.setAttribute('visibility', 'hidden');
  return true;
}

function cxcy(anim: SVGAnimationElement, el: FixTarget): boolean {
  if (!/^(circle|ellipse)$/.test(el.localName) || !bakeStyleTransform(el)) return false;
  if (ownAnims(el).some(other => other.localName === 'animateTransform' && other.getAttribute('additive') !== 'sum'))
    return false;
  const attr = anim.getAttribute('attributeName'),
    sum = anim.getAttribute('additive') === 'sum',
    base = sum ? 0 : geometryReader(el)(attr) || 0;
  const form = mapForm(anim, (value, k) => {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return null;
    const delta = k === 'by' ? num : num - base;
    return attr === 'cx' ? `${delta} 0` : `0 ${delta}`;
  });
  if (!form) return false;
  if (anim.localName === 'set') {
    form.values = form.to;
    delete form.to;
  }
  replace(anim, 'animateTransform', { attributeName: 'transform', type: 'translate', additive: 'sum', ...form });
  return true;
}
function display(anim: SVGAnimationElement, el: FixTarget): boolean {
  if (!displayToVisibility(el)) return false;
  const form = mapForm(anim, (value, k) => (k === 'by' ? null : value === 'none' ? 'hidden' : 'visible'));
  if (!form) return false;
  replace(anim, anim.localName, { attributeName: 'visibility', ...form });
  return true;
}
/** 只有填充（或只有描边）的形状：fill-opacity / stroke-opacity 等同于整体 opacity */
function paintOpacity(anim: SVGAnimationElement, el: FixTarget): boolean {
  const attr = anim.getAttribute('attributeName'),
    computed = el.ownerDocument.defaultView.getComputedStyle(el);
  if (
    !SHAPES.has(el.localName) ||
    (attr === 'fill-opacity' ? computed.stroke : computed.fill) !== 'none' ||
    +computed.opacity !== 1
  )
    return false;
  if (ownAnims(el).some(other => other !== anim && other.getAttribute('attributeName') === 'opacity')) return false;
  const form = mapForm(anim, value => (Number.isNaN(parseFloat(value)) ? null : value));
  if (!form) return false;
  const still = attr === 'fill-opacity' ? computed.fillOpacity : computed.strokeOpacity;
  el.style.removeProperty(attr);
  el.removeAttribute(attr);
  if (+still !== 1) el.setAttribute('opacity', still);
  replace(anim, anim.localName, { attributeName: 'opacity', ...form });
  return true;
}
/** "画线"：stroke-dasharray 从 "0 length" 变到 "length 0"（每帧两段之和 period 相同且不短于路径）等同于固定 "period period"、动 dashoffset */
function dash(anim: SVGAnimationElement, el: FixTarget): boolean {
  if (!el.getTotalLength || ownAnims(el).some(other => other.getAttribute('attributeName') === 'stroke-dashoffset'))
    return false;
  const pairs: number[][] = [];
  const form0 = mapForm(anim, (value, k) => {
    if (k === 'by') return null;
    const pair = value.split(/[\s,]+/).map(parseFloat);
    if (pair.length !== 2 || pair.some(Number.isNaN)) return null;
    pairs.push(pair);
    return value;
  });
  if (!form0 || !pairs.length) return false;
  const period = pairs[0][0] + pairs[0][1];
  const length = el.hasAttribute('pathLength') ? +el.getAttribute('pathLength') : el.getTotalLength();
  if (pairs.some(([dashLen, gapLen]) => Math.abs(dashLen + gapLen - period) > 1e-6) || period < length - 1e-6)
    return false;
  const computed = el.ownerDocument.defaultView.getComputedStyle(el);
  const base = computed.strokeDasharray === 'none' ? null : computed.strokeDasharray.split(/[\s,]+/).map(parseFloat);
  if (
    parseFloat(computed.strokeDashoffset) !== 0 ||
    (base && (base.length !== 2 || Math.abs(base[0] + base[1] - period) > 1e-6))
  )
    return false;
  const form = mapForm(anim, value => {
    const [dashLen] = value.split(/[\s,]+/).map(parseFloat);
    return String(period - dashLen);
  });
  el.style.removeProperty('stroke-dasharray');
  el.style.removeProperty('stroke-dashoffset');
  el.setAttribute('stroke-dasharray', `${period} ${period}`);
  el.setAttribute('stroke-dashoffset', String(base ? period - base[0] : 0));
  replace(anim, anim.localName, { attributeName: 'stroke-dashoffset', ...form });
  return true;
}
const FIX: Record<string, Fix | undefined> = {
  cx: cxcy,
  cy: cxcy,
  display,
  'fill-opacity': paintOpacity,
  'stroke-opacity': paintOpacity,
  'stroke-dasharray': dash,
};

/** 逐条检查 <animate>/<set>；换不了的按 attributeName 记进 rep */
export function fixWhitelist(root: Document | Element, ids: Map<string, Element>, rep: Report): number {
  let fixed = 0;
  for (const anim of [...root.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (anim.localName !== 'animate' && anim.localName !== 'set') continue;
    const attr = anim.getAttribute('attributeName');
    if (!attr || WX_ANIM_OK.has(attr)) continue;
    // 渐变、图案连同其中的动画都会删掉，用到它们的图形按 0 秒时的值画成位图（报为 paint:frozen）
    if (anim.closest('linearGradient,radialGradient,pattern')) continue;
    const el = targetOf(anim, ids);
    if (el && FIX[attr] && FIX[attr](anim as SVGAnimationElement, el as FixTarget)) fixed++;
    else rep('anim:' + attr, el || anim);
  }
  return fixed;
}
