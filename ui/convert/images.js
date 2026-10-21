import { splitTop } from './util.js';

/** 本机服务提供的图片地址里的 id */
export const ASSET_ID_RE = /\/a\/([0-9a-f]{16}\.[a-z0-9]+)/;
// 需要的设备像素按电脑上的阅读页算：正文宽 677px、2 倍屏（手机正文最宽约 400px × 3 倍屏 = 1200，比它小）
const NEED_W = 677 * 2;
// 读者点开正文里的图片时全屏查看：宽度至少保留到 430 宽 3 倍屏手机的宽度
const VIEWER_W = 1290;
const ANIM = 'animate,animateTransform,animateMotion,set';

/**
 * 成品中每张本地图片需要的分辨率与原图之比（≥ 1 表示原图的分辨率全都用得上），量不出来的为 null（比如 border-image、
 * 隐藏的元素、随动画缩放的 SVG 里的图）。doc 是按正文宽 width 渲染、跑过阅读页图片脚本的成品文档。
 * 同一张图用在几处时取最大值。返回 Map<id, number | null>
 */
export async function imageScales(doc, width) {
  const win = doc.defaultView, root = doc.querySelector('.rich_media_content') || doc.body;
  const k = NEED_W / width;
  const need = new Map();
  // 有一处量不出来就整张图记为 null：宁可按长边上限处理，也不按别处的小尺寸缩小
  const note = (id, v) => {
    const cur = need.get(id);
    if (cur === null) return;
    need.set(id, v === null ? null : cur === undefined ? v : Math.max(cur, v));
  };
  const idOf = u => { const m = ASSET_ID_RE.exec(u || ''); return m && m[1]; };
  // 元素自身的 CSS 像素到屏幕像素的比例（含 transform 与 SVG viewBox 的缩放）
  const screen = el => { const r = el.getBoundingClientRect(); return Math.max(r.width / (el.offsetWidth || 1), r.height / (el.offsetHeight || 1)); };
  // 在带 SMIL 动画的 SVG 里：显示尺寸可能随动画变化，量到的只是某一时刻
  const animated = [...root.querySelectorAll('svg')].filter(s => s.querySelector(ANIM));
  const moving = el => animated.some(s => s.contains(el));
  const crisp = c => /pixelated|crisp-edges/.test(c.imageRendering);
  const px = v => parseFloat(v) || 0;

  for (const img of root.querySelectorAll('img')) {
    const id = idOf(img.currentSrc || img.src);
    if (!id) continue;
    const c = win.getComputedStyle(img);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const bw = img.offsetWidth - px(c.paddingLeft) - px(c.paddingRight) - px(c.borderLeftWidth) - px(c.borderRightWidth);
    const bh = img.offsetHeight - px(c.paddingTop) - px(c.paddingBottom) - px(c.borderTopWidth) - px(c.borderBottomWidth);
    if (!nw || !nh || bw <= 0 || bh <= 0 || moving(img) || crisp(c)) { note(id, null); continue; }
    const sx = bw / nw, sy = bh / nh;
    const fit = c.objectFit;
    const s = fit === 'cover' ? Math.max(sx, sy) : fit === 'contain' ? Math.min(sx, sy) : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, sx, sy) : Math.max(sx, sy);
    note(id, Math.max(s * screen(img) * k, Math.min(1, VIEWER_W / nw)));
  }

  const sizes = new Map();
  const natural = url => {
    if (!sizes.has(url)) sizes.set(url, new Promise(res => {
      const im = new win.Image();
      im.onload = () => res([im.naturalWidth, im.naturalHeight]);
      im.onerror = () => res(null);
      im.src = url;
    }));
    return sizes.get(url);
  };
  const OTHER = ['borderImageSource', 'maskImage', 'webkitMaskImage', 'listStyleImage', 'content', 'cursor'];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const c = win.getComputedStyle(el);
    for (const p of OTHER) for (const m of String(c[p] || '').matchAll(/url\(\s*["']?([^"')]+)/g)) { const id = idOf(m[1]); if (id) note(id, null); }
    if (el.localName === 'image') { const id = idOf(el.getAttribute('href') || el.getAttribute('xlink:href')); if (id) note(id, null); }
    const bg = c.backgroundImage;
    if (!bg || bg === 'none') continue;
    const layers = splitTop(bg), bsz = splitTop(c.backgroundSize), org = splitTop(c.backgroundOrigin);
    for (let i = 0; i < layers.length; i++) {
      const m = /^url\(\s*["']?([^"')]+)["']?\s*\)$/.exec(layers[i].trim());
      const id = m && idOf(m[1]);
      if (!id) { if (idOf(layers[i])) note(idOf(layers[i]), null); continue; }
      if (!el.offsetWidth || moving(el) || crisp(c)) { note(id, null); continue; }
      const nat = await natural(m[1]);
      if (!nat || !nat[0] || !nat[1]) { note(id, null); continue; }
      const o = (org[i % org.length] || 'padding-box').trim();
      let aw = el.clientWidth || el.offsetWidth, ah = el.clientHeight || el.offsetHeight;
      if (o === 'border-box') { aw = el.offsetWidth; ah = el.offsetHeight; }
      if (o === 'content-box') { aw -= px(c.paddingLeft) + px(c.paddingRight); ah -= px(c.paddingTop) + px(c.paddingBottom); }
      const s = layerScale((bsz[i % bsz.length] || 'auto').trim(), nat[0], nat[1], aw, ah);
      note(id, s == null ? null : s * screen(el) * k);
    }
  }
  return need;
}

/** background-size 的一层 → 显示尺寸与原图之比（取宽、高两个方向中较大的），解析不了返回 null */
function layerScale(v, nw, nh, aw, ah) {
  if (v === 'cover') return Math.max(aw / nw, ah / nh);
  if (v === 'contain') return Math.min(aw / nw, ah / nh);
  const [a, b = 'auto'] = v.split(/\s+/);
  const len = (t, area) => t === 'auto' ? null : t.endsWith('%') ? parseFloat(t) / 100 * area : t.endsWith('px') ? parseFloat(t) : NaN;
  const w = len(a, aw), h = len(b, ah);
  if (Number.isNaN(w) || Number.isNaN(h)) return null;
  if (w == null && h == null) return 1;
  if (w == null) return h / nh;
  if (h == null) return w / nw;
  return Math.max(w / nw, h / nh);
}
