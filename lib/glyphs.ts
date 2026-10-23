// 字形接口：页面把要转为路径的单元连同计算样式拍成快照发来，无头 Chrome 照样排版、逐字核对位置与页面相同后，每个单元单独打印成一页 PDF，
// 由 MuPDF 读出 Chrome 实际画出的每个字形（字体、字形号、矩阵、颜色）与轮廓。字体回落、连字、竖排、从右到左、可变字体、
// Skia 合成的粗体与斜体都照 Chrome 的结果；只有 Windows 上 DirectWrite 模拟的粗体、斜体不进 PDF，按实测补画
import * as fontkit from 'fontkit';
import type { Browser, CDPSession, Page } from 'puppeteer-core';
import type { Font, Matrix, Page as PdfPage, PDFDocument } from 'mupdf';
import { findChrome } from './chrome.ts';
import { isJsonObject, type JsonObject } from './http.ts';
import { ASSET_ID } from '../ui/convert/assetid.ts';
import { GLYPH_LIMITS as LIMITS, SNAP_BOX, SNAP_INHERITED, SNAP_INLINE, SNAP_TAGS } from '../ui/convert/glyphapi.ts';
import { CodedError } from '../ui/convert/types.ts';
import type {
  GlyphFill,
  GlyphFont,
  GlyphFontSrc,
  GlyphPath,
  GlyphRequest,
  GlyphResponse,
  GlyphUnit,
  GlyphUnitResult,
  PlacedGlyph,
  SnapChar,
  SnapElement,
  SnapNode,
} from '../ui/convert/types.ts';

const IDLE_MS = 5 * 60000;
// 无头页面的源：不存在的域名，所有请求都被拦下，只回本页与字体字节，别的一律不发出去
const ORIGIN = 'https://glyphs.html2gzh.invalid';
// 服务端排出的逐字框与页面量到的差多少 px 以内算同一排版（两边是同一个 Chrome、同一设备像素比，实测只差浮点误差）
const LAYOUT_TOLERANCE = 0.3;
// PDF 的点 → CSS px
const PX_PER_PT = 96 / 72;
// DirectWrite 模拟的粗体（宋体等没有粗体字形面的本机字体）：屏幕上按整设备像素加粗（字号每 50 设备 px 约多 1 px），墨量随屏幕密度跳动；
// PDF 里的字宽增量是 5/256 em。这里用宽为字号 5/256 的平滑描边，在手机上标题常见的 54–120 设备 px 内与屏幕上的平均墨量相同（SimSun 实测），
// 整体右移半个描边宽（左边不动、往右长）。SimSun 的内嵌点阵只在 12–17 设备 px 用到，3 倍屏上相当于不到 6px 的字，不另做处理。
// 模拟的斜体是绕基线的错切，斜率约 1/3（实测 0.33–0.35）
const DW_BOLD = 5 / 256;
const DW_SLANT = 1 / 3;

interface Session {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  dpr: number;
}
let sessionPromise: Promise<Session> | null = null,
  idleTimer: ReturnType<typeof setTimeout> | 0 = 0,
  queue: Promise<unknown> = Promise.resolve(),
  fontsSignature: string | null = null;
/** 按 id 取已登记文件的字节（lib/uiroute.ts 提供） */
let getAsset: (id: string) => Buffer | null = () => null;
// MuPDF 是 WASM，第一次用到时才载入
let mupdfModule: Promise<typeof import('mupdf')> | null = null;
const loadMupdf = () => (mupdfModule ??= import('mupdf'));

async function getSession(): Promise<Session> {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const retired = sessionPromise;
    sessionPromise = null;
    if (retired) retired.then(current => current.browser.close()).catch(() => {});
  }, IDLE_MS);
  idleTimer.unref();
  if (!sessionPromise) {
    const starting = (sessionPromise = (async () => {
      const chromePath = findChrome();
      if (!chromePath) throw new CodedError('api.noChrome');
      const { default: puppeteer } = await import('puppeteer-core');
      const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-first-run', '--disable-extensions'],
      });
      // 浏览器崩了或被关掉时丢掉缓存，下次请求重新启动
      browser.once('disconnected', () => {
        if (sessionPromise === starting) {
          sessionPromise = null;
          fontsSignature = null;
        }
      });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', request => {
        let url: URL;
        try {
          url = new URL(request.url());
        } catch {
          return request.abort();
        }
        if (url.origin !== ORIGIN) return request.abort();
        if (url.pathname === '/')
          return request.respond({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            // 打印时照原样印颜色：默认的省墨模式会把浅色字加深
            body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact"></body></html>',
          });
        const id = url.pathname.startsWith('/a/') ? url.pathname.slice(3) : '';
        const buf = ASSET_ID.test(id) ? getAsset(id) : null;
        if (!buf) return request.respond({ status: 404, body: '' });
        return request.respond({
          status: 200,
          contentType: 'application/octet-stream',
          headers: { 'access-control-allow-origin': '*' },
          body: buf,
        });
      });
      await page.goto(ORIGIN + '/');
      const cdp = await page.createCDPSession();
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      return { browser, page, cdp, dpr: 0 };
    })());
  }
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

// ---------- 校验请求 ----------
const STYLE_KEYS = new Set([...SNAP_INHERITED, ...SNAP_BOX, ...Object.keys(SNAP_INLINE)]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
function invalid(what: string): never {
  throw new Error(what);
}
const asText = (input: unknown, max: number, what: string) => {
  const text = input == null ? '' : String(input);
  if (text.length > max || CONTROL_CHARS.test(text)) invalid(what + ' 超长或带控制字符');
  return text;
};
const asStyle = (input: unknown): Record<string, string> => {
  if (!isJsonObject(input)) invalid('style 应为对象');
  const out: Record<string, string> = {};
  for (const [prop, value] of Object.entries(input)) {
    if (!STYLE_KEYS.has(prop)) invalid('style 里有不收的属性 ' + prop.slice(0, 40));
    out[prop] = asText(value, LIMITS.value, 'style 的值');
  }
  return out;
};
/** 只收字体与排版有关的计算样式、几个行内标签、文字与逐字框，都限长限量 */
function parseRequest(body: unknown): GlyphRequest {
  const request: JsonObject = isJsonObject(body) ? body : {};
  if (!Array.isArray(request.units)) invalid('units 应为数组');
  const units: unknown[] = request.units;
  if (units.length > LIMITS.units) invalid('单元数超出上限');
  let elements = 0,
    text = 0,
    chars = 0;
  const asKids = (input: unknown, depth: number): SnapNode[] => {
    if (!Array.isArray(input)) invalid('kids 应为数组');
    if (depth > LIMITS.depth) invalid('嵌套太深');
    return (input as unknown[]).map((kid): SnapNode => {
      if (typeof kid === 'string') {
        text += kid.length;
        if (text > LIMITS.text) invalid('文字超出单次请求的上限');
        return kid;
      }
      if (!isJsonObject(kid)) invalid('kids 里有无效的节点');
      if (++elements > LIMITS.elements) invalid('元素数超出单次请求的上限');
      const el: SnapElement = {
        tag: typeof kid.tag === 'string' && SNAP_TAGS.includes(kid.tag) ? kid.tag : 'span',
        style: asStyle(kid.style),
        kids: asKids(kid.kids ?? [], depth + 1),
      };
      if (kid.lang != null) el.lang = asText(kid.lang, LIMITS.lang, 'lang');
      return el;
    });
  };
  const asNumber = (input: unknown, min: number, max: number, what: string) => {
    const value = Number(input);
    if (!Number.isFinite(value) || value < min || value > max) invalid(what + ' 超出范围');
    return value;
  };
  const out = units.map((item): GlyphUnit => {
    if (!isJsonObject(item)) invalid('units 里有无效的单元');
    if (!Array.isArray(item.chars)) invalid('chars 应为数组');
    const charList: unknown[] = item.chars;
    chars += charList.length;
    if (chars > LIMITS.chars) invalid('字数超出单次请求的上限');
    const before = text;
    const unit: GlyphUnit = {
      w: asNumber(item.w, 0, 1e5, 'w'),
      h: asNumber(item.h, 0, 1e6, 'h'),
      style: asStyle(item.style),
      lang: asText(item.lang, LIMITS.lang, 'lang'),
      kids: asKids(item.kids, 0),
      chars: [],
    };
    const len = text - before;
    unit.chars = charList.map((entry: unknown): SnapChar => {
      if (!Array.isArray(entry) || entry.length !== 6) invalid('chars 里有无效的字');
      const [start, end, x, y, w, h] = entry.map(Number);
      if (!(start >= 0 && end > start && end <= len) || ![x, y, w, h].every(Number.isFinite))
        invalid('chars 里有无效的字');
      return [start, end, x, y, w, h];
    });
    return unit;
  });
  return { dpr: asNumber(request.dpr ?? 1, 0.25, 8, 'dpr'), fonts: parseFonts(request.fonts), units: out };
}
/**
 * 文章的网页字体：[{ family, weight, style, stretch, range, sizeAdjust, src:[{ local } | { id, format }] }]。
 * src 为空表示原稿里这条加载失败：照样声明一条加载不了的，让 Chrome 和原稿一样跳过它
 */
function parseFonts(list: unknown): GlyphFont[] {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.fonts) invalid('fonts 格式有误或数量超出上限');
  return (list as unknown[]).map((item): GlyphFont => {
    const face: JsonObject = isJsonObject(item) ? item : {};
    const src: unknown[] = Array.isArray(face.src) ? face.src : [];
    if (src.length > LIMITS.srcs) invalid('src 数量超出上限');
    return {
      family: asText(face.family, LIMITS.str, 'family'),
      weight: asText(face.weight, 40, 'weight'),
      style: asText(face.style, 40, 'style'),
      stretch: asText(face.stretch, 40, 'stretch'),
      range: asText(face.range, LIMITS.range, 'range'),
      sizeAdjust: asText(face.sizeAdjust, 20, 'sizeAdjust'),
      src: src
        .map((source): GlyphFontSrc | null =>
          isJsonObject(source) && source.local != null
            ? { local: asText(source.local, LIMITS.str, 'local') }
            : isJsonObject(source) && ASSET_ID.test(String(source.id))
              ? { id: String(source.id), format: asText(source.format, 30, 'format') }
              : null,
        )
        .filter(source => source !== null),
    };
  });
}
/** 字体集合变了才重装：清掉旧的、按原样声明新的（url() 指向本页源下的 /a/<id>，请求被拦下，回登记过的字节）、全部加载完 */
async function installFonts(page: Page, fonts: GlyphFont[]) {
  const signature = JSON.stringify(fonts);
  if (signature === fontsSignature) return;
  const skipped = await page.evaluate(async (fonts: GlyphFont[]) => {
    document.fonts.clear();
    let skipped = 0;
    for (const face of fonts) {
      const src = face.src.length
        ? face.src
            .map(source =>
              source.local != null
                ? `local(${JSON.stringify(source.local)})`
                : `url(/a/${source.id})` + (source.format ? ` format(${JSON.stringify(source.format)})` : ''),
            )
            .join(', ')
        : 'url(/a/missing)';
      const descriptors: FontFaceDescriptors & { sizeAdjust?: string } = {
        style: face.style || 'normal',
        weight: face.weight || 'normal',
        stretch: face.stretch || 'normal',
      };
      if (face.range) descriptors.unicodeRange = face.range;
      if (face.sizeAdjust) descriptors.sizeAdjust = face.sizeAdjust;
      try {
        document.fonts.add(new FontFace(face.family, src, descriptors));
      } catch {
        skipped++;
      }
    }
    await Promise.all([...document.fonts].map(face => face.load().catch(() => {})));
    return skipped;
  }, fonts);
  if (skipped) console.error(`字形服务  ${skipped} 条网页字体声明无效，已跳过`);
  fontsSignature = signature;
}

// ---------- 在无头页面里排版、核对、分页 ----------
/** 一个字的框：相对内容盒原点的 x、y、宽、高，与所在元素的编号 */
type Rect = [x: number, y: number, w: number, h: number, el: number];
interface LaidOut {
  /** 与页面量到的逐字框最大差多少 px（这里量不到的字记 1e9）；worst 是差得最多的那个字 */
  deviation: number;
  worst: string;
  /** 内容盒原点相对块左上角的横向偏移：竖排 rl 的原点在块的右边 */
  originX: number;
  /** 墨迹可能伸出块外的四边留白：左、上、右、下（px） */
  padding: [number, number, number, number];
  rects: Rect[];
}
interface ElementFont {
  weight: number;
  italic: boolean;
  synthWeight: boolean;
  synthStyle: boolean;
}
/**
 * 在无头页面里按快照建出各单元（每个单元一个块，外包一层横排的分页块），量逐字框与页面比。
 * 在页面里执行，不能引用外面的变量。元素按建的先后编号（data-e），与文档顺序一致
 */
async function layOut(units: GlyphUnit[]): Promise<{ units: LaidOut[]; elementFonts: ElementFont[] }> {
  document.body.textContent = '';
  const elements: HTMLElement[] = [];
  const tagged = (tag: string) => {
    const el = document.createElement(tag);
    el.setAttribute('data-e', String(elements.length));
    elements.push(el);
    return el;
  };
  const build = (node: SnapNode): Node => {
    if (typeof node === 'string') return document.createTextNode(node);
    const el = tagged(node.tag);
    if (node.lang != null) el.lang = node.lang;
    for (const [prop, value] of Object.entries(node.style)) el.style.setProperty(prop, value);
    for (const kid of node.kids) el.appendChild(build(kid));
    return el;
  };
  const boxes = units.map((unit, i) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-u', String(i));
    wrap.style.cssText = 'width:max-content;margin:0;padding:0;border:0';
    const box = tagged('div');
    if (unit.lang) box.lang = unit.lang;
    for (const [prop, value] of Object.entries(unit.style)) box.style.setProperty(prop, value);
    const fixed = { display: 'block', 'box-sizing': 'content-box', margin: '0', padding: '0', border: '0' };
    for (const [prop, value] of Object.entries(fixed)) box.style.setProperty(prop, value);
    box.style.setProperty('width', unit.w + 'px');
    box.style.setProperty('height', unit.h + 'px');
    for (const kid of unit.kids) box.appendChild(build(kid));
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    return box;
  });
  await document.fonts.ready;
  const info = elements.map((el): ElementFont & { size: number } => {
    const style = getComputedStyle(el);
    return {
      weight: parseFloat(style.fontWeight) || 400,
      italic: style.fontStyle !== 'normal',
      synthWeight: style.fontSynthesisWeight !== 'none',
      synthStyle: style.fontSynthesisStyle !== 'none',
      size: parseFloat(style.fontSize) || 0,
    };
  });
  const range = document.createRange();
  const laid = units.map((unit, i): LaidOut => {
    const box = boxes[i];
    const boxRect = box.getBoundingClientRect();
    // 与页面同一取法：竖排 rl 从块的右边量起
    const originX = getComputedStyle(box).writingMode === 'vertical-rl' ? boxRect.width : 0;
    const texts: { node: Text; start: number }[] = [];
    let offset = 0;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      texts.push({ node: node as Text, start: offset });
      offset += (node as Text).data.length;
    }
    let deviation = 0,
      worst = '',
      textIndex = 0,
      minX = 0,
      minY = 0,
      maxX = boxRect.width,
      maxY = boxRect.height,
      size = 0;
    const rects: Rect[] = [];
    for (const [start, end, x, y, w, h] of unit.chars) {
      while (textIndex + 1 < texts.length && texts[textIndex + 1].start <= start) textIndex++;
      const { node: textNode, start: textStart } = texts[textIndex];
      range.setStart(textNode, start - textStart);
      range.setEnd(textNode, Math.min(end - textStart, textNode.data.length));
      const rect = range.getClientRects()[0];
      // 文字都在 build 建出的带编号元素里；找不到编号的字与量不到框的字一样，整个单元判为排版对不上
      const el = Number(textNode.parentElement?.getAttribute('data-e'));
      size = Math.max(size, info[el]?.size ?? 0);
      if (!rect || !info[el]) {
        deviation = 1e9;
        worst = textNode.data.slice(start - textStart, end - textStart);
        continue;
      }
      const charX = rect.left - boxRect.left - originX,
        charY = rect.top - boxRect.top;
      const charDeviation = Math.max(
        Math.abs(charX - x),
        Math.abs(charY - y),
        Math.abs(rect.width - w),
        Math.abs(rect.height - h),
      );
      if (charDeviation > deviation) {
        deviation = charDeviation;
        worst = textNode.data.slice(start - textStart, end - textStart);
      }
      rects.push([charX, charY, rect.width, rect.height, el]);
      minX = Math.min(minX, rect.left - boxRect.left);
      minY = Math.min(minY, rect.top - boxRect.top);
      maxX = Math.max(maxX, rect.right - boxRect.left);
      maxY = Math.max(maxY, rect.bottom - boxRect.top);
    }
    // 字框之外再留一个字号：斜体的出头、叠加的附加符号、着重号都落在里面，不会印到别的页上
    const margin = Math.ceil(size) + 8;
    const padding: LaidOut['padding'] = [
      margin - minX,
      margin - minY,
      margin + maxX - boxRect.width,
      margin + maxY - boxRect.height,
    ];
    return { deviation, worst, originX, padding: padding.map(value => Math.ceil(value)) as LaidOut['padding'], rects };
  });
  return { units: laid, elementFonts: info.map(({ size, ...font }) => font) };
}
/** 只留要打印的单元，每个单元另起一页、四边留白；返回纸张大小（px，取成 4 的倍数，换成点是整数） */
function paginate(plan: { unit: number; padding: LaidOut['padding'] }[]) {
  const keep = new Map(plan.map((entry, index) => [entry.unit, { padding: entry.padding, first: index === 0 }]));
  let paperWidth = 0,
    paperHeight = 0;
  for (const wrap of document.querySelectorAll<HTMLElement>('body > div[data-u]')) {
    const spec = keep.get(Number(wrap.dataset.u));
    if (!spec) {
      wrap.style.display = 'none';
      continue;
    }
    const [padLeft, padTop, padRight, padBottom] = spec.padding;
    wrap.style.padding = `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`;
    wrap.style.breakBefore = spec.first ? 'auto' : 'page';
    const wrapRect = wrap.getBoundingClientRect();
    paperWidth = Math.max(paperWidth, wrapRect.width);
    paperHeight = Math.max(paperHeight, wrapRect.height);
  }
  return { w: Math.ceil(paperWidth / 4) * 4 + 4, h: Math.ceil(paperHeight / 4) * 4 + 4 };
}

// ---------- 读 PDF ----------
/** 字体名 → 字体对象与用到的字形（字形号 → 码位）。Type0 字体的名字是 BaseFont（带子集前缀），Type3 是"Type3 (n 0 R)" */
type FontUse = Map<string, { font: Font; gids: Map<number, number> }>;
interface RawGlyph {
  name: string;
  gid: number;
  /** em（y 向上）→ 相对内容盒原点的 px */
  matrix: Matrix;
  fill: string;
  alpha: number;
}
interface Ink {
  glyphs: RawGlyph[];
  fills: GlyphFill[];
  /** 页上有画不成单色轮廓的东西：描边、图片、渐变、蒙版 */
  effect: boolean;
}
const hex = (components: number[]) =>
  '#' +
  (components.length === 1 ? [components[0], components[0], components[0]] : components)
    .slice(0, 3)
    .map(component =>
      Math.round(Math.min(1, Math.max(0, component)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
function readPage(mupdf: typeof import('mupdf'), page: PdfPage, fonts: FontUse, offsetX: number, offsetY: number): Ink {
  const ink: Ink = { glyphs: [], fills: [], effect: false };
  const stack: number[] = [];
  let groupAlpha = 1;
  const effect = () => {
    ink.effect = true;
  };
  const colorOf = (components: number[]) => {
    if (components.length !== 1 && components.length !== 3) ink.effect = true;
    return hex(components);
  };
  const device = new mupdf.Device({
    fillText(text, ctm, colorSpace, color, alpha) {
      const opacity = alpha * groupAlpha;
      text.walk({
        showGlyph(font, trm, gid, uni) {
          const name = font.getName();
          let entry = fonts.get(name);
          if (!entry) fonts.set(name, (entry = { font: new mupdf.Font(font.pointer), gids: new Map() }));
          if (!entry.gids.has(gid)) entry.gids.set(gid, uni > 0 ? uni : 0x20);
          if (opacity <= 0) return;
          const matrix = mupdf.Matrix.concat(trm, ctm);
          ink.glyphs.push({
            name,
            gid,
            matrix: [
              matrix[0] * PX_PER_PT,
              matrix[1] * PX_PER_PT,
              matrix[2] * PX_PER_PT,
              matrix[3] * PX_PER_PT,
              matrix[4] * PX_PER_PT - offsetX,
              matrix[5] * PX_PER_PT - offsetY,
            ],
            fill: colorOf(color),
            alpha: opacity,
          });
        },
      });
    },
    fillPath(path, evenOdd, ctm, colorSpace, color, alpha) {
      if (alpha * groupAlpha <= 0) return;
      const point = (x: number, y: number) =>
        `${+((ctm[0] * x + ctm[2] * y + ctm[4]) * PX_PER_PT - offsetX).toFixed(3)} ${+((ctm[1] * x + ctm[3] * y + ctm[5]) * PX_PER_PT - offsetY).toFixed(3)}`;
      let pathData = '';
      path.walk({
        moveTo: (x, y) => void (pathData += 'M' + point(x, y)),
        lineTo: (x, y) => void (pathData += 'L' + point(x, y)),
        curveTo: (x1, y1, x2, y2, x3, y3) => void (pathData += `C${point(x1, y1)} ${point(x2, y2)} ${point(x3, y3)}`),
        closePath: () => void (pathData += 'Z'),
      });
      ink.fills.push({ d: pathData, fill: colorOf(color), alpha: alpha * groupAlpha, evenOdd });
    },
    strokePath: effect,
    strokeText: effect,
    fillImage: effect,
    fillImageMask: effect,
    fillShade: effect,
    beginMask: effect,
    beginGroup(bbox, colorSpace, isolated, knockout, blend, alpha) {
      stack.push(groupAlpha);
      groupAlpha *= alpha;
    },
    endGroup() {
      groupAlpha = stack.pop() ?? 1;
    },
  });
  page.run(device, mupdf.Matrix.identity);
  device.close();
  return ink;
}

/** 一个字形的轮廓：字体单位（y 向上）的紧凑路径、墨迹中心；color 为彩色字形（表情符号等） */
interface Outline {
  path: GlyphPath | null;
  upem: number;
  centerX: number;
  centerY: number;
  bad?: 'color' | 'render';
}
/**
 * 用到的字形逐个取轮廓：每个字体把它的字形在单位矩阵下各画一次，交给 MuPDF 的 SVG 输出（text=path），按出现顺序对回字形号。
 * 内嵌的 TrueType/CFF 字形由 FreeType 读出（em 单位），Type3 字形是 Skia 写进 PDF 的路径（带 FontMatrix）
 */
function outlines(mupdf: typeof import('mupdf'), fonts: FontUse, fontPrograms: Map<string, Program | null>) {
  const out = new Map<string, Outline>();
  for (const [name, { font, gids }] of fonts) {
    const glyphList = [...gids];
    const text = new mupdf.Text();
    for (const [gid, uni] of glyphList) text.showGlyph(font, mupdf.Matrix.identity, gid, uni);
    const buffer = new mupdf.Buffer();
    let svg = '';
    try {
      const writer = new mupdf.DocumentWriter(buffer, 'svg', 'text=path');
      writer.beginPage([0, 0, 10, 10]).fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, [0], 1);
      writer.endPage();
      writer.close();
      svg = buffer.asString();
    } catch {
      /* 读不了的字体：下面全部记为 render */
    } finally {
      text.destroy();
      buffer.destroy();
    }
    const defs = new Map<string, { attrs: string[]; group: string | null }>();
    for (const match of svg.matchAll(/<path id="(font_\w+)"([^>]*?)\/>/g))
      defs.set(match[1], { attrs: [match[2]], group: null });
    for (const match of svg.matchAll(/<g id="(font_\w+)">([\s\S]*?)<\/g>/g))
      defs.set(match[1], {
        attrs: [...match[2].matchAll(/<path([^>]*?)\/>/g)].map(pathMatch => pathMatch[1]),
        group: match[2],
      });
    const uses = [...svg.matchAll(/<use[^>]*?xlink:href="#(font_\w+)"/g)].map(match => match[1]);
    const defaultUpem = fontPrograms.get(name)?.upem || 2048;
    const noOutline = (bad?: Outline['bad']): Outline => ({
      path: null,
      upem: defaultUpem,
      centerX: 0,
      centerY: 0,
      bad,
    });
    const outlineAt = (i: number): Outline => {
      if (uses.length !== glyphList.length) return noOutline('render');
      const def = defs.get(uses[i]);
      if (!def) return noOutline();
      if (def.group != null && /\sfill="|<image|<use/.test(def.group)) return noOutline('color');
      try {
        return toFontUnits(def.attrs, defaultUpem);
      } catch {
        return noOutline('render');
      }
    };
    glyphList.forEach(([gid], i) => out.set(name + '|' + gid, outlineAt(i)));
  }
  return out;
}
/**
 * MuPDF 的绝对坐标路径（em，y 向上；Type3 带 FontMatrix）→ 字体单位的整数坐标，再写成紧凑的相对坐标。
 * 二次曲线在 PDF 里升阶成了三次曲线，两个控制点反推出的二次控制点相同的还原成 q
 */
function toFontUnits(attrs: string[], defaultUpem: number): Outline {
  type Command = [op: 'M' | 'L' | 'Q' | 'C' | 'Z', ...xy: number[]];
  const commands: Command[] = [];
  let upem = defaultUpem;
  for (const attr of attrs) {
    const pathMatch = attr.match(/\sd="([^"]*)"/);
    if (!pathMatch) continue;
    const transformMatch = attr.match(/transform="matrix\(([^)]*)\)"/);
    const fontMatrix = transformMatch ? transformMatch[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    // Type3 的 FontMatrix 是 1/upem（Skia 写成 1/2048 或 1/1000）
    if (transformMatch) upem = Math.round(1 / Math.hypot(fontMatrix[0], fontMatrix[1]));
    const toUnits = (x: number, y: number) => [
      (fontMatrix[0] * x + fontMatrix[2] * y + fontMatrix[4]) * upem,
      (fontMatrix[1] * x + fontMatrix[3] * y + fontMatrix[5]) * upem,
    ];
    const tokens = pathMatch[1].match(/[MLHVCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
    let i = 0,
      command = '',
      penX = 0,
      penY = 0,
      startX = 0,
      startY = 0;
    const nextNumber = () => {
      const value = parseFloat(tokens[i++]);
      if (!Number.isFinite(value)) throw new Error('path');
      return value;
    };
    while (i < tokens.length) {
      if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
      if (command === 'Z' || command === 'z') {
        commands.push(['Z']);
        [penX, penY] = [startX, startY];
        command = '';
        continue;
      }
      if (command === 'M') {
        [penX, penY] = [nextNumber(), nextNumber()];
        [startX, startY] = [penX, penY];
        commands.push(['M', ...toUnits(penX, penY)]);
        command = 'L';
      } else if (command === 'L' || command === 'H' || command === 'V') {
        if (command !== 'V') penX = nextNumber();
        if (command !== 'H') penY = nextNumber();
        commands.push(['L', ...toUnits(penX, penY)]);
      } else if (command === 'C') {
        const control1 = toUnits(nextNumber(), nextNumber()),
          control2 = toUnits(nextNumber(), nextNumber());
        const from = toUnits(penX, penY);
        [penX, penY] = [nextNumber(), nextNumber()];
        const to = toUnits(penX, penY);
        const quad1 = [(3 * control1[0] - from[0]) / 2, (3 * control1[1] - from[1]) / 2],
          quad2 = [(3 * control2[0] - to[0]) / 2, (3 * control2[1] - to[1]) / 2];
        if (Math.hypot(quad1[0] - quad2[0], quad1[1] - quad2[1]) < 0.05) commands.push(['Q', ...quad1, ...to]);
        else commands.push(['C', ...control1, ...control2, ...to]);
      } else throw new Error('path ' + command);
    }
  }
  if (!commands.length) return { path: null, upem, centerX: 0, centerY: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [, ...coords] of commands)
    for (let k = 0; k < coords.length; k += 2) {
      minX = Math.min(minX, coords[k]);
      maxX = Math.max(maxX, coords[k]);
      minY = Math.min(minY, coords[k + 1]);
      maxY = Math.max(maxY, coords[k + 1]);
    }
  return { path: compact(commands), upem, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}
/** 字体单位的绝对坐标命令 → { m: 首个 moveto, d: 其余的相对坐标 }。坐标先取整再求差，不累积误差 */
function compact(cmds: [string, ...number[]][]): GlyphPath | null {
  const round = Math.round;
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0,
    first: [number, number] | null = null,
    d = '',
    last = '';
  const emit = (command: string, ...values: number[]) => {
    const body = values.map((value, i) => (i && value >= 0 ? ' ' : '') + value).join('');
    // 同一命令接着写时省去字母；接着的数是负数时负号本身就能分隔
    d += command === last ? (values[0] >= 0 ? ' ' : '') + body : command + body;
    last = command === 'm' ? 'l' : command;
  };
  for (const [command, ...coords] of cmds) {
    const rounded = coords.map(round);
    if (command === 'M') {
      // 首点由客户端写成绝对的 M（M 后面的隐式坐标对是绝对 L），所以紧跟的命令必须显式写字母
      if (!first) {
        first = [rounded[0], rounded[1]];
        last = '';
      } else emit('m', rounded[0] - x, rounded[1] - y);
      [x, y, startX, startY] = [rounded[0], rounded[1], rounded[0], rounded[1]];
    } else if (command === 'L') {
      const dx = rounded[0] - x,
        dy = rounded[1] - y;
      if (!dx && !dy) continue;
      if (!dy) emit('h', dx);
      else if (!dx) emit('v', dy);
      else emit('l', dx, dy);
      [x, y] = [rounded[0], rounded[1]];
    } else if (command === 'Q') {
      emit('q', rounded[0] - x, rounded[1] - y, rounded[2] - x, rounded[3] - y);
      [x, y] = [rounded[2], rounded[3]];
    } else if (command === 'C') {
      emit('c', rounded[0] - x, rounded[1] - y, rounded[2] - x, rounded[3] - y, rounded[4] - x, rounded[5] - y);
      [x, y] = [rounded[4], rounded[5]];
    } else if (command === 'Z') {
      d += 'z';
      last = 'z';
      [x, y] = [startX, startY];
    }
  }
  return first ? { m: first, d } : null;
}

/** 内嵌字体程序（Type0 字体）的字体单位、字重与是否斜体；读不了（如裸 CFF）为 null */
interface Program {
  upem: number;
  weight: number;
  italic: boolean;
}
function readFontPrograms(doc: PDFDocument) {
  const out = new Map<string, Program | null>();
  for (let pageIndex = 0; pageIndex < doc.countPages(); pageIndex++) {
    const resources = doc.findPage(pageIndex).getInheritable('Resources');
    const fonts = resources.isNull() ? resources : resources.get('Font');
    if (!fonts.isDictionary()) continue;
    fonts.forEach(entry => {
      const fontDict = entry.resolve();
      if (fontDict.get('Subtype').asName() !== 'Type0' || !fontDict.get('BaseFont').isName()) return;
      const name = fontDict.get('BaseFont').asName();
      if (out.has(name)) return;
      let program: Program | null = null;
      try {
        const descriptor = fontDict.get('DescendantFonts').get(0).resolve().get('FontDescriptor').resolve();
        const fontFile = descriptor.get('FontFile2').isNull()
          ? descriptor.get('FontFile3')
          : descriptor.get('FontFile2');
        if (!fontFile.isNull()) {
          const parsed = fontkit.create(Buffer.from(fontFile.readStream().asUint8Array()));
          const font = 'fonts' in parsed ? parsed.fonts[0] : parsed;
          const os2 = font['OS/2'];
          program = {
            upem: font.unitsPerEm || 2048,
            // 没有 OS/2 表时字重未知：比较都不成立，不补画
            weight: os2?.usWeightClass ?? NaN,
            italic: !!(os2?.fsSelection?.italic || os2?.fsSelection?.oblique || font.head?.macStyle?.italic),
          };
        }
      } catch {
        program = null;
      }
      out.set(name, program);
    });
  }
  return out;
}

// ---------- DirectWrite 模拟的粗体、斜体 ----------
/** 点落在哪个字框里（字框都没有就取中心最近的），返回字框所在元素的编号 */
function elementAt(rects: Rect[], x: number, y: number) {
  let best = -1,
    bestDistance = Infinity;
  for (const [rectX, rectY, w, h, el] of rects) {
    const dx = x < rectX ? rectX - x : x > rectX + w ? x - rectX - w : 0,
      dy = y < rectY ? rectY - y : y > rectY + h ? y - rectY - h : 0;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) [best, bestDistance] = [el, distance];
    if (!distance) break;
  }
  return best;
}
/** 矩阵带倾斜：em 的两条轴在页面上不垂直（Skia 合成斜体在 Tm 里写错切） */
const skewed = (matrix: Matrix) =>
  Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) >
  0.05 * Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
/**
 * 哪些 Type0 字体是 DirectWrite 模拟了粗体、斜体的本机字体。Skia 合成的粗体写成 Type3（轮廓已加粗）、合成的斜体在矩阵里，都不用补；
 * DirectWrite 模拟的仍按原字体程序嵌入，PDF 里看不出来。判据：字形所在元素要求的字重比字体程序重 200 以上（或要求斜体而字体程序不是斜体、
 * 矩阵也没斜），且 Chrome 报告这个元素用的是本机字体（网页字体不会被 DirectWrite 模拟）。每个字体按它的多数字形判
 */
async function simulated(
  cdp: CDPSession,
  pages: { ink: Ink; rects: Rect[] }[],
  fontPrograms: Map<string, Program | null>,
  glyphOutlines: Map<string, Outline>,
  elementFonts: ElementFont[],
) {
  const votes = new Map<string, { total: number; bold: number; slant: number; elementIds: Set<number> }>();
  for (const { ink, rects } of pages)
    for (const glyph of ink.glyphs) {
      const program = fontPrograms.get(glyph.name),
        outline = glyphOutlines.get(glyph.name + '|' + glyph.gid);
      if (!program || !outline || !outline.path) continue;
      const emX = outline.centerX / outline.upem,
        emY = outline.centerY / outline.upem;
      const el = elementAt(
        rects,
        glyph.matrix[0] * emX + glyph.matrix[2] * emY + glyph.matrix[4],
        glyph.matrix[1] * emX + glyph.matrix[3] * emY + glyph.matrix[5],
      );
      if (el < 0) continue;
      const font = elementFonts[el];
      let tally = votes.get(glyph.name);
      if (!tally) votes.set(glyph.name, (tally = { total: 0, bold: 0, slant: 0, elementIds: new Set() }));
      tally.total++;
      if (font.synthWeight && font.weight - program.weight > 200) tally.bold++;
      if (font.synthStyle && font.italic && !program.italic && !skewed(glyph.matrix)) tally.slant++;
      tally.elementIds.add(el);
    }
  const out = new Map<string, { bold: boolean; slant: boolean }>();
  const candidates = [...votes].filter(([, tally]) => tally.bold * 2 > tally.total || tally.slant * 2 > tally.total);
  if (!candidates.length) return out;
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-e]' });
  const localFonts = new Map<number, Map<string, boolean>>();
  const queried = [...new Set(candidates.flatMap(([, tally]) => [...tally.elementIds]))];
  await Promise.all(
    queried.map(async el => {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[el] });
      localFonts.set(el, new Map(fonts.map(font => [font.postScriptName, !font.isCustomFont])));
    }),
  );
  for (const [name, tally] of candidates) {
    const postScriptName = name.replace(/^[A-Z]{6}\+/, '');
    let yes = 0,
      no = 0;
    for (const el of tally.elementIds) {
      const isLocal = localFonts.get(el)?.get(postScriptName);
      if (isLocal === true) yes++;
      else if (isLocal === false) no++;
    }
    if (yes > no) out.set(name, { bold: tally.bold * 2 > tally.total, slant: tally.slant * 2 > tally.total });
  }
  return out;
}

/** 一个字形落到结果里：em → 内容盒 px 的矩阵换成字体单位 → px，补上 DirectWrite 的模拟 */
function place(
  glyph: RawGlyph,
  outline: Outline,
  pathIndex: number,
  simulation?: { bold: boolean; slant: boolean },
): PlacedGlyph {
  let [a, b, c, d, e, f] = glyph.matrix;
  if (simulation?.slant) {
    c += DW_SLANT * a;
    d += DW_SLANT * b;
  }
  let strokeWidth = 0;
  const size = Math.sqrt(Math.abs(a * d - b * c));
  if (simulation?.bold) {
    strokeWidth = DW_BOLD * outline.upem;
    // 往字形自己的 x 方向挪加粗量的一半
    e += (a / size) * (DW_BOLD * size) * 0.5;
    f += (b / size) * (DW_BOLD * size) * 0.5;
  }
  const linear = (value: number) => (Math.abs(value) < 1e-9 ? 0 : +(value / outline.upem).toPrecision(6));
  const offset = (value: number) => +value.toFixed(3);
  return [
    pathIndex,
    [linear(a), linear(b), linear(c), linear(d), offset(e), offset(f)],
    glyph.fill,
    +glyph.alpha.toFixed(3),
    +strokeWidth.toFixed(2),
  ];
}

// ---------- 一次请求 ----------
async function renderGlyphs(request: GlyphRequest): Promise<GlyphResponse> {
  const session = await getSession();
  if (session.dpr !== request.dpr) {
    await session.page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: request.dpr });
    session.dpr = request.dpr;
  }
  await installFonts(session.page, request.fonts);
  const laid = await session.page.evaluate(layOut, request.units);
  // null：排版对得上、要打印的单元，结果在下面补上
  const results: (GlyphUnitResult | null)[] = laid.units.map(unit =>
    unit.deviation > LAYOUT_TOLERANCE
      ? {
          fail: 'mismatch',
          detail: `${unit.worst.slice(0, 8)} ${unit.deviation > 1e8 ? '-' : unit.deviation.toFixed(2)}px`,
        }
      : null,
  );
  const complete = () =>
    results.map(result => {
      if (!result) throw new Error('glyphs: unit without result');
      return result;
    });
  const kept = results.flatMap((result, i) => (result ? [] : [i]));
  if (!kept.length) return { paths: [], units: complete() };
  const paper = await session.page.evaluate(
    paginate,
    kept.map(unitIndex => ({ unit: unitIndex, padding: laid.units[unitIndex].padding })),
  );
  const pdf = await session.page.pdf({
    width: paper.w + 'px',
    height: paper.h + 'px',
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const mupdf = await loadMupdf();
  const doc = new mupdf.PDFDocument(pdf);
  const fonts: FontUse = new Map();
  const paths: GlyphPath[] = [],
    pathIndexOf = new Map<string, number>();
  try {
    if (doc.countPages() !== kept.length) {
      for (const unitIndex of kept)
        results[unitIndex] = { fail: 'render', detail: `${doc.countPages()}/${kept.length} pages` };
      return { paths, units: complete() };
    }
    const pages = kept.map((unitIndex, pageIndex) => {
      const layout = laid.units[unitIndex];
      const page = doc.loadPage(pageIndex);
      try {
        return {
          ink: readPage(mupdf, page, fonts, layout.padding[0] + layout.originX, layout.padding[1]),
          rects: layout.rects,
        };
      } finally {
        page.destroy();
      }
    });
    const fontPrograms = readFontPrograms(doc);
    const glyphOutlines = outlines(mupdf, fonts, fontPrograms);
    const simulations = await simulated(session.cdp, pages, fontPrograms, glyphOutlines, laid.elementFonts);
    const unitResult = ({ ink }: (typeof pages)[number]): GlyphUnitResult => {
      if (ink.effect) return { fail: 'effect' };
      const unitOutlines = ink.glyphs.map(glyph => glyphOutlines.get(glyph.name + '|' + glyph.gid));
      if (unitOutlines.some(outline => outline?.bad === 'color')) return { fail: 'color' };
      if (!unitOutlines.every((outline): outline is Outline => !!outline && !outline.bad)) return { fail: 'render' };
      const glyphs: PlacedGlyph[] = [];
      ink.glyphs.forEach((glyph, i) => {
        const outline = unitOutlines[i],
          path = outline.path;
        if (!path) return;
        const pathIndex = pathIndexOf.getOrInsertComputed(glyph.name + '|' + glyph.gid, () => paths.push(path) - 1);
        glyphs.push(place(glyph, outline, pathIndex, simulations.get(glyph.name)));
      });
      return { glyphs, fills: ink.fills };
    };
    kept.forEach((unitIndex, pageIndex) => {
      results[unitIndex] = unitResult(pages[pageIndex]);
    });
    return { paths, units: complete() };
  } finally {
    for (const { font } of fonts.values()) font.destroy();
    doc.destroy();
  }
}

/**
 * POST /api/glyphs 的处理：{ dpr, fonts, units:[{ w, h, style, lang, kids, chars }] } → { paths, units:[{ glyphs, fills } | { fail }] }。
 * 同一时间只处理一个请求（共用一个无头页面）
 */
export function handleGlyphs(body: unknown, assets: (id: string) => Buffer | null): Promise<GlyphResponse> {
  const request = parseRequest(body);
  const job = queue.then(() => {
    getAsset = assets;
    return renderGlyphs(request);
  });
  queue = job.catch(() => {});
  return job;
}
