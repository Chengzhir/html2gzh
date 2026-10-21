import { ID, isHtmlEl, measure, diffBoxes, splitTop, unq, NO_TRANSFORM } from './util.ts';
import { GLYPH_BATCH as BATCH } from './glyphlimits.ts';
import { faceKey } from './fonts.ts';
import { annotateContainerWidths } from './responsive.ts';
import { resolveWebFonts, usesMissing } from './webfonts.ts';
import type { FontPlanRow, GlyphFont, GlyphItem, GlyphRequest, GlyphResponse, GlyphShape, OutlineVerdict } from './types.ts';

// 字体表里勾选的字转为 SVG 路径：字形取自本机字体文件（服务端 /api/glyphs），摆在转换帧里实测的逐字位置上；同位叠一层透明 <text> 供选中复制。
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
/** 样式+字 → 字形、样式+词 → 整词排版结果；跨多次转换复用（改设置重转时不必再问服务端） */
const glyphCache = new Map(), runCache = new Map();

const isFloat = n => n.nodeType === 1 && n.hasAttribute('data-wxc-float');
const f3 = n => String(Math.round(n * 1000) / 1000);
const MISS = { nofont: '无法确定实际使用的字体', webfont: '网页字体的声明与字体文件不匹配', webfile: '无法获取网页字体的文件', notindexed: '这台电脑的字体目录中没有这个字体',
  color: '是彩色字体', shape: '字形排版失败', notdef: '字体中没有这个字', long: '组合符号过多' };
/** 拼成"字体名：原因"计数，同一原因在不同字体上分开记 */
const noteMiss = (notes, kind, ps) => {
  const k = ps ? `${ps}：${MISS[kind] || kind}` : MISS[kind] || kind;
  notes.miss.set(k, (notes.miss.get(k) || 0) + 1);
  notes.kinds.add(kind);
};

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
export const webIn = (stack, web) => web && web.size ? splitTop(stack).map(unq).find(n => web.has(n.toLowerCase())) || '' : '';

function contentBox(win, el) {
  const r = el.getBoundingClientRect(), c = win.getComputedStyle(el);
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
  if (['Top', 'Right', 'Bottom', 'Left'].some(s => c['border' + s + 'Style'] !== 'none' && parseFloat(c['border' + s + 'Width']) > 0)) return false;
  if (c.outlineStyle !== 'none' || c.boxShadow !== 'none' || c.verticalAlign !== 'baseline' || c.position !== 'static') return false;
  if (c.filter !== 'none' || c.mixBlendMode !== 'normal' || c.clipPath !== 'none') return false;
  return [...el.children].every(k => plainInline(win, k));
}
/** 文字本身的继承属性里画不出来的：变形、竖排、小型大写、描边阴影、自动断词插入的连字符等。返回原因代码，可以画返回 '' */
function textWhy(c) {
  if (c.textTransform !== 'none' || c.fontVariantCaps !== 'normal' || (c.fontVariantPosition || 'normal') !== 'normal' || (c.fontVariantAlternates || 'normal') !== 'normal') return 'case';
  if (c.writingMode !== 'horizontal-tb' || c.direction !== 'ltr') return 'dir';
  if (parseFloat(c.webkitTextStrokeWidth || 0) !== 0 || c.textShadow !== 'none' || c.webkitTextFillColor !== c.color) return 'effect';
  if (/^optimizespeed$/i.test(c.textRendering || '') || (c.webkitTextSecurity || 'none') !== 'none' || c.hyphens === 'auto' || !(parseFloat(c.fontSize) > 0) || c.visibility !== 'visible') return 'other';
  return '';
}
const boxWhy = c => c.backgroundClip === 'text' ? 'effect' : c.textOverflow !== 'clip' || (c.webkitLineClamp || 'none') !== 'none' ? 'clip' : '';
const blockOf = (win, el, root) => {
  let a = el;
  while (a !== root && /^inline/.test(win.getComputedStyle(a).display)) a = a.parentElement;
  return a;
};

/** 单元里的文字节点（浮动元素里的不算：它们留在原处，不进轮廓） */
function textNodes(nodes) {
  const out = [];
  const walk = n => {
    if (n.nodeType === 3) { if (n.data) out.push(n); return; }
    if (n.nodeType === 1 && !isFloat(n)) for (const k of n.childNodes) walk(k);
  };
  nodes.forEach(walk);
  return out;
}
const unitText = nodes => [...seg.segment(textNodes(nodes).map(t => t.data).join(''))].map(s => s.segment).filter(s => !INVISIBLE.test(s)).join('').replace(/\s+/g, ' ').trim();
const visibleCount = s => [...seg.segment(s.split(WJ).join(''))].filter(x => visible(x.segment)).length;

/** nodes 能不能整体换成路径：只含文字、无外观的行内元素、零占位浮动；box 是承载它们的块。能换返回 ''，否则返回原因代码 */
function ineligible(win, box, nodes, root) {
  if (!nodes.length) return 'empty';
  const bw = boxWhy(win.getComputedStyle(box));
  if (bw) return bw;
  for (const n of nodes) {
    if (n.nodeType === 3 || n.nodeType === 8) continue;
    if (isFloat(n)) { if (n.textContent.trim()) return 'other'; continue; }
    if (!plainInline(win, n)) return 'inline';
  }
  const texts = textNodes(nodes);
  if (!texts.some(t => [...seg.segment(t.data)].some(s => visible(s.segment)))) return 'empty';
  if (texts.some(t => /[\u00ad\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(t.data))) return 'other';
  const seen = new Set();
  for (const t of texts) {
    const w = textWhy(win.getComputedStyle(t.parentElement));
    if (w) return w;
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
/** 字没转为路径的原因：选单元时的原因代码，加上 outline/decide 的结论代码 */
export const WHY_TEXT = {
  vote: '所在段落中的大部分文字属于没有勾选的行（一个段落整体转换或整体不转换）',
  inline: '所在段落中有带背景、边框或上下标的行内元素',
  deco: '所在段落中有下划线、删除线等装饰线',
  effect: '所在段落中有描边、阴影或背景裁切文字（background-clip: text）',
  case: '所在段落中有大小写变换或小型大写字母（text-transform、font-variant）',
  dir: '所在段落为竖排或从右到左排列',
  clip: '所在的块用省略号截断文字（text-overflow、line-clamp）',
  other: '不支持这种排版结构', empty: '不支持这种排版结构',
  font: '无法获取原稿字体的字形', server: '获取字形失败',
  layout: '转为路径后周围的元素会移位',
  reflow: '换行位置或缩放方式随屏宽变化，路径无法随之调整',
  shaping: '连字或随上下文变化的字形与浏览器的排版结果不一致',
  baseline: '无法准确测量文字基线',
  mismatch: '在其他屏宽下排版结构不同', missing: '在其他屏宽下排版结构不同',
  ineligible: '在其他屏宽下不再符合转换条件',
};

/**
 * 字体表与要转的单元。
 * 行：字体 + 字重 + 是否斜体 + 字号（sizeAt 折算到 335px 正文宽）；作者自己的 svg 里的字不算。
 * 单元：整块，或块容器/弹性容器里的一段行内内容；多数字所在的行勾选了（picked）才转。
 * 返回 { rows, units, skip }。units 是 [{ id, from?, to?, text, rows: { 行键: 字数 } }]，一段行内内容写父块的 id 与 childNodes 下标；
 * 只在主宽度下选一次，另一个宽度按同一组描述去找。skip：勾选了却没进单元的字，行键 → 原因代码 → 字数
 */
/** 要转的单元：一段行内内容写父块的 id 与 childNodes 下标 [from, to) */
export interface UnitDesc { id: string; from?: number; to?: number; text: string; rows: Record<string, number> }
export interface FontPlan {
  rows: FontPlanRow[];
  units: UnitDesc[];
  /** 行键 → 原因代码 → 字数 */
  skip: Map<string, Map<string, number>>;
}
export function planFonts(doc: Document, root: Element, { picked, web, sizeAt }: { picked: Set<string>; web: Set<string>; sizeAt: (el: Element) => number }): FontPlan {
  const win = doc.defaultView;
  const rows = new Map<string, FontPlanRow & { last: Element | null }>(), rowOf = new Map<Text, FontPlanRow>(), cnt = new Map<Text, number>();
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, 4);
  while (walker.nextNode()) {
    const t = walker.currentNode as Text, el = t.parentElement;
    if (!el || el.closest('svg')) continue;
    const n = visibleCount(t.data);
    if (!n) continue;
    range.selectNodeContents(t);
    const c = win.getComputedStyle(el);
    if (!range.getClientRects().length || c.visibility !== 'visible') continue;
    const f = faceKey(c), size = Math.round(sizeAt(el) * 2) / 2;
    const key = `${f.key}|${size}`;
    let r = rows.get(key);
    if (!r) rows.set(key, r = { ...f, face: f.key, key, size, stack: c.fontFamily, stretch: c.fontStretch, web: webIn(c.fontFamily, web), chars: 0, sample: '', last: null });
    r.chars += n; rowOf.set(t, r); cnt.set(t, n);
    // 同一个块里被行内元素切开的几段直接接上（保留原文的空格），换了块才加空格；样例多取一些，显示时由 CSS 省略号截断
    if (r.sample.length < 40) {
      const text = t.data.split(WJ).join('').replace(/\s+/g, ' ');
      const blk = blockOf(win, el, root);
      r.sample = (r.sample && blk !== r.last ? r.sample.trimEnd() + ' ' + text.trimStart() : r.sample + (r.sample ? text : text.trimStart())).slice(0, 40);
      r.last = blk;
    }
  }
  const isPicked = r => picked.has(r.key);
  const list: FontPlanRow[] = [...rows.values()].map(({ last, ...r }) => r);
  if (!list.some(isPicked)) return { rows: list, units: [], skip: new Map() };

  // 每个文字节点的去向：{ unit } 或原因代码。先定的为准：行内块里的字先于外层这一段定下
  const status = new Map();
  const mark = (nodes, s) => { for (const t of textNodes(nodes)) if (rowOf.has(t) && !status.has(t)) status.set(t, s); };
  const vote = nodes => {
    let yes = 0, all = 0;
    for (const t of textNodes(nodes)) { const r = rowOf.get(t); if (r) { all += cnt.get(t); if (isPicked(r)) yes += cnt.get(t); } }
    return all > 0 && yes * 2 >= all;
  };
  const units: UnitDesc[] = [];
  const take = (id: string, nodes: ChildNode[], from?: number) => {
    const counts: Record<string, number> = {};
    for (const t of textNodes(nodes)) { const r = rowOf.get(t); if (r) counts[r.key] = (counts[r.key] || 0) + cnt.get(t); }
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
    if (id && BOX_DISPLAY.test(c.display) && !ineligible(win, el, kids, root) && vote(kids)) { take(id, kids); return; }
    scan(el, /flex|grid/.test(c.display));
  };
  // 子节点按"行内段"分组：块容器里是匿名块，弹性/网格容器里是匿名项。只有整段都是纯文字的才包起来转
  const scan = (el, itemized) => {
    const id = el.getAttribute(ID);
    let run = [], bad = false;
    const flush = () => {
      const from = run.findIndex(n => !isFloat(n)), to = run.length - 1 - [...run].reverse().findIndex(n => !isFloat(n));
      const nodes = from < 0 ? [] : run.slice(from, to + 1);
      if (nodes.length) {
        const why = !id ? 'other' : bad ? 'inline' : ineligible(win, el, nodes, root);
        if (why) mark(nodes, why);
        else if (vote(nodes)) take(id, nodes, [...el.childNodes].indexOf(nodes[0]));
        else mark(nodes, 'vote');
      }
      run = []; bad = false;
    };
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.data.trim() || run.length) run.push(n); continue; }
      if (n.nodeType !== 1) continue;
      const nc = isHtmlEl(n) || n.localName === 'svg' ? win.getComputedStyle(n) : null;
      if (!nc || nc.display === 'none') continue;
      if (isFloat(n) && !itemized) {
        if (n.textContent.trim()) { flush(); visit(n); } else if (run.length) run.push(n);
        continue;
      }
      if (itemized || !/^inline/.test(nc.display)) { flush(); visit(n); continue; }
      if (plainInline(win, n)) { run.push(n); continue; }
      // 有外观的行内元素或行内块：这一段不转；行内块自己的内容另算（它的基线由内容决定，替换后靠逐元素校验兜底）
      bad = true; run.push(n);
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
    const m = skip.get(r.key);
    m.set(s, (m.get(s) || 0) + cnt.get(t));
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

const FEAT = { 'lining-nums': 'lnum', 'oldstyle-nums': 'onum', 'proportional-nums': 'pnum', 'tabular-nums': 'tnum', 'diagonal-fractions': 'frac',
  'stacked-fractions': 'afrc', ordinal: 'ordn', 'slashed-zero': 'zero', jis78: 'jp78', jis83: 'jp83', jis90: 'jp90', jis04: 'jp04',
  simplified: 'smpl', traditional: 'trad', 'full-width': 'fwid', 'proportional-width': 'pwid', ruby: 'ruby' };
function featuresOf(c) {
  const parts = [];
  for (const v of `${c.fontVariantNumeric} ${c.fontVariantEastAsian}`.split(/\s+/)) if (FEAT[v]) parts.push(`"${FEAT[v]}" 1`);
  if (c.fontKerning === 'none') parts.push('"kern" 0');
  if (c.fontFeatureSettings && c.fontFeatureSettings !== 'normal') parts.push(c.fontFeatureSettings);
  return parts.join(', ') || 'normal';
}
const parseColor = s => {
  const m = s.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  return m ? { fill: `rgb(${m[1]},${m[2]},${m[3]})`, a: m[4] == null ? 1 : +m[4] } : { fill: s, a: 1 };
};

/**
 * 内容盒的精确位置与宽度：计算样式里的 padding 是 CSS 值（如 10.05px），布局里却取整到 1/64px，
 * 直接相减会差 1/64px，换上的 svg 就会让弹性列收窄。临时塞一个空的块级子元素量它的框，得到的就是布局值
 */
function exactContentBox(doc, el) {
  const p = doc.createElement('span');
  p.style.cssText = 'display:block;width:auto;height:0;margin:0;padding:0;border:0;float:none';
  el.prepend(p);
  const r = p.getBoundingClientRect();
  p.remove();
  return { x: r.left, y: r.top, w: r.width, h: contentBox(doc.defaultView, el).h };
}

/** 逐字（字素簇）量位置与样式，坐标相对单元内容盒左上角。web：原稿用上的网页字体名；sig：这组网页字体的签名 */
function measureChars(doc, u, { web, sig }) {
  const win = doc.defaultView;
  const cb = exactContentBox(doc, u.box);
  u.w = cb.w; u.h = cb.h;
  const styleOf = new Map();
  const st = el => {
    let s = styleOf.get(el);
    if (s) return s;
    const c = win.getComputedStyle(el);
    let op = 1;
    for (let a = el; a && a !== u.box && a !== u.outer; a = a.parentElement) op *= parseFloat(win.getComputedStyle(a).opacity);
    const col = parseColor(c.color);
    const lang = (el.closest('[lang]') || doc.documentElement).getAttribute('lang') || '';
    s = { size: parseFloat(c.fontSize), ls: parseFloat(c.letterSpacing) || 0, fill: col.fill, alpha: col.a * op, family: c.fontFamily,
      weight: c.fontWeight, style: c.fontStyle, stretch: c.fontStretch, features: featuresOf(c), variations: c.fontVariationSettings,
      lang, synthW: c.fontSynthesisWeight !== 'none', synthS: c.fontSynthesisStyle !== 'none',
      ligatures: c.fontVariantLigatures, spaced: (parseFloat(c.letterSpacing) || 0) !== 0,
      web: webIn(c.fontFamily, web) };
    // 网页字体：可变字体的 opsz 轴随字号变，字形要按字号取；签名区分同名字体的不同文件
    if (s.web) { s.opsz = c.fontOpticalSizing === 'none' ? 0 : s.size; s.wsig = sig; }
    styleOf.set(el, s);
    return s;
  };
  u.chars = [];
  const range = doc.createRange();
  for (const t of textNodes(u.nodes)) {
    for (const { segment, index } of seg.segment(t.data)) {
      if (INVISIBLE.test(segment)) continue;
      range.setStart(t, index); range.setEnd(t, index + segment.length);
      const r = range.getClientRects()[0];
      if (!r || (!r.width && !segment.trim())) {
        // 行末折行处的空格不占位置（没有矩形），但复制出来的文字里要有它，记在前一个字上
        if (!segment.trim() && u.chars.length) u.chars[u.chars.length - 1].trail = true;
        continue;
      }
      u.chars.push({ t, i: index, s: segment, x: r.left - cb.x, y: r.top - cb.y, w: r.width, h: r.height, st: st(t.parentElement), space: !segment.trim() || segment === '\u00a0' });
    }
  }
  u.fail = u.chars.some(c => !c.space) ? baselines(doc, u, cb) : 'empty';
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
    const same = p && Math.abs(c.x - (p.x + p.w)) < 0.6 && c.y < p.y + p.h && p.y < c.y + c.h;
    if (same) cur.push(c); else segs.push(cur = [c]);
  }
  const range = doc.createRange();
  const rectOf = c => { range.setStart(c.t, c.i); range.setEnd(c.t, c.i + c.s.length); return range.getClientRects()[0]; };
  for (const sg of segs) {
    const last = [...sg].reverse().find(c => !c.space);
    if (!last) continue;
    const t = last.t, data = t.data;
    const rest = t.splitText(last.i + last.s.length);
    const mk = doc.createElement('span');
    mk.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
    t.after(mk);
    const base = mk.getBoundingClientRect().bottom - cb.y;
    mk.remove(); rest.remove(); t.data = data;
    const r = rectOf(last);
    if (!r || Math.abs(r.top - cb.y - last.y) > 0.5 || Math.abs(r.height - last.h) > 0.5) return 'baseline';
    for (const c of sg) c.base = base;
  }
  return u.chars.some(c => !c.space && c.base == null) ? 'baseline' : null;
}

const keyOf = s => JSON.stringify([s.family, s.weight, s.style, s.stretch, s.features, s.variations, s.ligatures, s.lang, s.spaced, ...(s.web ? [s.opsz, s.wsig] : [])]);
/**
 * 单元里的词：同一样式、同一字号、首尾相接（同一行、中间没有内边距之类的空隙）的一串非空白字。
 * Chrome 跨元素连排（只换颜色的相邻 span 照样成连字），字号、字距不同或有空隙就断开
 */
function wordsOf(u) {
  const out = [];
  let cur = null, prev = null;
  for (const c of u.chars) {
    if (c.space) { cur = null; prev = c; continue; }
    const k = keyOf(c.st);
    const joined = cur && !prev.space && !prev.trail && k === cur.k && c.st.size === prev.st.size && Math.abs(c.x - (prev.x + prev.w)) < 0.6 && c.base === prev.base;
    if (!joined) out.push(cur = { k, st: c.st, chars: [] });
    cur.chars.push(c);
    prev = c;
  }
  // 太长的（不带空格的长串）按码元数切成几段，各段单独排
  return out.flatMap(w => {
    const parts = [];
    let p = null;
    for (const c of w.chars) {
      if (!p || p.len + c.s.length > BATCH.run) parts.push(p = { k: w.k, st: w.st, chars: [], len: 0 });
      p.chars.push(c); p.len += c.s.length;
    }
    return parts.filter(q => q.chars.length > 1).map(q => ({ ...q, text: q.chars.map(c => c.s).join('') }));
  });
}
/** 一种样式要问的字与词 */
type WantItem = Omit<GlyphItem, 'chars' | 'runs'> & { k: string; chars: Set<string>; runs: Set<string> };
/**
 * 把各单元缺的字形分批问齐；没装 Chrome、字体找不到之类在 notes 里记原因。
 * 用到网页字体时先取字体文件（只取一次）；文件取不到的字体，用到它的单元不转
 */
async function fetchGlyphs(units, ctx, notes) {
  const glyphs: (req: GlyphRequest) => Promise<GlyphResponse> = ctx.glyphs;
  let fonts: GlyphFont[] = [];
  if (units.some(u => !u.fail && u.chars.some(c => !c.space && c.st.web))) {
    ctx.webResolved ??= resolveWebFonts(ctx.webUsed, ctx.fontBytes);
    const r = await ctx.webResolved;
    fonts = r.fonts;
    for (const u of units) if (!u.fail) {
      const c = u.chars.find(c => !c.space && c.st.web && usesMissing(c.st.family, r.missing));
      if (c) { u.fail = 'font'; noteMiss(notes, 'webfile', c.st.web); }
    }
  }
  const want = new Map<string, WantItem>();
  const item = (st): WantItem => {
    const k = keyOf(st);
    let it = want.get(k);
    if (!it) want.set(k, it = { k, family: st.family, weight: st.weight, style: st.style, stretch: st.stretch, features: st.features, variations: st.variations,
      ligatures: st.ligatures, lang: st.lang, spaced: st.spaced, opsz: st.opsz || 0, chars: new Set(), runs: new Set() });
    return it;
  };
  for (const u of units) if (!u.fail) {
    for (const c of u.chars) {
      if (c.space) continue;
      const k = keyOf(c.st);
      if (glyphCache.has(k + '\u0000' + c.s)) continue;
      // 叠了一长串组合符号的字服务端不收，按缺字处理
      if (c.s.length > BATCH.char) { glyphCache.set(k + '\u0000' + c.s, { miss: 'long' }); continue; }
      item(c.st).chars.add(c.s);
    }
    u.words = wordsOf(u);
    for (const w of u.words) if (!runCache.has(w.k + '\u0001' + w.text)) item(w.st).runs.add(w.text);
  }
  const parts: (GlyphItem & { k: string; len?: number })[] = [];
  for (const it of want.values()) {
    const chars = [...it.chars], runs = [...it.runs];
    for (let i = 0; i < chars.length; i += BATCH.chars) parts.push({ ...it, chars: chars.slice(i, i + BATCH.chars), runs: [] });
    for (let i = 0, p = null; i < runs.length; i++) {
      if (!p || p.runs.length >= BATCH.runs || p.len + runs[i].length > BATCH.runChars) parts.push(p = { ...it, chars: [], runs: [], len: 0 });
      p.runs.push(runs[i]); p.len += runs[i].length;
    }
  }
  const map = (res: GlyphResponse, gs: GlyphShape['g']) => gs.map(([p, x, y]) => [res.paths[p], x, y]);
  for (let i = 0; i < parts.length;) {
    const batch = [];
    for (let n = 0, r = 0, rc = 0; i < parts.length && (!batch.length || batch.length < BATCH.items && n + parts[i].chars.length <= BATCH.chars
      && r + parts[i].runs.length <= BATCH.runs && rc + (parts[i].len || 0) <= BATCH.runChars); i++) {
      batch.push(parts[i]); n += parts[i].chars.length; r += parts[i].runs.length; rc += parts[i].len || 0;
    }
    const res = await glyphs({ items: batch.map(({ len, k, ...it }) => it), fonts });
    batch.forEach((it, j) => {
      const k = it.k;
      it.chars.forEach((ch, q) => {
        const g = res.items[j].chars[q];
        glyphCache.set(k + '\u0000' + ch, g.miss ? { miss: g.miss, ps: g.ps } : {
          face: res.faces[g.f], adv: g.adv, g: map(res, g.g), halt: g.halt && { adv: g.halt.adv, g: map(res, g.halt.g) },
        });
      });
      it.runs.forEach((w, q) => {
        const v = res.items[j].runs[q];
        runCache.set(k + '\u0001' + w, Array.isArray(v) ? v.map(o => o && { adv: o.adv, g: map(res, o.g) }) : v);
      });
    });
  }
  for (const u of units) if (!u.fail) {
    for (const c of u.chars) {
      if (c.space) continue;
      const g = glyphCache.get(keyOf(c.st) + '\u0000' + c.s);
      if (!g || g.miss) { u.fail = 'font'; noteMiss(notes, g ? g.miss : 'nofont', g && g.ps); break; }
      c.g = g;
    }
    if (u.fail) continue;
    // 整词排版和逐字不同的（连字、上下文变体）换上整词的字形：簇首拿整簇，连字的后续字为空
    for (const w of u.words) {
      const v = runCache.get(w.k + '\u0001' + w.text);
      if (v === 'bad' || v === undefined || v && v.length !== w.chars.length) { u.fail = 'shaping'; u.detail = [w.text.slice(0, 20)]; break; }
      if (!v) continue;
      w.chars.forEach((c, i) => { if (v[i]) c.g = { face: c.g.face, adv: v[i].adv, g: v[i].g }; });
    }
  }
}
// Windows 上 Chrome 的假粗体分两种。本机字体由 DirectWrite 模拟（实测 SimSun 26–100px）：笔画横向加粗约 2.4% 字号、纵向约 1.9%，
// 描边只能取一个值，用两者平均；12px 及以下 SimSun 用内嵌点阵，不加粗。网页字体由 Skia 描边加粗：描边宽 = 字号 × 比例，
// 比例在 9px 时 1/24、36px 起 1/32，中间线性插值（实测 Arial 200px 与 size/32 的 SVG 描边相同）
const fakeBold = size => size <= 12 ? 0 : size * 0.0215;
const webBold = size => size * (size <= 9 ? 1 / 24 : size >= 36 ? 1 / 32 : 1 / 24 + (size - 9) / 27 * (1 / 32 - 1 / 24));
const ITALIC_SKEW = 0.25;
/**
 * 合成粗体、斜体：本机字体按字形面的字重差超过 200 判断；网页字体照 Blink 的规则，要求字重 ≥ 600 而 @font-face 的字重上限低于 600、
 * 要求斜体而声明的不是斜体才合成。返回描边宽（px，0 为不加粗）与是否倾斜
 */
function synth(st, face) {
  const w = parseInt(st.weight, 10);
  const bold = !st.synthW ? 0 : face.web ? (w >= 600 && face.weight < 600 ? webBold(st.size) : 0)
    : w - face.weight > 200 ? fakeBold(st.size) : 0;
  return { bold, ital: st.synthS && st.style !== 'normal' && !face.italic };
}

/** 单元 → <svg>：同色同字号的字拼成一条 path（变换只写一次，各字首点按字位偏移），外加透明复制层 */
function buildSvg(doc, u, o) {
  const groups = new Map();
  for (const c of u.chars) {
    // 连字的后续字没有字形（画在簇首那个字上）
    if (c.space || !c.g.g.length) continue;
    // scale：@font-face 的 size-adjust，字形按它缩放
    const g = c.g, s = c.st.size * (g.face.scale || 1) / g.face.upem;
    // 全角标点被挤压成半宽时用 halt 字形：看实测宽度更接近哪个步进
    const full = g.adv * s + c.st.ls;
    const v = g.halt && Math.abs(c.w - (g.halt.adv * s + c.st.ls)) + 0.2 < Math.abs(c.w - full) ? g.halt : g;
    const { bold, ital } = synth(c.st, g.face);
    const key = [c.st.fill, f3(c.st.alpha), s, bold, ital].join('|');
    let grp = groups.get(key);
    if (!grp) groups.set(key, grp = { st: c.st, s, bold, ital, x0: c.x, y0: c.base, d: '' });
    const k = ital ? ITALIC_SKEW : 0;
    for (const [p, gx, gy] of v.g) {
      // 组变换把 (u,v) 映到 (x0 + s·u + k·s·v, y0 − s·v)；倾斜要绕各字自己的原点，所以首点横向扣掉 k·v0
      const v0 = (grp.y0 - c.base) / s + gy;
      const u0 = (c.x - grp.x0) / s + gx - k * v0;
      grp.d += `M${Math.round(u0 + p.m[0])} ${Math.round(v0 + p.m[1])}${p.d}`;
    }
  }
  const svg = doc.createElementNS(SVG, 'svg');
  // 高度交给行盒：Chrome 的行高按 1/64px 四舍五入、height 却向下截断，比例写法的固定高度在别的宽度下总会差 1/64px，
  // 几个轮廓累积起来就把下文挤动。所以 svg 做成第一行里的行内块，比一行矮（不撑高行盒），其余各行由 <br> + 连接符撑出，
  // 字形画在 svg 的溢出区里。宽度加 1/256px：截断和四舍五入都落回原值
  const lines = new Set(u.chars.filter(c => !c.space).map(c => Math.round(c.base * 100))).size;
  const lh = parseFloat(doc.defaultView.getComputedStyle(u.box).lineHeight);
  const h1 = Math.max(1, Math.min(lh > 0 ? lh : Infinity, u.h / lines) - 1 / 32);
  u.lines = lines;
  const bw = f3(u.w + 1 / 256), bh = f3(h1);
  svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', u.d.text.slice(0, 500));
  svg.setAttribute('style', `display:inline-block;vertical-align:top;width:${bw}px;height:${bh}px;overflow:visible`);
  for (const grp of groups.values()) {
    const p = doc.createElementNS(SVG, 'path');
    const sk = grp.ital ? ITALIC_SKEW * grp.s : 0;
    p.setAttribute('transform', `matrix(${+grp.s.toPrecision(6)} 0 ${+sk.toPrecision(6)} ${-+grp.s.toPrecision(6)} ${f3(grp.x0)} ${f3(grp.y0)})`);
    p.setAttribute('fill', grp.st.fill);
    if (grp.st.alpha < 0.999) p.setAttribute('fill-opacity', f3(grp.st.alpha));
    if (grp.bold) {
      p.setAttribute('stroke', grp.st.fill);
      p.setAttribute('stroke-width', f3(grp.bold / grp.s));
      if (grp.st.alpha < 0.999) p.setAttribute('stroke-opacity', f3(grp.st.alpha));
    }
    p.setAttribute('d', grp.d);
    svg.appendChild(p);
  }
  if (o.svgCopy) for (const line of copyLines(u)) svg.appendChild(line(doc));
  return svg;
}

/** 透明复制层：每行一个 <text>，逐字给 x；空格写成不换行空格，免得被 SVG 的空白折叠吃掉、错开后面的位置 */
function copyLines(u) {
  const lines = [];
  let cur = null, pend = false;
  for (const c of u.chars) {
    const base = c.base != null ? c.base : cur && Math.abs(c.y - cur.y) < 1 ? cur.base : null;
    if (base == null) continue;
    if (!cur || Math.abs(base - cur.base) > 0.5 || c.st.size !== cur.size || c.x < cur.right - 0.6) lines.push(cur = { base, size: c.st.size, family: c.st.family, y: c.y, xs: [], text: '', right: 0 });
    // 折行处被吃掉的空格补在下一行行首、和首字同一位置：放在上一行末尾会伸出盒子
    if (pend) { cur.xs.push(f3(c.x)); cur.text += '\u00a0'; pend = false; }
    for (let i = 0; i < c.s.length; i++) cur.xs.push(f3(c.x));
    cur.text += c.space ? '\u00a0'.repeat(c.s.length) : c.s;
    cur.right = c.x + c.w;
    if (c.trail) pend = true;
  }
  return lines.filter(l => l.text.trim()).map(l => doc => {
    const t = doc.createElementNS(SVG, 'text');
    t.setAttribute('x', l.xs.join(' '));
    t.setAttribute('y', f3(l.base));
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
const originalHtml = u => u.d.from == null ? u.box.innerHTML : u.nodes.map(n => n.nodeType === 3 ? esc(n.data) : n.nodeType === 1 ? n.outerHTML : '').join('');

/**
 * 在一次转换的 DOM 上把 descs 描述的单元换成轮廓。逐元素校验布局不变，坏的单元单独还原。
 * 返回每个单元的 { ok, fail, cw, w, h, sig, html }，供两个宽度比对；notes 收集字体缺失等原因。
 */
export async function outline(doc, root, descs, ctx, notes) {
  const win = doc.defaultView;
  const base = measure(doc, true);
  const noTf = doc.createElement('style');
  noTf.setAttribute('data-wxc-tool', ''); noTf.textContent = NO_TRANSFORM;
  doc.head.appendChild(noTf);
  const units = descs.map(d => locate(doc, root, d));
  const fonts = { web: ctx.web || new Set(), sig: ctx.webSig || '' };
  for (const u of units) if (!u.fail) { u.html = originalHtml(u); u.orig = [...u.nodes]; wrapRun(doc, u); measureChars(doc, u, fonts); u.cw = nearestCw(win, u.box, root); }
  if (units.some(u => !u.fail)) {
    try { await fetchGlyphs(units, ctx, notes); } catch (e) { notes.server = e.message; for (const u of units) if (!u.fail) u.fail = 'server'; }
  }
  const apply = u => {
    if (u.d.from != null && u.box === u.outer) wrapRun(doc, u);
    const rest = [];
    for (let i = 1; i < u.lines; i++) rest.push(doc.createElement('br'), doc.createTextNode(WJ));
    u.box.replaceChildren(...u.orig.filter(n => isFloat(n)), u.svg, ...rest);
  };
  const revert = u => { u.box.replaceChildren(...u.orig); unwrapRun(u); };
  for (const u of units) {
    if (u.fail) { unwrapRun(u); continue; }
    u.svg = buildSvg(doc, u, ctx.o);
    u.svg.setAttribute('data-wxc-unit', String(descs.indexOf(u.d)));
    apply(u);
  }
  noTf.remove();
  const applied = units.filter(u => !u.fail);
  // 被换掉的内层元素不在新的测量里，diffBoxes 会跳过它们；其余所有元素都不许动，连 1/64px 也不行（会翻转下文的整像素取整）
  const moved = () => {
    const now = measure(doc, true);
    return diffBoxes(base, now, 0.01).map(id => { const a = base.get(id), b = now.get(id); return `${id} ${['x', 'y', 'w', 'h'].map(k => (b[k] - a[k]).toFixed(4)).join(',')}`; });
  };
  if (applied.length && moved().length) {
    // 逐个放回：哪个单元一换就让别的元素挪位，就把它还原成文字
    applied.forEach(revert);
    for (const u of applied) { apply(u); const m = moved(); if (m.length) { revert(u); u.fail = 'layout'; u.detail = m.slice(0, 3); } }
  }
  if (applied.length) annotateContainerWidths(doc, root);
  return units.map(u => u.fail ? { ok: false, fail: u.fail, detail: u.detail } : {
    ok: true, cw: u.cw, w: u.w, h: u.h, html: u.html, chars: u.chars.filter(c => !c.space).length,
    sig: u.chars.filter(c => !c.space).map(c => [c.x, c.base, c.st.size]), bytes: u.svg.outerHTML.length - u.html.length,
  });
}

/** 两个宽度的结果比一比：逐字位置按容器宽度等比缩放的写 viewBox（随屏宽缩放），完全不变的去掉 viewBox（固定像素） */
export function decide(ra, rb): OutlineVerdict[] {
  return ra.map((a, i): OutlineVerdict => {
    const b = rb[i];
    if (!a.ok) return { keep: false, why: a.fail, detail: a.detail };
    if (!b || !b.ok) return { keep: false, why: b ? b.fail : 'missing', detail: b && b.detail, side: 'B' };
    if (a.chars !== b.chars) return { keep: false, why: 'reflow' };
    // 最大偏差（px）：盒宽、盒高、逐字横坐标、基线、字号
    const dev = (r, w) => {
      const d = [w ? Math.abs(b.w - a.w * r) : 0, Math.abs(b.h - a.h * r), 0, 0, 0];
      a.sig.forEach((p, j) => { const q = b.sig[j]; d[2] = Math.max(d[2], Math.abs(q[0] - p[0] * r)); d[3] = Math.max(d[3], Math.abs(q[1] - p[1] * r)); d[4] = Math.max(d[4], Math.abs(q[2] - p[2] * r)); });
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
    if (v.keep) { if (v.mode === 'fixed') svg.removeAttribute('viewBox'); return; }
    const t = parser.createElement('template');
    t.innerHTML = results[i].html.replace(/\sdata-wxc-float=""/g, '');
    // 原文里已含被提到 svg 前面的浮动元素，整体换回即可
    const box = svg.parentElement;
    if (box.hasAttribute('data-wxc-wrap')) box.replaceWith(t.content); else box.replaceChildren(t.content);
  });
  return div.innerHTML;
}
