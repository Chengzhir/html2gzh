import { CodedError } from './types.ts';

export const ID = 'data-wxc';

/** 按顶层逗号切分（跳过括号与引号内） */
export function splitTop(s, sep = ',') {
  const out = []; let depth = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/** 去掉首尾空白与一层引号（字体名等） */
export const unq = s => String(s || '').trim().replace(/^["']|["']$/g, '');

/** unicode-range → [[lo, hi]]；空值表示全部，写错的段跳过（全写错时为空数组） */
export function unicodeRanges(s) {
  if (!String(s || '').trim()) return [[0, 0x10ffff]];
  const out = [];
  for (const part of String(s).split(',')) {
    const m = part.trim().match(/^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i);
    if (!m) continue;
    if (m[1].includes('?')) out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'f'), 16)]);
    else out.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
  }
  return out;
}

/** 作者样式表（带 data-wxc-author 的）的规则列表逐个交给 fn；读不了的（跨域等）交给 unreadable */
export function eachAuthorSheet(doc: Document, fn: (rules: CSSRuleList) => void, unreadable?: (sheet: CSSStyleSheet) => void) {
  for (const sh of doc.styleSheets as Iterable<CSSStyleSheet & { ownerNode: Element | null }>) {
    if (!sh.ownerNode || !sh.ownerNode.hasAttribute('data-wxc-author')) continue;
    try { fn(sh.cssRules); } catch { if (unreadable) unreadable(sh); }
  }
}

/** 解析声明块文本 → [{prop, value, important}]；保留简写原文（CSSOM 对含 var() 的简写读不出长写值） */
export function parseDecls(text) {
  const out = [];
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

export const isEl = (n, name) => n && n.nodeType === 1 && (!name || n.localName === name);
export const isHtmlEl = (n): n is HTMLElement => n && n.nodeType === 1 && n.namespaceURI === 'http://www.w3.org/1999/xhtml';
export const round = n => Math.round(n * 1000) / 1000;

/** 临时去掉所有变换，量布局位置用 */
export const NO_TRANSFORM = '*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
// measure 还要停住伪元素与过渡、动画：量的是每个元素的静止布局
const NO_TF = `*,*::before,*::after{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;transition:none!important;animation:none!important}`;

/**
 * 量每个带 ID 的元素相对 body 内容区原点的盒子。layout=true 时临时去掉 transform，得到的是布局位置。
 * 只量 HTML 元素与最外层 svg；svg 内部不参与。
 */
export function measure(doc, layout) {
  let st;
  if (layout) { st = doc.createElement('style'); st.textContent = NO_TF; doc.head.appendChild(st); }
  const b = doc.body.getBoundingClientRect();
  const cs = doc.defaultView.getComputedStyle(doc.body);
  const ox = b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const oy = b.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const out = new Map();
  for (const el of doc.querySelectorAll(`[${ID}]`)) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    out.set(el.getAttribute(ID), { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height });
  }
  if (st) st.remove();
  return out;
}

export function diffBoxes(a, b, tol = 0.75) {
  const bad = [];
  for (const [id, r] of a) {
    const s = b.get(id);
    if (!s) continue;
    if (Math.abs(r.x - s.x) > tol || Math.abs(r.y - s.y) > tol || Math.abs(r.w - s.w) > tol || Math.abs(r.h - s.h) > tol) bad.push(id);
  }
  return bad;
}

/** 用 srcdoc 装载并等字体与图片就绪 */
export function loadFrame(frame: HTMLIFrameElement, html: string, width: number, height = 760) {
  return new Promise<Document>((resolve, reject) => {
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    const t = setTimeout(() => reject(new CodedError('convert.frameTimeout')), 20000);
    frame.onload = async () => {
      clearTimeout(t);
      const doc = frame.contentDocument;
      try { await Promise.race([doc.fonts.ready, sleep(4000)]); } catch { /* 无字体 API */ }
      await Promise.race([Promise.all([...doc.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))), sleep(10000)]);
      resolve(doc);
    };
    frame.srcdoc = html;
  });
}
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 跨 realm 判断 CSSOM 规则类型 */
export const ruleType = r => r.constructor && r.constructor.name;
