import { splitTop, ruleType, unquote, unicodeRanges, eachAuthorSheet, viewOf } from './util.ts';
import type { GlyphFont, GlyphFontSrc } from './types.ts';

// 原稿的网页字体（@font-face）：哪些在原稿里真正用上了（加载过），字体文件在哪。
// 转为 SVG 路径时，字形服务在无头 Chrome 里照原样声明这些字体，取同样文件里的字形

const WEIGHT_KEYWORDS: Record<string, string> = { normal: '400', bold: '700' };
const STRETCH_KEYWORDS: Record<string, string> = {
  'ultra-condensed': '50%',
  'extra-condensed': '62.5%',
  condensed: '75%',
  'semi-condensed': '87.5%',
  normal: '100%',
  'semi-expanded': '112.5%',
  expanded: '125%',
  'extra-expanded': '150%',
  'ultra-expanded': '200%',
};
/** "bold" / "300 700" / "400 400" → 统一写法；FontFace 与 CSSFontFaceRule 序列化得不一样，两边都过一遍再比 */
const normRange = (text: string, keywords: Record<string, string>, fallback: string) => {
  const parts = (
    String(text || '')
      .trim()
      .toLowerCase() || fallback
  )
    .split(/\s+/)
    .map(word => keywords[word] || word);
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : parts.join(' ');
};
const normStyle = (text: string) =>
  String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ') || 'normal';
/** unicode-range → "lo-hi,lo-hi"（十六进制），空值或全写错时为全部 */
function normUnicode(text: string) {
  const ranges = unicodeRanges(text);
  return (ranges.length ? ranges : [[0, 0x10ffff]])
    .map(([lo, hi]) => lo.toString(16) + '-' + hi.toString(16))
    .join(',');
}
const faceKey = (family: string, weight: string, style: string, stretch: string, range: string) =>
  [
    unquote(family).toLowerCase(),
    normRange(weight, WEIGHT_KEYWORDS, '400'),
    normStyle(style),
    normRange(stretch, STRETCH_KEYWORDS, '100%'),
    normUnicode(range),
  ].join('|');

/** 作者样式表里生效的 @font-face（所在的 @media/@supports 当场成立） */
function faceRules(doc: Document) {
  const win = viewOf(doc),
    out: CSSFontFaceRule[] = [];
  const walk = (list: CSSRuleList) => {
    for (const rule of list) {
      const type = ruleType(rule);
      if (type === 'CSSFontFaceRule') out.push(rule as CSSFontFaceRule);
      else if (type === 'CSSMediaRule') {
        if (win.matchMedia((rule as CSSMediaRule).media.mediaText).matches) walk((rule as CSSMediaRule).cssRules);
      } else if (type === 'CSSSupportsRule') {
        if (win.CSS.supports((rule as CSSSupportsRule).conditionText)) walk((rule as CSSSupportsRule).cssRules);
      } else if (type === 'CSSLayerBlockRule') walk((rule as CSSLayerBlockRule).cssRules);
    }
  };
  eachAuthorSheet(doc, walk);
  return out;
}

/** 作者的全部 @font-face（带外层 @media/@supports），转换帧摘掉样式表后放回去：转换与转为路径时的排版和原稿用同一套字体 */
export function fontFaceCss(doc: Document) {
  const out: string[] = [];
  const walk = (list: CSSRuleList, wrap: (css: string) => string) => {
    for (const rule of list) {
      const type = ruleType(rule);
      if (type === 'CSSFontFaceRule') out.push(wrap(rule.cssText));
      else if (type === 'CSSMediaRule')
        walk((rule as CSSMediaRule).cssRules, css => wrap(`@media ${(rule as CSSMediaRule).media.mediaText}{${css}}`));
      else if (type === 'CSSSupportsRule')
        walk((rule as CSSSupportsRule).cssRules, css =>
          wrap(`@supports ${(rule as CSSSupportsRule).conditionText}{${css}}`),
        );
      else if (type === 'CSSLayerBlockRule') walk((rule as CSSLayerBlockRule).cssRules, wrap);
    }
  };
  eachAuthorSheet(doc, list => walk(list, css => css));
  return out.join('\n');
}

type FaceSrc = { local: string; url?: never; format?: never } | { local?: never; url: string; format: string };
/** src 描述符 → [{ local } | { url, format }]，保持原顺序 */
function parseSrc(text: string): FaceSrc[] {
  return splitTop(text || '')
    .map((part): FaceSrc | null => {
      const localMatch = part.match(/^local\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*?))\s*\)/i);
      if (localMatch) return { local: (localMatch[1] ?? localMatch[2] ?? localMatch[3] ?? '').trim() };
      const urlMatch = part.match(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/i);
      if (!urlMatch) return null;
      const formatMatch = part.match(/format\(\s*["']?([^"')]+)["']?\s*\)/i);
      return {
        url: (urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? '').trim(),
        format: formatMatch ? formatMatch[1].trim().toLowerCase() : '',
      };
    })
    .filter(src => src !== null);
}

interface UsedFace extends Omit<GlyphFont, 'src'> {
  src: FaceSrc[];
  failed: boolean;
}
export interface UsedWebFonts {
  faces: UsedFace[];
  /** 对不回 @font-face 的字体名（小写） */
  missing: Set<string>;
}

/**
 * 原稿里加载过（或加载失败）的网页字体，对回各自的 @font-face：{ faces:[{ family, weight, style, stretch, range, sizeAdjust, src, failed }], missing }。
 * 没加载的不算：原稿里没有字用到它。加载失败的也要：Chrome 选中它后会跳到字体栈的下一个，字形服务要照样跳。
 * 对不回规则的字体名放进 missing（用到它们的字不转）
 */
export function usedWebFonts(doc: Document): UsedWebFonts {
  const rules = new Map<string, CSSFontFaceRule>();
  for (const rule of faceRules(doc)) {
    const style = rule.style,
      descriptor = (name: string) => style.getPropertyValue(name);
    rules.set(
      faceKey(
        descriptor('font-family'),
        descriptor('font-weight'),
        descriptor('font-style'),
        descriptor('font-stretch'),
        descriptor('unicode-range'),
      ),
      rule,
    );
  }
  const seen = new Map<string, UsedFace>(),
    missing = new Set<string>();
  for (const face of doc.fonts) {
    if (face.status !== 'loaded' && face.status !== 'error') {
      if (face.status === 'loading') missing.add(unquote(face.family).toLowerCase());
      continue;
    }
    const key = faceKey(face.family, face.weight, face.style, face.stretch, face.unicodeRange);
    const rule = rules.get(key);
    if (!rule) {
      missing.add(unquote(face.family).toLowerCase());
      continue;
    }
    const prev = seen.get(key);
    if (prev && !prev.failed) continue;
    const style = rule.style;
    seen.set(key, {
      family: unquote(face.family),
      weight: normRange(face.weight, WEIGHT_KEYWORDS, '400'),
      style: normStyle(face.style),
      stretch: normRange(face.stretch, STRETCH_KEYWORDS, '100%'),
      range: face.unicodeRange,
      sizeAdjust: style.getPropertyValue('size-adjust').trim(),
      src: parseSrc(style.getPropertyValue('src')),
      failed: face.status === 'error',
    });
  }
  return { faces: [...seen.values()], missing };
}

const OK_FORMAT = /^(|woff2?|truetype|opentype|collection)(-variations)?$/;
/**
 * 取字体文件：url → 本机服务里的文件 id（fetchId 负责下载、登记）。按 src 的顺序，local() 原样保留，
 * 第一个取到的 url 为止（浏览器也是用第一个能加载的）。有 url 却一个都取不到的字体名放进 missing
 */
export async function resolveWebFonts(
  used: UsedWebFonts,
  fetchId: ((url: string) => Promise<string | null>) | null,
): Promise<{ fonts: GlyphFont[]; missing: Set<string> }> {
  const missing = new Set<string>(used.missing),
    fonts: GlyphFont[] = [];
  for (const face of used.faces) {
    const src: GlyphFontSrc[] = [];
    let hasUrl = false,
      got = false;
    if (!face.failed)
      for (const source of face.src) {
        if (source.local != null) {
          src.push(source);
          continue;
        }
        if (!OK_FORMAT.test(source.format)) continue;
        hasUrl = true;
        const id = fetchId ? await fetchId(source.url).catch((): null => null) : null;
        if (id) {
          src.push({ id, format: source.format });
          got = true;
          break;
        }
      }
    if (hasUrl && !got) {
      missing.add(face.family.toLowerCase());
      continue;
    }
    fonts.push({
      family: face.family,
      weight: face.weight,
      style: face.style,
      stretch: face.stretch,
      range: face.range,
      sizeAdjust: face.sizeAdjust,
      src: face.failed ? [] : src,
    });
  }
  return { fonts, missing };
}

/** 一组网页字体的短签名：字形缓存的键里带上它，换了文章、同名字体换了文件时不会取到旧字形 */
export function sigOf(value: unknown) {
  const json = JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < json.length; i++) hash = (hash * 31 + json.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36) + json.length.toString(36);
}
/** 字体栈里有没有取不到文件的网页字体 */
export const usesMissing = (stack: string, missing: Set<string>) =>
  missing.size > 0 && splitTop(stack).some(name => missing.has(unquote(name).toLowerCase()));
