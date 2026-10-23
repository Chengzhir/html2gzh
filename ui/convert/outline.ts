import { ID, isHtmlEl, measure, diffBoxes, splitTop, unq, NO_TRANSFORM } from './util.ts';
import { GLYPH_BATCH as BATCH, SNAP_BOX, SNAP_INHERITED, SNAP_INLINE, SNAP_TAGS } from './glyphapi.ts';
import { faceKey } from './fonts.ts';
import { annotateContainerWidths } from './responsive.ts';
import { resolveWebFonts, usesMissing } from './webfonts.ts';
import { CodedError, msg } from './types.ts';
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
} from './types.ts';

// 字体表里勾选的字转为 SVG 路径：单元连同计算样式拍成快照交给服务端（/api/glyphs），本机的 Chrome 照样排版、核对逐字位置后打印，
// 取回它实际画出的字形，同位叠一层透明 <text> 供选中复制。
// 单元 = 一个块元素的全部内容，或块容器/弹性容器里的一段行内内容（包进一个块级 span 后整体替换）。
// 两个宽度各转一遍后，只保留"逐字位置按宽度等比缩放（或完全不变）"的单元，其余还原成文字。
const SVG = 'http://www.w3.org/2000/svg';
const WJ = '\u2060';
// 零宽字符（零宽空格、连接符、BOM）不画、不进复制层：它们没有字形，送去取字形只会让整段判成缺字
const INVISIBLE = /^[\u200b-\u200d\u2060\ufeff]+$/;
const visible = s => !!s.trim() && !INVISIBLE.test(s);
// 列表项不整块转：项目符号（尤其 inside 的）排在第一行里，会把 svg 往右推
const BOX_DISPLAY = /^(block|flow-root)$/;
const REPLACED = /^(img|svg|video|canvas|iframe|object|embed|input|math|audio|picture|select|textarea|button)$/;
const CLEAR = /^(transparent|rgba\(0, 0, 0, 0\))$/;
const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
/** 一个单元取回的字形：[轮廓, 字体单位 → 内容盒 px 的矩阵, 填充色, 不透明度, 描边宽]，或没转成的原因 */
type Drawn =
  | { fail?: undefined; glyphs: [GlyphPath, number[], string, number, number][]; fills: GlyphFill[] }
  | { fail: string; detail?: string };
/** 快照 → 取回的字形；跨多次转换复用（改设置重转时，没变的单元不必再问服务端） */
const unitCache = new Map<string, Drawn>();

const isFloat = n => n.nodeType === 1 && n.hasAttribute('data-wxc-float');
const f3 = n => String(Math.round(n * 1000) / 1000);
/** 缺字形的原因（文案 miss.<kind>）按"原因|字体名"计数，同一原因在不同字体上分开记 */
const noteMiss = (notes, kind: string, ps?: string) => {
  const k = `${kind}|${ps || ''}`;
  notes.miss.set(k, (notes.miss.get(k) || 0) + 1);
  notes.kinds.add(kind);
};
/** notes.miss → 每条"字体名：原因"的文案 */
export const missMsgs = (miss: Map<string, number>): Msg[] =>
  [...miss.keys()].map(k => {
    const [kind, ps] = k.split('|');
    return ps ? msg('miss.named', { name: ps, why: msg('miss.' + kind) }) : msg('miss.' + kind);
  });

/**
 * 原稿真正用上的网页字体（@font-face）的字体名。用到它们的字转为路径时，字形取自文章引用的字体文件（见 webfonts.ts）。
 * 要在摘掉样式表之前调用。排在前面的本机字体已经覆盖了所有字时，网页字体不会被加载，状态停在 unloaded；
 * 加载失败的是 error，原稿里显示的也是回落字体，都不算
 */
export function webFamilies(doc) {
  const out = new Set();
  for (const f of doc.fonts) if (f.status === 'loaded' || f.status === 'loading') out.add(unq(f.family).toLowerCase());
  return out;
}
/** 字体栈里原稿用上的网络字体名，没有则为空串 */
export const webIn = (stack, web) =>
  web && web.size
    ? splitTop(stack)
        .map(unq)
        .find(n => web.has(n.toLowerCase())) || ''
    : '';

function contentBox(win, el) {
  const r = el.getBoundingClientRect(),
    c = win.getComputedStyle(el);
  const [bl, br, bt, bb] = ['Left', 'Right', 'Top', 'Bottom'].map(s => parseFloat(c['border' + s + 'Width']));
  const [pl, pr, pt, pb] = ['Left', 'Right', 'Top', 'Bottom'].map(s => parseFloat(c['padding' + s]));
  return { x: r.left + bl + pl, y: r.top + bt + pt, w: r.width - bl - br - pl - pr, h: r.height - bt - bb - pt - pb };
}

/** 单元里只允许没有自己外观的行内元素：字形之外的东西（背景、边框、下划线、上下标）画不进轮廓 */
function plainInline(win, el) {
  if (!isHtmlEl(el)) return false;
  if (el.localName === 'br' || el.localName === 'wbr') return true;
  if (REPLACED.test(el.localName) || isFloat(el)) return false;
  const c = win.getComputedStyle(el);
  if (c.display !== 'inline' || !CLEAR.test(c.backgroundColor) || c.backgroundImage !== 'none') return false;
  if (
    ['Top', 'Right', 'Bottom', 'Left'].some(
      s => c['border' + s + 'Style'] !== 'none' && parseFloat(c['border' + s + 'Width']) > 0,
    )
  )
    return false;
  if (c.outlineStyle !== 'none' || c.boxShadow !== 'none' || c.verticalAlign !== 'baseline' || c.position !== 'static')
    return false;
  if (c.filter !== 'none' || c.mixBlendMode !== 'normal' || c.clipPath !== 'none') return false;
  return [...el.children].every(k => plainInline(win, k));
}
/**
 * 文字本身的继承属性里画不出来的：描边、阴影，遮住的密码字，以及透明复制层对不上位置的排法（侧向书写模式、竖排的斜体）。
 * 字形由 Chrome 自己排、自己画，变形、小型大写、从右到左、竖排里侧转的字都照样转。返回原因代码，可以画返回 ''
 */
function textWhy(c: CSSStyleDeclaration) {
  if (parseFloat(c.webkitTextStrokeWidth || '0') !== 0 || c.textShadow !== 'none') return 'effect';
  if (
    !/^(horizontal-tb|vertical-rl|vertical-lr)$/.test(c.writingMode) ||
    (c.writingMode !== 'horizontal-tb' && c.fontStyle !== 'normal') ||
    (c.getPropertyValue('-webkit-text-security') || 'none') !== 'none' ||
    !(parseFloat(c.fontSize) > 0) ||
    c.visibility !== 'visible'
  )
    return 'other';
  return '';
}
/** 块本身的原因：背景裁切文字、省略号截断、分栏，以及缩放（zoom 下快照里的计算值与布局不成比例） */
const boxWhy = (c: CSSStyleDeclaration, el: Element) =>
  c.backgroundClip === 'text'
    ? 'effect'
    : c.textOverflow !== 'clip' || (c.webkitLineClamp || 'none') !== 'none'
      ? 'clip'
      : c.columnCount !== 'auto' || c.columnWidth !== 'auto' || ('currentCSSZoom' in el && el.currentCSSZoom !== 1)
        ? 'other'
        : '';
const blockOf = (win, el, root) => {
  let a = el;
  while (a !== root && /^inline/.test(win.getComputedStyle(a).display)) a = a.parentElement;
  return a;
};

/** 单元里的文字节点（浮动元素里的不算：它们留在原处，不进轮廓） */
function textNodes(nodes) {
  const out = [];
  const walk = n => {
    if (n.nodeType === 3) {
      if (n.data) out.push(n);
      return;
    }
    if (n.nodeType === 1 && !isFloat(n)) for (const k of n.childNodes) walk(k);
  };
  nodes.forEach(walk);
  return out;
}
const unitText = nodes =>
  [
    ...seg.segment(
      textNodes(nodes)
        .map(t => t.data)
        .join(''),
    ),
  ]
    .map(s => s.segment)
    .filter(s => !INVISIBLE.test(s))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const visibleCount = s => [...seg.segment(s.split(WJ).join(''))].filter(x => visible(x.segment)).length;

/** nodes 能不能整体换成路径：只含文字、无外观的行内元素、零占位浮动；box 是承载它们的块。能换返回 ''，否则返回原因代码 */
function ineligible(win, box, nodes, root) {
  if (!nodes.length) return 'empty';
  const bw = boxWhy(win.getComputedStyle(box), box);
  if (bw) return bw;
  for (const n of nodes) {
    if (n.nodeType === 3 || n.nodeType === 8) continue;
    if (isFloat(n)) {
      if (n.textContent.trim()) return 'other';
      continue;
    }
    if (!plainInline(win, n)) return 'inline';
  }
  const texts = textNodes(nodes);
  if (!texts.some(t => [...seg.segment(t.data)].some(s => visible(s.segment)))) return 'empty';
  const seen = new Set();
  const wm = win.getComputedStyle(box).writingMode;
  for (const t of texts) {
    const c = win.getComputedStyle(t.parentElement);
    const w = textWhy(c);
    if (w) return w;
    if (c.writingMode !== wm || ('currentCSSZoom' in t.parentElement && t.parentElement.currentCSSZoom !== 1))
      return 'other';
    // 下划线等装饰会从祖先块传到子孙文字上
    for (let a = t.parentElement; a && a !== root.parentElement && !seen.has(a); a = a.parentElement) {
      seen.add(a);
      const c = win.getComputedStyle(a);
      if (c.textDecorationLine !== 'none') return 'deco';
      if (c.backgroundClip === 'text') return 'effect';
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
}
export function planFonts(
  doc: Document,
  root: Element,
  { picked, web, sizeAt }: { picked: Set<string>; web: Set<string>; sizeAt: (el: Element) => number },
): FontPlan {
  const win = doc.defaultView;
  const rows = new Map<string, FontPlanRow & { last: Element | null }>(),
    rowOf = new Map<Text, FontPlanRow>(),
    cnt = new Map<Text, number>();
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, 4);
  while (walker.nextNode()) {
    const t = walker.currentNode as Text,
      el = t.parentElement;
    if (!el || el.closest('svg')) continue;
    const n = visibleCount(t.data);
    if (!n) continue;
    range.selectNodeContents(t);
    const c = win.getComputedStyle(el);
    if (!range.getClientRects().length || c.visibility !== 'visible') continue;
    const f = faceKey(c),
      size = Math.round(sizeAt(el) * 2) / 2;
    const key = `${f.key}|${size}`;
    let r = rows.get(key);
    if (!r)
      rows.set(
        key,
        (r = {
          ...f,
          face: f.key,
          key,
          size,
          stack: c.fontFamily,
          stretch: c.fontStretch,
          web: webIn(c.fontFamily, web),
          chars: 0,
          sample: '',
          last: null,
        }),
      );
    r.chars += n;
    rowOf.set(t, r);
    cnt.set(t, n);
    // 同一个块里被行内元素切开的几段直接接上（保留原文的空格），换了块才加空格；样例多取一些，显示时由 CSS 省略号截断
    if (r.sample.length < 40) {
      const text = t.data.split(WJ).join('').replace(/\s+/g, ' ');
      const blk = blockOf(win, el, root);
      r.sample = (
        r.sample && blk !== r.last
          ? r.sample.trimEnd() + ' ' + text.trimStart()
          : r.sample + (r.sample ? text : text.trimStart())
      ).slice(0, 40);
      r.last = blk;
    }
  }
  const isPicked = r => picked.has(r.key);
  const list: FontPlanRow[] = [...rows.values()].map(({ last, ...r }) => r);
  if (!list.some(isPicked)) return { rows: list, units: [], skip: new Map() };

  // 每个文字节点的去向：{ unit } 或原因代码。先定的为准：行内块里的字先于外层这一段定下
  const status = new Map();
  const mark = (nodes, s) => {
    for (const t of textNodes(nodes)) if (rowOf.has(t) && !status.has(t)) status.set(t, s);
  };
  const vote = nodes => {
    let yes = 0,
      all = 0;
    for (const t of textNodes(nodes)) {
      const r = rowOf.get(t);
      if (r) {
        all += cnt.get(t);
        if (isPicked(r)) yes += cnt.get(t);
      }
    }
    return all > 0 && yes * 2 >= all;
  };
  const units: UnitDesc[] = [];
  const take = (id: string, nodes: ChildNode[], from?: number) => {
    const counts: Record<string, number> = {};
    for (const t of textNodes(nodes)) {
      const r = rowOf.get(t);
      if (r) counts[r.key] = (counts[r.key] || 0) + cnt.get(t);
    }
    const d: UnitDesc = { id, text: unitText(nodes), rows: counts };
    if (from != null) Object.assign(d, { from, to: from + nodes.length });
    mark(nodes, { unit: units.length });
    units.push(d);
  };
  const visit = el => {
    if (!isHtmlEl(el) || REPLACED.test(el.localName)) return;
    const c = win.getComputedStyle(el);
    if (c.display === 'none' || c.display === 'contents') return;
    const id = el.getAttribute(ID);
    const kids = [...el.childNodes];
    if (id && BOX_DISPLAY.test(c.display) && !ineligible(win, el, kids, root) && vote(kids)) {
      take(id, kids);
      return;
    }
    scan(el, /flex|grid/.test(c.display));
  };
  // 子节点按"行内段"分组：块容器里是匿名块，弹性/网格容器里是匿名项。只有整段都是纯文字的才包起来转
  const scan = (el, itemized) => {
    const id = el.getAttribute(ID);
    let run = [],
      bad = false;
    const flush = () => {
      const from = run.findIndex(n => !isFloat(n)),
        to = run.length - 1 - [...run].reverse().findIndex(n => !isFloat(n));
      const nodes = from < 0 ? [] : run.slice(from, to + 1);
      if (nodes.length) {
        const why = !id ? 'other' : bad ? 'inline' : ineligible(win, el, nodes, root);
        if (why) mark(nodes, why);
        else if (vote(nodes)) take(id, nodes, [...el.childNodes].indexOf(nodes[0]));
        else mark(nodes, 'vote');
      }
      run = [];
      bad = false;
    };
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        if (n.data.trim() || run.length) run.push(n);
        continue;
      }
      if (n.nodeType !== 1) continue;
      const nc = isHtmlEl(n) || n.localName === 'svg' ? win.getComputedStyle(n) : null;
      if (!nc || nc.display === 'none') continue;
      if (isFloat(n) && !itemized) {
        if (n.textContent.trim()) {
          flush();
          visit(n);
        } else if (run.length) run.push(n);
        continue;
      }
      if (itemized || !/^inline/.test(nc.display)) {
        flush();
        visit(n);
        continue;
      }
      if (plainInline(win, n)) {
        run.push(n);
        continue;
      }
      // 有外观的行内元素或行内块：这一段不转；行内块自己的内容另算（它的基线由内容决定，替换后靠逐元素校验兜底）
      bad = true;
      run.push(n);
      if (nc.display !== 'inline') visit(n);
    }
    flush();
  };
  visit(root);

  const skip = new Map<string, Map<string, number>>();
  for (const [t, r] of rowOf) {
    const s = status.get(t) || 'other';
    if (!isPicked(r) || typeof s !== 'string') continue;
    if (!skip.has(r.key)) skip.set(r.key, new Map());
    const m = skip.get(r.key),
      w = whyCode(s);
    m.set(w, (m.get(w) || 0) + cnt.get(t));
  }
  return { rows: list, units, skip };
}
/** 按描述在本次转换的 DOM 里找到单元；文字对不上或在这个宽度下不再合格就返回原因 */
function locate(doc, root, d) {
  const win = doc.defaultView;
  const box = root.querySelector(`[${ID}="${d.id}"]`) || (root.getAttribute(ID) === d.id ? root : null);
  if (!box) return { d, fail: 'missing' };
  const nodes = d.from == null ? [...box.childNodes] : [...box.childNodes].slice(d.from, d.to);
  if (unitText(nodes) !== d.text) return { d, fail: 'mismatch' };
  if (ineligible(win, box, nodes, root)) return { d, fail: 'ineligible' };
  return { d, box, nodes, outer: box };
}

/** 一段行内内容包进块级 span：在块容器里等同匿名块，在弹性容器里等同匿名弹性项 */
function wrapRun(doc, u) {
  if (u.d.from == null) return;
  const w = doc.createElement('span');
  w.setAttribute('data-wxc-wrap', '');
  w.style.setProperty('display', 'block');
  u.nodes[0].before(w);
  for (const n of u.nodes) w.appendChild(n);
  u.box = w;
}
function unwrapRun(u) {
  if (u.d.from == null || u.box === u.outer) return;
  u.box.replaceWith(...u.box.childNodes);
  u.box = u.outer;
}

/**
 * 内容盒的精确位置与宽度：计算样式里的 padding 是 CSS 值（如 10.05px），布局里却取整到 1/64px，
 * 直接相减会差 1/64px，换上的 svg 就会让弹性列收窄。临时塞一个空的块级子元素量它的框，得到的就是布局值
 */
function exactContentBox(doc, el) {
  const win = doc.defaultView;
  const vertical = win.getComputedStyle(el).writingMode !== 'horizontal-tb';
  const p = doc.createElement('span');
  // 竖排时块的起始边在右（vertical-rl）或左（vertical-lr），空块是一条竖线：它的高就是内容盒的行向长度，左边是坐标原点
  p.style.cssText = `display:block;${vertical ? 'width:0;height:auto' : 'width:auto;height:0'};margin:0;padding:0;border:0;float:none`;
  el.prepend(p);
  const r = p.getBoundingClientRect();
  p.remove();
  const cb = contentBox(win, el);
  return vertical ? { x: r.left, y: r.top, w: cb.w, h: r.height } : { x: r.left, y: r.top, w: r.width, h: cb.h };
}

/**
 * 逐字（字素簇）量位置，坐标相对单元内容盒的原点（竖排 rl 在右上角，与服务端的取法相同）。web：原稿用上的网页字体名
 */
function measureChars(doc, u, web: Set<string>) {
  const win = doc.defaultView;
  const cb = exactContentBox(doc, u.box);
  u.w = cb.w;
  u.h = cb.h;
  u.vertical = win.getComputedStyle(u.box).writingMode !== 'horizontal-tb';
  u.rtl = win.getComputedStyle(u.box).direction === 'rtl';
  // 每个字记下字号（透明复制层用）与原稿用上的网页字体（缺文件时整段不转）
  const styleOf = new Map<Element, { size: number; family: string; web: string }>();
  const st = (el: Element) => {
    let s = styleOf.get(el);
    if (!s) {
      const c = win.getComputedStyle(el);
      styleOf.set(el, (s = { size: parseFloat(c.fontSize), family: c.fontFamily, web: webIn(c.fontFamily, web) }));
    }
    return s;
  };
  u.chars = [];
  const range = doc.createRange();
  for (const t of textNodes(u.nodes)) {
    for (const { segment, index } of seg.segment(t.data)) {
      if (INVISIBLE.test(segment)) continue;
      range.setStart(t, index);
      range.setEnd(t, index + segment.length);
      const r = range.getClientRects()[0];
      if (!r || (!(u.vertical ? r.height : r.width) && !segment.trim())) {
        // 行末折行处的空格不占位置（没有矩形），但复制出来的文字里要有它，记在前一个字上
        if (!segment.trim() && u.chars.length) u.chars[u.chars.length - 1].trail = true;
        continue;
      }
      const c = {
        t,
        i: index,
        s: segment,
        x: r.left - cb.x,
        y: r.top - cb.y,
        w: r.width,
        h: r.height,
        st: st(t.parentElement),
        space: !segment.trim() || segment === '\u00a0',
      };
      // 竖排的"基线"是列的中线：直立的字在字框里左右居中（实测与字框中线差不到 0.3px）
      if (u.vertical) Object.assign(c, { base: c.x + c.w / 2 });
      u.chars.push(c);
    }
  }
  u.fail = !u.chars.some(c => !c.space) ? 'empty' : u.vertical ? null : baselines(doc, u, cb);
}
/**
 * 基线：同一行里首尾相接的字分成一段，在段末最后一个非空白字后面临时插一个零尺寸行内块，它的底边就是这一行的基线。
 * 标记插在本来就断行（或不断行）的位置之后、宽度为零，不改变断行；插入前后字的纵向位置不变才采信。
 */
function baselines(doc, u, cb) {
  const segs = [];
  let cur = null;
  for (const c of u.chars) {
    const p = cur && cur[cur.length - 1];
    // 首尾相接：从左到右的字接在前一个字的右边，从右到左的接在左边
    const same =
      p && (Math.abs(c.x - (p.x + p.w)) < 0.6 || Math.abs(c.x + c.w - p.x) < 0.6) && c.y < p.y + p.h && p.y < c.y + c.h;
    if (same) cur.push(c);
    else segs.push((cur = [c]));
  }
  const range = doc.createRange();
  const rectOf = c => {
    range.setStart(c.t, c.i);
    range.setEnd(c.t, c.i + c.s.length);
    return range.getClientRects()[0];
  };
  for (const sg of segs) {
    const last = [...sg].reverse().find(c => !c.space);
    if (!last) continue;
    const t = last.t,
      data = t.data;
    const rest = t.splitText(last.i + last.s.length);
    const mk = doc.createElement('span');
    mk.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
    t.after(mk);
    const base = mk.getBoundingClientRect().bottom - cb.y;
    mk.remove();
    rest.remove();
    t.data = data;
    const r = rectOf(last);
    if (!r || Math.abs(r.top - cb.y - last.y) > 0.5 || Math.abs(r.height - last.h) > 0.5) return 'baseline';
    for (const c of sg) c.base = base;
  }
  return u.chars.some(c => !c.space && c.base == null) ? 'baseline' : null;
}

/**
 * 单元的快照：服务端照它重排版。块写明继承属性与几项块级属性；子孙元素只写与父元素不同的继承属性、与初始值不同的行内属性；
 * 零占位的浮动元素不带（它们留在原处，不进轮廓）。chars 是逐字的框，下标按快照里全部文字连起来计
 */
function snapshot(win: Window, u): { unit: GlyphUnit; elements: number; text: number } {
  const bc = win.getComputedStyle(u.box);
  const style: Record<string, string> = {};
  for (const k of [...SNAP_INHERITED, ...SNAP_BOX]) {
    const v = bc.getPropertyValue(k);
    if (v) style[k] = v;
  }
  const base = new Map<Text, number>();
  let text = 0,
    elements = 0;
  const walk = (pc: CSSStyleDeclaration, nodes: ChildNode[]): SnapNode[] => {
    const out: SnapNode[] = [];
    for (const n of nodes) {
      if (n.nodeType === 3) {
        const t = n as Text;
        if (!t.data) continue;
        base.set(t, text);
        text += t.data.length;
        out.push(t.data);
      } else if (n.nodeType === 1 && !isFloat(n)) {
        const el = n as Element,
          c = win.getComputedStyle(el);
        const s: Record<string, string> = {};
        for (const k of SNAP_INHERITED) {
          const v = c.getPropertyValue(k);
          if (v && v !== pc.getPropertyValue(k)) s[k] = v;
        }
        for (const [k, init] of Object.entries(SNAP_INLINE)) {
          const v = c.getPropertyValue(k);
          if (v && v !== init) s[k] = v;
        }
        elements++;
        const node: SnapElement = {
          tag: SNAP_TAGS.includes(el.localName) ? el.localName : 'span',
          style: s,
          kids: walk(c, [...el.childNodes]),
        };
        if (el.hasAttribute('lang')) node.lang = el.getAttribute('lang');
        out.push(node);
      }
    }
    return out;
  };
  // 一段行内内容此时已包进块级 span（u.box），子节点就是这一段
  const kids = walk(bc, [...u.box.childNodes]);
  const chars: SnapChar[] = u.chars.map(c => {
    const at = base.get(c.t);
    if (at == null) throw new Error('snapshot');
    return [at + c.i, at + c.i + c.s.length, c.x, c.y, c.w, c.h];
  });
  const lang = (u.box.closest('[lang]') || u.box.ownerDocument.documentElement).getAttribute('lang') || '';
  return { unit: { w: u.w, h: u.h, style, lang, kids, chars }, elements, text };
}

/**
 * 各单元的字形分批问服务端，结果记在 u.drawn。用到网页字体时先取字体文件（只取一次）；文件取不到的字体，用到它的单元不转。
 * 没装 Chrome 之类的错误整体抛出，由 outline 记下
 */
async function fetchOutlines(win: Window, units, ctx, notes) {
  const glyphs: (req: GlyphRequest) => Promise<GlyphResponse> = ctx.glyphs;
  let fonts: GlyphFont[] = [];
  if (units.some(u => !u.fail && u.chars.some(c => !c.space && c.st.web))) {
    ctx.webResolved ??= resolveWebFonts(ctx.webUsed, ctx.fontBytes);
    const r = await ctx.webResolved;
    fonts = r.fonts;
    for (const u of units)
      if (!u.fail) {
        const c = u.chars.find(c => !c.space && c.st.web && usesMissing(c.st.family, r.missing));
        if (c) {
          u.fail = 'font';
          noteMiss(notes, 'webfile', c.st.web);
        }
      }
  }
  const dpr = win.devicePixelRatio || 1;
  const sig = JSON.stringify([dpr, ctx.webSig || '']);
  const todo: { u; key: string; unit: GlyphUnit; elements: number; text: number }[] = [];
  for (const u of units) {
    if (u.fail) continue;
    let snap: ReturnType<typeof snapshot>;
    try {
      snap = snapshot(win, u);
    } catch {
      u.fail = 'other';
      continue;
    }
    if (snap.elements > BATCH.elements || snap.text > BATCH.text || snap.unit.chars.length > BATCH.chars) {
      u.fail = 'other';
      continue;
    }
    const key = sig + JSON.stringify(snap.unit);
    if (unitCache.has(key)) u.drawn = unitCache.get(key);
    else todo.push({ u, key, ...snap });
  }
  for (let i = 0; i < todo.length;) {
    const batch: typeof todo = [];
    for (
      let e = 0, t = 0, c = 0;
      i < todo.length &&
      (!batch.length ||
        (batch.length < BATCH.units &&
          e + todo[i].elements <= BATCH.elements &&
          t + todo[i].text <= BATCH.text &&
          c + todo[i].unit.chars.length <= BATCH.chars));
      i++
    ) {
      batch.push(todo[i]);
      e += todo[i].elements;
      t += todo[i].text;
      c += todo[i].unit.chars.length;
    }
    const res = await glyphs({ dpr, fonts, units: batch.map(b => b.unit) });
    batch.forEach((b, j) => {
      const r = res.units[j];
      const drawn: Drawn = r.fail
        ? { fail: r.fail, detail: r.detail }
        : { glyphs: r.glyphs.map(([p, m, fill, a, w]) => [res.paths[p], m, fill, a, w]), fills: r.fills };
      if (unitCache.size > 4000) unitCache.delete(unitCache.keys().next().value);
      unitCache.set(b.key, drawn);
      b.u.drawn = drawn;
    });
  }
  // 服务端的原因 → 本模块的原因代码（文案 why.<代码>）：排版对不上是 relayout，读不出轮廓归到 font 并记下 miss.render
  const WHY = { mismatch: 'relayout', color: 'color', effect: 'effect', render: 'font' };
  for (const u of units)
    if (!u.fail && u.drawn.fail) {
      u.fail = WHY[u.drawn.fail] || 'font';
      if (u.fail === 'font') noteMiss(notes, 'render');
      if (u.drawn.detail) u.detail = [u.drawn.detail];
    }
}

/**
 * 单元的 <svg> 空壳，先放进版面量位置，再由 drawSvg 画字。
 * 高度交给行盒：Chrome 的行高按 1/64px 四舍五入、height 却向下截断，比例写法的固定高度在别的宽度下总会差 1/64px，
 * 几个轮廓累积起来就把下文挤动。所以 svg 做成第一行里的行内块，比一行矮（不撑高行盒），其余各行由 <br> + 连接符撑出，
 * 字形画在 svg 的溢出区里。行向长度加 1/256px：截断和四舍五入都落回原值。竖排时"行"是列，宽高对调
 */
function shellSvg(doc, u) {
  const lines = new Set(u.chars.filter(c => !c.space).map(c => Math.round(c.base * 100))).size;
  const lh = parseFloat(doc.defaultView.getComputedStyle(u.box).lineHeight);
  u.lines = lines;
  u.thick = Math.max(1, Math.min(lh > 0 ? lh : Infinity, (u.vertical ? u.w : u.h) / lines) - 1 / 32);
  const svg = doc.createElementNS(SVG, 'svg');
  sizeSvg(svg, u, 0);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', u.d.text.slice(0, 500));
  return svg;
}
/** inset：svg 在行向上离内容盒起始边的距离（首行缩进等），行向长度扣掉它，免得伸出内容盒 */
function sizeSvg(svg, u, inset: number) {
  const len = f3((u.vertical ? u.h : u.w) - inset + 1 / 256),
    th = f3(u.thick);
  const [bw, bh] = u.vertical ? [th, len] : [len, th];
  svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
  svg.setAttribute('style', `display:inline-block;vertical-align:top;width:${bw}px;height:${bh}px;overflow:visible`);
}

/**
 * 放进版面后的空壳里画字：服务端给的字形按颜色、不透明度、描边与矩阵的线性部分分组，每组拼成一条 path
 * （变换只写一次，各字首点按自己的原点偏移），外加透明复制层。字形坐标相对内容盒，减去 svg 相对内容盒的偏移（竖排的列、首行缩进）
 */
function drawSvg(doc, u, o) {
  const svg = u.svg,
    r = svg.getBoundingClientRect(),
    cb = exactContentBox(doc, u.box);
  const near0 = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v);
  u.ox = near0(r.left - cb.x);
  u.oy = near0(r.top - cb.y);
  sizeSvg(svg, u, u.vertical ? u.oy : u.ox);
  const groups = new Map<string, { m: number[]; fill: string; alpha: number; w: number; d: string }>();
  for (const [p, m, fill, alpha, w] of u.drawn.glyphs) {
    const [a, b, c, d] = m,
      e = m[4] - u.ox,
      f = m[5] - u.oy;
    const det = a * d - b * c;
    if (!det) continue;
    const key = [fill, alpha, w, a, b, c, d].join('|');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { m: [a, b, c, d, e, f], fill, alpha, w, d: '' }));
    // 组矩阵 (a b c d E F) 把字体单位 (x, y) 映到 (E + a·x + c·y, F + b·x + d·y)：这个字的原点在组里的坐标是 (e − E, f − F) 反解出来的
    const dx = e - g.m[4],
      dy = f - g.m[5];
    const x0 = (d * dx - c * dy) / det,
      y0 = (a * dy - b * dx) / det;
    g.d += `M${Math.round(x0 + p.m[0])} ${Math.round(y0 + p.m[1])}${p.d}`;
  }
  for (const g of groups.values()) {
    const p = doc.createElementNS(SVG, 'path');
    p.setAttribute('transform', `matrix(${g.m.slice(0, 4).join(' ')} ${f3(g.m[4])} ${f3(g.m[5])})`);
    p.setAttribute('fill', g.fill);
    if (g.alpha < 0.999) p.setAttribute('fill-opacity', f3(g.alpha));
    if (g.w) {
      p.setAttribute('stroke', g.fill);
      p.setAttribute('stroke-width', f3(g.w));
      if (g.alpha < 0.999) p.setAttribute('stroke-opacity', f3(g.alpha));
    }
    p.setAttribute('d', g.d);
    svg.appendChild(p);
  }
  for (const fl of u.drawn.fills) {
    const p = doc.createElementNS(SVG, 'path');
    if (u.ox || u.oy) p.setAttribute('transform', `translate(${f3(-u.ox)} ${f3(-u.oy)})`);
    p.setAttribute('fill', fl.fill);
    if (fl.alpha < 0.999) p.setAttribute('fill-opacity', f3(fl.alpha));
    if (fl.evenOdd) p.setAttribute('fill-rule', 'evenodd');
    p.setAttribute('d', fl.d);
    svg.appendChild(p);
  }
  if (o.svgCopy) {
    for (const line of u.vertical ? copyColumns(u) : copyLines(u)) svg.appendChild(line(doc));
    keepInside(svg, cb, u.vertical);
  }
  return svg;
}
/**
 * 透明复制层不许伸出内容盒：从右到左的行首字以右边对准盒子右边，Chrome 给 <text> 量出的框比字框多出约 1px，
 * 内容结构检测会把它判为溢出。逐行量，伸出去多少就往回挪多少（再留 0.25px）；字是透明的，只影响选中时高亮的位置
 */
function keepInside(svg: SVGSVGElement, cb: { x: number; y: number; w: number; h: number }, vertical: boolean) {
  const lo = vertical ? cb.y : cb.x,
    hi = lo + (vertical ? cb.h : cb.w);
  const attr = vertical ? 'y' : 'x';
  for (const t of svg.querySelectorAll('text')) {
    const r = t.getBoundingClientRect();
    const a = vertical ? r.top : r.left,
      b = vertical ? r.bottom : r.right;
    const d = a < lo ? lo - a + 0.25 : b > hi ? hi - b - 0.25 : 0;
    if (d)
      t.setAttribute(
        attr,
        t
          .getAttribute(attr)
          .split(' ')
          .map(v => f3(+v + d))
          .join(' '),
      );
  }
}

/**
 * 透明复制层：每行一个 <text>，逐字给 x；空格写成不换行空格，免得被 SVG 的空白折叠吃掉、错开后面的位置。
 * 从右到左的段落里 <text> 继承 rtl，每个字以右边对准 x，所以 x 取字框的右边；字的先后照原文，复制出来的顺序不变
 */
function copyLines(u) {
  const lines = [];
  let cur = null,
    pend = false;
  const xOf = c => f3((u.rtl ? c.x + c.w : c.x) - u.ox);
  for (const c of u.chars) {
    const base = c.base != null ? c.base : cur && Math.abs(c.y - cur.y) < 1 ? cur.base : null;
    if (base == null) continue;
    if (!cur || Math.abs(base - cur.base) > 0.5 || c.st.size !== cur.size || (!u.rtl && c.x < cur.right - 0.6))
      lines.push((cur = { base, size: c.st.size, family: c.st.family, y: c.y, xs: [], text: '', right: 0 }));
    // 折行处被吃掉的空格补在下一行行首、和首字同一位置：放在上一行末尾会伸出盒子
    if (pend) {
      cur.xs.push(xOf(c));
      cur.text += '\u00a0';
      pend = false;
    }
    for (let i = 0; i < c.s.length; i++) cur.xs.push(xOf(c));
    cur.text += c.space ? '\u00a0'.repeat(c.s.length) : c.s;
    cur.right = c.x + c.w;
    if (c.trail) pend = true;
  }
  return lines
    .filter(l => l.text.trim())
    .map(l => doc => {
      const t = doc.createElementNS(SVG, 'text');
      t.setAttribute('x', l.xs.join(' '));
      t.setAttribute('y', f3(l.base - u.oy));
      t.setAttribute('font-size', f3(l.size));
      t.setAttribute('fill-opacity', '0');
      t.textContent = l.text;
      return t;
    });
}
/**
 * 竖排的透明复制层：每列一个 <text>，逐字给 x（列中线）、y（字框上沿）。svg 从单元的块继承竖排，
 * 竖排的 <text> 以中线定横向位置、以字的上沿定纵向位置，透明的字逐个落在原来的字框里
 */
function copyColumns(u) {
  const cols = [];
  let cur = null,
    pend = false;
  for (const c of u.chars) {
    if (!cur || Math.abs(c.base - cur.base) > 0.5 || c.st.size !== cur.size || c.y < cur.bottom - 0.6)
      cols.push((cur = { base: c.base, size: c.st.size, xs: [], ys: [], text: '', bottom: 0 }));
    const at = (n: number) => {
      for (let i = 0; i < n; i++) {
        cur.xs.push(f3(c.base - u.ox));
        cur.ys.push(f3(c.y - u.oy));
      }
    };
    if (pend) {
      at(1);
      cur.text += '\u00a0';
      pend = false;
    }
    at(c.s.length);
    cur.text += c.space ? '\u00a0'.repeat(c.s.length) : c.s;
    cur.bottom = c.y + c.h;
    if (c.trail) pend = true;
  }
  return cols
    .filter(l => l.text.trim())
    .map(l => doc => {
      const t = doc.createElementNS(SVG, 'text');
      t.setAttribute('x', l.xs.join(' '));
      t.setAttribute('y', l.ys.join(' '));
      t.setAttribute('font-size', f3(l.size));
      t.setAttribute('fill-opacity', '0');
      t.textContent = l.text;
      return t;
    });
}
/** svg 的 cqw 基准：从它的父级（单元的块）往上找最近的查询容器，和 annotateContainerWidths 的取法一致 */
const nearestCw = (win, box, root) => {
  let a = box;
  while (a && a !== root && win.getComputedStyle(a).containerType === 'normal') a = a.parentElement;
  return contentBox(win, a || root).w;
};
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const originalHtml = u =>
  u.d.from == null
    ? u.box.innerHTML
    : u.nodes.map(n => (n.nodeType === 3 ? esc(n.data) : n.nodeType === 1 ? n.outerHTML : '')).join('');

/**
 * 在一次转换的 DOM 上把 descs 描述的单元换成轮廓。逐元素校验布局不变，坏的单元单独还原。
 * 返回每个单元的 { ok, fail, cw, w, h, sig, html }，供两个宽度比对；notes 收集字体缺失等原因。
 */
export async function outline(doc, root, descs, ctx, notes) {
  const win = doc.defaultView;
  const base = measure(doc, true);
  const noTf = doc.createElement('style');
  noTf.setAttribute('data-wxc-tool', '');
  noTf.textContent = NO_TRANSFORM;
  doc.head.appendChild(noTf);
  const units = descs.map(d => locate(doc, root, d));
  const web = ctx.web || new Set();
  for (const u of units)
    if (!u.fail) {
      u.html = originalHtml(u);
      u.orig = [...u.nodes];
      wrapRun(doc, u);
      measureChars(doc, u, web);
      u.cw = nearestCw(win, u.box, root);
    }
  if (units.some(u => !u.fail)) {
    try {
      await fetchOutlines(win, units, ctx, notes);
    } catch (e) {
      notes.server =
        e instanceof CodedError ? msg(e.key, e.params) : msg('common.raw', { msg: String((e && e.message) || e) });
      for (const u of units) if (!u.fail) u.fail = 'server';
    }
  }
  const apply = u => {
    if (u.d.from != null && u.box === u.outer) wrapRun(doc, u);
    const rest = [];
    for (let i = 1; i < u.lines; i++) rest.push(doc.createElement('br'), doc.createTextNode(WJ));
    u.box.replaceChildren(...u.orig.filter(n => isFloat(n)), u.svg, ...rest);
  };
  const revert = u => {
    u.box.replaceChildren(...u.orig);
    unwrapRun(u);
  };
  for (const u of units) {
    if (u.fail) {
      unwrapRun(u);
      continue;
    }
    u.svg = shellSvg(doc, u);
    u.svg.setAttribute('data-wxc-unit', String(descs.indexOf(u.d)));
    apply(u);
  }
  // 全部换上之后再量各 svg 的位置、画字：前面的单元换上后，后面单元的块可能挪位，但 svg 相对自己内容盒的偏移不变
  for (const u of units) if (!u.fail) drawSvg(doc, u, ctx.o);
  noTf.remove();
  const applied = units.filter(u => !u.fail);
  // 被换掉的内层元素不在新的测量里，diffBoxes 会跳过它们；其余所有元素都不许动，连 1/64px 也不行（会翻转下文的整像素取整）
  const moved = () => {
    const now = measure(doc, true);
    return diffBoxes(base, now, 0.01).map(id => {
      const a = base.get(id),
        b = now.get(id);
      return `${id} ${['x', 'y', 'w', 'h'].map(k => (b[k] - a[k]).toFixed(4)).join(',')}`;
    });
  };
  if (applied.length && moved().length) {
    // 逐个放回：哪个单元一换就让别的元素挪位，就把它还原成文字
    applied.forEach(revert);
    for (const u of applied) {
      apply(u);
      const m = moved();
      if (m.length) {
        revert(u);
        u.fail = 'layout';
        u.detail = m.slice(0, 3);
      }
    }
  }
  if (applied.length) annotateContainerWidths(doc, root);
  return units.map(u =>
    u.fail
      ? { ok: false, fail: u.fail, detail: u.detail }
      : {
          ok: true,
          cw: u.cw,
          w: u.w,
          h: u.h,
          html: u.html,
          vertical: u.vertical,
          chars: u.chars.filter(c => !c.space).length,
          // 相对 svg 的 [行向位置, 行（列）的位置, 字号]
          sig: u.chars
            .filter(c => !c.space)
            .map(c => (u.vertical ? [c.y - u.oy, c.base - u.ox, c.st.size] : [c.x - u.ox, c.base - u.oy, c.st.size])),
          bytes: u.svg.outerHTML.length - u.html.length,
        },
  );
}

/** 两个宽度的结果比一比：逐字位置按容器宽度等比缩放的写 viewBox（随屏宽缩放），完全不变的去掉 viewBox（固定像素） */
export function decide(ra, rb): OutlineVerdict[] {
  return ra.map((a, i): OutlineVerdict => {
    const b = rb[i];
    if (!a.ok) return { keep: false, why: a.fail, detail: a.detail };
    if (!b || !b.ok) return { keep: false, why: b ? b.fail : 'missing', detail: b && b.detail, side: 'B' };
    if (a.chars !== b.chars || a.vertical !== b.vertical) return { keep: false, why: 'reflow' };
    // 最大偏差（px）：行向长度、块向长度、逐字的行向位置、基线（竖排为列中线）、字号。
    // 横排的行向长度是盒宽，竖排是盒高；w 为 false 时不比行向长度
    const [len, thick] = a.vertical ? ['h', 'w'] : ['w', 'h'];
    const dev = (r, w) => {
      const d = [w ? Math.abs(b[len] - a[len] * r) : 0, Math.abs(b[thick] - a[thick] * r), 0, 0, 0];
      a.sig.forEach((p, j) => {
        const q = b.sig[j];
        d[2] = Math.max(d[2], Math.abs(q[0] - p[0] * r));
        d[3] = Math.max(d[3], Math.abs(q[1] - p[1] * r));
        d[4] = Math.max(d[4], Math.abs(q[2] - p[2] * r));
      });
      return d;
    };
    // 纵向容差：基线在行内的位置由取整到整像素的 ascent/descent 决定，两个宽度各差最多 0.5px；
    // 行高再按 1/64px 量化，每多一行累积一点
    const lines = new Set(a.sig.map(p => Math.round(p[1] * 100))).size;
    const tv = 1.05 + lines / 32;
    const fits = d => d[0] < 0.8 && d[1] < tv && d[2] < 0.8 && d[3] < tv && d[4] < 0.05;
    const r = b.cw / a.cw;
    const ds = dev(r, true);
    if (fits(ds)) return { keep: true, mode: 'scale' };
    // 固定字号、靠左排的字：字位不变，块宽跟着容器变也没关系（没有 viewBox 时 svg 宽度不影响字形）
    if (fits(dev(1, false))) return { keep: true, mode: 'fixed' };
    return { keep: false, why: 'reflow', dev: ds.map(v => +v.toFixed(2)) };
  });
}

/** 合并前在两份预览片段里落实 decide 的结论：不保留的还原成原文字，固定像素的去掉 viewBox */
export function finalize(html: string, results, verdicts: OutlineVerdict[]) {
  const parser = document.implementation.createHTMLDocument('');
  const div = parser.createElement('div');
  div.innerHTML = html;
  verdicts.forEach((v, i) => {
    const svg = div.querySelector(`svg[data-wxc-unit="${i}"]`);
    if (!svg) return;
    if (v.keep) {
      if (v.mode === 'fixed') svg.removeAttribute('viewBox');
      return;
    }
    const t = parser.createElement('template');
    t.innerHTML = results[i].html.replace(/\sdata-wxc-float=""/g, '');
    // 原文里已含被提到 svg 前面的浮动元素，整体换回即可
    const box = svg.parentElement;
    if (box.hasAttribute('data-wxc-wrap')) box.replaceWith(t.content);
    else box.replaceChildren(t.content);
  });
  return div.innerHTML;
}
