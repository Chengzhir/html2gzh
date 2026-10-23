// 字形接口：页面把要转为路径的单元连同计算样式拍成快照发来，无头 Chrome 照样排版、逐字核对位置与页面相同后，每个单元单独打印成一页 PDF，
// 由 MuPDF 读出 Chrome 实际画出的每个字形（字体、字形号、矩阵、颜色）与轮廓。字体回落、连字、竖排、从右到左、可变字体、
// Skia 合成的粗体与斜体都照 Chrome 的结果；只有 Windows 上 DirectWrite 模拟的粗体、斜体不进 PDF，按实测补画
import * as fontkit from 'fontkit';
import type { Browser, CDPSession, Page } from 'puppeteer-core';
import type { Font, Matrix, Page as PdfPage, PDFDocument } from 'mupdf';
import { findChrome } from './chrome.ts';
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
const TOL = 0.3;
// PDF 的点 → CSS px
const PX = 96 / 72;
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
let sessionP: Promise<Session> | null = null,
  idle: ReturnType<typeof setTimeout> | 0 = 0,
  queue: Promise<unknown> = Promise.resolve(),
  webSig: string | null = null;
/** 按 id 取已登记文件的字节（lib/uiroute.ts 提供） */
let getAsset: (id: string) => Buffer | null = () => null;
// MuPDF 是 WASM，第一次用到时才载入
let mupdfP: Promise<typeof import('mupdf')> | null = null;
const mupdf = () => (mupdfP ??= import('mupdf'));

async function session(): Promise<Session> {
  clearTimeout(idle);
  idle = setTimeout(() => {
    const s = sessionP;
    sessionP = null;
    if (s) s.then(x => x.browser.close()).catch(() => {});
  }, IDLE_MS);
  idle.unref();
  if (!sessionP) {
    const p = (sessionP = (async () => {
      const exe = findChrome();
      if (!exe) throw new CodedError('api.noChrome');
      const { default: puppeteer } = await import('puppeteer-core');
      const browser = await puppeteer.launch({
        executablePath: exe,
        headless: true,
        args: ['--no-first-run', '--disable-extensions'],
      });
      // 浏览器崩了或被关掉时丢掉缓存，下次请求重新启动
      browser.once('disconnected', () => {
        if (sessionP === p) {
          sessionP = null;
          webSig = null;
        }
      });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', r => {
        let u: URL;
        try {
          u = new URL(r.url());
        } catch {
          return r.abort();
        }
        if (u.origin !== ORIGIN) return r.abort();
        if (u.pathname === '/')
          return r.respond({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            // 打印时照原样印颜色：默认的省墨模式会把浅色字加深
            body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact"></body></html>',
          });
        const id = u.pathname.startsWith('/a/') ? u.pathname.slice(3) : '';
        const buf = ASSET_ID.test(id) ? getAsset(id) : null;
        if (!buf) return r.respond({ status: 404, body: '' });
        r.respond({
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
    return await sessionP;
  } catch (e) {
    sessionP = null;
    throw e;
  }
}

// ---------- 校验请求 ----------
const STYLE_KEYS = new Set([...SNAP_INHERITED, ...SNAP_BOX, ...Object.keys(SNAP_INLINE)]);
const CTRL = /[\u0000-\u001f\u007f]/;
function bad(what: string): never {
  throw new Error(what);
}
const str = (v: unknown, max: number, what: string) => {
  const s = v == null ? '' : String(v);
  if (s.length > max || CTRL.test(s)) bad(what + ' 超长或带控制字符');
  return s;
};
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const styleOf = (v: unknown): Record<string, string> => {
  if (!isObj(v)) bad('style 应为对象');
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!STYLE_KEYS.has(k)) bad('style 里有不收的属性 ' + k.slice(0, 40));
    out[k] = str(x, LIMITS.value, 'style 的值');
  }
  return out;
};
/** 只收字体与排版有关的计算样式、几个行内标签、文字与逐字框，都限长限量 */
function clean(body: unknown): GlyphRequest {
  const b: Obj = isObj(body) ? body : {};
  if (!Array.isArray(b.units)) bad('units 应为数组');
  const units: unknown[] = b.units;
  if (units.length > LIMITS.units) bad('单元数超出上限');
  let elements = 0,
    text = 0,
    chars = 0;
  const kidsOf = (v: unknown, depth: number): SnapNode[] => {
    if (!Array.isArray(v)) bad('kids 应为数组');
    if (depth > LIMITS.depth) bad('嵌套太深');
    return (v as unknown[]).map((k): SnapNode => {
      if (typeof k === 'string') {
        text += k.length;
        if (text > LIMITS.text) bad('文字超出单次请求的上限');
        return k;
      }
      if (!isObj(k)) bad('kids 里有无效的节点');
      if (++elements > LIMITS.elements) bad('元素数超出单次请求的上限');
      const el: SnapElement = {
        tag: typeof k.tag === 'string' && SNAP_TAGS.includes(k.tag) ? k.tag : 'span',
        style: styleOf(k.style),
        kids: kidsOf(k.kids ?? [], depth + 1),
      };
      if (k.lang != null) el.lang = str(k.lang, LIMITS.lang, 'lang');
      return el;
    });
  };
  const num = (v: unknown, lo: number, hi: number, what: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) bad(what + ' 超出范围');
    return n;
  };
  const out = units.map((u): GlyphUnit => {
    if (!isObj(u)) bad('units 里有无效的单元');
    if (!Array.isArray(u.chars)) bad('chars 应为数组');
    const cs: unknown[] = u.chars;
    chars += cs.length;
    if (chars > LIMITS.chars) bad('字数超出单次请求的上限');
    const before = text;
    const unit: GlyphUnit = {
      w: num(u.w, 0, 1e5, 'w'),
      h: num(u.h, 0, 1e6, 'h'),
      style: styleOf(u.style),
      lang: str(u.lang, LIMITS.lang, 'lang'),
      kids: kidsOf(u.kids, 0),
      chars: [],
    };
    const len = text - before;
    unit.chars = cs.map((c: unknown): SnapChar => {
      if (!Array.isArray(c) || c.length !== 6) bad('chars 里有无效的字');
      const [a, z, x, y, w, h] = c.map(Number);
      if (!(a >= 0 && z > a && z <= len) || ![x, y, w, h].every(Number.isFinite)) bad('chars 里有无效的字');
      return [a, z, x, y, w, h];
    });
    return unit;
  });
  return { dpr: num(b.dpr ?? 1, 0.25, 8, 'dpr'), fonts: cleanFonts(b.fonts), units: out };
}
/**
 * 文章的网页字体：[{ family, weight, style, stretch, range, sizeAdjust, src:[{ local } | { id, format }] }]。
 * src 为空表示原稿里这条加载失败：照样声明一条加载不了的，让 Chrome 和原稿一样跳过它
 */
function cleanFonts(list: unknown): GlyphFont[] {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.fonts) bad('fonts 格式有误或数量超出上限');
  return (list as unknown[]).map((f): GlyphFont => {
    const o: Obj = isObj(f) ? f : {};
    const src: unknown[] = Array.isArray(o.src) ? o.src : [];
    if (src.length > LIMITS.srcs) bad('src 数量超出上限');
    return {
      family: str(o.family, LIMITS.str, 'family'),
      weight: str(o.weight, 40, 'weight'),
      style: str(o.style, 40, 'style'),
      stretch: str(o.stretch, 40, 'stretch'),
      range: str(o.range, LIMITS.range, 'range'),
      sizeAdjust: str(o.sizeAdjust, 20, 'sizeAdjust'),
      src: src
        .map((s): GlyphFontSrc | null =>
          isObj(s) && s.local != null
            ? { local: str(s.local, LIMITS.str, 'local') }
            : isObj(s) && ASSET_ID.test(String(s.id))
              ? { id: String(s.id), format: str(s.format, 30, 'format') }
              : null,
        )
        .filter(s => s !== null),
    };
  });
}
/** 字体集合变了才重装：清掉旧的、按原样声明新的（url() 指向本页源下的 /a/<id>，请求被拦下，回登记过的字节）、全部加载完 */
async function installFonts(page: Page, fonts: GlyphFont[]) {
  const sig = JSON.stringify(fonts);
  if (sig === webSig) return;
  const skipped = await page.evaluate(async (fonts: GlyphFont[]) => {
    document.fonts.clear();
    let skipped = 0;
    for (const f of fonts) {
      const src = f.src.length
        ? f.src
            .map(s =>
              s.local != null
                ? `local(${JSON.stringify(s.local)})`
                : `url(/a/${s.id})` + (s.format ? ` format(${JSON.stringify(s.format)})` : ''),
            )
            .join(', ')
        : 'url(/a/missing)';
      const d: FontFaceDescriptors & { sizeAdjust?: string } = {
        style: f.style || 'normal',
        weight: f.weight || 'normal',
        stretch: f.stretch || 'normal',
      };
      if (f.range) d.unicodeRange = f.range;
      if (f.sizeAdjust) d.sizeAdjust = f.sizeAdjust;
      try {
        document.fonts.add(new FontFace(f.family, src, d));
      } catch {
        skipped++;
      }
    }
    await Promise.all([...document.fonts].map(f => f.load().catch(() => {})));
    return skipped;
  }, fonts);
  if (skipped) console.error(`字形服务  ${skipped} 条网页字体声明无效，已跳过`);
  webSig = sig;
}

// ---------- 在无头页面里排版、核对、分页 ----------
/** 一个字的框：相对内容盒原点的 x、y、宽、高，与所在元素的编号 */
type Rect = [x: number, y: number, w: number, h: number, el: number];
interface LaidOut {
  /** 与页面量到的逐字框最大差多少 px（这里量不到的字记 1e9）；worst 是差得最多的那个字 */
  dev: number;
  worst: string;
  /** 内容盒原点相对块左上角的横向偏移：竖排 rl 的原点在块的右边 */
  ox: number;
  /** 墨迹可能伸出块外的四边留白：左、上、右、下（px） */
  pad: [number, number, number, number];
  rects: Rect[];
}
interface ElInfo {
  weight: number;
  italic: boolean;
  synthW: boolean;
  synthS: boolean;
}
/**
 * 在无头页面里按快照建出各单元（每个单元一个块，外包一层横排的分页块），量逐字框与页面比。
 * 在页面里执行，不能引用外面的变量。元素按建的先后编号（data-e），与文档顺序一致
 */
async function layOut(units: GlyphUnit[]): Promise<{ units: LaidOut[]; els: ElInfo[] }> {
  document.body.textContent = '';
  const els: HTMLElement[] = [];
  const tagged = (tag: string) => {
    const el = document.createElement(tag);
    el.setAttribute('data-e', String(els.length));
    els.push(el);
    return el;
  };
  const build = (n: SnapNode): Node => {
    if (typeof n === 'string') return document.createTextNode(n);
    const el = tagged(n.tag);
    if (n.lang != null) el.lang = n.lang;
    for (const [k, v] of Object.entries(n.style)) el.style.setProperty(k, v);
    for (const k of n.kids) el.appendChild(build(k));
    return el;
  };
  const boxes = units.map((u, i) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-u', String(i));
    wrap.style.cssText = 'width:max-content;margin:0;padding:0;border:0';
    const box = tagged('div');
    if (u.lang) box.lang = u.lang;
    for (const [k, v] of Object.entries(u.style)) box.style.setProperty(k, v);
    const fixed = { display: 'block', 'box-sizing': 'content-box', margin: '0', padding: '0', border: '0' };
    for (const [k, v] of Object.entries(fixed)) box.style.setProperty(k, v);
    box.style.setProperty('width', u.w + 'px');
    box.style.setProperty('height', u.h + 'px');
    for (const k of u.kids) box.appendChild(build(k));
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    return box;
  });
  await document.fonts.ready;
  const info = els.map((el): ElInfo & { size: number } => {
    const c = getComputedStyle(el);
    return {
      weight: parseFloat(c.fontWeight) || 400,
      italic: c.fontStyle !== 'normal',
      synthW: c.fontSynthesisWeight !== 'none',
      synthS: c.fontSynthesisStyle !== 'none',
      size: parseFloat(c.fontSize) || 0,
    };
  });
  const range = document.createRange();
  const laid = units.map((u, i): LaidOut => {
    const box = boxes[i];
    const r = box.getBoundingClientRect();
    // 与页面同一取法：竖排 rl 从块的右边量起
    const ox = getComputedStyle(box).writingMode === 'vertical-rl' ? r.width : 0;
    const texts: { t: Text; at: number }[] = [];
    let at = 0;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      texts.push({ t: n as Text, at });
      at += (n as Text).data.length;
    }
    let dev = 0,
      worst = '',
      ti = 0,
      minX = 0,
      minY = 0,
      maxX = r.width,
      maxY = r.height,
      size = 0;
    const rects: Rect[] = [];
    for (const [a, z, x, y, w, h] of u.chars) {
      while (ti + 1 < texts.length && texts[ti + 1].at <= a) ti++;
      const { t, at: base } = texts[ti];
      range.setStart(t, a - base);
      range.setEnd(t, Math.min(z - base, t.data.length));
      const q = range.getClientRects()[0];
      const el = Number(t.parentElement.getAttribute('data-e'));
      size = Math.max(size, info[el].size);
      if (!q) {
        dev = 1e9;
        worst = t.data.slice(a - base, z - base);
        continue;
      }
      const sx = q.left - r.left - ox,
        sy = q.top - r.top;
      const d = Math.max(Math.abs(sx - x), Math.abs(sy - y), Math.abs(q.width - w), Math.abs(q.height - h));
      if (d > dev) {
        dev = d;
        worst = t.data.slice(a - base, z - base);
      }
      rects.push([sx, sy, q.width, q.height, el]);
      minX = Math.min(minX, q.left - r.left);
      minY = Math.min(minY, q.top - r.top);
      maxX = Math.max(maxX, q.right - r.left);
      maxY = Math.max(maxY, q.bottom - r.top);
    }
    // 字框之外再留一个字号：斜体的出头、叠加的附加符号、着重号都落在里面，不会印到别的页上
    const m = Math.ceil(size) + 8;
    const pad: LaidOut['pad'] = [m - minX, m - minY, m + maxX - r.width, m + maxY - r.height];
    return { dev, worst, ox, pad: pad.map(v => Math.ceil(v)) as LaidOut['pad'], rects };
  });
  return { units: laid, els: info.map(({ size, ...e }) => e) };
}
/** 只留要打印的单元，每个单元另起一页、四边留白；返回纸张大小（px，取成 4 的倍数，换成点是整数） */
function paginate(plan: { u: number; pad: LaidOut['pad'] }[]) {
  const keep = new Map(plan.map((p, k) => [p.u, { pad: p.pad, first: k === 0 }]));
  let w = 0,
    h = 0;
  for (const wrap of document.querySelectorAll<HTMLElement>('body > div[data-u]')) {
    const p = keep.get(Number(wrap.dataset.u));
    if (!p) {
      wrap.style.display = 'none';
      continue;
    }
    const [l, t, r, b] = p.pad;
    wrap.style.padding = `${t}px ${r}px ${b}px ${l}px`;
    wrap.style.breakBefore = p.first ? 'auto' : 'page';
    const rr = wrap.getBoundingClientRect();
    w = Math.max(w, rr.width);
    h = Math.max(h, rr.height);
  }
  return { w: Math.ceil(w / 4) * 4 + 4, h: Math.ceil(h / 4) * 4 + 4 };
}

// ---------- 读 PDF ----------
/** 字体名 → 字体对象与用到的字形（字形号 → 码位）。Type0 字体的名字是 BaseFont（带子集前缀），Type3 是"Type3 (n 0 R)" */
type FontUse = Map<string, { font: Font; gids: Map<number, number> }>;
interface RawGlyph {
  name: string;
  gid: number;
  /** em（y 向上）→ 相对内容盒原点的 px */
  m: Matrix;
  fill: string;
  alpha: number;
}
interface Ink {
  glyphs: RawGlyph[];
  fills: GlyphFill[];
  /** 页上有画不成单色轮廓的东西：描边、图片、渐变、蒙版 */
  effect: boolean;
}
const hex = (c: number[]) =>
  '#' +
  (c.length === 1 ? [c[0], c[0], c[0]] : c)
    .slice(0, 3)
    .map(v =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
function readPage(mu: typeof import('mupdf'), page: PdfPage, fonts: FontUse, dx: number, dy: number): Ink {
  const ink: Ink = { glyphs: [], fills: [], effect: false };
  const stack: number[] = [];
  let ga = 1;
  const effect = () => {
    ink.effect = true;
  };
  const colorOf = (c: number[]) => {
    if (c.length !== 1 && c.length !== 3) ink.effect = true;
    return hex(c);
  };
  const dev = new mu.Device({
    fillText(text, ctm, cs, color, alpha) {
      const a = alpha * ga;
      text.walk({
        showGlyph(font, trm, gid, uni) {
          const name = font.getName();
          let f = fonts.get(name);
          if (!f) fonts.set(name, (f = { font: new mu.Font(font.pointer), gids: new Map() }));
          if (!f.gids.has(gid)) f.gids.set(gid, uni > 0 ? uni : 0x20);
          if (a <= 0) return;
          const m = mu.Matrix.concat(trm, ctm);
          ink.glyphs.push({
            name,
            gid,
            m: [m[0] * PX, m[1] * PX, m[2] * PX, m[3] * PX, m[4] * PX - dx, m[5] * PX - dy],
            fill: colorOf(color),
            alpha: a,
          });
        },
      });
    },
    fillPath(path, evenOdd, ctm, cs, color, alpha) {
      if (alpha * ga <= 0) return;
      const T = (x: number, y: number) =>
        `${+((ctm[0] * x + ctm[2] * y + ctm[4]) * PX - dx).toFixed(3)} ${+((ctm[1] * x + ctm[3] * y + ctm[5]) * PX - dy).toFixed(3)}`;
      let d = '';
      path.walk({
        moveTo: (x, y) => void (d += 'M' + T(x, y)),
        lineTo: (x, y) => void (d += 'L' + T(x, y)),
        curveTo: (a, b, c, e, g, h) => void (d += `C${T(a, b)} ${T(c, e)} ${T(g, h)}`),
        closePath: () => void (d += 'Z'),
      });
      ink.fills.push({ d, fill: colorOf(color), alpha: alpha * ga, evenOdd });
    },
    strokePath: effect,
    strokeText: effect,
    fillImage: effect,
    fillImageMask: effect,
    fillShade: effect,
    beginMask: effect,
    beginGroup(bbox, cs, isolated, knockout, blend, alpha) {
      stack.push(ga);
      ga *= alpha;
    },
    endGroup() {
      ga = stack.pop() ?? 1;
    },
  });
  page.run(dev, mu.Matrix.identity);
  dev.close();
  return ink;
}

/** 一个字形的轮廓：字体单位（y 向上）的紧凑路径、墨迹中心；color 为彩色字形（表情符号等） */
interface Outline {
  path: GlyphPath | null;
  upem: number;
  cx: number;
  cy: number;
  bad?: 'color' | 'render';
}
/**
 * 用到的字形逐个取轮廓：每个字体把它的字形在单位矩阵下各画一次，交给 MuPDF 的 SVG 输出（text=path），按出现顺序对回字形号。
 * 内嵌的 TrueType/CFF 字形由 FreeType 读出（em 单位），Type3 字形是 Skia 写进 PDF 的路径（带 FontMatrix）
 */
function outlines(mu: typeof import('mupdf'), fonts: FontUse, programs: Map<string, Program | null>) {
  const out = new Map<string, Outline>();
  for (const [name, { font, gids }] of fonts) {
    const list = [...gids];
    const text = new mu.Text();
    for (const [gid, uni] of list) text.showGlyph(font, mu.Matrix.identity, gid, uni);
    const buf = new mu.Buffer();
    let svg = '';
    try {
      const w = new mu.DocumentWriter(buf, 'svg', 'text=path');
      w.beginPage([0, 0, 10, 10]).fillText(text, mu.Matrix.identity, mu.ColorSpace.DeviceGray, [0], 1);
      w.endPage();
      w.close();
      svg = buf.asString();
    } catch {
      /* 读不了的字体：下面全部记为 render */
    } finally {
      text.destroy();
      buf.destroy();
    }
    const defs = new Map<string, { attrs: string[]; group: string | null }>();
    for (const m of svg.matchAll(/<path id="(font_\w+)"([^>]*?)\/>/g)) defs.set(m[1], { attrs: [m[2]], group: null });
    for (const m of svg.matchAll(/<g id="(font_\w+)">([\s\S]*?)<\/g>/g))
      defs.set(m[1], { attrs: [...m[2].matchAll(/<path([^>]*?)\/>/g)].map(x => x[1]), group: m[2] });
    const uses = [...svg.matchAll(/<use[^>]*?xlink:href="#(font_\w+)"/g)].map(m => m[1]);
    const upem0 = programs.get(name)?.upem || 2048;
    list.forEach(([gid], i) => {
      const key = name + '|' + gid;
      if (uses.length !== list.length) return out.set(key, { path: null, upem: upem0, cx: 0, cy: 0, bad: 'render' });
      const def = defs.get(uses[i]);
      if (!def) return out.set(key, { path: null, upem: upem0, cx: 0, cy: 0 });
      if (def.group != null && /\sfill="|<image|<use/.test(def.group))
        return out.set(key, { path: null, upem: upem0, cx: 0, cy: 0, bad: 'color' });
      try {
        out.set(key, toFontUnits(def.attrs, upem0));
      } catch {
        out.set(key, { path: null, upem: upem0, cx: 0, cy: 0, bad: 'render' });
      }
    });
  }
  return out;
}
/**
 * MuPDF 的绝对坐标路径（em，y 向上；Type3 带 FontMatrix）→ 字体单位的整数坐标，再写成紧凑的相对坐标。
 * 二次曲线在 PDF 里升阶成了三次曲线，两个控制点反推出的二次控制点相同的还原成 q
 */
function toFontUnits(attrs: string[], upem0: number): Outline {
  type Cmd = [op: 'M' | 'L' | 'Q' | 'C' | 'Z', ...xy: number[]];
  const cmds: Cmd[] = [];
  let upem = upem0;
  for (const a of attrs) {
    const dm = a.match(/\sd="([^"]*)"/);
    if (!dm) continue;
    const tm = a.match(/transform="matrix\(([^)]*)\)"/);
    const fm = tm ? tm[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    // Type3 的 FontMatrix 是 1/upem（Skia 写成 1/2048 或 1/1000）
    if (tm) upem = Math.round(1 / Math.hypot(fm[0], fm[1]));
    const T = (x: number, y: number) => [
      (fm[0] * x + fm[2] * y + fm[4]) * upem,
      (fm[1] * x + fm[3] * y + fm[5]) * upem,
    ];
    const toks = dm[1].match(/[MLHVCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
    let i = 0,
      op = '',
      cx = 0,
      cy = 0,
      sx = 0,
      sy = 0;
    const n = () => {
      const v = parseFloat(toks[i++]);
      if (!Number.isFinite(v)) throw new Error('path');
      return v;
    };
    while (i < toks.length) {
      if (/^[a-z]$/i.test(toks[i])) op = toks[i++];
      if (op === 'Z' || op === 'z') {
        cmds.push(['Z']);
        [cx, cy] = [sx, sy];
        op = '';
        continue;
      }
      if (op === 'M') {
        [cx, cy] = [n(), n()];
        [sx, sy] = [cx, cy];
        cmds.push(['M', ...T(cx, cy)]);
        op = 'L';
      } else if (op === 'L' || op === 'H' || op === 'V') {
        if (op !== 'V') cx = n();
        if (op !== 'H') cy = n();
        cmds.push(['L', ...T(cx, cy)]);
      } else if (op === 'C') {
        const a1 = T(n(), n()),
          a2 = T(n(), n());
        const p0 = T(cx, cy);
        [cx, cy] = [n(), n()];
        const p3 = T(cx, cy);
        const q1 = [(3 * a1[0] - p0[0]) / 2, (3 * a1[1] - p0[1]) / 2],
          q2 = [(3 * a2[0] - p3[0]) / 2, (3 * a2[1] - p3[1]) / 2];
        if (Math.hypot(q1[0] - q2[0], q1[1] - q2[1]) < 0.05) cmds.push(['Q', ...q1, ...p3]);
        else cmds.push(['C', ...a1, ...a2, ...p3]);
      } else throw new Error('path ' + op);
    }
  }
  if (!cmds.length) return { path: null, upem, cx: 0, cy: 0 };
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [, ...xy] of cmds)
    for (let k = 0; k < xy.length; k += 2) {
      x0 = Math.min(x0, xy[k]);
      x1 = Math.max(x1, xy[k]);
      y0 = Math.min(y0, xy[k + 1]);
      y1 = Math.max(y1, xy[k + 1]);
    }
  return { path: compact(cmds), upem, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
/** 字体单位的绝对坐标命令 → { m: 首个 moveto, d: 其余的相对坐标 }。坐标先取整再求差，不累积误差 */
function compact(cmds: [string, ...number[]][]): GlyphPath | null {
  const R = Math.round;
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    first: [number, number] | null = null,
    d = '',
    last = '';
  const emit = (op: string, ...ns: number[]) => {
    const body = ns.map((n, i) => (i && n >= 0 ? ' ' : '') + n).join('');
    // 同一命令接着写时省去字母；接着的数是负数时负号本身就能分隔
    d += op === last ? (ns[0] >= 0 ? ' ' : '') + body : op + body;
    last = op === 'm' ? 'l' : op;
  };
  for (const [op, ...raw] of cmds) {
    const a = raw.map(R);
    if (op === 'M') {
      // 首点由客户端写成绝对的 M（M 后面的隐式坐标对是绝对 L），所以紧跟的命令必须显式写字母
      if (!first) {
        first = [a[0], a[1]];
        last = '';
      } else emit('m', a[0] - x, a[1] - y);
      [x, y, sx, sy] = [a[0], a[1], a[0], a[1]];
    } else if (op === 'L') {
      const dx = a[0] - x,
        dy = a[1] - y;
      if (!dx && !dy) continue;
      if (!dy) emit('h', dx);
      else if (!dx) emit('v', dy);
      else emit('l', dx, dy);
      [x, y] = [a[0], a[1]];
    } else if (op === 'Q') {
      emit('q', a[0] - x, a[1] - y, a[2] - x, a[3] - y);
      [x, y] = [a[2], a[3]];
    } else if (op === 'C') {
      emit('c', a[0] - x, a[1] - y, a[2] - x, a[3] - y, a[4] - x, a[5] - y);
      [x, y] = [a[4], a[5]];
    } else if (op === 'Z') {
      d += 'z';
      last = 'z';
      [x, y] = [sx, sy];
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
function programs(doc: PDFDocument) {
  const out = new Map<string, Program | null>();
  for (let p = 0; p < doc.countPages(); p++) {
    const res = doc.findPage(p).getInheritable('Resources');
    const fonts = res.isNull() ? res : res.get('Font');
    if (!fonts.isDictionary()) continue;
    fonts.forEach(ref => {
      const f = ref.resolve();
      if (f.get('Subtype').asName() !== 'Type0' || !f.get('BaseFont').isName()) return;
      const name = f.get('BaseFont').asName();
      if (out.has(name)) return;
      let prog: Program | null = null;
      try {
        const fd = f.get('DescendantFonts').get(0).resolve().get('FontDescriptor').resolve();
        const ff = fd.get('FontFile2').isNull() ? fd.get('FontFile3') : fd.get('FontFile2');
        if (!ff.isNull()) {
          const parsed = fontkit.create(Buffer.from(ff.readStream().asUint8Array()));
          const font = 'fonts' in parsed ? parsed.fonts[0] : parsed;
          const os2 = font['OS/2'];
          prog = {
            upem: font.unitsPerEm || 2048,
            // 没有 OS/2 表时字重未知：比较都不成立，不补画
            weight: os2?.usWeightClass ?? NaN,
            italic: !!(os2?.fsSelection?.italic || os2?.fsSelection?.oblique || font.head?.macStyle?.italic),
          };
        }
      } catch {
        prog = null;
      }
      out.set(name, prog);
    });
  }
  return out;
}

// ---------- DirectWrite 模拟的粗体、斜体 ----------
/** 点落在哪个字框里（字框都没有就取中心最近的），返回字框所在元素的编号 */
function elementAt(rects: Rect[], x: number, y: number) {
  let best = -1,
    bd = Infinity;
  for (const [rx, ry, w, h, el] of rects) {
    const dx = x < rx ? rx - x : x > rx + w ? x - rx - w : 0,
      dy = y < ry ? ry - y : y > ry + h ? y - ry - h : 0;
    const d = dx * dx + dy * dy;
    if (d < bd) [best, bd] = [el, d];
    if (!d) break;
  }
  return best;
}
/** 矩阵带倾斜：em 的两条轴在页面上不垂直（Skia 合成斜体在 Tm 里写错切） */
const skewed = (m: Matrix) => Math.abs(m[0] * m[2] + m[1] * m[3]) > 0.05 * Math.abs(m[0] * m[3] - m[1] * m[2]);
/**
 * 哪些 Type0 字体是 DirectWrite 模拟了粗体、斜体的本机字体。Skia 合成的粗体写成 Type3（轮廓已加粗）、合成的斜体在矩阵里，都不用补；
 * DirectWrite 模拟的仍按原字体程序嵌入，PDF 里看不出来。判据：字形所在元素要求的字重比字体程序重 200 以上（或要求斜体而字体程序不是斜体、
 * 矩阵也没斜），且 Chrome 报告这个元素用的是本机字体（网页字体不会被 DirectWrite 模拟）。每个字体按它的多数字形判
 */
async function simulated(
  cdp: CDPSession,
  pages: { ink: Ink; rects: Rect[] }[],
  progs: Map<string, Program | null>,
  outs: Map<string, Outline>,
  els: ElInfo[],
) {
  const votes = new Map<string, { n: number; bold: number; slant: number; els: Set<number> }>();
  for (const { ink, rects } of pages)
    for (const g of ink.glyphs) {
      const prog = progs.get(g.name),
        o = outs.get(g.name + '|' + g.gid);
      if (!prog || !o || !o.path) continue;
      const u = o.cx / o.upem,
        v = o.cy / o.upem;
      const el = elementAt(rects, g.m[0] * u + g.m[2] * v + g.m[4], g.m[1] * u + g.m[3] * v + g.m[5]);
      if (el < 0) continue;
      const e = els[el];
      let t = votes.get(g.name);
      if (!t) votes.set(g.name, (t = { n: 0, bold: 0, slant: 0, els: new Set() }));
      t.n++;
      if (e.synthW && e.weight - prog.weight > 200) t.bold++;
      if (e.synthS && e.italic && !prog.italic && !skewed(g.m)) t.slant++;
      t.els.add(el);
    }
  const out = new Map<string, { bold: boolean; slant: boolean }>();
  const want = [...votes].filter(([, t]) => t.bold * 2 > t.n || t.slant * 2 > t.n);
  if (!want.length) return out;
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-e]' });
  const local = new Map<number, Map<string, boolean>>();
  const need = [...new Set(want.flatMap(([, t]) => [...t.els]))];
  await Promise.all(
    need.map(async el => {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[el] });
      local.set(el, new Map(fonts.map(f => [f.postScriptName, !f.isCustomFont])));
    }),
  );
  for (const [name, t] of want) {
    const ps = name.replace(/^[A-Z]{6}\+/, '');
    let yes = 0,
      no = 0;
    for (const el of t.els) {
      const l = local.get(el)?.get(ps);
      if (l === true) yes++;
      else if (l === false) no++;
    }
    if (yes > no) out.set(name, { bold: t.bold * 2 > t.n, slant: t.slant * 2 > t.n });
  }
  return out;
}

/** 一个字形落到结果里：em → 内容盒 px 的矩阵换成字体单位 → px，补上 DirectWrite 的模拟 */
function place(g: RawGlyph, o: Outline, path: number, sim?: { bold: boolean; slant: boolean }): PlacedGlyph {
  let [a, b, c, d, e, f] = g.m;
  if (sim?.slant) {
    c += DW_SLANT * a;
    d += DW_SLANT * b;
  }
  let w = 0;
  const size = Math.sqrt(Math.abs(a * d - b * c));
  if (sim?.bold) {
    w = DW_BOLD * o.upem;
    // 往字形自己的 x 方向挪加粗量的一半
    e += (a / size) * (DW_BOLD * size) * 0.5;
    f += (b / size) * (DW_BOLD * size) * 0.5;
  }
  const lin = (v: number) => (Math.abs(v) < 1e-9 ? 0 : +(v / o.upem).toPrecision(6));
  const pos = (v: number) => +v.toFixed(3);
  return [path, [lin(a), lin(b), lin(c), lin(d), pos(e), pos(f)], g.fill, +g.alpha.toFixed(3), +w.toFixed(2)];
}

// ---------- 一次请求 ----------
async function run(req: GlyphRequest): Promise<GlyphResponse> {
  const s = await session();
  if (s.dpr !== req.dpr) {
    await s.page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: req.dpr });
    s.dpr = req.dpr;
  }
  await installFonts(s.page, req.fonts);
  const laid = await s.page.evaluate(layOut, req.units);
  const results: (GlyphUnitResult | null)[] = laid.units.map(l =>
    l.dev > TOL
      ? { fail: 'mismatch', detail: `${l.worst.slice(0, 8)} ${l.dev > 1e8 ? '-' : l.dev.toFixed(2)}px` }
      : null,
  );
  const kept = results.flatMap((r, i) => (r ? [] : [i]));
  if (!kept.length) return { paths: [], units: results };
  const paper = await s.page.evaluate(
    paginate,
    kept.map(u => ({ u, pad: laid.units[u].pad })),
  );
  const pdf = await s.page.pdf({
    width: paper.w + 'px',
    height: paper.h + 'px',
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const mu = await mupdf();
  const doc = new mu.PDFDocument(pdf);
  const fonts: FontUse = new Map();
  const paths: GlyphPath[] = [],
    pathNo = new Map<string, number>();
  try {
    if (doc.countPages() !== kept.length) {
      for (const u of kept) results[u] = { fail: 'render', detail: `${doc.countPages()}/${kept.length} pages` };
      return { paths, units: results };
    }
    const pages = kept.map((u, k) => {
      const l = laid.units[u];
      const page = doc.loadPage(k);
      try {
        return { ink: readPage(mu, page, fonts, l.pad[0] + l.ox, l.pad[1]), rects: l.rects };
      } finally {
        page.destroy();
      }
    });
    const progs = programs(doc);
    const outs = outlines(mu, fonts, progs);
    const sims = await simulated(s.cdp, pages, progs, outs, laid.els);
    kept.forEach((u, k) => {
      const { ink } = pages[k];
      if (ink.effect) return (results[u] = { fail: 'effect' });
      const os = ink.glyphs.map(g => outs.get(g.name + '|' + g.gid));
      if (os.some(o => o?.bad === 'color')) return (results[u] = { fail: 'color' });
      if (os.some(o => !o || o.bad)) return (results[u] = { fail: 'render' });
      const glyphs: PlacedGlyph[] = [];
      for (const g of ink.glyphs) {
        const key = g.name + '|' + g.gid,
          o = outs.get(key);
        if (!o.path) continue;
        if (!pathNo.has(key)) {
          pathNo.set(key, paths.length);
          paths.push(o.path);
        }
        glyphs.push(place(g, o, pathNo.get(key), sims.get(g.name)));
      }
      results[u] = { glyphs, fills: ink.fills };
    });
    return { paths, units: results };
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
  const req = clean(body);
  const job = queue.then(() => {
    getAsset = assets;
    return run(req);
  });
  queue = job.catch(() => {});
  return job;
}
