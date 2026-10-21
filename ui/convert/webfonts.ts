import { splitTop, ruleType, unq, unicodeRanges, eachAuthorSheet } from './util.ts';
import type { GlyphFont, GlyphFontSrc } from './types.ts';

// 原稿的网页字体（@font-face）：哪些在原稿里真正用上了（加载过），字体文件在哪。
// 转为 SVG 路径时，字形服务在无头 Chrome 里照原样声明这些字体，取同样文件里的字形

const KW_W = { normal: '400', bold: '700' };
const KW_S = { 'ultra-condensed': '50%', 'extra-condensed': '62.5%', condensed: '75%', 'semi-condensed': '87.5%', normal: '100%',
  'semi-expanded': '112.5%', expanded: '125%', 'extra-expanded': '150%', 'ultra-expanded': '200%' };
/** "bold" / "300 700" / "400 400" → 统一写法；FontFace 与 CSSFontFaceRule 序列化得不一样，两边都过一遍再比 */
const normRange = (s, kw, def) => {
  const v = (String(s || '').trim().toLowerCase() || def).split(/\s+/).map(x => kw[x] || x);
  return v.length === 2 && v[0] === v[1] ? v[0] : v.join(' ');
};
const normStyle = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ') || 'normal';
/** unicode-range → "lo-hi,lo-hi"（十六进制），空值或全写错时为全部 */
function normUnicode(s) {
  const r = unicodeRanges(s);
  return (r.length ? r : [[0, 0x10ffff]]).map(([lo, hi]) => lo.toString(16) + '-' + hi.toString(16)).join(',');
}
const faceKey = (family, weight, style, stretch, range) =>
  [unq(family).toLowerCase(), normRange(weight, KW_W, '400'), normStyle(style), normRange(stretch, KW_S, '100%'), normUnicode(range)].join('|');

/** 作者样式表里生效的 @font-face（所在的 @media/@supports 当场成立） */
function faceRules(doc) {
  const win = doc.defaultView, out = [];
  const walk = list => {
    for (const r of list) {
      const t = ruleType(r);
      if (t === 'CSSFontFaceRule') out.push(r);
      else if (t === 'CSSMediaRule') { if (win.matchMedia(r.media.mediaText).matches) walk(r.cssRules); }
      else if (t === 'CSSSupportsRule') { if (win.CSS.supports(r.conditionText)) walk(r.cssRules); }
      else if (t === 'CSSLayerBlockRule') walk(r.cssRules);
    }
  };
  eachAuthorSheet(doc, walk);
  return out;
}

/** 作者的全部 @font-face（带外层 @media/@supports），转换帧摘掉样式表后放回去：转换与转为路径时的排版和原稿用同一套字体 */
export function fontFaceCss(doc) {
  const out = [];
  const walk = (list, wrap) => {
    for (const r of list) {
      const t = ruleType(r);
      if (t === 'CSSFontFaceRule') out.push(wrap(r.cssText));
      else if (t === 'CSSMediaRule') walk(r.cssRules, css => wrap(`@media ${r.media.mediaText}{${css}}`));
      else if (t === 'CSSSupportsRule') walk(r.cssRules, css => wrap(`@supports ${r.conditionText}{${css}}`));
      else if (t === 'CSSLayerBlockRule') walk(r.cssRules, wrap);
    }
  };
  eachAuthorSheet(doc, list => walk(list, css => css));
  return out.join('\n');
}

/** src 描述符 → [{ local } | { url, format }]，保持原顺序 */
export function parseSrc(text) {
  return splitTop(text || '').map(part => {
    const loc = part.match(/^local\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*?))\s*\)/i);
    if (loc) return { local: (loc[1] ?? loc[2] ?? loc[3] ?? '').trim() };
    const u = part.match(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/i);
    if (!u) return null;
    const fm = part.match(/format\(\s*["']?([^"')]+)["']?\s*\)/i);
    return { url: (u[1] ?? u[2] ?? u[3] ?? '').trim(), format: fm ? fm[1].trim().toLowerCase() : '' };
  }).filter(Boolean);
}

/**
 * 原稿里加载过（或加载失败）的网页字体，对回各自的 @font-face：{ faces:[{ family, weight, style, stretch, range, sizeAdjust, src, failed }], missing }。
 * 没加载的不算：原稿里没有字用到它。加载失败的也要：Chrome 选中它后会跳到字体栈的下一个，字形服务要照样跳。
 * 对不回规则的字体名放进 missing（用到它们的字不转）
 */
export function usedWebFonts(doc) {
  const rules = new Map();
  for (const r of faceRules(doc)) {
    const st = r.style, g = k => st.getPropertyValue(k);
    rules.set(faceKey(g('font-family'), g('font-weight'), g('font-style'), g('font-stretch'), g('unicode-range')), r);
  }
  const seen = new Map(), missing = new Set();
  for (const f of doc.fonts) {
    if (f.status !== 'loaded' && f.status !== 'error') {
      if (f.status === 'loading') missing.add(unq(f.family).toLowerCase());
      continue;
    }
    const k = faceKey(f.family, f.weight, f.style, f.stretch, f.unicodeRange);
    const r = rules.get(k);
    if (!r) { missing.add(unq(f.family).toLowerCase()); continue; }
    const prev = seen.get(k);
    if (prev && !prev.failed) continue;
    const st = r.style;
    seen.set(k, { family: unq(f.family), weight: normRange(f.weight, KW_W, '400'), style: normStyle(f.style), stretch: normRange(f.stretch, KW_S, '100%'),
      range: f.unicodeRange, sizeAdjust: st.getPropertyValue('size-adjust').trim(), src: parseSrc(st.getPropertyValue('src')), failed: f.status === 'error' });
  }
  return { faces: [...seen.values()], missing };
}

const OK_FORMAT = /^(|woff2?|truetype|opentype|collection)(-variations)?$/;
/**
 * 取字体文件：url → 本机服务里的文件 id（fetchId 负责下载、登记）。按 src 的顺序，local() 原样保留，
 * 第一个取到的 url 为止（浏览器也是用第一个能加载的）。有 url 却一个都取不到的字体名放进 missing
 */
export async function resolveWebFonts(used, fetchId: ((url: string) => Promise<string | null>) | null): Promise<{ fonts: GlyphFont[]; missing: Set<string> }> {
  const missing = new Set<string>(used.missing), fonts: GlyphFont[] = [];
  for (const f of used.faces) {
    const src: GlyphFontSrc[] = [];
    let hasUrl = false, got = false;
    if (!f.failed) for (const s of f.src) {
      if (s.local != null) { src.push(s); continue; }
      if (!OK_FORMAT.test(s.format)) continue;
      hasUrl = true;
      const id = fetchId ? await fetchId(s.url).catch(() => null) : null;
      if (id) { src.push({ id, format: s.format }); got = true; break; }
    }
    if (hasUrl && !got) { missing.add(f.family.toLowerCase()); continue; }
    fonts.push({ family: f.family, weight: f.weight, style: f.style, stretch: f.stretch, range: f.range, sizeAdjust: f.sizeAdjust, src: f.failed ? [] : src });
  }
  return { fonts, missing };
}

/** 一组网页字体的短签名：字形缓存的键里带上它，换了文章、同名字体换了文件时不会取到旧字形 */
export function sigOf(v) {
  const s = JSON.stringify(v);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}
/** 字体栈里有没有取不到文件的网页字体 */
export const usesMissing = (stack, missing) => missing.size > 0 && splitTop(stack).some(n => missing.has(unq(n).toLowerCase()));
