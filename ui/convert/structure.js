import { ID, isHtmlEl } from './util.js';

// 粘贴后编辑器（ProseMirror）的实测行为：div 会被重建成 p 并丢掉容器样式，section 原样保留；
// 空的行内元素没有文字可挂，会被吞掉。下面的改写都围绕这两点。
// blockquote 也改：阅读页给它强加灰字、左侧 ::before 竖条和 15px 字号，发表/预览时还会删掉它身上的 color
const TO_SECTION = new Set(['div', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'hgroup', 'address', 'dl', 'dt', 'dd',
  'details', 'summary', 'center', 'search', 'figcaption', 'blockquote']);
const MARKS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'small', 'code', 'kbd', 'samp', 'var', 'cite', 'abbr', 'time', 'label', 'sub', 'sup', 'big', 'font', 'dfn']);
const FREEZE = ['display', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'font-weight', 'font-style', 'font-size', 'font-family', 'text-decoration-line', 'color', 'vertical-align'];
const VOID = new Set(['img', 'svg', 'br', 'hr', 'video', 'audio', 'iframe', 'canvas', 'input', 'textarea', 'select', 'object', 'embed', 'picture', 'math']);
const JUNK = 'script,style,link,meta,title,base,noscript,template,slot';
const BLOCKISH = /^(block|flex|grid|table|list-item|flow-root)/;

function rename(doc, el, tag) {
  const win = doc.defaultView;
  const before = win.getComputedStyle(el);
  const vals = FREEZE.map(k => before.getPropertyValue(k));
  // 浏览器默认样式里只有链接自带颜色；其他标签此刻的颜色若和父级不同，只可能来自套上的微信正文样式，不能冻结
  const keepColor = el.localName === 'a';
  const n = doc.createElement(tag);
  for (const a of el.attributes) n.setAttribute(a.name, a.value);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  const after = win.getComputedStyle(n);
  FREEZE.forEach((k, i) => {
    if (after.getPropertyValue(k) === vals[i]) return;
    if (k === 'display' && vals[i] === 'list-item') return;
    if (k === 'color' && !keepColor) return;
    n.style.setProperty(k, vals[i]);
  });
  return n;
}

export function cleanStructure(doc, root, findings) {
  const win = doc.defaultView;
  const cs = el => win.getComputedStyle(el);
  root.querySelectorAll(JUNK).forEach(e => e.remove());
  root.querySelectorAll('picture').forEach(p => { const im = p.querySelector('img'); if (im) p.replaceWith(im); else p.remove(); });
  root.querySelectorAll('source,track').forEach(e => e.remove());
  const lost = root.querySelectorAll('form,input,button,select,textarea,iframe,video,audio,canvas,object,embed');
  if (lost.length) findings.warn('互动元素', `${lost.length} 个表单/音视频/iframe/canvas 元素，微信会删掉，要用后台自带的组件重新插入`, [...lost]);

  // 链接：只有 mp.weixin.qq.com 能留；页内锚点会让草稿存不下去，站外链接保存后变纯文字
  let anchors = 0, outside = 0;
  const outEls = [];
  for (const a of [...root.querySelectorAll('a')]) {
    const href = (a.getAttribute('href') || '').trim();
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) continue;
    if (/^https?:/i.test(href)) { outside++; outEls.push(a); } else if (href) anchors++;
    rename(doc, a, 'span').removeAttribute('href');
  }
  if (anchors) findings.fixed('链接', `${anchors} 个页内锚点/相对链接改成了普通文字（否则后台拒绝保存）`);
  if (outside) findings.warn('站外链接', `${outside} 个站外链接已改成普通文字，公众号正文只允许放公众号文章的链接；需要的话放进“阅读原文”`, outEls);

  let n = 0;
  for (const el of [...root.querySelectorAll('ul,ol')]) {
    const li = [...el.children].filter(k => k.localName === 'li');
    const plain = li.every(k => cs(k).display !== 'list-item' || cs(k).listStyleType === 'none');
    if (!plain) continue;
    li.forEach(k => { rename(doc, k, 'section'); n++; });
    rename(doc, el, 'section'); n++;
  }
  for (const el of [...root.querySelectorAll('*')]) {
    if (!isHtmlEl(el) || el === root) continue;
    const t = el.localName;
    if (TO_SECTION.has(t)) { rename(doc, el, 'section'); n++; } else if (MARKS.has(t) && el.hasAttribute('style')) { rename(doc, el, 'span'); n++; }
  }
  if (n) findings.fixed('容器', `${n} 个 div/blockquote 等容器改成了 section（编辑器会把 div 重建成段落；blockquote 在阅读页会被强制成灰字）`);
}

const isTextContext = (win, el) => {
  for (const c of el.childNodes) if (c.nodeType === 3 && c.data.trim()) return true;
  return /^(p|h[1-6]|span|li|blockquote|td|th|pre|figcaption|b|strong|i|em|u|s|label|sub|sup|small|code|mark)$/.test(el.localName)
    || /^inline/.test(win.getComputedStyle(el).display) && !/flex|grid/.test(win.getComputedStyle(el).display);
};

/** 空元素（色块、圆点、线条）：文字环境里换成 svg，块环境里在 section 里塞一个零尺寸 svg 占位（秀米同款） */
export function keepShapes(doc, root, findings) {
  const win = doc.defaultView;
  let shapes = 0, dropped = 0;
  for (const el of [...root.querySelectorAll('*')].reverse()) {
    // foreignObject 里的 HTML 由 SVG 自己排版，不按段落规则改
    if (!isHtmlEl(el) || VOID.has(el.localName) || el === root || el.closest('svg')) continue;
    if (el.children.length || el.textContent.replace(/\u00a0/g, ' ').trim()) continue;
    const r = el.getBoundingClientRect();
    const c = win.getComputedStyle(el);
    if (c.display === 'none') continue;
    if (r.width < 0.1 && r.height < 0.1) {
      if (el.hasAttribute('data-wxc-pseudo')) { el.remove(); dropped++; }
      continue;
    }
    const P = el.parentElement;
    if (P && isTextContext(win, P)) {
      const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const a of el.attributes) s.setAttribute(a.name, a.value);
      s.setAttribute('aria-hidden', 'true');
      el.replaceWith(s);
      if (c.display === 'inline') s.style.setProperty('display', 'inline-block');
      if (!s.style.width || s.style.width === 'auto') s.style.setProperty('width', r.width.toFixed(2) + 'px');
      if (!s.style.height || s.style.height === 'auto') s.style.setProperty('height', r.height.toFixed(2) + 'px');
      s.style.setProperty('overflow', s.style.overflow || 'hidden');
    } else {
      const sec = el.localName === 'section' ? el : rename(doc, el, 'section');
      if (!BLOCKISH.test(win.getComputedStyle(sec).display) && !sec.style.display) sec.style.setProperty('display', c.display === 'inline' ? 'inline-block' : c.display);
      const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 1 1');
      s.setAttribute('style', 'float:left;width:0;height:0;overflow:hidden;display:block');
      sec.appendChild(s);
    }
    shapes++;
  }
  if (shapes) findings.fixed('装饰块', `${shapes} 个空的色块/线条加了占位，粘贴时不会被编辑器吞掉`);
  return dropped;
}

/** 标签之间的换行缩进在手机端会被渲染成额外高度；pre 类空白保留 */
export function squashWhitespace(doc, root) {
  const win = doc.defaultView;
  const walker = doc.createTreeWalker(root, 4 | 128);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const isBlock = n => n && n.nodeType === 1 && (BLOCKISH.test(win.getComputedStyle(n).display) || n.hasAttribute('data-wxc-float'));
  const isBox = n => n === root || BLOCKISH.test(win.getComputedStyle(n).display) || /flex|grid/.test(win.getComputedStyle(n).display);
  /** 这一侧在行内流里挨着的是块边界吗：没有兄弟就往上找，直到碰到块容器 */
  const edge = (t, dir) => {
    let n = t;
    for (;;) {
      const sib = n[dir];
      if (sib) return isBlock(sib);
      n = n.parentElement;
      if (!n || isBox(n)) return true;
    }
  };
  let saved = 0;
  for (const t of nodes) {
    if (t.nodeType === 8) { saved += t.data.length + 7; t.remove(); continue; }
    const P = t.parentElement;
    if (!P || /^pre|^break-spaces/.test(win.getComputedStyle(P).whiteSpace)) continue;
    const before = t.data.length;
    let s = t.data.replace(/[ \t\n\r\f]+/g, ' ');
    const flexParent = /flex|grid/.test(win.getComputedStyle(P).display);
    if (flexParent || edge(t, 'previousSibling')) s = s.replace(/^ /, '');
    if (flexParent || edge(t, 'nextSibling')) s = s.replace(/ $/, '');
    if (!s) t.remove(); else if (s !== t.data) t.data = s;
    saved += before - s.length;
  }
  return saved;
}

/**
 * 公众号会删掉 white-space（实测预览页里一处都不剩），nowrap 的标题、日期在窄字体的手机上会被折行。
 * 改在文字层面禁止断行：空格换成不换行空格，字与字之间插 U+2060（WORD JOINER，前后都不许断行）。
 */
const WJ = '\u2060';
export function keepNoWrap(doc, root) {
  const win = doc.defaultView;
  const nowrap = el => /^nowrap$/.test(win.getComputedStyle(el).whiteSpace);
  let n = 0;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!isHtmlEl(el) || !nowrap(el) || (el.parentElement && el.parentElement !== root && nowrap(el.parentElement))) continue;
    const walker = doc.createTreeWalker(el, 4);
    const texts = [];
    // SVG 文字按字定位（x 列表一个值对应一个字），插连接符会错位
    while (walker.nextNode()) if (walker.currentNode.data && isHtmlEl(walker.currentNode.parentElement)) texts.push(walker.currentNode);
    texts.forEach((t, i) => {
      const chars = [...t.data.replace(/ /g, '\u00a0')];
      t.data = chars.join(WJ) + (i < texts.length - 1 ? WJ : '');
    });
    if (texts.length) n++;
  }
  return n;
}

export function cleanAttributes(root) {
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const k = a.name;
      if (k === ID || k.startsWith('data-wxc')) continue;
      if (/^on/i.test(k) || /^data-v-/.test(k) || ['class', 'loading', 'decoding', 'srcset', 'sizes', 'contenteditable', 'tabindex', 'draggable', 'fetchpriority'].includes(k)) el.removeAttribute(k);
    }
  }
}
