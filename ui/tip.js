// 悬浮说明：带 data-tip 的元素在鼠标悬停或键盘聚焦时显示说明，Esc 关闭，鼠标可以移进说明框（WCAG 1.4.13）。
// 说明框挂在 body 上、fixed 定位，不被侧栏的滚动区裁掉；读屏软件从 aria-description 读到同样的文字
const box = document.createElement('div');
box.className = 'tip';
box.setAttribute('role', 'tooltip');
box.hidden = true;
document.body.appendChild(box);
let owner = null, timer = 0;

function show(el) {
  clearTimeout(timer);
  owner = el;
  box.textContent = el.dataset.tip;
  box.hidden = false;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const below = r.bottom + 6 + b.height <= innerHeight - 8 || r.top - 6 - b.height < 8;
  box.style.top = (below ? r.bottom + 6 : r.top - 6 - b.height) + 'px';
  box.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2)) + 'px';
}
function hide(now) {
  clearTimeout(timer);
  const go = () => { box.hidden = true; owner = null; };
  if (now) go(); else timer = setTimeout(go, 150);
}
const tipOf = t => t instanceof Element ? t.closest('[data-tip]') : null;

document.addEventListener('mouseover', e => {
  const el = tipOf(e.target);
  if (el) { if (el !== owner || box.hidden) show(el); else clearTimeout(timer); }
  else if (box.contains(e.target)) clearTimeout(timer);
});
document.addEventListener('mouseout', e => {
  const to = e.relatedTarget;
  if (to instanceof Node && (box.contains(to) || owner && owner.contains(to))) return;
  if (tipOf(e.target) || box.contains(e.target)) hide();
});
document.addEventListener('focusin', e => { const el = tipOf(e.target); if (el) show(el); else hide(true); });
document.addEventListener('focusout', e => { if (tipOf(e.target)) hide(true); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) hide(true); });
document.addEventListener('scroll', () => hide(true), true);
addEventListener('resize', () => hide(true));

/** 给元素挂上说明；text 为空则去掉 */
export function setTip(el, text) {
  if (text) { el.dataset.tip = text; el.setAttribute('aria-description', text); }
  else { delete el.dataset.tip; el.removeAttribute('aria-description'); }
  if (owner === el) { if (text) show(el); else hide(true); }
}
for (const el of document.querySelectorAll('[data-tip]')) el.setAttribute('aria-description', el.dataset.tip);
