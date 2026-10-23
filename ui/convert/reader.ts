import { ID, measure, round } from './util.ts';
import type { BoxRect } from './types.ts';

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
export function previewDoc(fragment: string, extraCss = '') {
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
  const content = doc.querySelector('.rich_media_content') as HTMLElement;
  if (!content) return 0;
  const num = (value: string) => parseFloat(value) || 0;
  const client = (parent: Element, computed: CSSStyleDeclaration) => {
    if (!exact) return parent.clientWidth;
    const w = num(computed.width);
    if (!w) return 0;
    return computed.boxSizing === 'border-box'
      ? w - num(computed.borderLeftWidth) - num(computed.borderRightWidth)
      : w + num(computed.paddingLeft) + num(computed.paddingRight);
  };
  const parentW = (el: Element) => {
    let outer = 0;
    for (let parent = el.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
      const computed = win.getComputedStyle(parent as Element);
      const w = client(parent as Element, computed) - num(computed.paddingLeft) - num(computed.paddingRight) - outer;
      if (w > 0) return w;
      outer +=
        num(computed.paddingLeft) +
        num(computed.paddingRight) +
        num(computed.marginLeft) +
        num(computed.marginRight) +
        num(computed.borderLeftWidth) +
        num(computed.borderRightWidth);
    }
    return 0;
  };
  const contentStyle = win.getComputedStyle(content);
  const maxW = content.offsetWidth - num(contentStyle.paddingLeft) - num(contentStyle.paddingRight);
  let n = 0;
  for (const img of content.querySelectorAll('img')) {
    if (!img.naturalWidth) continue;
    const ratio = img.naturalHeight / img.naturalWidth;
    // 宽度先是属性原文（字符串）或原图宽度（数字），换算后变成数字
    let w: string | number = img.style.width || img.getAttribute('width') || img.naturalWidth;
    if (parseFloat(w as string) > maxW) w = maxW;
    if (w === 'inherit') w = parentW(img) || maxW;
    if (exact && typeof w === 'string' && w.includes('%')) {
      img.style.cssText += `;height: auto !important; aspect-ratio: calc(1/${ratio});`;
      n++;
      continue;
    }
    if (typeof w === 'string' && w.includes('%')) {
      img.style.cssText += `;width: ${img.naturalWidth}px !important;`;
      w = (parseFloat(w) / 100) * (parentW(img) || maxW);
    }
    if (w === 'auto') w = img.naturalWidth;
    const match = /^(\d+(?:\.\d+)?)([a-zA-Z%]+)?$/.exec(w as string);
    const unit = match && match[2] ? match[2] : 'px';
    let wn = match ? +match[1] : 0;
    img.style.cssText += `;width: ${wn}${unit} !important;`;
    const pw = parentW(img);
    if (wn > pw) wn = pw;
    img.style.cssText += `;width: ${wn}${unit} !important;height: auto !important; aspect-ratio: calc(1/${ratio});`;
    n++;
  }
  return n;
}

const edges = (computed: CSSStyleDeclaration) => ({
  w:
    parseFloat(computed.paddingLeft) +
    parseFloat(computed.paddingRight) +
    parseFloat(computed.borderLeftWidth) +
    parseFloat(computed.borderRightWidth),
  h:
    parseFloat(computed.paddingTop) +
    parseFloat(computed.paddingBottom) +
    parseFloat(computed.borderTopWidth) +
    parseFloat(computed.borderBottomWidth),
});

/** 图片 data-wxc → 宽、高要不要钉住（主宽度定下，另一个宽度照做） */
export type ImagePins = Map<string, { w: boolean; h: boolean }>;

/**
 * 转换时先在当前文档里模拟一遍 readerImages，尺寸会被它改掉的图：
 * - 宽度变了（width:auto、fit-content 等）：写成 px，合并时拟合成 cqw；
 * - 高度变了：用 min-height = max-height 钉住，它压得过阅读页的 aspect-ratio，也不受懒加载影响。
 *   （aspect-ratio:auto 不行：图片加载前 src 是 1×1 的占位 SVG，auto 会按 1:1 撑开，加载完再跳回去。）
 *   高度是纯 cqw 或纯 px 时任何宽度都准；% 宽配固定 px 边框/内边距时高度不成比例，只在主宽度精确。
 * 处理方式由主宽度决定并记在 pins 里，另一个宽度照做，两边结构一致才能拟合。
 */
export function pinImages(doc: Document, root: Element, pins: ImagePins) {
  const win = doc.defaultView;
  const all = [...doc.querySelectorAll<HTMLImageElement>('.rich_media_content img')];
  const imgs = all.filter(img => img.naturalWidth && img.hasAttribute(ID) && root.contains(img));
  if (imgs.some(img => !pins.has(img.getAttribute(ID)))) {
    const saved = all.map(img => img.getAttribute('style'));
    const before = measure(doc, true);
    readerImages(doc);
    const after = measure(doc, true);
    all.forEach((img, k) => {
      if (saved[k] == null) img.removeAttribute('style');
      else img.setAttribute('style', saved[k]);
    });
    for (const img of imgs) {
      const id = img.getAttribute(ID),
        boxBefore: BoxRect | undefined = before.get(id),
        boxAfter: BoxRect | undefined = after.get(id);
      if (pins.has(id)) continue;
      // 0.5px 以内是阅读页按 clientWidth（取整）算宽度带来的，不算变形
      pins.set(id, {
        w: !!(boxBefore && boxAfter) && Math.abs(boxBefore.w - boxAfter.w) > 0.5,
        h: !!(boxBefore && boxAfter) && Math.abs(boxBefore.h - boxAfter.h) > 0.5,
      });
    }
  }
  const now = measure(doc, true);
  let n = 0;
  for (const img of imgs) {
    const pin = pins.get(img.getAttribute(ID)),
      box = now.get(img.getAttribute(ID));
    if (!pin || !box || !(pin.w || pin.h)) continue;
    const computed = win.getComputedStyle(img);
    const edge = computed.boxSizing === 'content-box' ? edges(computed) : { w: 0, h: 0 };
    if (pin.w) img.style.setProperty('width', round(box.w - edge.w) + 'px');
    if (pin.h) {
      const h = round(box.h - edge.h) + 'px';
      img.style.setProperty('min-height', h);
      img.style.setProperty('max-height', h);
    }
    n++;
  }
  return n;
}
