// 字形接口：无头 Chrome 告诉我们每个字实际用的是哪个字形面（CDP CSS.getPlatformFontsForNode），fontkit 给出轮廓。
// 文章的网页字体（@font-face）在无头 Chrome 里照原样声明一遍（字节由本机服务提供），Chrome 选中哪个文件就用哪个文件的字形
import { loadIndex, norm, shape, shapeClusters, pathOf, parseFeatures, faceKey, webFontInfo, dropWebFonts } from './fontindex.ts';
import { findChrome } from './chrome.ts';
import { convert as convertFont } from 'fontverter';
import { ASSET_ID } from '../ui/convert/assetid.ts';
import { GLYPH_LIMITS as LIMITS } from '../ui/convert/glyphlimits.ts';
import { splitTop, unq, unicodeRanges } from '../ui/convert/util.ts';
import type { GlyphChar, GlyphFace, GlyphFont, GlyphFontSrc, GlyphItem, GlyphMiss, GlyphMissKind, GlyphOutline, GlyphPath, GlyphRef, GlyphResponse, GlyphRun, GlyphShape } from '../ui/convert/types.ts';

const IDLE_MS = 5 * 60000;
// 无头页面的源：不存在的域名，所有请求都被拦下，只回本页与字体字节，别的一律不发出去
const ORIGIN = 'https://glyphs.html2gzh.invalid';
const STYLE = { family: 'font-family', weight: 'font-weight', style: 'font-style', stretch: 'font-stretch', features: 'font-feature-settings', variations: 'font-variation-settings', ligatures: 'font-variant-ligatures' };
const SEG = new Intl.Segmenter('und', { granularity: 'grapheme' });
const graphemes = (s: string) => [...SEG.segment(s)].map(x => x.segment);
// 标点挤压（text-spacing-trim / halt）会把全角标点排成半宽，这几段字符额外给出 halt 字形，由客户端按实测宽度挑
const CJK_PUNCT = /^[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\u2018\u2019\u201c\u201d\u2014\u2026\u00b7]$/u;
const OT_LANG: [RegExp, string][] = [[/^zh-(hk|mo)/i, 'ZHH '], [/^zh-(tw|hant)/i, 'ZHT '], [/^zh/i, 'ZHS '], [/^ja/i, 'JAN '], [/^ko/i, 'KOR ']];

let browserP = null, idle: ReturnType<typeof setTimeout> | 0 = 0, queue: Promise<unknown> = Promise.resolve();
/** 按 id 取已登记文件的字节（lib/uiroute.ts 提供） */
let getAsset: (id: string) => Buffer | null = null;
// 当前装在无头页面里的网页字体：签名、每条 @font-face 的信息（对上 Chrome 报的字体用）
let webSig = '', webFaces = [];
async function session() {
  clearTimeout(idle);
  idle = setTimeout(() => { const b = browserP; browserP = null; if (b) b.then(x => x.browser.close()).catch(() => {}); }, IDLE_MS);
  idle.unref();
  if (!browserP) {
    const p = browserP = (async () => {
      const exe = findChrome();
      if (!exe) throw new Error('未找到 Chrome 或 Edge：转为 SVG 路径时，需要通过它确定每个字实际使用的字体（浏览器安装在其他位置时，请设置环境变量 CHROME_PATH）');
      const { default: puppeteer } = await import('puppeteer-core');
      const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--disable-extensions'] });
      // 浏览器崩了或被关掉时丢掉缓存，下次请求重新启动
      browser.once('disconnected', () => { if (browserP === p) { browserP = null; webSig = ''; } });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', r => {
        let u;
        try { u = new URL(r.url()); } catch { return r.abort(); }
        if (u.origin !== ORIGIN) return r.abort();
        if (u.pathname === '/') return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>' });
        const id = u.pathname.startsWith('/a/') ? u.pathname.slice(3) : '';
        const buf = ASSET_ID.test(id) && getAsset ? getAsset(id) : null;
        if (!buf) return r.respond({ status: 404, body: '' });
        r.respond({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: buf });
      });
      await page.goto(ORIGIN + '/');
      const cdp = await page.createCDPSession();
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      return { browser, page, cdp };
    })();
  }
  try { return await browserP; } catch (e) { browserP = null; throw e; }
}

/** 校验请求：只收字体相关的几个属性，字符串都限长 */
function clean(body: any): GlyphItem[] {
  const items = Array.isArray(body && body.items) ? body.items : null;
  if (!items || items.length > LIMITS.items) throw new Error('items 格式有误或数量超出上限');
  let total = 0, runs = 0, runChars = 0;
  return items.map(it => {
    // opsz：网页字体的字号（font-optical-sizing: auto 时 Chrome 把 opsz 轴设成字号），0 表示不设
    const opsz = Number(it.opsz);
    const out = { lang: typeof it.lang === 'string' ? it.lang.slice(0, 35) : '', spaced: it.spaced === true, opsz: opsz > 0 && opsz < 2000 ? opsz : 0 } as GlyphItem;
    for (const k of Object.keys(STYLE)) {
      const v = it[k] == null ? '' : String(it[k]);
      if (v.length > LIMITS.str) throw new Error(k + ' 超出长度上限');
      out[k] = v;
    }
    if (!Array.isArray(it.chars)) throw new Error('chars 应为数组');
    out.chars = it.chars.map(c => String(c));
    if (out.chars.some(c => !c || c.length > LIMITS.char)) throw new Error('chars 中有空字符串或超长的字');
    total += out.chars.length;
    if (total > LIMITS.chars) throw new Error('字数超出单次请求的上限');
    if (it.runs != null && !Array.isArray(it.runs)) throw new Error('runs 应为数组');
    out.runs = (it.runs || []).map(r => String(r));
    if (out.runs.some(r => !r || r.length > LIMITS.run)) throw new Error('runs 中有空字符串或超长的词');
    runs += out.runs.length; runChars += out.runs.reduce((n, r) => n + r.length, 0);
    if (runs > LIMITS.runs || runChars > LIMITS.runChars) throw new Error('词数超出单次请求的上限');
    return out;
  });
}
/**
 * 文章的网页字体：[{ family, weight, style, stretch, range, sizeAdjust, src:[{ local } | { id, format }] }]。
 * src 为空表示原稿里这条加载失败：照样声明一条加载不了的，让 Chrome 和原稿一样跳过它
 */
function cleanFonts(list: any): GlyphFont[] {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.fonts) throw new Error('fonts 格式有误或数量超出上限');
  const str = (v: unknown, max: number) => {
    const s = v == null ? '' : String(v);
    if (s.length > max || /[\u0000-\u001f\u007f]/.test(s)) throw new Error('fonts 中有超长或带控制字符的值');
    return s;
  };
  return list.map((f): GlyphFont => {
    const src = Array.isArray(f && f.src) ? f.src : [];
    if (src.length > LIMITS.srcs) throw new Error('src 数量超出上限');
    return {
      family: str(f.family, LIMITS.str), weight: str(f.weight, 40), style: str(f.style, 40), stretch: str(f.stretch, 40),
      range: str(f.range, LIMITS.range), sizeAdjust: str(f.sizeAdjust, 20),
      src: src.map(s => s && s.local != null ? { local: str(s.local, LIMITS.str) }
        : s && ASSET_ID.test(String(s.id)) ? { id: String(s.id), format: str(s.format, 30) } : null).filter(Boolean) as GlyphFontSrc[],
    };
  });
}
// woff、woff2 先解成普通字体文件再交给 fontkit：fontkit 直接读 woff2 时，可变字体的 getVariation 会丢掉 cmap，取不出字形。
// Chrome 那边仍用原文件
const sfnts = new Map<string, Promise<Buffer | null>>();
async function sfntOf(id: string) {
  if (!sfnts.has(id)) {
    const raw = getAsset(id);
    sfnts.set(id, raw ? convertFont(raw, 'sfnt').then(b => Buffer.from(b)).catch(() => null) : Promise.resolve(null));
  }
  return sfnts.get(id);
}
/** 字体集合变了才重装：清掉旧的、按原样声明新的、全部加载完；以前的查询结果作废 */
async function installFonts(page, fonts: GlyphFont[]) {
  const sig = JSON.stringify(fonts);
  if (sig === webSig) return;
  resolved.clear(); runCount.clear(); dropWebFonts(); sfnts.clear();
  webFaces = [];
  for (const f of fonts) {
    const id = (f.src.find(s => s.id) || {}).id;
    const buf = id ? await sfntOf(id) : null;
    const info = buf ? webFontInfo(buf) : null;
    webFaces.push({ ...f, id: info ? id : '', data: info ? buf : null, info, ranges: unicodeRanges(f.range), w: rangeOf(f.weight, 400), s: rangeOf(f.stretch, 100), italic: /italic|oblique/.test(f.style) });
  }
  const bad = await page.evaluate(async fonts => {
    document.fonts.clear();
    let bad = 0;
    for (const f of fonts) {
      // url() 指向本页源下的 /a/<id>（请求被拦下，回登记过的字节）；src 为空时指向一个不存在的文件，加载失败
      const src = f.src.length ? f.src.map(s => s.local != null ? `local(${JSON.stringify(s.local)})` : `url(/a/${s.id})` + (s.format ? ` format(${JSON.stringify(s.format)})` : '')).join(', ') : 'url(/a/missing)';
      const d: FontFaceDescriptors & { sizeAdjust?: string } = { style: f.style || 'normal', weight: f.weight || 'normal', stretch: f.stretch || 'normal' };
      if (f.range) d.unicodeRange = f.range;
      if (f.sizeAdjust) d.sizeAdjust = f.sizeAdjust;
      try { document.fonts.add(new FontFace(f.family, src, d)); } catch { bad++; }
    }
    await Promise.all([...document.fonts].map(f => f.load().catch(() => {})));
    return bad;
  }, fonts);
  if (bad) console.error(`字形服务  ${bad} 条网页字体声明无效，已跳过`);
  webSig = sig;
}
/** "400" / "300 700" / "75% 100%" → [min, max]；空值用默认 */
function rangeOf(s: string, def: number): [number, number] {
  const n = String(s || '').trim().split(/\s+/).map(parseFloat).filter(x => !Number.isNaN(x));
  return n.length ? [Math.min(...n), Math.max(...n)] : [def, def];
}

/**
 * 问 Chrome 每个字最终用了哪个字形面：每个字放一个行内块，彼此不连排（相邻的 f、i 会被排成连字，后一个字就报不出字体）。
 * 每个词另放一段、照原样设字距，记下 Chrome 排它用了各字形面多少个字形，供整词排版对照。都按样式缓存
 */
const resolved = new Map<string, ChromeFont | null>(), runCount = new Map<string, Record<string, number>>();
interface ChromeFont { ps: string; family: string; custom: boolean }
const styleKey = (it: GlyphItem) => JSON.stringify([it.family, it.weight, it.style, it.stretch, it.features, it.variations, it.ligatures, it.lang]);
const runKey = (it: GlyphItem, w: string) => styleKey(it) + (it.spaced ? '\u0001' : '\u0000') + w;
async function resolveFaces(items: GlyphItem[]) {
  const todo: [number, string][] = [], words: [number, string][] = [];
  items.forEach((it, i) => {
    const need = new Set(it.chars);
    for (const w of new Set(it.runs)) {
      for (const g of graphemes(w)) if (g.length <= LIMITS.char) need.add(g);
      if (!runCount.has(runKey(it, w))) words.push([i, w]);
    }
    for (const c of need) if (c.trim() && !resolved.has(styleKey(it) + '\u0000' + c)) todo.push([i, c]);
  });
  if (!todo.length && !words.length) return;
  const { page, cdp } = await session();
  // 内容不经过 HTML 解析：样式逐项 setProperty（非法值浏览器直接丢弃），文字用 textContent
  await page.evaluate((items, todo, words, STYLE) => {
    document.body.textContent = '';
    const boxes = items.map(it => {
      const d = document.createElement('div');
      if (it.lang) d.lang = it.lang;
      for (const [k, prop] of Object.entries(STYLE)) if (it[k]) d.style.setProperty(prop as string, it[k]);
      d.style.setProperty('font-size', '40px');
      document.body.appendChild(d);
      return d;
    });
    for (const [i, c] of todo) { const s = document.createElement('span'); s.style.display = 'inline-block'; s.textContent = c; boxes[i].appendChild(s); }
    for (const [i, w] of words) { const p = document.createElement('p'); if (items[i].spaced) p.style.letterSpacing = '1px'; p.textContent = w; boxes[i].appendChild(p); }
    // getPlatformFontsForNode 读的是排版结果，不先排版会返回空列表
    return document.body.offsetHeight;
  }, items, todo, words, STYLE);
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const nodes = async sel => (await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: sel })).nodeIds;
  const spans = await nodes('body > div > span'), paras = await nodes('body > div > p');
  if (spans.length !== todo.length || paras.length !== words.length) throw new Error('字体查询页的结构有误');
  const fontsOf = async ids => {
    const out = [];
    for (let k = 0; k < ids.length; k += 200) out.push(...await Promise.all(ids.slice(k, k + 200).map(nodeId => cdp.send('CSS.getPlatformFontsForNode', { nodeId }))));
    return out.map(r => r.fonts);
  };
  (await fontsOf(spans)).forEach((fonts, j) => {
    const [i, c] = todo[j];
    const best = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
    resolved.set(styleKey(items[i]) + '\u0000' + c, best ? { ps: best.postScriptName, family: best.familyName, custom: best.isCustomFont } : null);
  });
  (await fontsOf(paras)).forEach((fonts, j) => {
    const [i, w] = words[j];
    runCount.set(runKey(items[i], w), Object.fromEntries(fonts.map(f => [f.postScriptName, f.glyphCount])));
  });
}

/**
 * CSS 的连字开关 → OpenType 特性。字距不为 0 时 Chrome 关掉常用连字和上下文变体（实测 Calibri「office」排 6 个字形，
 * 写了 common-ligatures 也一样；Segoe Script 只有连 calt 一起关，整词步进才和 Chrome 一致）
 */
function featuresFor(it: GlyphItem): Record<string, boolean> {
  const f: Record<string, boolean> = {};
  for (const v of it.ligatures.split(/\s+/)) {
    if (v === 'none') Object.assign(f, { liga: false, clig: false, dlig: false, hlig: false, calt: false });
    else if (v === 'no-common-ligatures') Object.assign(f, { liga: false, clig: false });
    else if (v === 'discretionary-ligatures' || v === 'no-discretionary-ligatures') f.dlig = v[0] !== 'n';
    else if (v === 'historical-ligatures' || v === 'no-historical-ligatures') f.hlig = v[0] !== 'n';
    else if (v === 'no-contextual') f.calt = false;
  }
  if (it.spaced) Object.assign(f, { liga: false, clig: false, calt: false });
  return { ...f, ...parseFeatures(it.features) };
}

const otLang = (lang: string) => { const hit = OT_LANG.find(([re]) => re.test(lang || '')); return hit ? hit[1] : undefined; };

/** 字体栈 → 规范化的字体名（顶层逗号切分，去引号） */
const stackNames = (stack: string) => splitTop(String(stack)).map(s => unq(s).toLowerCase()).filter(Boolean);
/**
 * Chrome 报的网页字体 → 装进去的哪条 @font-face。Chrome 报的是字体文件里的名字（可变字体报命名实例的 PostScript 名），
 * 不是 CSS 里的字体名，所以按文件里的各种名字对；同名的几条（unicode-range 切片、不同字重的文件）再按
 * 字体栈先后、unicode-range 与 cmap 是否含这个字、字重与斜体是否吻合挑
 */
function matchWeb(it: GlyphItem, c: string, hit: ChromeFont) {
  const cp = c.codePointAt(0), stack = stackNames(it.family);
  const keys = [norm(hit.ps), norm(hit.family)].filter(Boolean);
  const w = parseFloat(it.weight) || 400, italic = it.style !== 'normal';
  let best = null, bestScore = Infinity;
  for (const f of webFaces) {
    if (!f.info || !keys.some(k => f.info.names.has(k))) continue;
    const at = stack.indexOf(f.family.toLowerCase());
    if (at < 0 || !f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi) || !f.info.has(cp)) continue;
    const score = at * 100 + (w >= f.w[0] && w <= f.w[1] ? 0 : 10) + (italic === f.italic ? 0 : 1);
    // 同分时取后声明的：范围重叠的几条 @font-face，Chrome 先试后面的
    if (score <= bestScore) { best = f; bestScore = score; }
  }
  return best;
}
/**
 * 可变网页字体的坐标，照 Blink 的做法：字重、宽度先夹进 @font-face 声明的范围再设到 wght、wdth 轴，
 * font-optical-sizing 为 auto 时 opsz 轴设成字号，最后是 font-variation-settings。都再夹进轴自己的范围
 */
function varCoords(f, it: GlyphItem) {
  const axes = f.info.axes;
  if (!axes) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const out: Record<string, number> = {};
  const set = (tag: string, v: number) => { if (axes[tag] && Number.isFinite(v)) out[tag] = clamp(v, axes[tag].min, axes[tag].max); };
  set('wght', clamp(parseFloat(it.weight) || 400, f.w[0], f.w[1]));
  set('wdth', clamp(parseFloat(it.stretch) || 100, f.s[0], f.s[1]));
  if (it.opsz) set('opsz', it.opsz);
  if (it.variations && it.variations !== 'normal') {
    for (const m of it.variations.matchAll(/["']([A-Za-z0-9 ]{4})["']\s+(-?[\d.]+)/g)) set(m[1].trim(), parseFloat(m[2]));
  }
  return Object.keys(out).length ? out : null;
}

/**
 * POST /api/glyphs 的处理：{ items:[{ family, weight, style, stretch, features, variations, ligatures, lang, spaced, chars:[字], runs:[词] }] }
 * → { faces:[{ upem, weight, italic, name }], paths:[{ m, d }], items:[{ chars:[ 字形 | { miss, ps? } | { space } ], runs:[ 词结果 ] }] }
 * 字形 = { f, adv, g:[[路径号, x, y]], halt? }。词结果：null 表示逐字排版就是对的；
 * 数组表示整词排版与逐字不同（连字、上下文变体），按字素给出替换（null 为不变、{ adv, g } 为簇首、{ adv:0, g:[] } 为连字的后续字）；
 * 'bad' 表示对不上 Chrome 的排版，这个词不能画
 */
export function handleGlyphs(body: any, assets: (id: string) => Buffer | null): Promise<GlyphResponse> {
  const items = clean(body), fonts = cleanFonts(body && body.fonts);
  const job = queue.then(() => { getAsset = assets; return run(items, fonts); });
  queue = job.catch(() => {});
  return job;
}
// 汉字、假名、谚文、全角标点：逐字排版，不参与整词比较（连字与上下文变体只出现在拼音文字里，汉字和西文混排时脚本切分也难对上 Chrome）
const CJK = /[\u1100-\u11ff\u2e80-\u2fff\u3000-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{3ffff}]/u;
async function run(items: GlyphItem[], fonts: GlyphFont[]): Promise<GlyphResponse> {
  const index = loadIndex();
  const { page } = await session();
  await installFonts(page, fonts);
  await resolveFaces(items);
  const faces: GlyphFace[] = [], faceNo = new Map<string, number>(), paths: GlyphPath[] = [], pathNo = new Map<string, number>(), webCache = new Map();
  const pathRef = (id: string) => {
    if (!pathNo.has(id)) { pathNo.set(id, paths.length); paths.push(pathOf(id)); }
    return pathNo.get(id);
  };
  const glyphsOf = (gs: { id: string; x: number; y: number }[]) => gs.map((g): GlyphRef => [pathRef(g.id), g.x, g.y]);
  // 返回给客户端的字形面：合成粗体、斜体按 Chrome 的规则判断，网页字体与本机字体的规则不同；scale 是 size-adjust
  const faceOf = (it: GlyphItem, c: string): FaceHit => {
    const hit = resolved.get(styleKey(it) + '\u0000' + c);
    if (!hit) return { miss: 'nofont' };
    let face, info: Omit<GlyphFace, 'name'>;
    if (hit.custom) {
      // 网页字体只用文章引用的文件；本机装了同名字体也不用（版本、子集可能不同）。local() 声明的 Chrome 报成本机字体，走下面
      const wf = matchWeb(it, c, hit);
      if (!wf) return { miss: 'webfont', ps: hit.ps };
      const coords = varCoords(wf, it);
      const fk = `asset:${wf.id}#${wf.info.idx}#${coords ? JSON.stringify(coords) : ''}`;
      if (!webCache.has(fk)) webCache.set(fk, { file: 'asset:' + wf.id, idx: wf.info.idx, coords, data: wf.data, upem: wf.info.upem, color: wf.info.color });
      face = webCache.get(fk);
      info = { upem: wf.info.upem, weight: wf.w[1], italic: wf.italic, web: true, scale: wf.sizeAdjust ? parseFloat(wf.sizeAdjust) / 100 || 1 : 1 };
    } else {
      face = index.get(norm(hit.ps)) || index.get(norm(hit.family));
      if (!face) return { miss: 'notindexed', ps: hit.ps };
      info = { upem: face.upem, weight: face.weight, italic: face.italic };
    }
    if (face.color) return { miss: 'color', ps: hit.ps };
    const fk = faceKey(face) + (info.web ? `|${info.weight}|${info.italic}|${info.scale}` : '');
    if (!faceNo.has(fk)) { faceNo.set(fk, faces.length); faces.push({ ...info, name: hit.ps }); }
    return { face, ps: hit.ps, fk };
  };
  const out = items.map(it => {
    const feats = featuresFor(it);
    const lang = otLang(it.lang);
    const chars = it.chars.map((c): GlyphChar => {
      if (!c.trim()) return { space: true };
      const fc = faceOf(it, c);
      if (fc.miss) return fc as GlyphMiss;
      let r;
      try { r = shape(fc.face, c, feats, lang); } catch { return { miss: 'shape', ps: fc.ps }; }
      if (r.notdef) return { miss: 'notdef', ps: fc.ps };
      const g: GlyphOutline = { f: faceNo.get(fc.fk), adv: r.adv, g: glyphsOf(r.glyphs) };
      if (CJK_PUNCT.test(c) && !feats.halt) {
        const h = shape(fc.face, c, { ...feats, halt: true }, lang);
        if (h.adv !== r.adv) g.halt = { adv: h.adv, g: glyphsOf(h.glyphs) };
      }
      return g;
    });
    const runs = it.runs.map(w => contextual(it, w, feats, lang, faceOf, glyphsOf));
    return { chars, runs };
  });
  return { faces, paths, items: out };
}

/**
 * 一个词（同一样式、中间无空格）整体排版，和逐字排版比：字形或字形内偏移不同就给出按字素的替换。
 * 词按字形面切段（混排时西文、汉字可能各用一套字），汉字逐字成段。
 * 最后核对每个字形面排出的字形数与 Chrome 一致：连字成没成、回落到哪套字，两边必须相同
 */
/** faceOf 的结果：缺字时 miss 为原因 */
interface FaceHit { miss?: GlyphMissKind | 'long'; face?: any; ps?: string; fk?: string }
function contextual(it: GlyphItem, word: string, feats: Record<string, boolean>, lang: string, faceOf: (it: GlyphItem, c: string) => FaceHit, glyphsOf: (gs: { id: string; x: number; y: number }[]) => GlyphRef[]): GlyphRun {
  const gs = graphemes(word);
  const fcs = gs.map((g): FaceHit => g.length > LIMITS.char ? { miss: 'long' } : faceOf(it, g));
  if (fcs.some(f => f.miss)) return 'bad';
  const want = runCount.get(runKey(it, word));
  if (!want) return 'bad';
  const got: Record<string, number> = {}, over: (GlyphShape | null)[] = gs.map(() => null);
  let differs = false;
  for (let i = 0; i < gs.length;) {
    let j = i + 1;
    if (!CJK.test(gs[i])) while (j < gs.length && fcs[j].face === fcs[i].face && !CJK.test(gs[j])) j++;
    const part = gs.slice(i, j), face = fcs[i].face;
    let whole;
    try { whole = shapeClusters(face, part, feats, lang); } catch { return 'bad'; }
    if (!whole) return 'bad';
    got[fcs[i].ps] = (got[fcs[i].ps] || 0) + whole.count;
    part.forEach((g, k) => {
      const each = shape(face, g, feats, lang).glyphs, w = whole.graphemes[k];
      const same = each.length === w.glyphs.length && each.every((e, q) => e.id === w.glyphs[q].id && Math.abs(e.x - w.glyphs[q].x) < 0.5 && Math.abs(e.y - w.glyphs[q].y) < 0.5);
      if (!same) { differs = true; over[i + k] = { adv: w.adv, g: glyphsOf(w.glyphs) }; }
    });
    i = j;
  }
  const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
  for (const k of keys) if ((want[k] || 0) !== (got[k] || 0)) return 'bad';
  return differs ? over : null;
}
