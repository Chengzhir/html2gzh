import { ID, isHtmlEl, measure, diffBoxes, splitTop } from './util.js';
import { faceKey, faceDefault } from './fonts.js';
import { annotateContainerWidths } from './responsive.js';

// 大字转 SVG 轮廓：字形取自本机字体文件（服务端 /api/glyphs），摆在转换帧里实测的逐字位置上；同位叠一层透明 <text> 供选中复制。
// 单元 = 一个块元素的全部内容，或块容器/弹性容器里的一段行内内容（包进一个块级 span 后整体替换）。
// 两个宽度各转一遍后，只保留"逐字位置按宽度等比缩放（或完全不变）"的单元，其余还原成文字。
const SVG = 'http://www.w3.org/2000/svg';
const REF_W = 335;
const NO_TF = '*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
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
const unq = s => s.trim().replace(/^["']|["']$/g, '');
const MISS = { nofont: '浏览器没给出字体', webfont: '网络字体', notindexed: '不在本机字体目录', color: '彩色字体', shape: '排版出错', notdef: '字体里没有这个字', long: '组合符号过多' };
const noteMiss = (notes, kind, ps) => { const k = ps ? `${ps} ${MISS[kind] || kind}` : MISS[kind] || kind; notes.miss.set(k, (notes.miss.get(k) || 0) + 1); };

/**
 * 原稿真正用上的网络字体（@font-face）。轮廓只能画本机字体，用了网络字体的字画出来是回落字体，不是原设计，留成文字。
 * 要在摘掉样式表之前调用（之后它们就从 document.fonts 里消失了）。排在前面的本机字体已经覆盖了所有字时，
 * 网络字体不会被加载，状态停在 unloaded；加载失败的是 error，原稿里显示的也是回落字体，都不算
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
/** 文字本身的继承属性：变形、竖排、小型大写、描边阴影、自动断词插入的连字符都画不出来 */
const textOk = c => c.textTransform === 'none' && c.writingMode === 'horizontal-tb' && c.direction === 'ltr'
  && c.fontVariantCaps === 'normal' && (c.fontVariantPosition || 'normal') === 'normal' && (c.fontVariantAlternates || 'normal') === 'normal'
  && !/^optimizespeed$/i.test(c.textRendering || '') && (c.webkitTextSecurity || 'none') === 'none' && parseFloat(c.webkitTextStrokeWidth || 0) === 0
  && c.textShadow === 'none' && c.hyphens !== 'auto' && c.webkitTextFillColor === c.color && parseFloat(c.fontSize) > 0 && c.visibility === 'visible';
const boxOk = c => c.textOverflow === 'clip' && (c.webkitLineClamp || 'none') === 'none' && c.backgroundClip !== 'text';
const blockOf = (win, el, root) => {
  let a = el;
  while (a !== root && /^inline/.test(win.getComputedStyle(a).display)) a = a.parentElement;
  return a;
};
/** 文中用到的每套字：字数、字号范围（折算到 335px 正文宽）、样例，供设置面板逐套选择。作者自己的 svg 里的字不算（不转） */
export function listFaces(doc, root) {
  const win = doc.defaultView;
  const rootW = contentBox(win, root).w;
  const rows = new Map();
  const walker = doc.createTreeWalker(root, 4);
  const range = doc.createRange();
  while (walker.nextNode()) {
    const t = walker.currentNode, el = t.parentElement;
    if (!el || el.closest('svg')) continue;
    const text = t.data.split(WJ).join('').replace(/\s+/g, ' ');
    const n = [...seg.segment(text)].filter(s => visible(s.segment)).length;
    if (!n) continue;
    range.selectNodeContents(t);
    const c = win.getComputedStyle(el);
    if (!range.getClientRects().length || c.visibility !== 'visible') continue;
    const f = faceKey(c);
    let r = rows.get(f.key);
    if (!r) rows.set(f.key, r = { ...f, stack: c.fontFamily, stretch: c.fontStretch, chars: 0, min: Infinity, max: 0, sample: '', outlined: 0 });
    const px = parseFloat(c.fontSize) * REF_W / rootW;
    r.chars += n; r.min = Math.min(r.min, px); r.max = Math.max(r.max, px);
    // 同一个块里被行内元素切开的几段直接接上（保留原文的空格），换了块才加空格；样例多取一些，显示时由 CSS 省略号截断
    if (r.sample.length < 40) {
      const blk = blockOf(win, el, root);
      r.sample = (r.sample && blk !== r.last ? r.sample.trimEnd() + ' ' + text.trimStart() : r.sample + (r.sample ? text : text.trimStart())).slice(0, 40);
      r.last = blk;
    }
  }
  return [...rows.values()].sort((a, b) => b.max - a.max).map(({ last, ...r }) => ({ ...r, min: Math.round(r.min), max: Math.round(r.max) }));
}

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

/** nodes 能不能整体换成轮廓：只含文字、无外观的行内元素、零占位浮动；box 是承载它们的块 */
function eligible(win, box, nodes, root) {
  if (!nodes.length || !boxOk(win.getComputedStyle(box))) return false;
  for (const n of nodes) {
    if (n.nodeType === 3 || n.nodeType === 8) continue;
    if (isFloat(n)) { if (n.textContent.trim()) return false; continue; }
    if (!plainInline(win, n)) return false;
  }
  const texts = textNodes(nodes);
  if (!texts.some(t => [...seg.segment(t.data)].some(s => visible(s.segment)))) return false;
  if (texts.some(t => /[\u00ad\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(t.data))) return false;
  const seen = new Set();
  for (const t of texts) {
    if (!textOk(win.getComputedStyle(t.parentElement))) return false;
    // 下划线等装饰会从祖先块传到子孙文字上
    for (let a = t.parentElement; a && a !== root.parentElement && !seen.has(a); a = a.parentElement) {
      seen.add(a);
      const c = win.getComputedStyle(a);
      if (c.textDecorationLine !== 'none' || c.backgroundClip === 'text') return false;
    }
  }
  return true;
}

/** 每个字按它那套字的选择（全部 / 只转大字 / 保留文字）投票，多数要转才整段转；字号折算到 335px 正文宽，两个转换宽度下结论一致 */
function wanted(win, nodes, o, rootW, web) {
  let yes = 0, all = 0;
  for (const t of textNodes(nodes)) {
    const c = win.getComputedStyle(t.parentElement);
    const f = faceKey(c);
    const pick = o.faces[f.key] || faceDefault(f.family);
    const hit = !webIn(c.fontFamily, web) && (pick === 'all' || pick === 'big' && parseFloat(c.fontSize) * REF_W / rootW >= o.svgMin - 0.01);
    for (const { segment } of seg.segment(t.data)) {
      if (!visible(segment)) continue;
      all++; if (hit) yes++;
    }
  }
  return all > 0 && yes * 2 >= all;
}
/**
 * 选单元。返回描述 [{ id, from?, to?, text }]：整块写 { id }，一段行内内容写 { id: 父块, from, to }（childNodes 下标）。
 * 只在主宽度下选一次，另一个宽度按同一组描述去找，保证两边结构一致。
 */
export function selectUnits(doc, root, o, web) {
  const win = doc.defaultView;
  const rootW = contentBox(win, root).w;
  const out = [];
  const ok = (box, nodes) => eligible(win, box, nodes, root) && wanted(win, nodes, o, rootW, web);
  const visit = el => {
    if (!isHtmlEl(el) || REPLACED.test(el.localName)) return;
    const c = win.getComputedStyle(el);
    if (c.display === 'none' || c.display === 'contents') return;
    const id = el.getAttribute(ID);
    const kids = [...el.childNodes];
    if (id && BOX_DISPLAY.test(c.display) && ok(el, kids)) { out.push({ id, text: unitText(kids) }); return; }
    scan(el, /flex|grid/.test(c.display));
  };
  // 子节点按"行内段"分组：块容器里是匿名块，弹性/网格容器里是匿名项。只有整段都是纯文字的才包起来转
  const scan = (el, itemized) => {
    const id = el.getAttribute(ID);
    let run = [], bad = false;
    const flush = () => {
      const from = run.findIndex(n => !isFloat(n)), to = run.length - 1 - [...run].reverse().findIndex(n => !isFloat(n));
      const nodes = from < 0 ? [] : run.slice(from, to + 1);
      if (id && !bad && nodes.length && ok(el, nodes)) {
        const i0 = [...el.childNodes].indexOf(nodes[0]);
        out.push({ id, from: i0, to: i0 + nodes.length, text: unitText(nodes) });
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
  return out;
}
/** 按描述在本次转换的 DOM 里找到单元；文字对不上或在这个宽度下不再合格就返回原因 */
function locate(doc, root, d) {
  const win = doc.defaultView;
  const box = root.querySelector(`[${ID}="${d.id}"]`) || (root.getAttribute(ID) === d.id ? root : null);
  if (!box) return { d, fail: 'missing' };
  const nodes = d.from == null ? [...box.childNodes] : [...box.childNodes].slice(d.from, d.to);
  if (unitText(nodes) !== d.text) return { d, fail: 'mismatch' };
  if (!eligible(win, box, nodes, root)) return { d, fail: 'ineligible' };
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

/** 逐字（字素簇）量位置与样式，坐标相对单元内容盒左上角 */
function measureChars(doc, u, web) {
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
    s = { face: faceKey(c).key, size: parseFloat(c.fontSize), ls: parseFloat(c.letterSpacing) || 0, fill: col.fill, alpha: col.a * op, family: c.fontFamily,
      weight: c.fontWeight, style: c.fontStyle, stretch: c.fontStretch, features: featuresOf(c), variations: c.fontVariationSettings,
      lang, synthW: c.fontSynthesisWeight !== 'none', synthS: c.fontSynthesisStyle !== 'none',
      ligatures: c.fontVariantLigatures, spaced: (parseFloat(c.letterSpacing) || 0) !== 0,
      web: webIn(c.fontFamily, web) };
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

const keyOf = s => JSON.stringify([s.family, s.weight, s.style, s.stretch, s.features, s.variations, s.ligatures, s.lang, s.spaced]);
// 每次请求的上限，比服务端（lib/glyphs.mjs 的 LIMITS）略紧
const BATCH = { items: 250, chars: 4000, char: 16, runs: 1200, run: 200, runChars: 16000 };
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
/** 把各单元缺的字形分批问齐；没装 Chrome、字体找不到之类在 notes 里记原因 */
async function fetchGlyphs(units, glyphs, notes) {
  for (const u of units) if (!u.fail) {
    const c = u.chars.find(c => !c.space && c.st.web);
    if (c) { u.fail = 'font'; noteMiss(notes, 'webfont', c.st.web); }
  }
  const want = new Map();
  const item = st => {
    const k = keyOf(st);
    let it = want.get(k);
    if (!it) want.set(k, it = { family: st.family, weight: st.weight, style: st.style, stretch: st.stretch, features: st.features, variations: st.variations,
      ligatures: st.ligatures, lang: st.lang, spaced: st.spaced, chars: new Set(), runs: new Set() });
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
  const parts = [];
  for (const it of want.values()) {
    const chars = [...it.chars], runs = [...it.runs];
    for (let i = 0; i < chars.length; i += BATCH.chars) parts.push({ ...it, chars: chars.slice(i, i + BATCH.chars), runs: [] });
    for (let i = 0, p = null; i < runs.length; i++) {
      if (!p || p.runs.length >= BATCH.runs || p.len + runs[i].length > BATCH.runChars) parts.push(p = { ...it, chars: [], runs: [], len: 0 });
      p.runs.push(runs[i]); p.len += runs[i].length;
    }
  }
  const map = (res, gs) => gs.map(([p, x, y]) => [res.paths[p], x, y]);
  for (let i = 0; i < parts.length;) {
    const batch = [];
    for (let n = 0, r = 0, rc = 0; i < parts.length && (!batch.length || batch.length < BATCH.items && n + parts[i].chars.length <= BATCH.chars
      && r + parts[i].runs.length <= BATCH.runs && rc + (parts[i].len || 0) <= BATCH.runChars); i++) {
      batch.push(parts[i]); n += parts[i].chars.length; r += parts[i].runs.length; rc += parts[i].len || 0;
    }
    const res = await glyphs({ items: batch.map(({ len, ...it }) => it) });
    batch.forEach((it, j) => {
      const k = keyOf(it);
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
// Windows 上 Chrome 的假粗体（实测 SimSun 26–100px）：笔画横向加粗约 2.4% 字号、纵向约 1.9%，描边只能取一个值，用两者平均。
// 12px 及以下 SimSun 用内嵌点阵，不加粗
const fakeBold = size => size <= 12 ? 0 : size * 0.0215;
const ITALIC_SKEW = 0.25;

/** 单元 → <svg>：同色同字号的字拼成一条 path（变换只写一次，各字首点按字位偏移），外加透明复制层 */
function buildSvg(doc, u, o) {
  const groups = new Map();
  for (const c of u.chars) {
    // 连字的后续字没有字形（画在簇首那个字上）
    if (c.space || !c.g.g.length) continue;
    const g = c.g, s = c.st.size / g.face.upem;
    // 全角标点被挤压成半宽时用 halt 字形：看实测宽度更接近哪个步进
    const full = g.adv * s + c.st.ls;
    const v = g.halt && Math.abs(c.w - (g.halt.adv * s + c.st.ls)) + 0.2 < Math.abs(c.w - full) ? g.halt : g;
    const bold = c.st.synthW && parseInt(c.st.weight, 10) - g.face.weight > 200 && fakeBold(c.st.size) > 0;
    const ital = c.st.synthS && c.st.style !== 'normal' && !g.face.italic;
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
      p.setAttribute('stroke-width', f3(fakeBold(grp.st.size) / grp.s));
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
  noTf.setAttribute('data-wxc-tool', ''); noTf.textContent = NO_TF;
  doc.head.appendChild(noTf);
  const units = descs.map(d => locate(doc, root, d));
  const web = ctx.web || new Set();
  for (const u of units) if (!u.fail) { u.html = originalHtml(u); u.orig = [...u.nodes]; wrapRun(doc, u); measureChars(doc, u, web); u.cw = nearestCw(win, u.box, root); }
  if (units.some(u => !u.fail)) {
    try { await fetchGlyphs(units, ctx.glyphs, notes); } catch (e) { notes.server = e.message; for (const u of units) if (!u.fail) u.fail = 'server'; }
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
    faces: u.chars.filter(c => !c.space).reduce((m, c) => (m[c.st.face] = (m[c.st.face] || 0) + 1, m), {}),
    sig: u.chars.filter(c => !c.space).map(c => [c.x, c.base, c.st.size]), bytes: u.svg.outerHTML.length - u.html.length,
  });
}

/** 两个宽度的结果比一比：逐字位置按容器宽度等比缩放的写 viewBox（随屏宽缩放），完全不变的去掉 viewBox（固定像素） */
export function decide(ra, rb) {
  return ra.map((a, i) => {
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
export function finalize(html, results, verdicts) {
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
