import { ID, idOf, isHtmlEl, isText, round, measure, layoutRect, viewOf } from './util.ts';
import { msg } from './types.ts';
import type { BoxRect, FindingSink } from './types.ts';

// 微信存储层删 position 但保留 float / transform / margin / z-index：
// relative → 去掉定位，位移交给 translate；absolute → 零占位浮动（负外边距抵消尺寸），再用 translate 摆回原处。
const INSET = ['position', 'top', 'right', 'bottom', 'left', 'inset', 'inset-block', 'inset-inline'];
const FLEXISH = /^(inline-)?(flex|grid)$|^table|^contents$/;
export const INHERITED = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'white-space',
  'visibility',
  'direction',
  'writing-mode',
];
const REPLACED = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'object', 'embed', 'input']);

const stripInset = (style: CSSStyleDeclaration) => INSET.forEach(prop => style.removeProperty(prop));
const FAR = 4000;

/** 一个非 static 定位元素的转换计划；explicitH 及以下只有 absolute/fixed 才填 */
interface PositionPlan {
  el: HTMLElement;
  pos: string;
  z: string;
  tf: string;
  w: number;
  h: number;
  display: string;
  explicitH?: boolean;
  stretch?: boolean;
  side?: 'left' | 'right';
  maxContent?: boolean;
}

export function convertPositions(doc: Document, root: Element, findings: FindingSink): Set<string> {
  const win = viewOf(doc);
  const computedStyle = (el: Element) => win.getComputedStyle(el);
  const layers = new Set<string>();
  const els = [...root.querySelectorAll('*')].filter(isHtmlEl);
  const plan: PositionPlan[] = [];
  for (const el of els) {
    const computed = computedStyle(el);
    if (computed.position === 'static') {
      stripInset(el.style);
      continue;
    }
    const rect = layoutRect(doc, el);
    plan.push({
      el,
      pos: computed.position,
      z: computed.zIndex,
      tf: computed.transform,
      w: rect.width,
      h: rect.height,
      display: computed.display,
    });
  }
  // 宽度先全部量完：转换一个元素会改变别的元素的包含块
  for (const item of plan) {
    if (item.pos !== 'absolute' && item.pos !== 'fixed') continue;
    const style = item.el.style;
    const set = (value: string) => !!value && value !== 'auto';
    item.explicitH = set(style.height);
    item.stretch = set(style.left) && set(style.right);
    item.side = set(style.right) && !set(style.left) ? 'right' : 'left';
    item.maxContent = false;
    if ((!style.width || style.width === 'auto') && !item.stretch) {
      const old = style.getPropertyValue('width');
      style.setProperty('width', 'max-content');
      item.maxContent = Math.abs(layoutRect(doc, item.el).width - item.w) < 0.3;
      if (old) style.setProperty('width', old);
      else style.removeProperty('width');
    }
  }
  const fixed: HTMLElement[] = [],
    clipped: HTMLElement[] = [];
  let relocated = 0;
  for (const item of plan) {
    const { el } = item,
      style = el.style;
    layers.add(idOf(el));
    if (item.pos === 'relative' || item.pos === 'sticky') {
      stripInset(style);
      continue;
    }
    if (item.pos === 'fixed') fixed.push(el);
    stripInset(style);
    style.setProperty('float', item.side ?? 'left');
    style.setProperty('clear', 'none');
    style.setProperty('box-sizing', 'border-box');
    style.setProperty('width', item.maxContent ? 'max-content' : round(item.w) + 'px');
    if (item.explicitH || !el.childNodes.length) style.setProperty('height', round(item.h) + 'px');
    // 横向外边距取一个远大于任何宽度的负值，而不是正好抵消量到的宽度：手机上没有原稿字体时文字会变宽，
    // 正好抵消就会剩出占位，把同一行后面的浮动推开。纵向照旧精确抵消（改成大负值会动到 clear 的落点）
    style.setProperty('margin', '0');
    style.setProperty(item.side === 'left' ? 'margin-right' : 'margin-left', -FAR + 'px');
    // 多抵消 1/16px：负外边距在布局里向零截断到 1/64px，浮动自身的高度在别的宽度下又随行高取整，正好抵消常会剩出
    // 一两个 1/64px 的外边距盒，所在容器是 BFC（如 flex 项）时被它撑高。clear 的落点至多因此差 1/16px
    style.setProperty('margin-bottom', -round(item.h + 1 / 16) + 'px');
    el.setAttribute('data-wxc-float', '');
    // 在 flex/grid/table 容器里 float 不生效：挪到容器后面，并补上挪动后丢失的继承值
    let container = el.parentElement;
    if (container && FLEXISH.test(computedStyle(container).display)) {
      while (
        container.parentElement &&
        container.parentElement !== root.parentElement &&
        FLEXISH.test(computedStyle(container.parentElement).display)
      )
        container = container.parentElement;
      for (
        let ancestor = el.parentElement;
        ancestor && ancestor !== container.parentElement;
        ancestor = ancestor.parentElement
      )
        if (computedStyle(ancestor).overflow !== 'visible') {
          clipped.push(el);
          break;
        }
      const before = INHERITED.map(prop => computedStyle(el).getPropertyValue(prop));
      container.after(el);
      INHERITED.forEach((prop, i) => {
        if (computedStyle(el).getPropertyValue(prop) !== before[i]) style.setProperty(prop, before[i]);
      });
      relocated++;
    }
  }
  // z-index 只在 flex/grid 子项上还有效；正值的普通流元素尝试把父级改成纵向 flex
  const zLost: HTMLElement[] = [];
  let zKept = 0;
  const flexified = new Set<HTMLElement>();
  // 去掉 z-index 后，layer 只是按文档顺序画的一层；后面压在它上面的层若只是 position:relative 且没有 transform，
  // 让它退回普通流（不加 translate），layer 就重新盖在它上面。还有别的层压着就算保不住。
  const overlap = (a: DOMRect, b: DOMRect) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const yieldLaterLayers = (layer: HTMLElement) => {
    const layerRect = layer.getBoundingClientRect();
    let ok = true;
    for (const later of els) {
      const id = idOf(later);
      if (!layers.has(id) || later === layer || layer.contains(later) || !(layer.compareDocumentPosition(later) & 4))
        continue;
      if (!overlap(layerRect, later.getBoundingClientRect())) continue;
      const laterPlan = plan.find(x => x.el === later);
      if (
        laterPlan &&
        (laterPlan.pos === 'relative' || laterPlan.pos === 'sticky') &&
        laterPlan.tf === 'none' &&
        !parseInt(laterPlan.z, 10)
      )
        layers.delete(id);
      else ok = false;
    }
    return ok;
  };
  for (const item of plan) {
    const { el } = item;
    const z = parseInt(item.z, 10);
    if (!z) {
      el.style.removeProperty('z-index');
      continue;
    }
    const parent = el.parentElement;
    if (parent && /flex|grid/.test(computedStyle(parent).display)) {
      zKept++;
      continue;
    }
    if (z > 0 && !el.hasAttribute('data-wxc-float') && parent && (flexified.has(parent) || flexify(doc, parent))) {
      flexified.add(parent);
      zKept++;
      continue;
    }
    el.style.removeProperty('z-index');
    if (z < 0 || !yieldLaterLayers(el)) zLost.push(el);
    else zKept++;
  }
  if (plan.length)
    findings.fixed(
      'position',
      { n: plan.length },
      { parts: [relocated > 0 && msg('finding.position.relocated', { n: relocated })] },
    );
  if (flexified.size) findings.fixed('zFlex', { n: flexified.size });
  if (zLost.length) findings.warn('zLost', { n: zLost.length }, { els: zLost });
  if (fixed.length) findings.warn('fixedPos', { n: fixed.length }, { els: fixed });
  if (clipped.length) findings.warn('clipped', { n: clipped.length }, { els: clipped });
  return layers;
}

/** 父级改纵向 flex，用外边距复现原位置；任何元素位移超差就还原 */
function flexify(doc: Document, parent: HTMLElement): boolean {
  const win = viewOf(doc);
  for (const node of parent.childNodes) if (isText(node) && node.data.trim()) return false;
  const kids = [...parent.children] as (HTMLElement | SVGElement)[];
  if (kids.some(kid => win.getComputedStyle(kid).display.startsWith('inline') && !kid.hasAttribute('data-wxc-float')))
    return false;
  const floating = (e: Element) => e.hasAttribute('data-wxc-float');
  // 浮动的元素稍后统一用 translate 摆回，不参与这里的校验；父级例外：下面要按它的内容框排，它自己浮动也要量
  const watched = [parent, ...[parent.nextElementSibling, ...kids].filter(e => e != null).filter(e => !floating(e))];
  const snap = () => watched.map(e => layoutRect(doc, e));
  const before = snap();
  const rectOf = new Map(watched.map((e, i) => [e, before[i]]));
  const saved = [parent, ...kids].map(e => e.getAttribute('style'));
  const parentStyle = win.getComputedStyle(parent);
  const parentRect = before[0];
  let cursor = parentRect.top + parseFloat(parentStyle.borderTopWidth) + parseFloat(parentStyle.paddingTop);
  const bottom = parentRect.bottom - parseFloat(parentStyle.borderBottomWidth) - parseFloat(parentStyle.paddingBottom);
  // 量出的间距已按 1/64px 截断，原样写回会再截断一次、每个块少 1/64px，累积起来下文整像素错位。
  // 所以先按计算值算出折叠后的外边距，和量出的间距相差不到 1/64px 就写它，布局截断后正好落回原位
  const margins = kids.map(kid => {
    const computed = win.getComputedStyle(kid);
    return [parseFloat(computed.marginTop), parseFloat(computed.marginBottom)];
  });
  const collapse = (a: number, b: number) => Math.max(a, b, 0) + Math.min(a, b, 0);
  const floatH = kids.map(kid => (floating(kid) ? layoutRect(doc, kid).height : 0));
  parent.style.setProperty('display', 'flex');
  parent.style.setProperty('flex-direction', 'column');
  parent.style.setProperty('align-items', 'stretch');
  let last: HTMLElement | SVGElement | null = null,
    prev = -1;
  for (const [i, kid] of kids.entries()) {
    // 没量的就是浮动项
    const rect = rectOf.get(kid);
    if (!rect) {
      // flex 里浮动不生效，它就是个普通弹性项：下外边距必须正好抵消自身高度才不占位，多抵消一点都会把后面的项往上拉。
      // 多写 1/128px，截断到 1/64px 后正好等于高度
      kid.style.setProperty('margin-top', '0px');
      kid.style.setProperty('margin-bottom', -round(floatH[i] + 1 / 128) + 'px');
      continue;
    }
    const gap = rect.top - cursor,
      own = prev < 0 ? margins[i][0] : collapse(margins[prev][1], margins[i][0]);
    kid.style.setProperty('margin-top', round(Math.abs(gap - own) < 1 / 64 ? own : gap) + 'px');
    kid.style.setProperty('margin-bottom', '0px');
    kid.style.setProperty('flex', 'none');
    cursor = rect.bottom;
    last = kid;
    prev = i;
  }
  if (last) {
    const gap = bottom - cursor,
      own = margins[prev][1];
    last.style.setProperty('margin-bottom', round(Math.abs(gap - own) < 1 / 64 ? own : gap) + 'px');
  }
  const after = snap();
  const ok = after.every(
    (rect, i) =>
      Math.abs(rect.top - before[i].top) < 0.75 &&
      Math.abs(rect.left - before[i].left) < 0.75 &&
      Math.abs(rect.width - before[i].width) < 0.75 &&
      Math.abs(rect.height - before[i].height) < 0.75,
  );
  if (!ok)
    [parent, ...kids].forEach((e, i) =>
      saved[i] == null ? e.removeAttribute('style') : e.setAttribute('style', saved[i]),
    );
  return ok;
}

const canTransform = (win: Window, el: Element) => {
  if (!el.isConnected) return false;
  const display = win.getComputedStyle(el).display;
  if (display === 'none' || display === 'contents' || /^table-(row|column)/.test(display)) return false;
  return display !== 'inline' || REPLACED.has(el.localName);
};
function addTranslate(el: HTMLElement | SVGElement, dx: number, dy: number) {
  const style = el.style,
    cur = style.getPropertyValue('transform');
  const translate = `translate(${round(dx)}px, ${round(dy)}px)`;
  style.setProperty(
    'transform',
    cur && cur !== 'none' ? translate + ' ' + cur : translate,
    style.getPropertyPriority('transform'),
  );
}

/** 逐元素把布局位置拉回目标；祖先已做的位移会带着子孙走，所以要扣掉 */
export function correctOffsets(
  doc: Document,
  root: HTMLElement,
  target: Map<string, BoxRect>,
  layers: Set<string>,
): { moved: number; stuck: string[] } {
  const win = viewOf(doc);
  const cur = measure(doc, true);
  const stuck: string[] = [];
  let moved = 0;
  const walk = (el: HTMLElement | SVGElement, ax: number, ay: number) => {
    const id = el.getAttribute(ID);
    let nx = ax,
      ny = ay;
    const goal = id ? target.get(id) : undefined,
      now = id ? cur.get(id) : undefined;
    if (id && goal && now) {
      const dx = goal.x - now.x - ax,
        dy = goal.y - now.y - ay;
      const need = Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05;
      if (canTransform(win, el)) {
        if (need || layers.has(id)) {
          addTranslate(el, need ? dx : 0, need ? dy : 0);
          if (need) moved++;
          nx += need ? dx : 0;
          ny += need ? dy : 0;
        }
      } else if (Math.abs(dx) > 1 || Math.abs(dy) > 1) stuck.push(id);
    } else if (id && layers.has(id) && canTransform(win, el)) addTranslate(el, 0, 0);
    for (const kid of el.children)
      if (isHtmlEl(kid) || kid.localName === 'svg') walk(kid as HTMLElement | SVGElement, nx, ny);
  };
  walk(root, 0, 0);
  return { moved, stuck };
}
