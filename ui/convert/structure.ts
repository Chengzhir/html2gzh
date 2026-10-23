import { ID, isHtmlEl, viewOf } from './util.ts';
import type { FindingSink } from './types.ts';

// 粘贴后编辑器（ProseMirror）的实测行为：div 会被重建成 p 并丢掉容器样式，section 原样保留；
// 空的行内元素没有文字可挂，会被吞掉。下面的改写都围绕这两点。
// blockquote 也改：阅读页给它强加灰字、左侧 ::before 竖条和 15px 字号，发表/预览时还会删掉它身上的 color
const TO_SECTION = new Set([
  'div',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'aside',
  'hgroup',
  'address',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'center',
  'search',
  'figcaption',
  'blockquote',
]);
const MARKS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'small',
  'code',
  'kbd',
  'samp',
  'var',
  'cite',
  'abbr',
  'time',
  'label',
  'sub',
  'sup',
  'big',
  'font',
  'dfn',
]);
const FREEZE = [
  'display',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-weight',
  'font-style',
  'font-size',
  'font-family',
  'text-decoration-line',
  'color',
  'vertical-align',
];
const VOID = new Set([
  'img',
  'svg',
  'br',
  'hr',
  'video',
  'audio',
  'iframe',
  'canvas',
  'input',
  'textarea',
  'select',
  'object',
  'embed',
  'picture',
  'math',
]);
const JUNK = 'script,style,link,meta,title,base,noscript,template,slot';
const BLOCKISH = /^(block|flex|grid|table|list-item|flow-root)/;

function rename(doc: Document, el: Element, tag: string): HTMLElement {
  const win = viewOf(doc);
  const before = win.getComputedStyle(el);
  const values = FREEZE.map(prop => before.getPropertyValue(prop));
  // 浏览器默认样式里只有链接自带颜色；其他标签此刻的颜色若和父级不同，只可能来自套上的微信正文样式，不能冻结
  const keepColor = el.localName === 'a';
  const replacement = doc.createElement(tag);
  for (const attr of el.attributes) replacement.setAttribute(attr.name, attr.value);
  while (el.firstChild) replacement.appendChild(el.firstChild);
  el.replaceWith(replacement);
  const after = win.getComputedStyle(replacement);
  FREEZE.forEach((prop, i) => {
    if (after.getPropertyValue(prop) === values[i]) return;
    if (prop === 'display' && values[i] === 'list-item') return;
    if (prop === 'color' && !keepColor) return;
    replacement.style.setProperty(prop, values[i]);
  });
  return replacement;
}

export function cleanStructure(doc: Document, root: Element, findings: FindingSink) {
  const win = viewOf(doc);
  const computed = (el: Element) => win.getComputedStyle(el);
  root.querySelectorAll(JUNK).forEach(el => el.remove());
  root.querySelectorAll('picture').forEach(picture => {
    const image = picture.querySelector('img');
    if (image) picture.replaceWith(image);
    else picture.remove();
  });
  root.querySelectorAll('source,track').forEach(el => el.remove());
  const lost = root.querySelectorAll('form,input,button,select,textarea,iframe,video,audio,canvas,object,embed');
  if (lost.length) findings.warn('interactive', { n: lost.length }, { els: [...lost] });

  // 链接：只有 mp.weixin.qq.com 能留；页内锚点会让草稿存不下去，站外链接保存后变纯文字
  let anchors = 0,
    outside = 0;
  const outsideLinks: HTMLAnchorElement[] = [];
  for (const link of [...root.querySelectorAll('a')]) {
    const href = (link.getAttribute('href') || '').trim();
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) continue;
    if (/^https?:/i.test(href)) {
      outside++;
      outsideLinks.push(link);
    } else if (href) anchors++;
    rename(doc, link, 'span').removeAttribute('href');
  }
  if (anchors) findings.fixed('anchors', { n: anchors });
  if (outside) findings.warn('outside', { n: outside }, { els: outsideLinks });

  let renamed = 0;
  for (const el of [...root.querySelectorAll('ul,ol')]) {
    const items = [...el.children].filter(child => child.localName === 'li');
    const plain = items.every(
      item => computed(item).display !== 'list-item' || computed(item).listStyleType === 'none',
    );
    if (!plain) continue;
    items.forEach(item => {
      rename(doc, item, 'section');
      renamed++;
    });
    rename(doc, el, 'section');
    renamed++;
  }
  for (const el of [...root.querySelectorAll('*')]) {
    if (!isHtmlEl(el) || el === root) continue;
    const tag = el.localName;
    if (TO_SECTION.has(tag)) {
      rename(doc, el, 'section');
      renamed++;
    } else if (MARKS.has(tag) && el.hasAttribute('style')) {
      rename(doc, el, 'span');
      renamed++;
    }
  }
  if (renamed) findings.fixed('containers', { n: renamed });
}

const isTextContext = (win: Window, el: Element) => {
  for (const child of el.childNodes) if (child.nodeType === 3 && (child as Text).data.trim()) return true;
  return (
    /^(p|h[1-6]|span|li|blockquote|td|th|pre|figcaption|b|strong|i|em|u|s|label|sub|sup|small|code|mark)$/.test(
      el.localName,
    ) ||
    (win.getComputedStyle(el).display.startsWith('inline') && !/flex|grid/.test(win.getComputedStyle(el).display))
  );
};

/** 空元素（色块、圆点、线条）：文字环境里换成 svg，块环境里在 section 里塞一个零尺寸 svg 占位（秀米同款） */
export function keepShapes(doc: Document, root: Element, findings: FindingSink) {
  const win = viewOf(doc);
  let shapes = 0,
    dropped = 0;
  for (const el of [...root.querySelectorAll('*')].reverse()) {
    // foreignObject 里的 HTML 由 SVG 自己排版，不按段落规则改
    if (!isHtmlEl(el) || VOID.has(el.localName) || el === root || el.closest('svg')) continue;
    if (el.children.length || el.textContent.replace(/\u00a0/g, ' ').trim()) continue;
    const rect = el.getBoundingClientRect();
    const computed = win.getComputedStyle(el);
    if (computed.display === 'none') continue;
    if (rect.width < 0.1 && rect.height < 0.1) {
      if (el.hasAttribute('data-wxc-pseudo')) {
        el.remove();
        dropped++;
      }
      continue;
    }
    const parent = el.parentElement;
    if (parent && isTextContext(win, parent)) {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const attr of el.attributes) svg.setAttribute(attr.name, attr.value);
      svg.setAttribute('aria-hidden', 'true');
      el.replaceWith(svg);
      if (computed.display === 'inline') svg.style.setProperty('display', 'inline-block');
      if (!svg.style.width || svg.style.width === 'auto') svg.style.setProperty('width', rect.width.toFixed(2) + 'px');
      if (!svg.style.height || svg.style.height === 'auto')
        svg.style.setProperty('height', rect.height.toFixed(2) + 'px');
      svg.style.setProperty('overflow', svg.style.overflow || 'hidden');
    } else {
      const section = el.localName === 'section' ? el : rename(doc, el, 'section');
      if (!BLOCKISH.test(win.getComputedStyle(section).display) && !section.style.display)
        section.style.setProperty('display', computed.display === 'inline' ? 'inline-block' : computed.display);
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1 1');
      svg.setAttribute('style', 'float:left;width:0;height:0;overflow:hidden;display:block');
      section.appendChild(svg);
    }
    shapes++;
  }
  if (shapes) findings.fixed('shapes', { n: shapes });
  return dropped;
}

/** 标签之间的换行缩进在手机端会被渲染成额外高度；pre 类空白保留 */
export function squashWhitespace(doc: Document, root: Element) {
  const win = viewOf(doc);
  const walker = doc.createTreeWalker(root, 4 | 128);
  const nodes: CharacterData[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as CharacterData);
  const isBlock = (node: Node) =>
    node &&
    node.nodeType === 1 &&
    (BLOCKISH.test(win.getComputedStyle(node as Element).display) || (node as Element).hasAttribute('data-wxc-float'));
  const isBox = (el: Element) =>
    el === root ||
    BLOCKISH.test(win.getComputedStyle(el).display) ||
    /flex|grid/.test(win.getComputedStyle(el).display);
  /** 这一侧在行内流里挨着的是块边界吗：没有兄弟就往上找，直到碰到块容器 */
  const edge = (start: CharacterData, dir: 'previousSibling' | 'nextSibling') => {
    if (start[dir]) return isBlock(start[dir]);
    for (let parent = start.parentElement; parent && !isBox(parent); parent = parent.parentElement)
      if (parent[dir]) return isBlock(parent[dir]);
    return true;
  };
  let saved = 0;
  for (const node of nodes) {
    if (node.nodeType === 8) {
      saved += node.data.length + 7;
      node.remove();
      continue;
    }
    const parent = node.parentElement;
    if (!parent || /^pre|^break-spaces/.test(win.getComputedStyle(parent).whiteSpace)) continue;
    const before = node.data.length;
    let text = node.data.replace(/[ \t\n\r\f]+/g, ' ');
    const flexParent = /flex|grid/.test(win.getComputedStyle(parent).display);
    if (flexParent || edge(node, 'previousSibling')) text = text.replace(/^ /, '');
    if (flexParent || edge(node, 'nextSibling')) text = text.replace(/ $/, '');
    if (!text) node.remove();
    else if (text !== node.data) node.data = text;
    saved += before - text.length;
  }
  return saved;
}

/**
 * 公众号会删掉 white-space（实测预览页里一处都不剩），nowrap 的标题、日期在窄字体的手机上会被折行。
 * 改在文字层面禁止断行：空格换成不换行空格，字与字之间插 U+2060（WORD JOINER，前后都不许断行）。
 */
const WJ = '\u2060';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function keepNoWrap(doc: Document, root: Element) {
  const win = viewOf(doc);
  const nowrap = (el: Element) => /^nowrap$/.test(win.getComputedStyle(el).whiteSpace);
  let count = 0;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!isHtmlEl(el) || !nowrap(el) || (el.parentElement && el.parentElement !== root && nowrap(el.parentElement)))
      continue;
    const walker = doc.createTreeWalker(el, 4);
    const texts: Text[] = [];
    // SVG 文字按字定位（x 列表一个值对应一个字），插连接符会错位
    while (walker.nextNode())
      if ((walker.currentNode as Text).data && isHtmlEl(walker.currentNode.parentElement))
        texts.push(walker.currentNode as Text);
    // 连接符插在字素簇之间：插进 emoji 序列、组合附加符里会把一个字拆开
    texts.forEach((text, i) => {
      const chars = [...graphemes.segment(text.data.replace(/ /g, '\u00a0'))].map(part => part.segment);
      text.data = chars.join(WJ) + (i < texts.length - 1 ? WJ : '');
    });
    if (texts.length) count++;
  }
  return count;
}

export function cleanAttributes(root: Element) {
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name;
      if (name === ID || name.startsWith('data-wxc')) continue;
      if (
        /^on/i.test(name) ||
        name.startsWith('data-v-') ||
        [
          'class',
          'loading',
          'decoding',
          'srcset',
          'sizes',
          'contenteditable',
          'tabindex',
          'draggable',
          'fetchpriority',
        ].includes(name)
      )
        el.removeAttribute(name);
    }
  }
}
