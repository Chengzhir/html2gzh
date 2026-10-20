import { ID, measure, round } from './util.js';

/** 微信手机端正文区的默认样式（抓自线上文章页 CSS），预览与校验都在它下面进行 */
export const READER_CSS = `.rich_media_content{color:rgba(0,0,0,.9);font-size:17px;overflow:hidden;text-align:justify;position:relative;z-index:0;line-height:1.6;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.544px;hyphens:auto;-webkit-hyphens:auto;text-underline-position:under;text-underline-offset:1.6px;text-decoration-skip-ink:none}
.rich_media_content *{max-width:100%!important;box-sizing:border-box!important;word-wrap:break-word!important}
.rich_media_content p{clear:both;min-height:1em}
.rich_media_content img{height:auto!important}
.rich_media_content em{font-style:italic}
.rich_media_content table{table-layout:fixed!important}
.rich_media_content td,.rich_media_content th{width:auto!important}
.rich_media_content blockquote{color:rgba(0,0,0,.55)}
.rich_media_content a{color:#576b95}
.rich_media_content mark{color:#000}`;
export const NEUTRAL = `html,body{margin:0!important;padding:0!important;border:0!important}html{scrollbar-width:none}html::-webkit-scrollbar{display:none}`;

/** 预览/校验用文档：微信正文区默认样式 + 成品片段。图片尺寸还要再跑一遍 readerImages */
export function previewDoc(fragment, extraCss = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${NEUTRAL}${READER_CSS}${extraCss}</style></head><body><div class="rich_media_content">${fragment}</div></body></html>`;
}

/**
 * 照抄阅读页脚本 setImgSize 对正文图片做的事（2026-10 抓自线上文章页）：
 * 宽度取 style.width，超过正文宽的按正文宽、% 按父级内容宽换成 px、解析不了的（fit-content 等）当 0；
 * 再追加 `width: … !important; height: auto !important; aspect-ratio: 原图宽高比`。
 * 宽高比作用在 border-box 上，带边框/内边距、拉伸或裁切的图因此会变形。
 * 阅读页用 clientWidth（取整）算父级宽度，% 宽的图会差零点几像素。exact 时 % 宽保持原样、其余按小数宽度算：
 * 逐像素比对用它，只暴露转换本身的问题，不让取整误差（换成 px 也有 1/64px 的截断）把下面整页挪动。
 * 要能整段传进 puppeteer 的 evaluate，所以不引用任何外部变量。
 */
export function readerImages(doc = document, exact = false) {
  const win = doc.defaultView;
  const content = doc.querySelector('.rich_media_content');
  if (!content) return 0;
  const num = v => parseFloat(v) || 0;
  const client = (p, c) => {
    if (!exact) return p.clientWidth;
    const w = num(c.width);
    if (!w) return 0;
    return c.boxSizing === 'border-box' ? w - num(c.borderLeftWidth) - num(c.borderRightWidth) : w + num(c.paddingLeft) + num(c.paddingRight);
  };
  const parentW = el => {
    let outer = 0;
    for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      const c = win.getComputedStyle(p);
      const w = client(p, c) - num(c.paddingLeft) - num(c.paddingRight) - outer;
      if (w > 0) return w;
      outer += num(c.paddingLeft) + num(c.paddingRight) + num(c.marginLeft) + num(c.marginRight) + num(c.borderLeftWidth) + num(c.borderRightWidth);
    }
    return 0;
  };
  const cc = win.getComputedStyle(content);
  const maxW = content.offsetWidth - num(cc.paddingLeft) - num(cc.paddingRight);
  let n = 0;
  for (const img of content.querySelectorAll('img')) {
    if (!img.naturalWidth) continue;
    const ratio = img.naturalHeight / img.naturalWidth;
    let w = img.style.width || img.getAttribute('width') || img.naturalWidth;
    if (parseFloat(w) > maxW) w = maxW;
    if (w === 'inherit') w = parentW(img) || maxW;
    if (exact && typeof w === 'string' && w.includes('%')) {
      img.style.cssText += `;height: auto !important; aspect-ratio: calc(1/${ratio});`;
      n++; continue;
    }
    if (typeof w === 'string' && w.includes('%')) {
      img.style.cssText += `;width: ${img.naturalWidth}px !important;`;
      w = parseFloat(w) / 100 * (parentW(img) || maxW);
    }
    if (w === 'auto') w = img.naturalWidth;
    const m = /^(\d+(?:\.\d+)?)([a-zA-Z%]+)?$/.exec(w);
    const unit = m && m[2] ? m[2] : 'px';
    let wn = m ? +m[1] : 0;
    img.style.cssText += `;width: ${wn}${unit} !important;`;
    const pw = parentW(img);
    if (wn > pw) wn = pw;
    img.style.cssText += `;width: ${wn}${unit} !important;height: auto !important; aspect-ratio: calc(1/${ratio});`;
    n++;
  }
  return n;
}

const edges = c => ({
  w: parseFloat(c.paddingLeft) + parseFloat(c.paddingRight) + parseFloat(c.borderLeftWidth) + parseFloat(c.borderRightWidth),
  h: parseFloat(c.paddingTop) + parseFloat(c.paddingBottom) + parseFloat(c.borderTopWidth) + parseFloat(c.borderBottomWidth),
});

/**
 * 转换时先在当前文档里模拟一遍 readerImages，尺寸会被它改掉的图：
 * - 宽度变了（width:auto、fit-content 等）：写成 px，合并时拟合成 cqw；
 * - 高度变了：用 min-height = max-height 钉住，它压得过阅读页的 aspect-ratio，也不受懒加载影响。
 *   （aspect-ratio:auto 不行：图片加载前 src 是 1×1 的占位 SVG，auto 会按 1:1 撑开，加载完再跳回去。）
 *   高度是纯 cqw 或纯 px 时任何宽度都准；% 宽配固定 px 边框/内边距时高度不成比例，只在主宽度精确。
 * 处理方式由主宽度决定并记在 pins 里，另一个宽度照做，两边结构一致才能拟合。
 */
export function pinImages(doc, root, pins) {
  const win = doc.defaultView;
  const all = [...doc.querySelectorAll('.rich_media_content img')];
  const imgs = all.filter(i => i.naturalWidth && i.hasAttribute(ID) && root.contains(i));
  if (imgs.some(i => !pins.has(i.getAttribute(ID)))) {
    const saved = all.map(i => i.getAttribute('style'));
    const before = measure(doc, true);
    readerImages(doc);
    const after = measure(doc, true);
    all.forEach((img, k) => { if (saved[k] == null) img.removeAttribute('style'); else img.setAttribute('style', saved[k]); });
    for (const img of imgs) {
      const id = img.getAttribute(ID), a = before.get(id), b = after.get(id);
      if (pins.has(id)) continue;
      // 0.5px 以内是阅读页按 clientWidth（取整）算宽度带来的，不算变形
      pins.set(id, { w: !!(a && b) && Math.abs(a.w - b.w) > 0.5, h: !!(a && b) && Math.abs(a.h - b.h) > 0.5 });
    }
  }
  const now = measure(doc, true);
  let n = 0;
  for (const img of imgs) {
    const p = pins.get(img.getAttribute(ID)), r = now.get(img.getAttribute(ID));
    if (!p || !r || !(p.w || p.h)) continue;
    const c = win.getComputedStyle(img);
    const e = c.boxSizing === 'content-box' ? edges(c) : { w: 0, h: 0 };
    if (p.w) img.style.setProperty('width', round(r.w - e.w) + 'px');
    if (p.h) {
      const h = round(r.h - e.h) + 'px';
      img.style.setProperty('min-height', h);
      img.style.setProperty('max-height', h);
    }
    n++;
  }
  return n;
}
