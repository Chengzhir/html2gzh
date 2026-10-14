import { ID, isHtmlEl, round, measure } from './util.js';

// 微信存储层删 position 但保留 float / transform / margin / z-index：
// relative → 去掉定位，位移交给 translate；absolute → 零占位浮动（负外边距抵消尺寸），再用 translate 摆回原处。
const INSET = ['position', 'top', 'right', 'bottom', 'left', 'inset', 'inset-block', 'inset-inline'];
const FLEXISH = /^(inline-)?(flex|grid)$|^table|^contents$/;
export const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'white-space', 'visibility', 'direction', 'writing-mode'];
const REPLACED = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'object', 'embed', 'input']);

const stripInset = s => INSET.forEach(p => s.removeProperty(p));
const FAR = 4000;
const layoutRect = (doc, el) => {
  const st = doc.createElement('style');
  st.textContent = '*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
  doc.head.appendChild(st);
  const r = el.getBoundingClientRect();
  st.remove();
  return r;
};

export function convertPositions(doc, root, findings) {
  const win = doc.defaultView;
  const cs = el => win.getComputedStyle(el);
  const layers = new Set();
  const els = [...root.querySelectorAll('*')].filter(isHtmlEl);
  const plan = [];
  for (const el of els) {
    const c = cs(el);
    if (c.position === 'static') { stripInset(el.style); continue; }
    const r = layoutRect(doc, el);
    plan.push({ el, pos: c.position, z: c.zIndex, tf: c.transform, w: r.width, h: r.height, display: c.display });
  }
  // 宽度先全部量完：转换一个元素会改变别的元素的包含块
  for (const p of plan) {
    if (p.pos !== 'absolute' && p.pos !== 'fixed') continue;
    const s = p.el.style;
    p.explicitH = s.height && s.height !== 'auto';
    p.stretch = s.left && s.left !== 'auto' && s.right && s.right !== 'auto';
    p.side = (s.right && s.right !== 'auto' && (!s.left || s.left === 'auto')) ? 'right' : 'left';
    p.maxContent = false;
    if ((!s.width || s.width === 'auto') && !p.stretch) {
      const old = s.getPropertyValue('width');
      s.setProperty('width', 'max-content');
      p.maxContent = Math.abs(layoutRect(doc, p.el).width - p.w) < 0.3;
      if (old) s.setProperty('width', old); else s.removeProperty('width');
    }
  }
  let fixed = 0, clipped = 0, relocated = 0;
  for (const p of plan) {
    const { el } = p, s = el.style;
    layers.add(el.getAttribute(ID));
    if (p.pos === 'relative' || p.pos === 'sticky') { stripInset(s); continue; }
    if (p.pos === 'fixed') fixed++;
    stripInset(s);
    s.setProperty('float', p.side);
    s.setProperty('clear', 'none');
    s.setProperty('box-sizing', 'border-box');
    s.setProperty('width', p.maxContent ? 'max-content' : round(p.w) + 'px');
    if (p.explicitH || !el.childNodes.length) s.setProperty('height', round(p.h) + 'px');
    // 横向外边距取一个远大于任何宽度的负值，而不是正好抵消量到的宽度：手机上没有原稿字体时文字会变宽，
    // 正好抵消就会剩出占位，把同一行后面的浮动推开。纵向照旧精确抵消（改成大负值会动到 clear 的落点）
    s.setProperty('margin', '0');
    s.setProperty(p.side === 'left' ? 'margin-right' : 'margin-left', -FAR + 'px');
    s.setProperty('margin-bottom', -round(p.h) + 'px');
    el.setAttribute('data-wxc-float', '');
    // 在 flex/grid/table 容器里 float 不生效：挪到容器后面，并补上挪动后丢失的继承值
    let C = el.parentElement;
    if (C && FLEXISH.test(cs(C).display)) {
      while (C.parentElement && C.parentElement !== root.parentElement && FLEXISH.test(cs(C.parentElement).display)) C = C.parentElement;
      for (let a = el.parentElement; a && a !== C.parentElement; a = a.parentElement) if (cs(a).overflow !== 'visible') { clipped++; break; }
      const before = INHERITED.map(k => cs(el).getPropertyValue(k));
      C.after(el);
      INHERITED.forEach((k, i) => { if (cs(el).getPropertyValue(k) !== before[i]) s.setProperty(k, before[i]); });
      relocated++;
    }
  }
  // z-index 只在 flex/grid 子项上还有效；正值的普通流元素尝试把父级改成纵向 flex
  let zLost = 0, zKept = 0;
  const flexified = new Set();
  // 去掉 z-index 后，E 只是按文档顺序画的一层；后面压在它上面的层若只是 position:relative 且没有 transform，
  // 让它退回普通流（不加 translate），E 就重新盖在它上面。还有别的层压着就算保不住。
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const yieldLaterLayers = E => {
    const er = E.getBoundingClientRect();
    let ok = true;
    for (const L of els) {
      const id = L.getAttribute(ID);
      if (!layers.has(id) || L === E || E.contains(L) || !(E.compareDocumentPosition(L) & 4)) continue;
      if (!overlap(er, L.getBoundingClientRect())) continue;
      const q = plan.find(x => x.el === L);
      if (q && (q.pos === 'relative' || q.pos === 'sticky') && q.tf === 'none' && !parseInt(q.z, 10)) layers.delete(id);
      else ok = false;
    }
    return ok;
  };
  for (const p of plan) {
    const { el } = p;
    const z = parseInt(p.z, 10);
    if (!z) { el.style.removeProperty('z-index'); continue; }
    const P = el.parentElement;
    if (P && /flex|grid/.test(cs(P).display)) { zKept++; continue; }
    if (z > 0 && !el.hasAttribute('data-wxc-float') && P && (flexified.has(P) || flexify(doc, P))) { flexified.add(P); zKept++; continue; }
    el.style.removeProperty('z-index');
    if (z < 0 || !yieldLaterLayers(el)) zLost++; else zKept++;
  }
  if (plan.length) findings.fixed('定位改写', `${plan.length} 个定位元素已改成浮动 + 位移（微信会删掉 position）` + (relocated ? `，其中 ${relocated} 个移出了 flex/grid 容器` : ''));
  if (flexified.size) findings.fixed('层叠顺序', `${flexified.size} 个容器改成纵向 flex，以保住 z-index 层叠`);
  if (zLost) findings.warn('层叠顺序', `${zLost} 个元素的 z-index 无法保留，重叠处的上下关系按文档顺序决定`);
  if (fixed) findings.warn('固定定位', `${fixed} 个 position:fixed 元素会随正文滚动，不再固定在屏幕上`);
  if (clipped) findings.warn('裁切', `${clipped} 个定位元素移出了 overflow 裁切容器，超出部分可能不再被裁掉`);
  return layers;
}

/** 父级改纵向 flex，用外边距复现原位置；任何元素位移超差就还原 */
function flexify(doc, P) {
  const win = doc.defaultView;
  for (const n of P.childNodes) if (n.nodeType === 3 && n.data.trim()) return false;
  const kids = [...P.children];
  if (kids.some(k => /^inline/.test(win.getComputedStyle(k).display) && !k.hasAttribute('data-wxc-float'))) return false;
  const next = P.nextElementSibling;
  // 浮动子项稍后统一用 translate 摆回，不参与这里的校验
  const snap = () => [P, next, ...kids].filter(Boolean).map(e => e.hasAttribute('data-wxc-float') ? null : layoutRect(doc, e));
  const before = snap();
  const saved = [P, ...kids].map(e => e.getAttribute('style'));
  const pc = win.getComputedStyle(P);
  const pr = before[0];
  let cursor = pr.top + parseFloat(pc.borderTopWidth) + parseFloat(pc.paddingTop);
  const bottom = pr.bottom - parseFloat(pc.borderBottomWidth) - parseFloat(pc.paddingBottom);
  P.style.setProperty('display', 'flex');
  P.style.setProperty('flex-direction', 'column');
  P.style.setProperty('align-items', 'stretch');
  let last = null;
  kids.forEach((k, i) => {
    const r = before[i + (next ? 2 : 1)];
    if (k.hasAttribute('data-wxc-float')) { k.style.setProperty('margin-top', '0px'); return; }
    k.style.setProperty('margin-top', round(r.top - cursor) + 'px');
    k.style.setProperty('margin-bottom', '0px');
    k.style.setProperty('flex', 'none');
    cursor = r.bottom; last = k;
  });
  if (last) last.style.setProperty('margin-bottom', round(bottom - cursor) + 'px');
  const after = snap();
  const ok = after.every((r, i) => !r || Math.abs(r.top - before[i].top) < 0.75 && Math.abs(r.left - before[i].left) < 0.75
    && Math.abs(r.width - before[i].width) < 0.75 && Math.abs(r.height - before[i].height) < 0.75);
  if (!ok) [P, ...kids].forEach((e, i) => saved[i] == null ? e.removeAttribute('style') : e.setAttribute('style', saved[i]));
  return ok;
}

const canTransform = (win, el) => {
  if (!el.isConnected) return false;
  const d = win.getComputedStyle(el).display;
  if (d === 'none' || d === 'contents' || /^table-(row|column)/.test(d)) return false;
  return d !== 'inline' || REPLACED.has(el.localName);
};
function addTranslate(el, dx, dy) {
  const s = el.style, cur = s.getPropertyValue('transform');
  const t = `translate(${round(dx)}px, ${round(dy)}px)`;
  s.setProperty('transform', cur && cur !== 'none' ? t + ' ' + cur : t, s.getPropertyPriority('transform'));
}

/** 逐元素把布局位置拉回目标；祖先已做的位移会带着子孙走，所以要扣掉 */
export function correctOffsets(doc, root, target, layers) {
  const win = doc.defaultView;
  const cur = measure(doc, true);
  const stuck = [];
  let moved = 0;
  const walk = (el, ax, ay) => {
    const id = el.getAttribute(ID);
    let nx = ax, ny = ay;
    if (id && cur.has(id) && target.has(id)) {
      const t = target.get(id), c = cur.get(id);
      const dx = t.x - c.x - ax, dy = t.y - c.y - ay;
      const need = Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05;
      if (canTransform(win, el)) {
        if (need || layers.has(id)) { addTranslate(el, need ? dx : 0, need ? dy : 0); if (need) moved++; nx += need ? dx : 0; ny += need ? dy : 0; }
      } else if (Math.abs(dx) > 1 || Math.abs(dy) > 1) stuck.push(id);
    } else if (id && layers.has(id) && canTransform(win, el)) addTranslate(el, 0, 0);
    for (const k of el.children) if (isHtmlEl(k) || k.localName === 'svg') walk(k, nx, ny);
  };
  walk(root, 0, 0);
  return { moved, stuck };
}
