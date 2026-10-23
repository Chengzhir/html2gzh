import { isHtmlEl, splitTop, viewOf } from './util.ts';
import { ASSET_URL_RE } from './assetid.ts';

// 需要的设备像素按电脑上的阅读页算：正文宽 677px、2 倍屏（手机正文最宽约 400px × 3 倍屏 = 1200，比它小）。
// 服务端再按读者拿到的最宽 1080px 封顶
const NEED_W = 677 * 2;
const ANIM = 'animate,animateTransform,animateMotion,set';

/** 正文里的元素：HTML 元素，或没有 offsetWidth/offsetHeight 的 SVG 元素 */
interface ContentElement extends Element {
  offsetWidth?: number;
  offsetHeight?: number;
}

/**
 * 成品中每张本地图片需要的分辨率与原图之比（≥ 1 表示原图的分辨率全都用得上），量不出来的为 null（比如 border-image、
 * 随动画缩放的 SVG 里的图）。doc 是按正文宽 width 渲染的成品文档。同一张图用在几处时取最大值。返回 Map<id, number | null>
 */
export async function imageScales(doc: Document, width: number): Promise<Map<string, number | null>> {
  const win = viewOf(doc),
    root: ContentElement = doc.querySelector('.rich_media_content') || doc.body;
  const needRatio = NEED_W / width;
  const need = new Map<string, number | null>();
  // 有一处量不出来就整张图记为 null：宁可按读者拿到的尺寸处理，也不按别处的小尺寸缩小
  const note = (id: string, ratio: number | null) => {
    const current = need.get(id);
    if (current === null) return;
    need.set(id, ratio === null ? null : current === undefined ? ratio : Math.max(current, ratio));
  };
  const assetIdOf = (url: string | null) => {
    const match = ASSET_URL_RE.exec(url || '');
    return match && match[1];
  };
  // 元素自身的 CSS 像素到屏幕像素的比例（含 transform 与 SVG viewBox 的缩放）
  const screen = (el: ContentElement) => {
    const rect = el.getBoundingClientRect();
    return Math.max(rect.width / (el.offsetWidth || 1), rect.height / (el.offsetHeight || 1));
  };
  // 在带 SMIL 动画的 SVG 里：显示尺寸可能随动画变化，量到的只是某一时刻
  const animated = [...root.querySelectorAll('svg')].filter(svg => svg.querySelector(ANIM));
  const moving = (el: Element) => animated.some(svg => svg.contains(el));
  const crisp = (computed: CSSStyleDeclaration) => /pixelated|crisp-edges/.test(computed.imageRendering);
  const px = (value: string) => parseFloat(value) || 0;

  // 正文里的 <img> 读者点开就是全屏的 1080 宽版本，不管它在版面里显示多大
  for (const img of root.querySelectorAll('img')) {
    const id = assetIdOf(img.currentSrc || img.src);
    if (id) note(id, 1);
  }

  const sizes = new Map<string, Promise<[number, number] | null>>();
  const natural = (url: string) => {
    if (!sizes.has(url))
      sizes.set(
        url,
        new Promise(resolve => {
          const image = new win.Image();
          image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
          image.onerror = () => resolve(null);
          image.src = url;
        }),
      );
    return sizes.get(url);
  };
  const OTHER = ['borderImageSource', 'maskImage', 'webkitMaskImage', 'listStyleImage', 'content', 'cursor'] as const;
  for (const el of [root, ...root.querySelectorAll<ContentElement>('*')]) {
    const computed = win.getComputedStyle(el);
    for (const prop of OTHER)
      for (const match of String(computed[prop] || '').matchAll(/url\(\s*["']?([^"')]+)/g)) {
        const id = assetIdOf(match[1]);
        if (id) note(id, null);
      }
    if (el.localName === 'image') {
      const id = assetIdOf(el.getAttribute('href') || el.getAttribute('xlink:href'));
      if (id) note(id, null);
    }
    const backgroundImage = computed.backgroundImage;
    if (!backgroundImage || backgroundImage === 'none') continue;
    const layers = splitTop(backgroundImage),
      layerSizes = splitTop(computed.backgroundSize),
      origins = splitTop(computed.backgroundOrigin);
    for (let i = 0; i < layers.length; i++) {
      const urlMatch = /^url\(\s*["']?([^"')]+)["']?\s*\)$/.exec(layers[i].trim());
      const id = urlMatch && assetIdOf(urlMatch[1]);
      if (!id) {
        const inside = assetIdOf(layers[i]);
        if (inside) note(inside, null);
        continue;
      }
      // SVG 元素没有 offsetWidth：它们的背景图量不出显示尺寸
      if (!isHtmlEl(el) || !el.offsetWidth || moving(el) || crisp(computed)) {
        note(id, null);
        continue;
      }
      const naturalSize = await natural(urlMatch[1]);
      if (!naturalSize || !naturalSize[0] || !naturalSize[1]) {
        note(id, null);
        continue;
      }
      const boxOrigin = (origins[i % origins.length] || 'padding-box').trim();
      let areaWidth = el.clientWidth || el.offsetWidth,
        areaHeight = el.clientHeight || el.offsetHeight;
      if (boxOrigin === 'border-box') {
        areaWidth = el.offsetWidth;
        areaHeight = el.offsetHeight;
      }
      if (boxOrigin === 'content-box') {
        areaWidth -= px(computed.paddingLeft) + px(computed.paddingRight);
        areaHeight -= px(computed.paddingTop) + px(computed.paddingBottom);
      }
      const scale = layerScale(
        (layerSizes[i % layerSizes.length] || 'auto').trim(),
        naturalSize[0],
        naturalSize[1],
        areaWidth,
        areaHeight,
      );
      note(id, scale == null ? null : scale * screen(el) * needRatio);
    }
  }
  return need;
}

/** background-size 的一层 → 显示尺寸与原图之比（取宽、高两个方向中较大的），解析不了返回 null */
function layerScale(
  size: string,
  naturalWidth: number,
  naturalHeight: number,
  areaWidth: number,
  areaHeight: number,
): number | null {
  if (size === 'cover') return Math.max(areaWidth / naturalWidth, areaHeight / naturalHeight);
  if (size === 'contain') return Math.min(areaWidth / naturalWidth, areaHeight / naturalHeight);
  const [widthToken, heightToken = 'auto'] = size.split(/\s+/);
  const resolveLength = (token: string, area: number): number | null =>
    token === 'auto'
      ? null
      : token.endsWith('%')
        ? (parseFloat(token) / 100) * area
        : token.endsWith('px')
          ? parseFloat(token)
          : NaN;
  const w = resolveLength(widthToken, areaWidth),
    h = resolveLength(heightToken, areaHeight);
  if (Number.isNaN(w) || Number.isNaN(h)) return null;
  if (w == null) return h == null ? 1 : h / naturalHeight;
  if (h == null) return w / naturalWidth;
  return Math.max(w / naturalWidth, h / naturalHeight);
}
