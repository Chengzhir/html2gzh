import {
  ID,
  idOf,
  isElement,
  isHtmlEl,
  isText,
  measure,
  diffBoxes,
  splitTop,
  unquote,
  NO_TRANSFORM,
  tempStyle,
  viewOf,
} from './util.ts';
import { GLYPH_BATCH as BATCH, SNAP_BOX, SNAP_INHERITED, SNAP_INLINE, SNAP_TAGS } from './glyphapi.ts';
import { faceKey } from './fonts.ts';
import { annotateContainerWidths } from './responsive.ts';
import { resolveWebFonts, usesMissing } from './webfonts.ts';
import { CodedError, messageOf, msg } from './types.ts';
import type {
  FontPlanRow,
  GlyphFill,
  GlyphFont,
  GlyphPath,
  GlyphRequest,
  GlyphResponse,
  GlyphUnit,
  Msg,
  OutlineVerdict,
  SnapChar,
  SnapElement,
  SnapNode,
  BoxRect,
} from './types.ts';

// 字体表里勾选的字转为 SVG 路径：单元连同计算样式拍成快照交给服务端（/api/glyphs），本机的 Chrome 照样排版、核对逐字位置后打印，
// 取回它实际画出的字形，同位叠一层透明 <text> 供选中复制。
// 单元 = 一个块元素的全部内容，或块容器/弹性容器里的一段行内内容（包进一个块级 span 后整体替换）。
// 两个宽度各转一遍后，只保留"逐字位置按宽度等比缩放（或完全不变）"的单元，其余还原成文字。
const SVG = 'http://www.w3.org/2000/svg';
const WJ = '\u2060';
// 零宽字符（零宽空格、连接符、BOM）不画、不进复制层：它们没有字形，送去取字形只会让整段判成缺字
const INVISIBLE = /^[\u200b-\u200d\u2060\ufeff]+$/;
const visible = (text: string) => !!text.trim() && !INVISIBLE.test(text);
// 列表项不整块转：项目符号（尤其 inside 的）排在第一行里，会把 svg 往右推
const BOX_DISPLAY = /^(block|flow-root)$/;
const REPLACED = /^(img|svg|video|canvas|iframe|object|embed|input|math|audio|picture|select|textarea|button)$/;
const CLEAR = /^(transparent|rgba\(0, 0, 0, 0\))$/;
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
/** 一个单元取回的字形：[轮廓, 字体单位 → 内容盒 px 的矩阵, 填充色, 不透明度, 描边宽]，或没转成的原因 */
type Drawn =
  | {
      fail?: undefined;
      detail?: undefined;
      glyphs: [GlyphPath, number[], string, number, number][];
      fills: GlyphFill[];
    }
  | { fail: string; detail?: string };
/** 快照 → 取回的字形；跨多次转换复用（改设置重转时，没变的单元不必再问服务端） */
const unitCache = new Map<string, Drawn>();

export interface OutlineNotes {
  miss: Map<string, number>;
  kinds: Set<string>;
  server: Msg | null;
}
export interface OutlineCtx {
  glyphs: (req: GlyphRequest) => Promise<GlyphResponse>;
  web: Set<string> | null;
  /** 与 web 同时读下；为 null 时 web 也是空的，没有字用网页字体 */
  webUsed: Parameters<typeof resolveWebFonts>[0] | null;
  fontBytes: Parameters<typeof resolveWebFonts>[1];
  webResolved: ReturnType<typeof resolveWebFonts> | null;
  webSig: string;
  o: { svgCopy: boolean };
}
interface CharStyle {
  size: number;
  family: string;
  web: string;
}
/** 量出来的一个字；base 是基线（竖排为列中线），量完时非空白的字都有 */
interface RawChar {
  t: Text;
  i: number;
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  st: CharStyle;
  space: boolean;
  base?: number;
  trail?: boolean;
}
type CharBox = (RawChar & { space: true }) | (RawChar & { space: false; base: number });
/** 找到的单元。box 是单元的块（一段行内内容包进的 span，或 outer 本身）；fail 记下后面哪一步没做成 */
interface Located {
  d: UnitDesc;
  box: Element;
  outer: Element;
  nodes: ChildNode[];
  fail: string | null;
  detail?: string[];
}
/** 单元内容盒的尺寸与逐字的框 */
interface Measured {
  w: number;
  h: number;
  vertical: boolean;
  rtl: boolean;
  chars: CharBox[];
}
interface MeasuredUnit extends Located, Measured {
  /** 原文，还原用 */
  html: string;
  orig: ChildNode[];
  cw: number;
}
/** 换上轮廓的单元：ox、oy 是 svg 相对内容盒的偏移，drawSvg 量出 */
type Ink = Extract<Drawn, { glyphs: unknown }>;
interface DrawnUnit extends MeasuredUnit {
  ink: Ink;
  svg: SVGSVGElement;
  lines: number;
  thick: number;
  ox: number;
  oy: number;
}
interface CopyLine {
  base: number;
  size: number;
  family: string;
  y: number;
  xs: string[];
  text: string;
  right: number;
}
interface CopyColumn {
  base: number;
  size: number;
  xs: string[];
  ys: string[];
  text: string;
  bottom: number;
}
/** outline() 对每个单元的结果，供两个宽度比对 */
export type OutlineResult =
  | { ok: false; fail: string; detail?: string[] }
  | {
      ok: true;
      cw: number;
      w: number;
      h: number;
      /** 原文，不保留时换回 */
      html: string;
      vertical: boolean;
      chars: number;
      sig: number[][];
      bytes: number;
    };

const isFloat = (node: Node) => isElement(node) && node.hasAttribute('data-wxc-float');
const f3 = (value: number) => String(Math.round(value * 1000) / 1000);
/** 缺字形的原因（文案 miss.<kind>）按"原因|字体名"计数，同一原因在不同字体上分开记 */
const noteMiss = (notes: OutlineNotes, kind: string, fontName?: string) => {
  const key = `${kind}|${fontName || ''}`;
  notes.miss.set(key, (notes.miss.get(key) || 0) + 1);
  notes.kinds.add(kind);
};
/** notes.miss → 每条"字体名：原因"的文案 */
export const missMsgs = (miss: Map<string, number>): Msg[] =>
  [...miss.keys()].map(key => {
    const [kind, fontName] = key.split('|');
    return fontName ? msg('miss.named', { name: fontName, why: msg('miss.' + kind) }) : msg('miss.' + kind);
  });

/**
 * 原稿真正用上的网页字体（@font-face）的字体名。用到它们的字转为路径时，字形取自文章引用的字体文件（见 webfonts.ts）。
 * 要在摘掉样式表之前调用。排在前面的本机字体已经覆盖了所有字时，网页字体不会被加载，状态停在 unloaded；
 * 加载失败的是 error，原稿里显示的也是回落字体，都不算
 */
export function webFamilies(doc: Document) {
  const out = new Set<string>();
  for (const face of doc.fonts)
    if (face.status === 'loaded' || face.status === 'loading') out.add(unquote(face.family).toLowerCase());
  return out;
}
/** 字体栈里原稿用上的网络字体名，没有则为空串 */
const webIn = (stack: string, web: Set<string> | null) =>
  web && web.size
    ? splitTop(stack)
        .map(unquote)
        .find(name => web.has(name.toLowerCase())) || ''
    : '';

function contentBox(win: Window, el: Element): BoxRect {
  const rect = el.getBoundingClientRect(),
    style = win.getComputedStyle(el);
  const [borderLeft, borderRight, borderTop, borderBottom] = (['Left', 'Right', 'Top', 'Bottom'] as const).map(side =>
    parseFloat(style[`border${side}Width`]),
  );
  const [paddingLeft, paddingRight, paddingTop, paddingBottom] = (['Left', 'Right', 'Top', 'Bottom'] as const).map(
    side => parseFloat(style[`padding${side}`]),
  );
  return {
    x: rect.left + borderLeft + paddingLeft,
    y: rect.top + borderTop + paddingTop,
    w: rect.width - borderLeft - borderRight - paddingLeft - paddingRight,
    h: rect.height - borderTop - borderBottom - paddingTop - paddingBottom,
  };
}

/** 单元里只允许没有自己外观的行内元素：字形之外的东西（背景、边框、下划线、上下标）画不进轮廓 */
function plainInline(win: Window, el: Node): boolean {
  if (!isHtmlEl(el)) return false;
  if (el.localName === 'br' || el.localName === 'wbr') return true;
  if (REPLACED.test(el.localName) || isFloat(el)) return false;
  const style = win.getComputedStyle(el);
  if (style.display !== 'inline' || !CLEAR.test(style.backgroundColor) || style.backgroundImage !== 'none')
    return false;
  if (
    (['Top', 'Right', 'Bottom', 'Left'] as const).some(
      side => style[`border${side}Style`] !== 'none' && parseFloat(style[`border${side}Width`]) > 0,
    )
  )
    return false;
  if (
    style.outlineStyle !== 'none' ||
    style.boxShadow !== 'none' ||
    style.verticalAlign !== 'baseline' ||
    style.position !== 'static'
  )
    return false;
  if (style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.clipPath !== 'none') return false;
  return [...el.children].every(child => plainInline(win, child));
}
/**
 * 文字本身的继承属性里画不出来的：描边、阴影，遮住的密码字，以及透明复制层对不上位置的排法（侧向书写模式、竖排的斜体）。
 * 字形由 Chrome 自己排、自己画，变形、小型大写、从右到左、竖排里侧转的字都照样转。返回原因代码，可以画返回 ''
 */
function textWhy(style: CSSStyleDeclaration) {
  if (parseFloat(style.webkitTextStrokeWidth || '0') !== 0 || style.textShadow !== 'none') return 'effect';
  if (
    !/^(horizontal-tb|vertical-rl|vertical-lr)$/.test(style.writingMode) ||
    (style.writingMode !== 'horizontal-tb' && style.fontStyle !== 'normal') ||
    (style.getPropertyValue('-webkit-text-security') || 'none') !== 'none' ||
    !(parseFloat(style.fontSize) > 0) ||
    style.visibility !== 'visible'
  )
    return 'other';
  return '';
}
/** 块本身的原因：背景裁切文字、省略号截断、分栏，以及缩放（zoom 下快照里的计算值与布局不成比例） */
const boxWhy = (style: CSSStyleDeclaration, el: Element) =>
  style.backgroundClip === 'text'
    ? 'effect'
    : style.textOverflow !== 'clip' || (style.webkitLineClamp || 'none') !== 'none'
      ? 'clip'
      : style.columnCount !== 'auto' ||
          style.columnWidth !== 'auto' ||
          ('currentCSSZoom' in el && el.currentCSSZoom !== 1)
        ? 'other'
        : '';
const blockOf = (win: Window, el: Element, root: Element) => {
  let block = el;
  while (block !== root && win.getComputedStyle(block).display.startsWith('inline'))
    block = block.parentElement ?? root;
  return block;
};

/** 单元里的文字节点（浮动元素里的不算：它们留在原处，不进轮廓） */
function textNodes(nodes: ChildNode[]) {
  const out: Text[] = [];
  const walk = (node: Node) => {
    if (isText(node)) {
      if (node.data) out.push(node);
      return;
    }
    if (node.nodeType === 1 && !isFloat(node)) for (const child of node.childNodes) walk(child);
  };
  nodes.forEach(walk);
  return out;
}
const unitText = (nodes: ChildNode[]) =>
  [
    ...segmenter.segment(
      textNodes(nodes)
        .map(t => t.data)
        .join(''),
    ),
  ]
    .map(part => part.segment)
    .filter(text => !INVISIBLE.test(text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const visibleCount = (text: string) =>
  [...segmenter.segment(text.split(WJ).join(''))].filter(part => visible(part.segment)).length;

/** nodes 能不能整体换成路径：只含文字、无外观的行内元素、零占位浮动；box 是承载它们的块。能换返回 ''，否则返回原因代码 */
function ineligible(win: Window, box: Element, nodes: ChildNode[], root: Element) {
  if (!nodes.length) return 'empty';
  const boxReason = boxWhy(win.getComputedStyle(box), box);
  if (boxReason) return boxReason;
  for (const node of nodes) {
    if (node.nodeType === 3 || node.nodeType === 8) continue;
    if (isFloat(node)) {
      if (node.textContent?.trim()) return 'other';
      continue;
    }
    if (!plainInline(win, node)) return 'inline';
  }
  const texts = textNodes(nodes);
  if (!texts.some(t => [...segmenter.segment(t.data)].some(part => visible(part.segment)))) return 'empty';
  const seen = new Set<Element>();
  const writingMode = win.getComputedStyle(box).writingMode;
  for (const t of texts) {
    // 文字节点都在单元里，父元素至少是 box
    const parent = t.parentElement ?? box;
    const style = win.getComputedStyle(parent);
    const reason = textWhy(style);
    if (reason) return reason;
    if (style.writingMode !== writingMode || ('currentCSSZoom' in parent && parent.currentCSSZoom !== 1))
      return 'other';
    // 下划线等装饰会从祖先块传到子孙文字上
    for (
      let ancestor = t.parentElement;
      ancestor && ancestor !== root.parentElement && !seen.has(ancestor);
      ancestor = ancestor.parentElement
    ) {
      seen.add(ancestor);
      const ancestorStyle = win.getComputedStyle(ancestor);
      if (ancestorStyle.textDecorationLine !== 'none') return 'deco';
      if (ancestorStyle.backgroundClip === 'text') return 'effect';
    }
  }
  return '';
}
/**
 * 字没转为路径的原因：选单元时的原因代码，加上 outline/decide 的结论代码；说法见文案 why.<代码>。
 * 说法相同的几种归成一种，计数时合在一起
 */
const WHY_SAME: Record<string, string> = { empty: 'other', missing: 'mismatch' };
export const whyCode = (why: string) => WHY_SAME[why] || why;

/**
 * 字体表与要转的单元。
 * 行：字体 + 字重 + 是否斜体 + 字号（sizeAt 折算到 335px 正文宽）；作者自己的 svg 里的字不算。
 * 单元：整块，或块容器/弹性容器里的一段行内内容；多数字所在的行勾选了（picked）才转。
 * 返回 { rows, units, skip }。units 是 [{ id, from?, to?, text, rows: { 行键: 字数 } }]，一段行内内容写父块的 id 与 childNodes 下标；
 * 只在主宽度下选一次，另一个宽度按同一组描述去找。skip：勾选了却没进单元的字，行键 → 原因代码 → 字数
 */
/** 要转的单元：一段行内内容写父块的 id 与 childNodes 下标 [from, to) */
export interface UnitDesc {
  id: string;
  from?: number;
  to?: number;
  text: string;
  rows: Record<string, number>;
}
export interface FontPlan {
  rows: FontPlanRow[];
  units: UnitDesc[];
  /** 行键 → 原因代码 → 字数 */
  skip: Map<string, Map<string, number>>;
  /** skip 中的字所在的元素 */
  skipIds: string[];
}
export function planFonts(
  doc: Document,
  root: Element,
  { picked, web, sizeAt }: { picked: Set<string>; web: Set<string>; sizeAt: (el: Element) => number },
): FontPlan {
  const win = viewOf(doc);
  const rows = new Map<string, FontPlanRow & { last: Element | null }>(),
    rowOf = new Map<Text, FontPlanRow>(),
    charCount = new Map<Text, number>();
  const charsIn = (t: Text) => charCount.get(t) ?? 0;
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, 4);
  while (walker.nextNode()) {
    const t = walker.currentNode as Text,
      el = t.parentElement;
    if (!el || el.closest('svg')) continue;
    const count = visibleCount(t.data);
    if (!count) continue;
    range.selectNodeContents(t);
    const style = win.getComputedStyle(el);
    if (!range.getClientRects().length || style.visibility !== 'visible') continue;
    const face = faceKey(style),
      size = Math.round(sizeAt(el) * 2) / 2;
    const key = `${face.key}|${size}`;
    let row = rows.get(key);
    if (!row)
      rows.set(
        key,
        (row = {
          ...face,
          face: face.key,
          key,
          size,
          stack: style.fontFamily,
          stretch: style.fontStretch,
          web: webIn(style.fontFamily, web),
          chars: 0,
          sample: '',
          last: null,
        }),
      );
    row.chars += count;
    rowOf.set(t, row);
    charCount.set(t, count);
    // 同一个块里被行内元素切开的几段直接接上（保留原文的空格），换了块才加空格；样例多取一些，显示时由 CSS 省略号截断
    if (row.sample.length < 40) {
      const text = t.data.split(WJ).join('').replace(/\s+/g, ' ');
      const block = blockOf(win, el, root);
      row.sample = (
        row.sample && block !== row.last
          ? row.sample.trimEnd() + ' ' + text.trimStart()
          : row.sample + (row.sample ? text : text.trimStart())
      ).slice(0, 40);
      row.last = block;
    }
  }
  const isPicked = (row: FontPlanRow) => picked.has(row.key);
  const list: FontPlanRow[] = [...rows.values()].map(({ last, ...row }) => row);
  if (!list.some(isPicked)) return { rows: list, units: [], skip: new Map(), skipIds: [] };

  // 每个文字节点的去向：{ unit } 或原因代码。先定的为准：行内块里的字先于外层这一段定下
  const status = new Map<Text, string | { unit: number }>();
  const mark = (nodes: ChildNode[], state: string | { unit: number }) => {
    for (const t of textNodes(nodes)) if (rowOf.has(t) && !status.has(t)) status.set(t, state);
  };
  const vote = (nodes: ChildNode[]) => {
    let yes = 0,
      all = 0;
    for (const t of textNodes(nodes)) {
      const row = rowOf.get(t);
      if (row) {
        all += charsIn(t);
        if (isPicked(row)) yes += charsIn(t);
      }
    }
    return all > 0 && yes * 2 >= all;
  };
  const units: UnitDesc[] = [];
  const take = (id: string, nodes: ChildNode[], from?: number) => {
    const counts: Record<string, number> = {};
    for (const t of textNodes(nodes)) {
      const row = rowOf.get(t);
      if (row) counts[row.key] = (counts[row.key] || 0) + charsIn(t);
    }
    const desc: UnitDesc = { id, text: unitText(nodes), rows: counts };
    if (from != null) Object.assign(desc, { from, to: from + nodes.length });
    mark(nodes, { unit: units.length });
    units.push(desc);
  };
  const visit = (el: Node) => {
    if (!isHtmlEl(el) || REPLACED.test(el.localName)) return;
    const style = win.getComputedStyle(el);
    if (style.display === 'none' || style.display === 'contents') return;
    const id = el.getAttribute(ID);
    const kids = [...el.childNodes];
    if (id && BOX_DISPLAY.test(style.display) && !ineligible(win, el, kids, root) && vote(kids)) {
      take(id, kids);
      return;
    }
    scan(el, /flex|grid/.test(style.display));
  };
  // 子节点按"行内段"分组：块容器里是匿名块，弹性/网格容器里是匿名项。只有整段都是纯文字的才包起来转
  const scan = (el: Element, itemized: boolean) => {
    const id = el.getAttribute(ID);
    let run: ChildNode[] = [],
      bad = false;
    const flush = () => {
      const from = run.findIndex(node => !isFloat(node)),
        to = run.findLastIndex(node => !isFloat(node));
      const nodes = from < 0 ? [] : run.slice(from, to + 1);
      if (nodes.length) {
        const why = !id ? 'other' : bad ? 'inline' : ineligible(win, el, nodes, root);
        if (why || !id) mark(nodes, why || 'other');
        else if (vote(nodes)) take(id, nodes, [...el.childNodes].indexOf(nodes[0]));
        else mark(nodes, 'vote');
      }
      run = [];
      bad = false;
    };
    for (const node of el.childNodes) {
      if (isText(node)) {
        if (node.data.trim() || run.length) run.push(node);
        continue;
      }
      if (!isElement(node)) continue;
      const nodeStyle = isHtmlEl(node) || node.localName === 'svg' ? win.getComputedStyle(node) : null;
      if (!nodeStyle || nodeStyle.display === 'none') continue;
      if (isFloat(node) && !itemized) {
        if (node.textContent?.trim()) {
          flush();
          visit(node);
        } else if (run.length) run.push(node);
        continue;
      }
      if (itemized || !nodeStyle.display.startsWith('inline')) {
        flush();
        visit(node);
        continue;
      }
      if (plainInline(win, node)) {
        run.push(node);
        continue;
      }
      // 有外观的行内元素或行内块：这一段不转；行内块自己的内容另算（它的基线由内容决定，替换后靠逐元素校验兜底）
      bad = true;
      run.push(node);
      if (nodeStyle.display !== 'inline') visit(node);
    }
    flush();
  };
  visit(root);

  const skip = new Map<string, Map<string, number>>(),
    skipIds = new Set<string>();
  for (const [t, row] of rowOf) {
    const state = status.get(t) || 'other';
    if (!isPicked(row) || typeof state !== 'string') continue;
    const reasons = skip.getOrInsertComputed(row.key, () => new Map()),
      why = whyCode(state);
    reasons.set(why, (reasons.get(why) || 0) + charsIn(t));
    const holder = t.parentElement?.closest(`[${ID}]`);
    if (holder) skipIds.add(idOf(holder));
  }
  return { rows: list, units, skip, skipIds: [...skipIds] };
}
/** 按描述在本次转换的 DOM 里找到单元；文字对不上或在这个宽度下不再合格就返回原因 */
function locate(
  doc: Document,
  root: Element,
  d: UnitDesc,
): Located | { d: UnitDesc; fail: string; detail?: undefined } {
  const win = viewOf(doc);
  const box = root.querySelector(`[${ID}="${d.id}"]`) || (root.getAttribute(ID) === d.id ? root : null);
  if (!box) return { d, fail: 'missing' };
  const nodes = d.from == null ? [...box.childNodes] : [...box.childNodes].slice(d.from, d.to);
  if (unitText(nodes) !== d.text) return { d, fail: 'mismatch' };
  if (ineligible(win, box, nodes, root)) return { d, fail: 'ineligible' };
  return { d, box, nodes, outer: box, fail: null };
}

/** 一段行内内容包进块级 span：在块容器里等同匿名块，在弹性容器里等同匿名弹性项 */
function wrapRun(doc: Document, unit: Located) {
  if (unit.d.from == null) return;
  const wrapper = doc.createElement('span');
  wrapper.setAttribute('data-wxc-wrap', '');
  wrapper.style.setProperty('display', 'block');
  unit.nodes[0].before(wrapper);
  for (const node of unit.nodes) wrapper.appendChild(node);
  unit.box = wrapper;
}
function unwrapRun(unit: Located) {
  if (unit.d.from == null || unit.box === unit.outer) return;
  unit.box.replaceWith(...unit.box.childNodes);
  unit.box = unit.outer;
}

/**
 * 内容盒的精确位置与宽度：计算样式里的 padding 是 CSS 值（如 10.05px），布局里却取整到 1/64px，
 * 直接相减会差 1/64px，换上的 svg 就会让弹性列收窄。临时塞一个空的块级子元素量它的框，得到的就是布局值
 */
function exactContentBox(doc: Document, el: Element): BoxRect {
  const win = viewOf(doc);
  const vertical = win.getComputedStyle(el).writingMode !== 'horizontal-tb';
  const probe = doc.createElement('span');
  // 竖排时块的起始边在右（vertical-rl）或左（vertical-lr），空块是一条竖线：它的高就是内容盒的行向长度，左边是坐标原点
  probe.style.cssText = `display:block;${vertical ? 'width:0;height:auto' : 'width:auto;height:0'};margin:0;padding:0;border:0;float:none`;
  el.prepend(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  const content = contentBox(win, el);
  return vertical
    ? { x: rect.left, y: rect.top, w: content.w, h: rect.height }
    : { x: rect.left, y: rect.top, w: rect.width, h: content.h };
}

/**
 * 逐字（字素簇）量位置，坐标相对单元内容盒的原点（竖排 rl 在右上角，与服务端的取法相同）。web：原稿用上的网页字体名
 */
function measureChars(doc: Document, unit: Located, web: Set<string>): Measured | string {
  const win = viewOf(doc);
  const content = exactContentBox(doc, unit.box);
  const vertical = win.getComputedStyle(unit.box).writingMode !== 'horizontal-tb';
  // 每个字记下字号（透明复制层用）与原稿用上的网页字体（缺文件时整段不转）
  const styleOf = new Map<Element, CharStyle>();
  const charStyle = (el: Element) =>
    styleOf.getOrInsertComputed(el, () => {
      const style = win.getComputedStyle(el);
      return { size: parseFloat(style.fontSize), family: style.fontFamily, web: webIn(style.fontFamily, web) };
    });
  const chars: RawChar[] = [];
  const range = doc.createRange();
  for (const t of textNodes(unit.nodes)) {
    for (const { segment, index } of segmenter.segment(t.data)) {
      if (INVISIBLE.test(segment)) continue;
      range.setStart(t, index);
      range.setEnd(t, index + segment.length);
      const rect = range.getClientRects()[0];
      if (!rect || (!(vertical ? rect.height : rect.width) && !segment.trim())) {
        // 行末折行处的空格不占位置（没有矩形），但复制出来的文字里要有它，记在前一个字上
        if (!segment.trim() && chars.length) chars[chars.length - 1].trail = true;
        continue;
      }
      const char: RawChar = {
        t,
        i: index,
        s: segment,
        x: rect.left - content.x,
        y: rect.top - content.y,
        w: rect.width,
        h: rect.height,
        st: charStyle(t.parentElement ?? unit.box),
        space: !segment.trim() || segment === '\u00a0',
      };
      // 竖排的"基线"是列的中线：直立的字在字框里左右居中（实测与字框中线差不到 0.3px）
      if (vertical) char.base = char.x + char.w / 2;
      chars.push(char);
    }
  }
  if (!chars.some(char => !char.space)) return 'empty';
  if (!vertical && !baselines(doc, chars, content)) return 'baseline';
  if (!chars.every((char): char is CharBox => char.space || char.base != null)) return 'baseline';
  const rtl = win.getComputedStyle(unit.box).direction === 'rtl';
  return { w: content.w, h: content.h, vertical, rtl, chars };
}
/**
 * 基线：同一行里首尾相接的字分成一段，在段末最后一个非空白字后面临时插一个零尺寸行内块，它的底边就是这一行的基线。
 * 标记插在本来就断行（或不断行）的位置之后、宽度为零，不改变断行；插入前后字的纵向位置不变才采信。
 */
function baselines(doc: Document, chars: RawChar[], content: BoxRect): boolean {
  const segments: RawChar[][] = [];
  for (const char of chars) {
    const current = segments.at(-1),
      prev = current?.at(-1);
    // 首尾相接：从左到右的字接在前一个字的右边，从右到左的接在左边
    const same =
      prev &&
      (Math.abs(char.x - (prev.x + prev.w)) < 0.6 || Math.abs(char.x + char.w - prev.x) < 0.6) &&
      char.y < prev.y + prev.h &&
      prev.y < char.y + char.h;
    if (current && same) current.push(char);
    else segments.push([char]);
  }
  const range = doc.createRange();
  const rectOf = (char: RawChar) => {
    range.setStart(char.t, char.i);
    range.setEnd(char.t, char.i + char.s.length);
    return range.getClientRects()[0];
  };
  for (const segment of segments) {
    const last = segment.findLast(char => !char.space);
    if (!last) continue;
    const t = last.t,
      data = t.data;
    const rest = t.splitText(last.i + last.s.length);
    const marker = doc.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
    t.after(marker);
    const base = marker.getBoundingClientRect().bottom - content.y;
    marker.remove();
    rest.remove();
    t.data = data;
    const rect = rectOf(last);
    if (!rect || Math.abs(rect.top - content.y - last.y) > 0.5 || Math.abs(rect.height - last.h) > 0.5) return false;
    for (const char of segment) char.base = base;
  }
  return true;
}

/**
 * 单元的快照：服务端照它重排版。块写明继承属性与几项块级属性；子孙元素只写与父元素不同的继承属性、与初始值不同的行内属性；
 * 零占位的浮动元素不带（它们留在原处，不进轮廓）。chars 是逐字的框，下标按快照里全部文字连起来计
 */
function snapshot(win: Window, unit: MeasuredUnit): { unit: GlyphUnit; elements: number; text: number } {
  const boxStyle = win.getComputedStyle(unit.box);
  const style: Record<string, string> = {};
  for (const prop of [...SNAP_INHERITED, ...SNAP_BOX]) {
    const value = boxStyle.getPropertyValue(prop);
    if (value) style[prop] = value;
  }
  const base = new Map<Text, number>();
  let text = 0,
    elements = 0;
  const walk = (parentStyle: CSSStyleDeclaration, nodes: ChildNode[]): SnapNode[] => {
    const out: SnapNode[] = [];
    for (const child of nodes) {
      if (isText(child)) {
        if (!child.data) continue;
        base.set(child, text);
        text += child.data.length;
        out.push(child.data);
      } else if (isElement(child) && !isFloat(child)) {
        const el = child,
          computed = win.getComputedStyle(el);
        const diff: Record<string, string> = {};
        for (const prop of SNAP_INHERITED) {
          const value = computed.getPropertyValue(prop);
          if (value && value !== parentStyle.getPropertyValue(prop)) diff[prop] = value;
        }
        for (const [prop, init] of Object.entries(SNAP_INLINE)) {
          const value = computed.getPropertyValue(prop);
          if (value && value !== init) diff[prop] = value;
        }
        elements++;
        const node: SnapElement = {
          tag: SNAP_TAGS.includes(el.localName) ? el.localName : 'span',
          style: diff,
          kids: walk(computed, [...el.childNodes]),
        };
        const lang = el.getAttribute('lang');
        if (lang != null) node.lang = lang;
        out.push(node);
      }
    }
    return out;
  };
  // 一段行内内容此时已包进块级 span（unit.box），子节点就是这一段
  const kids = walk(boxStyle, [...unit.box.childNodes]);
  const chars: SnapChar[] = unit.chars.map(char => {
    const at = base.get(char.t);
    if (at == null) throw new Error('snapshot');
    return [at + char.i, at + char.i + char.s.length, char.x, char.y, char.w, char.h];
  });
  const lang = (unit.box.closest('[lang]') || unit.box.ownerDocument.documentElement).getAttribute('lang') || '';
  return { unit: { w: unit.w, h: unit.h, style, lang, kids, chars }, elements, text };
}

/**
 * 各单元的字形分批问服务端，返回取到字形的单元；没转成的记下 unit.fail。用到网页字体时先取字体文件（只取一次）；
 * 文件取不到的字体，用到它的单元不转。没装 Chrome 之类的错误整体抛出，由 outline 记下
 */
async function fetchOutlines(
  win: Window,
  units: MeasuredUnit[],
  ctx: OutlineCtx,
  notes: OutlineNotes,
): Promise<Map<MeasuredUnit, Ink>> {
  const glyphs = ctx.glyphs;
  // 服务端的原因 → 本模块的原因代码（文案 why.<代码>）：排版对不上是 relayout，读不出轮廓归到 font 并记下 miss.render
  const WHY: Record<string, string> = { mismatch: 'relayout', color: 'color', effect: 'effect', render: 'font' };
  const inks = new Map<MeasuredUnit, Ink>();
  const settle = (unit: MeasuredUnit, drawn: Drawn) => {
    if (drawn.fail == null) {
      inks.set(unit, drawn);
      return;
    }
    unit.fail = WHY[drawn.fail] || 'font';
    if (unit.fail === 'font') noteMiss(notes, 'render');
    if (drawn.detail) unit.detail = [drawn.detail];
  };
  let fonts: GlyphFont[] = [];
  const webUsed = ctx.webUsed;
  if (webUsed && units.some(unit => !unit.fail && unit.chars.some(char => !char.space && char.st.web))) {
    ctx.webResolved ??= resolveWebFonts(webUsed, ctx.fontBytes);
    const resolved = await ctx.webResolved;
    fonts = resolved.fonts;
    for (const unit of units)
      if (!unit.fail) {
        const missingChar = unit.chars.find(
          char => !char.space && char.st.web && usesMissing(char.st.family, resolved.missing),
        );
        if (missingChar) {
          unit.fail = 'font';
          noteMiss(notes, 'webfile', missingChar.st.web);
        }
      }
  }
  const dpr = win.devicePixelRatio || 1;
  const cacheSig = JSON.stringify([dpr, ctx.webSig || '']);
  const todo: { u: MeasuredUnit; key: string; unit: GlyphUnit; elements: number; text: number }[] = [];
  for (const unit of units) {
    if (unit.fail) continue;
    let snap: ReturnType<typeof snapshot>;
    try {
      snap = snapshot(win, unit);
    } catch {
      unit.fail = 'other';
      continue;
    }
    if (snap.elements > BATCH.elements || snap.text > BATCH.text || snap.unit.chars.length > BATCH.chars) {
      unit.fail = 'other';
      continue;
    }
    const key = cacheSig + JSON.stringify(snap.unit);
    const cached = unitCache.get(key);
    if (cached) settle(unit, cached);
    else todo.push({ u: unit, key, ...snap });
  }
  for (let i = 0; i < todo.length;) {
    const batch: typeof todo = [];
    for (
      let elementTotal = 0, textTotal = 0, charTotal = 0;
      i < todo.length &&
      (!batch.length ||
        (batch.length < BATCH.units &&
          elementTotal + todo[i].elements <= BATCH.elements &&
          textTotal + todo[i].text <= BATCH.text &&
          charTotal + todo[i].unit.chars.length <= BATCH.chars));
      i++
    ) {
      batch.push(todo[i]);
      elementTotal += todo[i].elements;
      textTotal += todo[i].text;
      charTotal += todo[i].unit.chars.length;
    }
    const response = await glyphs({ dpr, fonts, units: batch.map(item => item.unit) });
    batch.forEach((item, j) => {
      const result = response.units[j];
      const drawn: Drawn = result.fail
        ? { fail: result.fail, detail: result.detail }
        : {
            glyphs: result.glyphs.map(([path, matrix, fill, alpha, w]) => [
              response.paths[path],
              matrix,
              fill,
              alpha,
              w,
            ]),
            fills: result.fills,
          };
      if (unitCache.size > 4000) {
        const oldest = unitCache.keys().next();
        if (!oldest.done) unitCache.delete(oldest.value);
      }
      unitCache.set(item.key, drawn);
      settle(item.u, drawn);
    });
  }
  return inks;
}

/**
 * 单元的 <svg> 空壳，先放进版面量位置，再由 drawSvg 画字。
 * 高度交给行盒：Chrome 的行高按 1/64px 四舍五入、height 却向下截断，比例写法的固定高度在别的宽度下总会差 1/64px，
 * 几个轮廓累积起来就把下文挤动。所以 svg 做成第一行里的行内块，比一行矮（不撑高行盒），其余各行由 <br> + 连接符撑出，
 * 字形画在 svg 的溢出区里。行向长度加 1/256px：截断和四舍五入都落回原值。竖排时"行"是列，宽高对调
 */
function shellSvg(doc: Document, unit: MeasuredUnit, ink: Ink): DrawnUnit {
  const lines = new Set(unit.chars.flatMap(char => (char.space ? [] : [Math.round(char.base * 100)]))).size;
  const lineHeight = parseFloat(viewOf(doc).getComputedStyle(unit.box).lineHeight);
  const thick = Math.max(
    1,
    Math.min(lineHeight > 0 ? lineHeight : Infinity, (unit.vertical ? unit.w : unit.h) / lines) - 1 / 32,
  );
  const svg = doc.createElementNS(SVG, 'svg');
  const drawn: DrawnUnit = Object.assign(unit, { ink, svg, lines, thick, ox: 0, oy: 0 });
  sizeSvg(svg, drawn, 0);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', unit.d.text.slice(0, 500));
  return drawn;
}
/** inset：svg 在行向上离内容盒起始边的距离（首行缩进等），行向长度扣掉它，免得伸出内容盒 */
function sizeSvg(svg: SVGSVGElement, unit: DrawnUnit, inset: number) {
  const len = f3((unit.vertical ? unit.h : unit.w) - inset + 1 / 256),
    thick = f3(unit.thick);
  const [boxW, boxH] = unit.vertical ? [thick, len] : [len, thick];
  svg.setAttribute('viewBox', `0 0 ${boxW} ${boxH}`);
  svg.setAttribute(
    'style',
    `display:inline-block;vertical-align:top;width:${boxW}px;height:${boxH}px;overflow:visible`,
  );
}

/**
 * Chrome 画文字时按字色的亮度加重边缘像素的覆盖率，画路径时不加，转为路径的字因此偏细，浅色字更明显。
 * 在路径下面垫一层同色、不偏移、不模糊的阴影：边缘像素的覆盖率 a 变为 a + k·a·(1 − a)，内部不变，
 * 加重的量按设备像素计，屏幕越清晰越小，与文字的情形一致。k 按 Windows 上的 Chrome 实测拟合，
 * 安卓版 Chromium 加重得少（SK_GAMMA_CONTRAST=0），WebKit 不画 SVG 子元素上的 CSS 滤镜。
 * 写成 filter 属性：公众号删 style 里的 filter，留 filter 属性
 */
function edgeBoost(fill: string) {
  const channels = [1, 3, 5].map(at => parseInt(fill.slice(at, at + 2), 16));
  const luma = (0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]) / 255;
  const k = 0.65 + 1.3 * luma ** 3;
  const shadow = (alpha: number) => `drop-shadow(0 0 0 rgba(${channels.join(',')},${f3(alpha)}))`;
  return k <= 1 ? shadow(k) : `${shadow(1)} ${shadow(k - 1)}`;
}

/**
 * 放进版面后的空壳里画字：服务端给的字形按颜色、不透明度、描边与矩阵的线性部分分组，每组拼成一条 path
 * （变换只写一次，各字首点按自己的原点偏移），外加透明复制层。字形坐标相对内容盒，减去 svg 相对内容盒的偏移（竖排的列、首行缩进）
 */
function drawSvg(doc: Document, unit: DrawnUnit, opts: OutlineCtx['o']) {
  const svg = unit.svg,
    rect = svg.getBoundingClientRect(),
    content = exactContentBox(doc, unit.box);
  const near0 = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v);
  unit.ox = near0(rect.left - content.x);
  unit.oy = near0(rect.top - content.y);
  sizeSvg(svg, unit, unit.vertical ? unit.oy : unit.ox);
  const groups = new Map<string, { m: number[]; fill: string; alpha: number; w: number; d: string }>();
  const drawn = unit.ink;
  for (const [path, matrix, fill, alpha, w] of drawn.glyphs) {
    const [a, b, c, d] = matrix,
      e = matrix[4] - unit.ox,
      f = matrix[5] - unit.oy;
    const det = a * d - b * c;
    if (!det) continue;
    const key = [fill, alpha, w, a, b, c, d].join('|');
    const group = groups.getOrInsertComputed(key, () => ({ m: [a, b, c, d, e, f], fill, alpha, w, d: '' }));
    // 组矩阵 (a b c d E F) 把字体单位 (x, y) 映到 (E + a·x + c·y, F + b·x + d·y)：这个字的原点在组里的坐标是 (e − E, f − F) 反解出来的
    const dx = e - group.m[4],
      dy = f - group.m[5];
    const x0 = (d * dx - c * dy) / det,
      y0 = (a * dy - b * dx) / det;
    group.d += `M${Math.round(x0 + path.m[0])} ${Math.round(y0 + path.m[1])}${path.d}`;
  }
  for (const group of groups.values()) {
    const pathEl = doc.createElementNS(SVG, 'path');
    pathEl.setAttribute('transform', `matrix(${group.m.slice(0, 4).join(' ')} ${f3(group.m[4])} ${f3(group.m[5])})`);
    pathEl.setAttribute('fill', group.fill);
    // 半透明的字垫阴影会让内部也变深，不加
    if (group.alpha < 0.999) pathEl.setAttribute('fill-opacity', f3(group.alpha));
    else pathEl.setAttribute('filter', edgeBoost(group.fill));
    if (group.w) {
      pathEl.setAttribute('stroke', group.fill);
      pathEl.setAttribute('stroke-width', f3(group.w));
      if (group.alpha < 0.999) pathEl.setAttribute('stroke-opacity', f3(group.alpha));
    }
    pathEl.setAttribute('d', group.d);
    svg.appendChild(pathEl);
  }
  for (const fill of drawn.fills) {
    const pathEl = doc.createElementNS(SVG, 'path');
    if (unit.ox || unit.oy) pathEl.setAttribute('transform', `translate(${f3(-unit.ox)} ${f3(-unit.oy)})`);
    pathEl.setAttribute('fill', fill.fill);
    if (fill.alpha < 0.999) pathEl.setAttribute('fill-opacity', f3(fill.alpha));
    if (fill.evenOdd) pathEl.setAttribute('fill-rule', 'evenodd');
    pathEl.setAttribute('d', fill.d);
    svg.appendChild(pathEl);
  }
  if (opts.svgCopy) {
    for (const line of unit.vertical ? copyColumns(unit) : copyLines(unit)) svg.appendChild(line(doc));
    keepInside(svg, content, unit.vertical);
  }
  return svg;
}
/**
 * 透明复制层不许伸出内容盒：从右到左的行首字以右边对准盒子右边，Chrome 给 <text> 量出的框比字框多出约 1px，
 * 内容结构检测会把它判为溢出。逐行量，伸出去多少就往回挪多少（再留 0.25px）；字是透明的，只影响选中时高亮的位置
 */
function keepInside(svg: SVGSVGElement, content: BoxRect, vertical: boolean) {
  const lo = vertical ? content.y : content.x,
    hi = lo + (vertical ? content.h : content.w);
  const attr = vertical ? 'y' : 'x';
  for (const t of svg.querySelectorAll('text')) {
    const rect = t.getBoundingClientRect();
    const start = vertical ? rect.top : rect.left,
      end = vertical ? rect.bottom : rect.right;
    const shift = start < lo ? lo - start + 0.25 : end > hi ? hi - end - 0.25 : 0;
    const positions = t.getAttribute(attr);
    if (shift && positions)
      t.setAttribute(
        attr,
        positions
          .split(' ')
          .map(v => f3(+v + shift))
          .join(' '),
      );
  }
}

/**
 * 透明复制层：每行一个 <text>，逐字给 x；空格写成不换行空格，免得被 SVG 的空白折叠吃掉、错开后面的位置。
 * 从右到左的段落里 <text> 继承 rtl，每个字以右边对准 x，所以 x 取字框的右边；字的先后照原文，复制出来的顺序不变
 */
function copyLines(unit: DrawnUnit): ((doc: Document) => SVGTextElement)[] {
  const lines: CopyLine[] = [];
  let line: CopyLine | null = null,
    pending = false;
  const xOf = (char: CharBox) => f3((unit.rtl ? char.x + char.w : char.x) - unit.ox);
  for (const char of unit.chars) {
    const base: number | null =
      char.base != null ? char.base : line && Math.abs(char.y - line.y) < 1 ? line.base : null;
    if (base == null) continue;
    if (
      !line ||
      Math.abs(base - line.base) > 0.5 ||
      char.st.size !== line.size ||
      (!unit.rtl && char.x < line.right - 0.6)
    )
      lines.push((line = { base, size: char.st.size, family: char.st.family, y: char.y, xs: [], text: '', right: 0 }));
    // 折行处被吃掉的空格补在下一行行首、和首字同一位置：放在上一行末尾会伸出盒子
    if (pending) {
      line.xs.push(xOf(char));
      line.text += '\u00a0';
      pending = false;
    }
    // xs 与 line.text 按 UTF-16 码元一一对应，不是按码位
    const x = xOf(char);
    line.xs.push(...Array.from({ length: char.s.length }, () => x));
    line.text += char.space ? '\u00a0'.repeat(char.s.length) : char.s;
    line.right = char.x + char.w;
    if (char.trail) pending = true;
  }
  return lines
    .filter(entry => entry.text.trim())
    .map(entry => (doc: Document) => {
      const t = doc.createElementNS(SVG, 'text');
      t.setAttribute('x', entry.xs.join(' '));
      t.setAttribute('y', f3(entry.base - unit.oy));
      t.setAttribute('font-size', f3(entry.size));
      t.setAttribute('fill-opacity', '0');
      t.textContent = entry.text;
      return t;
    });
}
/**
 * 竖排的透明复制层：每列一个 <text>，逐字给 x（列中线）、y（字框上沿）。svg 从单元的块继承竖排，
 * 竖排的 <text> 以中线定横向位置、以字的上沿定纵向位置，透明的字逐个落在原来的字框里
 */
function copyColumns(unit: DrawnUnit): ((doc: Document) => SVGTextElement)[] {
  const columns: CopyColumn[] = [];
  let column: CopyColumn | null = null,
    pending = false;
  for (const char of unit.chars) {
    // 竖排时每个字（含空白）都量了列中线
    const base = char.base ?? char.x + char.w / 2;
    if (!column || Math.abs(base - column.base) > 0.5 || char.st.size !== column.size || char.y < column.bottom - 0.6)
      columns.push((column = { base, size: char.st.size, xs: [], ys: [], text: '', bottom: 0 }));
    const current = column;
    const at = (count: number) => {
      for (let i = 0; i < count; i++) {
        current.xs.push(f3(base - unit.ox));
        current.ys.push(f3(char.y - unit.oy));
      }
    };
    if (pending) {
      at(1);
      column.text += '\u00a0';
      pending = false;
    }
    at(char.s.length);
    column.text += char.space ? '\u00a0'.repeat(char.s.length) : char.s;
    column.bottom = char.y + char.h;
    if (char.trail) pending = true;
  }
  return columns
    .filter(entry => entry.text.trim())
    .map(entry => (doc: Document) => {
      const t = doc.createElementNS(SVG, 'text');
      t.setAttribute('x', entry.xs.join(' '));
      t.setAttribute('y', entry.ys.join(' '));
      t.setAttribute('font-size', f3(entry.size));
      t.setAttribute('fill-opacity', '0');
      t.textContent = entry.text;
      return t;
    });
}
/** svg 的 cqw 基准：从它的父级（单元的块）往上找最近的查询容器，和 annotateContainerWidths 的取法一致 */
const nearestCw = (win: Window, box: Element, root: Element) => {
  let container: Element | null = box;
  while (container && container !== root && win.getComputedStyle(container).containerType === 'normal')
    container = container.parentElement;
  return contentBox(win, container || root).w;
};
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const originalHtml = (unit: Located) =>
  unit.d.from == null
    ? unit.box.innerHTML
    : unit.nodes.map(node => (isText(node) ? esc(node.data) : isElement(node) ? node.outerHTML : '')).join('');

/**
 * 在一次转换的 DOM 上把 descs 描述的单元换成轮廓。逐元素校验布局不变，坏的单元单独还原。
 * 返回每个单元的 { ok, fail, cw, w, h, sig, html }，供两个宽度比对；notes 收集字体缺失等原因。
 */
export async function outline(
  doc: Document,
  root: Element,
  descs: UnitDesc[],
  ctx: OutlineCtx,
  notes: OutlineNotes,
): Promise<OutlineResult[]> {
  const win = viewOf(doc);
  const base = measure(doc, true);
  using _noTransform = tempStyle(doc, NO_TRANSFORM);
  const units = descs.map(desc => locate(doc, root, desc));
  const located = units.filter(unit => 'box' in unit);
  const web = ctx.web || new Set<string>();
  const measured: MeasuredUnit[] = [];
  for (const unit of located) {
    const html = originalHtml(unit),
      orig = [...unit.nodes];
    wrapRun(doc, unit);
    const result = measureChars(doc, unit, web);
    if (typeof result === 'string') unit.fail = result;
    else measured.push(Object.assign(unit, result, { html, orig, cw: nearestCw(win, unit.box, root) }));
  }
  let inks = new Map<MeasuredUnit, Ink>();
  if (measured.length) {
    try {
      inks = await fetchOutlines(win, measured, ctx, notes);
    } catch (error) {
      notes.server =
        error instanceof CodedError ? msg(error.key, error.params) : msg('common.raw', { msg: messageOf(error) });
      for (const unit of measured) unit.fail = 'server';
    }
  }
  const apply = (unit: DrawnUnit) => {
    if (unit.d.from != null && unit.box === unit.outer) wrapRun(doc, unit);
    const rest: Node[] = [];
    for (let i = 1; i < unit.lines; i++) rest.push(doc.createElement('br'), doc.createTextNode(WJ));
    unit.box.replaceChildren(...unit.orig.filter(node => isFloat(node)), unit.svg, ...rest);
  };
  const revert = (unit: DrawnUnit) => {
    unit.box.replaceChildren(...unit.orig);
    unwrapRun(unit);
  };
  // 没取到字形的单元（含 measured 里后来失败的）还原包装
  for (const unit of located) if (unit.fail) unwrapRun(unit);
  const applied: DrawnUnit[] = [];
  for (const unit of measured) {
    const ink = inks.get(unit);
    if (unit.fail || !ink) continue;
    const drawn = shellSvg(doc, unit, ink);
    drawn.svg.setAttribute('data-wxc-unit', String(descs.indexOf(unit.d)));
    apply(drawn);
    applied.push(drawn);
  }
  // 全部换上之后再量各 svg 的位置、画字：前面的单元换上后，后面单元的块可能挪位，但 svg 相对自己内容盒的偏移不变
  for (const unit of applied) drawSvg(doc, unit, ctx.o);
  // 被换掉的内层元素不在新的测量里，diffBoxes 会跳过它们；其余所有元素都不许动，连 1/64px 也不行（会翻转下文的整像素取整）
  const moved = () => {
    const now = measure(doc, true);
    return diffBoxes(base, now, 0.01).flatMap(id => {
      const a = base.get(id),
        b = now.get(id);
      return a && b ? [`${id} ${(['x', 'y', 'w', 'h'] as const).map(k => (b[k] - a[k]).toFixed(4)).join(',')}`] : [];
    });
  };
  if (applied.length && moved().length) {
    // 逐个放回：哪个单元一换就让别的元素挪位，就把它还原成文字
    applied.forEach(revert);
    for (const unit of applied) {
      apply(unit);
      const movedIds = moved();
      if (movedIds.length) {
        revert(unit);
        unit.fail = 'layout';
        unit.detail = movedIds.slice(0, 3);
      }
    }
  }
  if (applied.length) annotateContainerWidths(doc, root);
  const drawnOf = new Map(applied.map(unit => [unit.d, unit]));
  return units.map((unit): OutlineResult => {
    const drawn = drawnOf.get(unit.d);
    if (!drawn || drawn.fail) return { ok: false, fail: unit.fail || 'other', detail: unit.detail };
    const glyphs = drawn.chars.filter(char => !char.space);
    return {
      ok: true,
      cw: drawn.cw,
      w: drawn.w,
      h: drawn.h,
      html: drawn.html,
      vertical: drawn.vertical,
      chars: glyphs.length,
      // 相对 svg 的 [行向位置, 行（列）的位置, 字号]
      sig: glyphs.map(char =>
        drawn.vertical
          ? [char.y - drawn.oy, char.base - drawn.ox, char.st.size]
          : [char.x - drawn.ox, char.base - drawn.oy, char.st.size],
      ),
      bytes: drawn.svg.outerHTML.length - drawn.html.length,
    };
  });
}

/** 两个宽度的结果比一比：逐字位置按容器宽度等比缩放的写 viewBox（随屏宽缩放），完全不变的去掉 viewBox（固定像素） */
export function decide(resultsA: OutlineResult[], resultsB: OutlineResult[]): OutlineVerdict[] {
  return resultsA.map((a, i): OutlineVerdict => {
    const b = resultsB[i];
    if (!a.ok) return { keep: false, why: a.fail, detail: a.detail };
    if (!b || !b.ok) return { keep: false, why: b ? b.fail : 'missing', detail: b && b.detail, side: 'B' };
    if (a.chars !== b.chars || a.vertical !== b.vertical) return { keep: false, why: 'reflow' };
    // 最大偏差（px）：行向长度、块向长度、逐字的行向位置、基线（竖排为列中线）、字号。
    // 横排的行向长度是盒宽，竖排是盒高；w 为 false 时不比行向长度
    const [len, thick] = a.vertical ? (['h', 'w'] as const) : (['w', 'h'] as const);
    const dev = (ratio: number, w: boolean) => {
      const deviation = [w ? Math.abs(b[len] - a[len] * ratio) : 0, Math.abs(b[thick] - a[thick] * ratio), 0, 0, 0];
      a.sig.forEach((pointA, j) => {
        const pointB = b.sig[j];
        deviation[2] = Math.max(deviation[2], Math.abs(pointB[0] - pointA[0] * ratio));
        deviation[3] = Math.max(deviation[3], Math.abs(pointB[1] - pointA[1] * ratio));
        deviation[4] = Math.max(deviation[4], Math.abs(pointB[2] - pointA[2] * ratio));
      });
      return deviation;
    };
    // 纵向容差：基线在行内的位置由取整到整像素的 ascent/descent 决定，两个宽度各差最多 0.5px；
    // 行高再按 1/64px 量化，每多一行累积一点
    const lines = new Set(a.sig.map(point => Math.round(point[1] * 100))).size;
    const vertTolerance = 1.05 + lines / 32;
    const fits = (deviation: number[]) =>
      deviation[0] < 0.8 &&
      deviation[1] < vertTolerance &&
      deviation[2] < 0.8 &&
      deviation[3] < vertTolerance &&
      deviation[4] < 0.05;
    const ratio = b.cw / a.cw;
    const scaled = dev(ratio, true);
    if (fits(scaled)) return { keep: true, mode: 'scale' };
    // 固定字号、靠左排的字：字位不变，块宽跟着容器变也没关系（没有 viewBox 时 svg 宽度不影响字形）
    if (fits(dev(1, false))) return { keep: true, mode: 'fixed' };
    return { keep: false, why: 'reflow', dev: scaled.map(v => +v.toFixed(2)) };
  });
}

/** 合并前在两份预览片段里落实 decide 的结论：不保留的还原成原文字，固定像素的去掉 viewBox */
export function finalize(html: string, results: OutlineResult[], verdicts: OutlineVerdict[]) {
  const parser = document.implementation.createHTMLDocument('');
  const div = parser.createElement('div');
  div.innerHTML = html;
  verdicts.forEach((verdict, i) => {
    const svg = div.querySelector(`svg[data-wxc-unit="${i}"]`);
    if (!svg) return;
    if (verdict.keep) {
      if (verdict.mode === 'fixed') svg.removeAttribute('viewBox');
      return;
    }
    // 片段里有这个 svg，说明这个宽度换上了轮廓、结果是 ok 的
    const result = results[i],
      box = svg.parentElement;
    if (!result.ok || !box) return;
    const template = parser.createElement('template');
    template.innerHTML = result.html.replace(/\sdata-wxc-float=""/g, '');
    // 原文里已含被提到 svg 前面的浮动元素，整体换回即可
    if (box.hasAttribute('data-wxc-wrap')) box.replaceWith(template.content);
    else box.replaceChildren(template.content);
  });
  return div.innerHTML;
}
