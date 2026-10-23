import { CodedError } from './types.ts';
import type { BoxRect } from './types.ts';

export const ID = 'data-wxc';

/** 按顶层的分隔符切分（跳过括号与引号内） */
export function splitTop(text: string, sep = ',') {
  const out: string[] = [];
  let depth = 0,
    quote = '',
    current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[++i] || '';
      } else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map(part => part.trim()).filter(Boolean);
}

/** 去掉首尾空白与一层引号（字体名等） */
export const unquote = (text: string | null | undefined) =>
  String(text || '')
    .trim()
    .replace(/^["']|["']$/g, '');

/** unicode-range → [[lo, hi]]；空值表示全部，写错的段跳过（全写错时为空数组） */
export function unicodeRanges(text: string | null | undefined): [number, number][] {
  if (!String(text || '').trim()) return [[0, 0x10ffff]];
  const out: [number, number][] = [];
  for (const part of String(text).split(',')) {
    const match = part.trim().match(/^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i);
    if (!match) continue;
    if (match[1].includes('?'))
      out.push([parseInt(match[1].replace(/\?/g, '0'), 16), parseInt(match[1].replace(/\?/g, 'f'), 16)]);
    else out.push([parseInt(match[1], 16), parseInt(match[2] || match[1], 16)]);
  }
  return out;
}

/** 作者样式表（带 data-wxc-author 的）的规则列表逐个交给 fn；读不了的（跨域等）交给 unreadable */
export function eachAuthorSheet(
  doc: Document,
  fn: (rules: CSSRuleList) => void,
  unreadable?: (sheet: CSSStyleSheet) => void,
) {
  for (const sheet of doc.styleSheets as Iterable<CSSStyleSheet & { ownerNode: Element | null }>) {
    if (!sheet.ownerNode || !sheet.ownerNode.hasAttribute('data-wxc-author')) continue;
    try {
      fn(sheet.cssRules);
    } catch {
      if (unreadable) unreadable(sheet);
    }
  }
}

export interface Declaration {
  prop: string;
  value: string;
  important: boolean;
  /** 取值时改用元素的计算值（见 parseDecls） */
  pending: boolean;
}
/** 解析声明块文本 → [{prop, value, important}]；保留简写原文（CSSOM 对含 var() 的简写读不出长写值） */
export function parseDecls(text: string | null | undefined) {
  const out: Declaration[] = [];
  for (const piece of splitTop(text || '', ';')) {
    const i = piece.indexOf(':');
    if (i <= 0) continue;
    let prop = piece.slice(0, i).trim();
    let value = piece.slice(i + 1).trim();
    if (!prop.startsWith('--')) prop = prop.toLowerCase();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    // Chrome 对含 var() 的简写，把各长写序列化成空值；标记出来，取值时改用元素自己的计算值
    out.push({ prop, value, important, pending: value === '' && !prop.startsWith('--') });
  }
  return out;
}

/** 元素的 data-wxc；只对带这个属性的元素调用（没有时为空串） */
/** 读属性，没有时为空串 */
export const attrOf = (el: Element, name: string) => el.getAttribute(name) ?? '';
export const idOf = (el: Element) => attrOf(el, ID);
export const isHtmlEl = (node: Node | null | undefined): node is HTMLElement =>
  !!node && node.nodeType === 1 && (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml';
/** 文档所在的窗口。转换只在装进 iframe 的文档上进行，取不到说明 iframe 已被移走 */
export function viewOf(doc: Document): Window & typeof globalThis {
  if (!doc.defaultView) throw new Error('document is not in a window');
  return doc.defaultView;
}
export const round = (value: number) => Math.round(value * 1000) / 1000;

/** 临时去掉所有变换，量布局位置用 */
export const NO_TRANSFORM =
  '*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
// measure 还要停住伪元素与过渡、动画：量的是每个元素的静止布局
const STILL_LAYOUT = `*,*::before,*::after{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;transition:none!important;animation:none!important}`;

/**
 * 量每个带 ID 的元素相对 body 内容区原点的盒子。layout=true 时临时去掉 transform，得到的是布局位置。
 * 只量 HTML 元素与最外层 svg；svg 内部不参与。
 */
export function measure(doc: Document, layout: boolean) {
  let still: HTMLStyleElement | undefined;
  if (layout) {
    still = doc.createElement('style');
    still.textContent = STILL_LAYOUT;
    doc.head.appendChild(still);
  }
  const body = doc.body.getBoundingClientRect();
  const bodyStyle = viewOf(doc).getComputedStyle(doc.body);
  const originX = body.left + parseFloat(bodyStyle.borderLeftWidth) + parseFloat(bodyStyle.paddingLeft);
  const originY = body.top + parseFloat(bodyStyle.borderTopWidth) + parseFloat(bodyStyle.paddingTop);
  const out = new Map<string, BoxRect>();
  for (const el of doc.querySelectorAll(`[${ID}]`)) {
    if (!el.getClientRects().length) continue;
    const rect = el.getBoundingClientRect();
    out.set(idOf(el), { x: rect.left - originX, y: rect.top - originY, w: rect.width, h: rect.height });
  }
  if (still) still.remove();
  return out;
}

/** 两次测量中位置或尺寸差超过 tolerance 的元素 ID（只比两边都有的） */
export function diffBoxes(a: Map<string, BoxRect>, b: Map<string, BoxRect>, tolerance = 0.75) {
  const bad: string[] = [];
  for (const [id, was] of a) {
    const now = b.get(id);
    if (!now) continue;
    if (
      Math.abs(was.x - now.x) > tolerance ||
      Math.abs(was.y - now.y) > tolerance ||
      Math.abs(was.w - now.w) > tolerance ||
      Math.abs(was.h - now.h) > tolerance
    )
      bad.push(id);
  }
  return bad;
}

/** 用 srcdoc 装载并等字体与图片就绪 */
export function loadFrame(frame: HTMLIFrameElement, html: string, width: number, height = 760) {
  return new Promise<Document>((resolve, reject) => {
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    const timer = setTimeout(() => reject(new CodedError('convert.frameTimeout')), 20000);
    frame.onload = async () => {
      clearTimeout(timer);
      const doc = frame.contentDocument;
      if (!doc) return reject(new Error('frame has no document'));
      await Promise.race([doc.fonts.ready, sleep(4000)]);
      await Promise.race([
        Promise.all(
          [...doc.images]
            .filter(img => !img.complete)
            .map(
              img =>
                new Promise(done => {
                  img.onload = img.onerror = done;
                }),
            ),
        ),
        sleep(10000),
      ]);
      resolve(doc);
    };
    frame.srcdoc = html;
  });
}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 跨 realm 判断 CSSOM 规则类型 */
export const ruleType = (rule: CSSRule): string => rule.constructor && rule.constructor.name;
