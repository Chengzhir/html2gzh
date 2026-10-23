// 读文章、把所有本地资源换成本机服务的地址：<img>、svg <image>、style 属性与 <style> 里的 url()、外链样式表（内联进来）
import { t } from './i18n.ts';

export const ORIGIN = location.origin;
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
/** 把 ref 接到 base 目录下并规范化；越出根目录时保留前导 ..（路径模式由服务端判定） */
function joinRel(base: string, ref: string) {
  const out: string[] = [];
  for (const seg of (base + ref).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}
const isLocalRef = (r: string) => r && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r.trim());
// Windows 上写出来的 HTML 常有 images\a.png 这种反斜杠路径，浏览器会当成 /，这里也一样
const cleanRef = (r: string) => {
  const s = r.trim().split(/[?#]/)[0].replace(/\\/g, '/');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
export const EXT_OF_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** 读文件、登记文件的途径：路径模式经本机服务，拖入模式读浏览器里的 File */
export interface PrepIO {
  /** 相对文章根的路径 → 本机服务里的文件 id；缺失为 null */
  resolveRefs(rels: string[]): Promise<Map<string, string | null>>;
  uploadDataUri(uri: string): Promise<string | null>;
  readLocalText(rel: string): Promise<string | null>;
}
/**
 * missing 只放 <img> 的图（粘贴后变错误卡片、草稿存不了）；样式表、CSS 与 svg <image> 引用的文件缺了只影响效果。
 * names：图片 id → 网页文件夹里的相对路径，提示图片过大、下载超时时用
 */
export interface PrepReport {
  missing: string[];
  sheets: string[];
  refs: string[];
  remote: number;
  dataUri: number;
  badData: number;
  local: number;
  names: Map<string, string>;
}

/** 阅读页模拟的页头与底栏用到的原稿信息，没有的为空串。icon 是能直接放进 <img src> 的地址 */
export interface ArticleMeta {
  title: string;
  author: string;
  account: string;
  icon: string;
}

const metaContent = (doc: Document, selector: string) =>
  doc.querySelector(selector)?.getAttribute('content')?.trim() || '';
/** 网站图标：声明尺寸最大的那个（矢量图与 sizes="any" 算最大）；没有声明时浏览器会去取 favicon.ico */
function iconRef(doc: Document) {
  let best = '',
    bestSize = -1;
  for (const link of doc.querySelectorAll('link[rel][href]')) {
    if (!/(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(link.getAttribute('rel'))) continue;
    const sizes = link.getAttribute('sizes') || '';
    const size =
      /any/i.test(sizes) || /svg/i.test(link.getAttribute('type') || '')
        ? Infinity
        : Math.max(0, ...sizes.split(/\s+/).map(s => parseInt(s, 10) || 0));
    if (size > bestSize) {
      best = link.getAttribute('href').trim();
      bestSize = size;
    }
  }
  return best || 'favicon.ico';
}

/** 返回 { html, report, meta } */
export async function prepare(
  html: string,
  entryRel: string,
  io: PrepIO,
): Promise<{ html: string; report: PrepReport; meta: ArticleMeta }> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseDir = dirOf(entryRel);
  const report: PrepReport = {
    missing: [],
    sheets: [],
    refs: [],
    remote: 0,
    dataUri: 0,
    badData: 0,
    local: 0,
    names: new Map(),
  };
  // 公众号名称：站点名，没有时用作者
  const author = metaContent(doc, 'meta[name="author" i]');
  const site = metaContent(doc, 'meta[property="og:site_name"]') || metaContent(doc, 'meta[name="application-name" i]');
  const meta: ArticleMeta = {
    title: doc.title.trim() || metaContent(doc, 'meta[property="og:title"]'),
    author,
    account: site || author,
    icon: '',
  };
  const icon = iconRef(doc),
    iconRel = isLocalRef(icon) ? joinRel(baseDir, cleanRef(icon)) : '';
  if (!iconRel && /^(https?:|data:image\/)/i.test(icon.trim())) meta.icon = icon.trim();

  // 外链样式表与 @import 读进来，内联成 <style>，各自记下自己的基准（本地是相对文章根的目录，站外是绝对地址）。
  // 站外的要对方允许跨域读取（Google Fonts 等字体服务都允许），读不了的列进检查结果
  const absUrl = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//');
  const loadSheet = async (href: string, base: string) => {
    href = href.trim();
    if (absUrl(href) || absUrl(base)) {
      let url: URL;
      try {
        url = new URL(href, absUrl(base) ? base : location.href);
      } catch {
        return null;
      }
      if (!/^https?:$/.test(url.protocol)) return null;
      const response = await fetch(url.href, { mode: 'cors', credentials: 'omit' }).catch((): null => null);
      return response?.ok ? { text: await response.text(), base: response.url || url.href } : null;
    }
    const rel = joinRel(base, cleanRef(href));
    const text = await io.readLocalText(rel).catch((): null => null);
    return text == null ? null : { text, base: dirOf(rel) };
  };
  const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
  type Chunk = { text: string; base: string; media: string; supports?: string };
  /** 样式表文本 → 依次排列的若干段：@import 就地展开（最多四层），条件跟着它那一段 */
  const expand = async (text: string, base: string, media: string, depth = 0): Promise<Chunk[]> => {
    const chunks: Chunk[] = [];
    let rest = text;
    if (depth < 4) {
      for (const match of [...text.matchAll(IMPORT_RE)]) {
        const href = match[2] || match[4];
        const condition = match[5]
          .trim()
          .replace(/\blayer(\([^)]*\))?/i, '')
          .trim();
        const supports = condition.match(/^supports\(((?:[^()]|\([^()]*\))*)\)\s*/i);
        const mediaQuery = (supports ? condition.slice(supports[0].length) : condition).trim();
        const imported = await loadSheet(href, base);
        if (!imported) {
          report.sheets.push(href);
          continue;
        }
        for (const chunk of await expand(imported.text, imported.base, mediaQuery || media, depth + 1))
          chunks.push(supports ? { ...chunk, supports: supports[1] } : chunk);
      }
      rest = text.replace(IMPORT_RE, '');
    }
    chunks.push({ text: rest, base, media });
    return chunks;
  };
  const styleEls = (chunks: Chunk[]) =>
    chunks.map(chunk => {
      const style = doc.createElement('style');
      style.textContent = chunk.supports ? `@supports (${chunk.supports}){${chunk.text}}` : chunk.text;
      style.dataset.base = chunk.base;
      if (chunk.media) style.media = chunk.media;
      return style;
    });
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
    const href = link.getAttribute('href'),
      media = link.getAttribute('media') || '';
    const sheet = await loadSheet(href, baseDir);
    if (!sheet) {
      report.sheets.push(href);
      link.remove();
      continue;
    }
    link.replaceWith(...styleEls(await expand(sheet.text, sheet.base, media === 'all' ? '' : media)));
  }
  for (const style of [...doc.querySelectorAll('style')]) {
    if (style.dataset.base != null || !/@import/i.test(style.textContent)) continue;
    style.replaceWith(...styleEls(await expand(style.textContent, baseDir, style.media || '')));
  }

  // 第一遍：收集。@font-face 里的地址是字体文件，不是图片：本地的登记成文件，data: 与站外的原样保留，都不计入图片数
  const wanted = new Set<string>();
  const datas = new Set<string>();
  const note = (ref: string, base: string) => {
    if (!ref) return;
    ref = ref.trim();
    if (/^data:/i.test(ref)) {
      datas.add(ref);
      return;
    }
    if (isLocalRef(ref) && !absUrl(base)) wanted.add(joinRel(base, cleanRef(ref)));
  };
  const noteFont = (ref: string, base: string) => {
    if (isLocalRef(ref) && !absUrl(base)) wanted.add(joinRel(base, cleanRef(ref.trim())));
  };
  const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const FACE_RE = /@font-face\s*\{[^}]*\}/gi;
  /** 样式文本按 @font-face 块切开：[[文本, 是不是 @font-face], …] */
  const segments = (css: string): [string, boolean][] => {
    const parts: [string, boolean][] = [];
    let at = 0;
    for (const match of css.matchAll(FACE_RE)) {
      parts.push([css.slice(at, match.index), false], [match[0], true]);
      at = match.index + match[0].length;
    }
    parts.push([css.slice(at), false]);
    return parts;
  };
  doc.querySelectorAll('img[src]').forEach(e => note(e.getAttribute('src'), baseDir));
  doc.querySelectorAll('image').forEach(e => note(e.getAttribute('href') || e.getAttribute('xlink:href'), baseDir));
  doc.querySelectorAll('[style]').forEach(e => {
    for (const match of e.getAttribute('style').matchAll(URL_RE)) note(match[2], baseDir);
  });
  doc.querySelectorAll('style').forEach(style => {
    const base = style.dataset.base ?? baseDir;
    for (const [text, isFace] of segments(style.textContent))
      for (const match of text.matchAll(URL_RE)) (isFace ? noteFont : note)(match[2], base);
  });

  // 图标和其他文件一起登记，但不在正文里，不计入图片
  const ids = await io.resolveRefs([...wanted, ...(iconRel && !wanted.has(iconRel) ? [iconRel] : [])]);
  if (iconRel && ids.get(iconRel)) meta.icon = ORIGIN + '/a/' + ids.get(iconRel);
  const dataIds = new Map<string, string | null>();
  for (const uri of datas) dataIds.set(uri, await io.uploadDataUri(uri).catch((): null => null));

  // 第二遍：改写。站外样式表里的相对地址按样式表自己的地址补全
  const swap = (ref: string, base: string, lost = report.missing) => {
    const value = (ref || '').trim();
    if (/^data:/i.test(value)) {
      const id = dataIds.get(value);
      if (!id) {
        report.badData++;
        return value;
      }
      report.dataUri++;
      report.names.set(id, t('img.dataUri'));
      return ORIGIN + '/a/' + id;
    }
    if (isLocalRef(value) && absUrl(base)) {
      try {
        report.remote++;
        return new URL(value, base).href;
      } catch {
        return value;
      }
    }
    if (/^(https?:)?\/\//i.test(value)) {
      report.remote++;
      return value;
    }
    if (!isLocalRef(value)) return value;
    const rel = joinRel(base, cleanRef(value));
    const id = ids.get(rel);
    if (!id) {
      lost.push(rel);
      return value;
    }
    report.local++;
    report.names.set(id, rel);
    return ORIGIN + '/a/' + id;
  };
  const swapFont = (ref: string, base: string) => {
    const value = (ref || '').trim();
    if (!isLocalRef(value)) return value;
    if (absUrl(base)) {
      try {
        return new URL(value, base).href;
      } catch {
        return value;
      }
    }
    const rel = joinRel(base, cleanRef(value)),
      id = ids.get(rel);
    if (!id) {
      report.refs.push(rel);
      return value;
    }
    return ORIGIN + '/a/' + id;
  };
  const swapCss = (css: string, base: string) =>
    segments(css)
      .map(([text, isFace]) =>
        text.replace(
          URL_RE,
          (_match, _quote, url: string) => `url("${isFace ? swapFont(url, base) : swap(url, base, report.refs)}")`,
        ),
      )
      .join('');
  doc.querySelectorAll('img').forEach(e => {
    e.removeAttribute('srcset');
    e.removeAttribute('loading');
    if (e.hasAttribute('src')) e.setAttribute('src', swap(e.getAttribute('src'), baseDir));
  });
  doc.querySelectorAll('image').forEach(e => {
    for (const attr of ['href', 'xlink:href'])
      if (e.hasAttribute(attr)) e.setAttribute(attr, swap(e.getAttribute(attr), baseDir, report.refs));
  });
  doc.querySelectorAll('[style]').forEach(e => e.setAttribute('style', swapCss(e.getAttribute('style'), baseDir)));
  // 打标记：转换时只认文章自己的样式表，浏览器扩展往 iframe 里注入的样式不算
  doc.querySelectorAll('style').forEach(style => {
    style.textContent = swapCss(style.textContent, style.dataset.base ?? baseDir);
    style.removeAttribute('data-base');
    style.setAttribute('data-wxc-author', '');
  });
  doc.querySelectorAll('script').forEach(e => e.remove());
  return { html: '<!DOCTYPE html>' + doc.documentElement.outerHTML, report, meta };
}
