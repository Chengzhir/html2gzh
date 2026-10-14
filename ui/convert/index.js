import { ID, isHtmlEl, measure, diffBoxes, loadFrame } from './util.js';
import { collectRules, matchRules, cascadeOrder, toStyle } from './cascade.js';
import { convertPositions, correctOffsets, INHERITED } from './position.js';
import { cleanStructure, keepShapes, squashWhitespace, cleanAttributes } from './structure.js';
import { mergeWidths, annotateContainerWidths, stripTool, markIgnoreWidth } from './responsive.js';

/** 微信手机端正文区的默认样式（抓自线上文章页 CSS），预览与校验都在它下面进行 */
export const READER_CSS = `.rich_media_content{color:rgba(0,0,0,.9);font-size:17px;overflow:hidden;text-align:justify;position:relative;z-index:0;line-height:1.6;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.544px;hyphens:auto;-webkit-hyphens:auto;text-underline-position:under;text-underline-offset:1.6px;text-decoration-skip-ink:none}
.rich_media_content *{max-width:100%!important;box-sizing:border-box!important;word-wrap:break-word!important}
.rich_media_content p{clear:both;min-height:1em}
.rich_media_content img{height:auto!important}
.rich_media_content em{font-style:italic}
.rich_media_content table{table-layout:fixed!important}
.rich_media_content td,.rich_media_content th{width:auto!important}
.rich_media_content blockquote{color:rgba(0,0,0,.55)}
.rich_media_content a{color:#576b95}
.rich_media_content mark{color:#000}`;
/** 阅读页直接给这几个标签上色、不从父级继承（在线上文章正文里逐个标签实测得出）：转换时把继承到的颜色写到它们自己身上。
 *  blockquote 不在此列：预览/发表时它身上的 color 会被删，所以 structure.js 直接把它改成 section */
const SELF_COLORED = 'a,mark';
const NEUTRAL = `html,body{margin:0!important;padding:0!important;border:0!important}html{scrollbar-width:none}html::-webkit-scrollbar{display:none}`;

function collector() {
  const list = [];
  const add = level => (title, text, els) => list.push({ level, title, text, ids: (els || []).map(e => e.getAttribute && e.getAttribute(ID)).filter(Boolean) });
  return { list, fixed: add('fixed'), warn: add('warn'), info: add('info'), error: add('error') };
}
const FORCED = ['max-width', 'min-height', 'clear', 'box-sizing', 'height'];
// 微信正文样式里这几项带 !important，只有它们补回时也得带；其余内联声明本来就压得过（规范不建议用 !important）
const READER_IMPORTANT = new Set(['max-width', 'box-sizing', 'height']);
/** 比对用的正文宽度：常见手机，加上内容结构检测用的 375/585/677 屏宽（它直接把这些宽度设成正文区宽） */
const CHECK_WIDTHS = [320, 335, 353, 374, 375, 460, 585, 677];
const FLOW = /^(block|flow-root|list-item)$/;

/**
 * 输入已改写好图片地址的 HTML。按 width 与另一个宽度各转换一遍，合并成随宽度等比缩放的成品，
 * 再在多个正文宽度下与原稿逐元素比对。payload 里的本地图片地址由调用方换成公网地址。
 */
export async function convert(html, { width, frame, verifyFrame }) {
  const wb = width < 400 ? width + 64 : width - 64;
  const A = await convertAt(html, width, frame);
  const B = await convertAt(html, wb, frame);
  const { html: mergedRaw, stat } = mergeWidths(A.preview, B.preview);
  const F = A.F;
  // 内容结构检测就在 375/585/677 三个宽度下来量（见其 xr 数组），超出正文区的节点会被判"存在溢出问题"
  const overIds = new Set();
  for (const w of CHECK_WIDTHS.filter(w => w > 460 || w === 375)) for (const id of overflowing(await loadFrame(verifyFrame, previewDoc(mergedRaw), w))) overIds.add(id);
  const { html: merged, n: ignored } = markIgnoreWidth(mergedRaw, [...overIds]);
  if (ignored) F.fixed('溢出豁免', `${overIds.size} 处有意超出版心的元素（出血图、旋转色块等，原稿里被裁切）及其上级加了 data-ignore-width，避免被内容结构检测误判为溢出`);

  const widths = [...new Set([...CHECK_WIDTHS.filter(w => w !== width), width])];
  const others = [];
  let visualBad = [], verified = 0, V = new Map();
  for (const w of widths) {
    const target = w === width ? A.targetV : measure(await loadFrame(frame, A.original, w), false);
    V = measure(await loadFrame(verifyFrame, previewDoc(merged), w), false);
    const bad = diffBoxes(new Map([...target].filter(([k]) => V.has(k))), V, 1.5);
    if (w === width) { visualBad = bad; verified = V.size; } else if (bad.length) others.push([w, bad]);
  }

  if (stat.cq) F.fixed('等比缩放', `${stat.cq} 个长度写成了 cqw，随手机宽度等比缩放` + (stat.split ? `，${stat.split} 处位移拆成固定 + 比例两段` : ''));
  if (stat.approx) F.warn('缩放近似', `${stat.approx} 个长度既有固定部分又有比例部分，微信不支持 calc()，只能在 ${width}px 下精确、其他宽度近似`);
  if (stat.diverged) F.warn('缩放近似', `${stat.diverged} 处在两个宽度下转换结果结构不同，按 ${width}px 的结果等比换算`);
  if (others.length) F.list.push({ level: 'warn', title: '其他宽度', text: others.map(([w, b]) => `${w}px 下 ${b.length} 个元素偏差超过 1.5px`).join('；'), ids: [...new Set(others.flatMap(([, b]) => b))] });
  else F.info('其他宽度', `正文宽 ${widths.filter(w => w !== width).join('/')}px 下也与原稿逐元素一致`);

  return {
    payload: stripTool(merged), preview: merged, original: A.original, findings: F.list,
    stats: { chars: stripTool(merged).length, elements: A.n, moved: A.moved, visualBad, verified, others },
    debug: { tv: [...A.targetV], v: [...V], approx: stat.where },
  };
}

/** 与内容结构检测同一判据：盒子左右任一侧超出正文区 1px 以上、且不是左右对称居中 */
function overflowing(doc) {
  const box = doc.querySelector('.rich_media_content').getBoundingClientRect();
  const out = [];
  for (const el of doc.querySelectorAll(`[${ID}]`)) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const centered = Math.abs((r.left - box.left) - (box.right - r.right)) <= 1;
    if ((r.left < box.left - 1 || r.right > box.right + 1) && !centered) out.push(el.getAttribute(ID));
  }
  return out;
}

/** 读屏专用的隐藏文字（1px 裁切）：公众号自带标题栏，留着会被判"内容溢出容器" */
function dropVisuallyHidden(doc, F) {
  const win = doc.defaultView;
  let n = 0;
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!el.isConnected || !isHtmlEl(el) || !el.textContent.trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 1.5 || r.height > 1.5 || !el.getClientRects().length) continue;
    const c = win.getComputedStyle(el);
    if (c.overflow === 'visible' && c.clipPath === 'none' && c.clip === 'auto') continue;
    el.remove(); n++;
  }
  if (n) F.fixed('隐藏文字', `删掉 ${n} 处只给读屏软件看的隐藏文字（公众号有自己的标题栏，留着会被判为内容溢出）`);
}

/** 微信给所有元素加 max-width:100%!important，作者的 max-width 会失效；块级自动宽度的元素改写成 width，效果等同 min(原上限, 100%) */
function keepMaxWidth(doc, root) {
  const win = doc.defaultView;
  let n = 0;
  for (const el of root.querySelectorAll('[style]')) {
    const s = el.style, c = win.getComputedStyle(el);
    if (!/px$/.test(s.maxWidth) || s.width && s.width !== 'auto') continue;
    if (!FLOW.test(c.display) || c.float !== 'none' || c.position !== 'static' || c.boxSizing !== 'border-box') continue;
    if (!el.parentElement || !FLOW.test(win.getComputedStyle(el.parentElement).display)) continue;
    if (![s.marginLeft, s.marginRight].every(m => !m || m === 'auto' || parseFloat(m) === 0)) continue;
    s.setProperty('width', s.maxWidth);
    s.setProperty('max-width', '100%');
    n++;
  }
  return n;
}
/** 按一个固定正文宽度转换：所有长度量成 px，供 mergeWidths 拟合 */
async function convertAt(html, width, frame) {
  const F = collector();
  const src = html.replace(/<head([^>]*)>/i, `<head$1><style data-wxc-tool>${NEUTRAL}</style>`);
  const doc = await loadFrame(frame, /<head/i.test(src) ? src : `<head><style data-wxc-tool>${NEUTRAL}</style></head>` + src, width);
  const win = doc.defaultView;
  const cs = el => win.getComputedStyle(el);

  let n = 0;
  for (const el of doc.body.querySelectorAll('*')) if (isHtmlEl(el) || el.localName === 'svg') el.setAttribute(ID, 'e' + n++);
  const original = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  const S0 = measure(doc, true), S0v = measure(doc, false);

  // 层叠：逐元素算出生效声明，伪元素同理
  const notes = { media: 0, fontface: 0, keyframes: 0, imports: 0, container: 0, unreadable: 0, nested: 0, otherPseudo: 0, dynamic: 0, badSel: 0 };
  const rules = collectRules(doc, notes);
  const matched = matchRules(doc, rules, notes);
  const hit = { cq: 0, rem: 0, vw: 0, pct: 0, badVar: 0 };
  const rem = parseFloat(cs(doc.documentElement).fontSize) || 16;
  const tmp = doc.createElement('span');
  const noTf = doc.createElement('style');
  noTf.setAttribute('data-wxc-tool', '');
  noTf.textContent = '*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}';
  const layoutBox = el => { doc.head.appendChild(noTf); const r = el.getBoundingClientRect(); noTf.remove(); return r; };
  // 用布局盒（不含 transform）的小数尺寸；clientWidth 会取整，换算出的 px 就差 1
  const box = el => { const r = layoutBox(el), c = cs(el); return { pw: r.width - parseFloat(c.borderLeftWidth) - parseFloat(c.borderRightWidth), ph: r.height - parseFloat(c.borderTopWidth) - parseFloat(c.borderBottomWidth), c }; };
  const contentW = el => { const { pw, c } = box(el); return pw - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight); };
  const envFor = (el, pseudoAbs) => ({
    hit, rem, vw: win.innerWidth,
    cq: () => {
      for (let a = pseudoAbs !== undefined ? el : el.parentElement; a; a = a.parentElement) {
        if (cs(a).containerType !== 'normal') { const { ph, c } = box(a); return { w: contentW(a), h: ph - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom) }; }
      }
      return { w: win.innerWidth, h: win.innerHeight };
    },
    // 只有绝对定位元素的 % 要换算：它改成浮动后包含块变了；其余元素的 % 在成品里照样相对原来的父级
    cbw: () => {
      const abs = pseudoAbs !== undefined ? pseudoAbs : /absolute|fixed/.test(cs(el).position);
      if (!abs) return null;
      let a = pseudoAbs !== undefined ? el : el.parentElement;
      while (a && a !== doc.body && cs(a).position === 'static') a = a.parentElement;
      return a && a !== doc.body ? box(a).pw : win.innerWidth;
    },
  });
  const forcedOf = c => Object.fromEntries(FORCED.map(k => [k, c.getPropertyValue(k)]));
  const want = new Map();
  const bqColor = new Map();
  for (const el of doc.body.querySelectorAll(SELF_COLORED)) bqColor.set(el, cs(el).color);
  const plans = [], pseudos = [];
  for (const el of doc.body.querySelectorAll('*')) {
    const b = matched.get(el);
    const inline = el.getAttribute('style');
    const id = el.getAttribute(ID);
    if (id) want.set(id, forcedOf(cs(el)));
    if (b || inline) plans.push([el, toStyle(cascadeOrder(b ? b.self : [], inline), cs(el), envFor(el), tmp)]);
    if (!b || !isHtmlEl(el) || /^(img|input|video|iframe|canvas|br|hr|textarea|select|object|embed)$/.test(el.localName)) continue;
    for (const slot of ['before', 'after']) {
      if (!b[slot].length) continue;
      const pc = win.getComputedStyle(el, '::' + slot);
      if (pc.content === 'none' || pc.content === 'normal' || pc.display === 'none') continue;
      const text = contentText(pc.content, el, notes);
      if (text == null) continue;
      const style = toStyle(cascadeOrder(b[slot]), pc, envFor(el, /absolute|fixed/.test(pc.position)), tmp);
      pseudos.push({ el, slot, text, style, forced: forcedOf(pc) });
    }
  }

  // 根容器只带上作者在 html/body 上声明过的继承属性，外加行高/字号/对齐（否则会被微信默认值顶掉）
  const declared = new Set(['line-height', 'font-size', 'text-align']);
  for (const el of [doc.documentElement, doc.body]) {
    const b = matched.get(el);
    for (const d of cascadeOrder(b ? b.self : [], el.getAttribute('style'))) {
      declared.add(d.prop);
      if (d.prop === 'font') ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'].forEach(k => declared.add(k));
    }
  }
  // 取声明值而不是计算值：line-height:1.7 的计算值是 px，会让字号不同的子孙行高全错
  const bodyCs = cs(doc.body);
  const rootTmp = doc.createElement('span');
  for (const el of [doc.documentElement, doc.body]) {
    const b = matched.get(el);
    const st = toStyle(cascadeOrder(b ? b.self : [], el.getAttribute('style')), cs(el), envFor(el), tmp);
    for (const d of (tmp.removeAttribute('style'), tmp.setAttribute('style', st), [...tmp.style])) rootTmp.style.setProperty(d, tmp.style.getPropertyValue(d));
  }
  const rootDecl = INHERITED.filter(k => declared.has(k)).map(k => [k, k !== 'font-size' && rootTmp.style.getPropertyValue(k) || bodyCs.getPropertyValue(k)]);
  // 页面底色：宽屏上版心两侧露出来的那一块
  const pageBg = [doc.body, doc.documentElement].map(e => cs(e).backgroundColor).find(c => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');

  doc.querySelectorAll('style:not([data-wxc-tool]),link[rel~="stylesheet"]').forEach(e => e.remove());
  // 扩展注入的样式表可能挂在 adoptedStyleSheets 上，也一并摘掉，免得校验时还在起作用
  doc.adoptedStyleSheets = [];
  for (const [el, style] of plans) { if (style) el.setAttribute('style', style); else el.removeAttribute('style'); }
  doc.body.querySelectorAll('[class]').forEach(e => e.removeAttribute('class'));
  let pn = 0;
  for (const p of pseudos) {
    const s = doc.createElement('span');
    const id = 'p' + pn++;
    s.setAttribute(ID, id); s.setAttribute('data-wxc-pseudo', p.slot);
    if (p.style) s.setAttribute('style', p.style);
    if (p.text) s.textContent = p.text; else s.setAttribute('aria-hidden', 'true');
    if (p.slot === 'before') p.el.prepend(s); else p.el.append(s);
    want.set(id, p.forced);
  }
  let bqFixed = 0;
  for (const [el, color] of bqColor) {
    if (!el.isConnected || el.style.color) continue;
    el.style.setProperty('color', color); bqFixed++;
  }
  dropVisuallyHidden(doc, F);
  // 根容器自身是查询容器：原稿里没有容器祖先的 cqw 相对视口，成品里相对正文宽度，两者一致
  const root = doc.createElement('section');
  root.setAttribute(ID, 'root');
  root.setAttribute('data-ignore-width', '');
  while (doc.body.firstChild) root.appendChild(doc.body.firstChild);
  doc.body.appendChild(root);
  for (const [k, v] of rootDecl) root.style.setProperty(k, k === 'text-align' ? v.replace(/^start$/, 'left').replace(/^end$/, 'right') : v);
  // 阅读页正文区还给这几项设了值（字距 0.544px、自动断词等），原稿没声明的元素会继承过去，换行全变；根容器写回原稿的值
  for (const k of ['letter-spacing', 'hyphens', 'text-underline-position', 'text-underline-offset', 'text-decoration-skip-ink']) {
    if (!root.style.getPropertyValue(k)) root.style.setProperty(k, bodyCs.getPropertyValue(k));
  }
  if (pageBg) root.style.setProperty('background-color', pageBg);
  root.style.setProperty('container-type', 'inline-size');
  const capped = keepMaxWidth(doc, root);

  const S1 = measure(doc, true), S1v = measure(doc, false);
  const cascadeBad = diffBoxes(new Map([...S0].filter(([k]) => !k.startsWith('p') && S1.has(k))), S1);
  const target = new Map(S0), targetV = new Map(S0v);
  for (const [k, v] of S1) if (k.startsWith('p')) { target.set(k, v); targetV.set(k, S1v.get(k)); }

  // 套上微信正文区的默认样式，把被它顶掉的属性逐个补回
  const rst = doc.createElement('style');
  rst.setAttribute('data-wxc-tool', ''); rst.textContent = READER_CSS;
  doc.head.appendChild(rst);
  const wrap = doc.createElement('div');
  wrap.className = 'rich_media_content';
  root.before(wrap); wrap.appendChild(root);
  let forcedN = 0;
  const fixReader = () => {
    for (let pass = 0; pass < 4; pass++) {
      const bad = diffBoxes(target, measure(doc, true));
      let changed = 0;
      for (const id of bad) {
        const el = doc.querySelector(`[${ID}="${id}"]`), w = want.get(id);
        if (!el || !w) continue;
        const c = cs(el);
        for (const k of FORCED) {
          if (k === 'height' && el.localName !== 'img') continue;
          if (k === 'box-sizing' && el.hasAttribute('data-wxc-float')) continue;
          if (k === 'max-width' && el.style.maxWidth === '100%') continue;
          if (c.getPropertyValue(k) === w[k]) continue;
          const pri = READER_IMPORTANT.has(k) ? 'important' : '';
          if (el.style.getPropertyValue(k) === w[k] && el.style.getPropertyPriority(k) === pri) continue;
          el.style.setProperty(k, w[k], pri); changed++; forcedN++;
        }
      }
      if (!changed) break;
    }
  };
  fixReader();

  const layers = convertPositions(doc, root, F);
  cleanStructure(doc, root, F);
  keepShapes(doc, root, F);
  const ws = squashWhitespace(doc, root);
  cleanAttributes(root);
  fixReader();
  const { moved, stuck } = correctOffsets(doc, root, target, layers);
  annotateContainerWidths(doc, root);

  root.querySelectorAll('[data-wxc-float],[data-wxc-pseudo]').forEach(e => { e.removeAttribute('data-wxc-float'); e.removeAttribute('data-wxc-pseudo'); });
  const preview = root.outerHTML;

  if (pn) F.fixed('伪元素', `${pn} 个 ::before/::after 改成了真实元素`);
  if (capped) F.fixed('最大宽度', `${capped} 处 max-width 改写成 width（微信会把所有 max-width 强制成 100%）`);
  if (bqFixed) F.fixed('文字颜色', `${bqFixed} 个链接/mark 补上了文字颜色（阅读页给这几种标签直接上色、不继承父级，深底浅字会变色）`);
  if (forcedN) F.fixed('微信默认样式', `${forcedN} 处被微信正文默认样式（max-width、段落最小高度等）顶掉的属性已补回`);
  if (ws > 200) F.fixed('空白', `清掉 ${ws} 个标签间空白字符（手机端会把它们渲染成额外的空行）`);
  if (notes.fontface) F.warn('网络字体', `${notes.fontface} 个 @font-face 字体用不了，读者看到的是手机系统字体，字宽不同可能导致换行变化`);
  if (notes.keyframes) F.warn('动画', `${notes.keyframes} 个 @keyframes 动画会丢失`);
  if (notes.dynamic) F.warn('交互样式', `${notes.dynamic} 条 :hover/:focus 等交互样式没有效果，已忽略`);
  if (notes.otherPseudo) F.warn('伪元素', `${notes.otherPseudo} 条 ::marker/::first-line 等规则无法转换，已忽略`);
  if (notes.unreadable || notes.imports) F.warn('样式表', `${notes.unreadable + notes.imports} 个样式表或 @import 读不到，相关样式缺失`);
  if (notes.container) F.warn('容器查询', `${notes.container} 条 @container 规则没有处理`);
  if (hit.badVar) F.warn('CSS 变量', `${hit.badVar} 处 var() 找不到值，该声明已丢弃`);
  if (cascadeBad.length) F.warn('样式内联', `${cascadeBad.length} 个元素内联后位置或尺寸和原稿不同`, cascadeBad.map(id => doc.querySelector(`[${ID}="${id}"]`)).filter(Boolean));
  if (stuck.length) F.warn('位置偏差', `${stuck.length} 个行内元素没法用位移校正，位置可能有偏差`, stuck.map(id => doc.querySelector(`[${ID}="${id}"]`)).filter(Boolean));
  if (notes.media) F.info('@media', `${notes.media} 条 @media 规则已按 ${width}px 手机宽度取值`);

  return { F, preview, original, targetV, n, moved };
}

/** 预览/校验用文档：微信正文区默认样式 + 成品片段 */
export function previewDoc(fragment, extraCss = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${NEUTRAL}${READER_CSS}${extraCss}</style></head><body><div class="rich_media_content">${fragment}</div></body></html>`;
}

/** 伪元素 content 计算值 → 文本；counter()/url() 无法转换返回 null */
function contentText(v, el, notes) {
  let out = '';
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)|(open-quote|close-quote|no-open-quote|no-close-quote)|([a-z-]+\([^)]*\))/gi;
  let m;
  while ((m = re.exec(v))) {
    if (m[1] != null || m[2] != null) out += (m[1] ?? m[2]).replace(/\\([0-9a-f]{1,6})\s?/gi, (x, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
    else if (m[3]) out += el.getAttribute(m[3]) || '';
    else if (m[4]) out += m[4] === 'open-quote' ? '“' : m[4] === 'close-quote' ? '”' : '';
    else if (m[5]) { notes.otherPseudo++; return null; }
  }
  return out;
}
