import { ID, isHtmlEl, measure, diffBoxes, loadFrame } from './util.js';
import { collectRules, matchRules, cascadeOrder, toStyle } from './cascade.js';
import { convertPositions, correctOffsets, INHERITED } from './position.js';
import { cleanStructure, keepShapes, squashWhitespace, keepNoWrap, cleanAttributes } from './structure.js';
import { mergeWidths, annotateContainerWidths, stripTool, markIgnoreWidth } from './responsive.js';
import { DEFAULT_OPTS, REF_W, parseRules, phoneFonts } from './fonts.js';
import { planFonts, outline, decide, finalize, webFamilies, WHY_TEXT } from './outline.js';
import { READER_CSS, NEUTRAL, previewDoc, readerImages, pinImages } from './reader.js';
import { prepareSvgs, convertSvgs } from './svg/index.js';
import { wechatClean, webkitFilter } from './wechat.js';

/** 阅读页直接给这几个标签上色、不从父级继承（在线上文章正文里逐个标签实测得出）：转换时把继承到的颜色写到它们自己身上。
 *  blockquote 不在此列：预览/发表时它身上的 color 会被删，所以 structure.js 直接把它改成 section */
const SELF_COLORED = 'a,mark';

function collector() {
  const list = [];
  // 标题、一句结论、可选的详细说明（界面上点开才显示）、要在预览里标出的元素；没有说明时第三个参数直接给元素
  const add = level => (title, text, detail, els) => {
    if (typeof detail !== 'string') { els = detail; detail = ''; }
    list.push({ level, title, text, detail, ids: (els || []).map(e => typeof e === 'string' ? e : e.getAttribute && e.getAttribute(ID)).filter(Boolean) });
  };
  return { list, fixed: add('fixed'), warn: add('warn'), info: add('info'), error: add('error') };
}
const FORCED = ['max-width', 'min-height', 'clear', 'box-sizing', 'height'];
// 微信正文样式里这几项带 !important，只有它们补回时也得带；其余内联声明本来就压得过（规范不建议用 !important）
const READER_IMPORTANT = new Set(['max-width', 'box-sizing', 'height']);
/** 比对用的正文宽度：常见手机，加上内容结构检测用的 375/585/677 屏宽（它直接把这些宽度设成正文区宽） */
const CHECK_WIDTHS = [320, 335, 353, 372, 374, 375, 460, 585, 677];
const FLOW = /^(block|flow-root|list-item)$/;

/**
 * 输入已改写好图片地址的 HTML。按 width 与另一个宽度各转换一遍，合并成随宽度等比缩放的成品，
 * 再在多个正文宽度下与原稿逐元素比对。payload 里的本地图片地址由调用方换成公网地址。
 */
export async function convert(html, { width, frame, verifyFrame, opts = {}, glyphs = null, raster = null }) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const { rules: fontRules, bad: badRules } = parseRules(o.rules);
  const ctx = { o, fontRules, glyphs, plan: null, web: null, pins: new Map(), notes: { miss: new Map(), server: '' },
    sizes: { A: null, B: null }, svg: { raster, rasterCache: new Map(), spline: false } };
  const wb = width < 400 ? width + 64 : width - 64;
  // 字体表的字号按 335px 正文宽折算：在两个转换宽度下量原稿字号，线性插值。主宽度就是 335 时不用量
  if (width !== REF_W) {
    const pd = await loadFrame(frame, withNeutral(html), wb);
    tagIds(pd);
    ctx.sizes.B = readSizes(pd);
  }
  ctx.sizes.t = (REF_W - width) / (wb - width);
  const A = await convertAt(html, width, frame, ctx);
  const B = await convertAt(html, wb, frame, ctx);
  let pa = A.preview, pb = B.preview, outlineStat = null;
  if (A.outlined) {
    const verdicts = decide(A.outlined, B.outlined);
    pa = finalize(pa, A.outlined, verdicts);
    pb = finalize(pb, B.outlined, verdicts);
    outlineStat = { units: verdicts.length, verdicts, kept: 0, chars: 0, bytes: 0 };
    verdicts.forEach((v, i) => {
      if (!v.keep) return;
      const r = A.outlined[i];
      outlineStat.kept++; outlineStat.chars += r.chars; outlineStat.bytes += r.bytes;
    });
  }
  const fonts = fontRows(ctx, outlineStat && outlineStat.verdicts);
  const { html: mergedRaw, stat } = mergeWidths(pa, pb);
  const F = A.F;
  if (outlineStat) outlineFindings(F, outlineStat, ctx);
  // 内容结构检测就在 375/585/677 三个宽度下来量（见其 xr 数组），超出正文区的节点会被判"存在溢出问题"
  const overIds = new Set();
  for (const w of CHECK_WIDTHS.filter(w => w > 460 || w === 375)) for (const id of overflowing(await loadFrame(verifyFrame, previewDoc(mergedRaw), w))) overIds.add(id);
  const { html: marked, n: ignored } = markIgnoreWidth(mergedRaw, [...overIds]);
  const merged = wechatClean(marked);
  if (ignored) F.fixed('超出版面', `${overIds.size} 处故意超出版面的元素加了 data-ignore-width`, '出血图、旋转色块等原稿里被裁切的元素，连同外层容器。不加的话，粘贴后后台的“内容结构检测”会把它们报成溢出。', [...overIds]);

  // 主宽度排最后：循环结束时 verifyFrame 停在所选宽度上（复制时的纯文本取自它）
  const widths = [...new Set([...CHECK_WIDTHS.filter(w => w !== width), width])];
  const others = [];
  let visualBad = [], verified = 0, V = new Map();
  for (const w of widths) {
    const target = w === width ? A.targetV : measure(await loadFrame(frame, A.original, w), false);
    const vd = await loadFrame(verifyFrame, previewDoc(merged), w);
    readerImages(vd);
    V = measure(vd, false);
    const bad = diffBoxes(new Map([...target].filter(([k]) => V.has(k))), V, 1.5);
    if (w === width) { visualBad = bad; verified = V.size; } else if (bad.length) others.push([w, bad]);
  }

  if (A.pageBg && A.pageBg !== 'rgb(255, 255, 255)') F.warn('页面底色', `原稿的页面底色（${A.pageBg}）粘贴后只铺满正文区`, '阅读页正文区左右各留 20px，这两条显示阅读页自己的底色（浅色模式白色，深色模式 #191919），去不掉。效果见右边的预览。');
  if (badRules.length) F.warn('备用字体规则', `第 ${badRules.join('、')} 行格式不对，已跳过`, '每行应为“原稿字体, … => 备用字体, …”。');
  if (stat.cq) F.fixed('等比缩放', `${stat.cq} 个尺寸改写成 cqw，随手机屏宽等比缩放`, '1cqw 等于外层查询容器宽度的 1%，最外层的容器就是正文区。' + (stat.split ? `其中 ${stat.split} 处位移拆成固定值与比例值两段。` : ''));
  // 多宽度比对都过了就只是说明，不必处理
  if (stat.approx) (others.length ? F.warn : F.info)('缩放近似', `${stat.approx} 个尺寸只在正文 ${width}px 宽时完全精确`, `这些尺寸由固定值和比例值合成（相当于 calc()），公众号会删掉 calc()，其他屏宽下按比例近似。` + (others.length ? '' : '各比对宽度下偏差都不超过 1.5px。'));
  if (stat.diverged) F.warn('缩放近似', `${stat.diverged} 处排版结构随屏宽变化，按正文 ${width}px 宽时的样子等比缩放`, '比如换行位置不同，无法拟合成等比缩放。其他屏宽下这几处可能与原稿不同。');
  // 375/585/677 是内容结构检测直接用的正文宽，460 补在手机与电脑之间
  const phones = widths.filter(w => w !== width && w < 375), rest = widths.filter(w => w !== width && w >= 375);
  if (others.length) F.warn('其他宽度', `${others.length} 个宽度下有元素与原稿相差超过 1.5px`, others.map(([w, b]) => `· 正文 ${w}px：${b.length} 个元素`).join('\n'), [...new Set(others.flatMap(([, b]) => b))]);
  else F.info('其他宽度', `正文 ${phones.join('/')}px 与 ${rest.join('/')}px 下也与原稿一致`, '前者是常见手机，后者包括公众号“内容结构检测”用的宽度。');

  const payload = webkitFilter(stripTool(merged));
  return {
    payload, preview: merged, original: A.original, findings: F.list, fonts,
    stats: { chars: payload.length, elements: A.n, moved: A.moved, visualBad, verified, others,
      outline: outlineStat && { units: outlineStat.units, kept: outlineStat.kept, chars: outlineStat.chars, bytes: outlineStat.bytes } },
    debug: { tv: [...A.targetV], v: [...V], approx: stat.where,
      verdicts: outlineStat && outlineStat.verdicts.map((v, i) => ({ ...v, id: ctx.plan.units[i].id, run: ctx.plan.units[i].from != null, text: ctx.plan.units[i].text.slice(0, 40) })) },
  };
}

/** 字体表：每行的字数、转为路径的字数、没转的原因（原因代码 → 字数），以及手机上的字体栈 */
function fontRows(ctx, verdicts) {
  const { rows, units, skip } = ctx.plan;
  const out = new Map(rows.map(r => [r.key, { ...r, done: 0, why: Object.fromEntries(skip.get(r.key) || []), phone: phoneFonts(r.stack, r.weight, ctx.fontRules) }]));
  (verdicts || []).forEach((v, i) => {
    for (const [k, n] of Object.entries(units[i].rows)) {
      const r = out.get(k);
      if (v.keep) r.done += n;
      else if (ctx.o.paths.includes(k) && !r.web) r.why[v.why] = (r.why[v.why] || 0) + n;
    }
  });
  return [...out.values()];
}

/** 每个字号（含 ::before/::after）：data-wxc → px；'' 是 body 的 */
function readSizes(doc) {
  const win = doc.defaultView, out = new Map([['', parseFloat(win.getComputedStyle(doc.body).fontSize)]]);
  for (const el of doc.querySelectorAll(`[${ID}]`)) {
    const id = el.getAttribute(ID);
    out.set(id, parseFloat(win.getComputedStyle(el).fontSize));
    if (!isHtmlEl(el)) continue;
    for (const slot of ['before', 'after']) out.set(`${id}::${slot}`, parseFloat(win.getComputedStyle(el, '::' + slot).fontSize));
  }
  return out;
}
/**
 * 元素的字号折算到 335px 正文宽：找最近的、两个宽度下都量过的原稿元素，按它字号随宽度的变化比例换算。
 * 原稿元素在转换中拆出来的工具元素（伪元素改成的 span 记在 pseudoSrc 里，包装元素没有 id）跟着这个比例走
 */
function sizeAtRef(sizes, pseudoSrc) {
  return el => {
    const px = parseFloat(el.ownerDocument.defaultView.getComputedStyle(el).fontSize);
    if (!sizes.B) return px;
    for (let a = el; a; a = a.parentElement) {
      const id = a.getAttribute && a.getAttribute(ID);
      const k = a === a.ownerDocument.body ? '' : id && (pseudoSrc.get(id) || id);
      if (k == null || !sizes.A.has(k) || !sizes.B.has(k) || !sizes.A.get(k)) continue;
      return px * (1 + sizes.t * (sizes.B.get(k) / sizes.A.get(k) - 1));
    }
    return px;
  };
}

function outlineFindings(F, s, ctx) {
  if (s.kept) F.fixed('SVG 路径', `${s.kept} 段（${s.chars} 字）转为 SVG 路径`, `手机上字形与原稿一致；代码多出约 ${Math.round(s.bytes / 1024)} KB。` + (ctx.o.svgCopy ? '路径上叠了透明文字，读者能选中、复制。' : '没有叠透明文字，读者不能选中、复制。'));
  if (ctx.notes.server) return F.warn('SVG 路径', '取字形失败，勾选的字仍是文字', `${ctx.notes.server}。这些字在手机上显示为备用字体。`);
  // 按显示出来的原因合并计数（几种内部原因说法相同）；没有可见字的段不算问题
  const why = new Map(), left = [];
  s.verdicts.forEach((v, i) => {
    if (v.keep || v.why === 'empty') return;
    const k = WHY_TEXT[v.why] || v.why;
    why.set(k, (why.get(k) || 0) + 1); left.push(ctx.plan.units[i].id);
  });
  if (!why.size) return;
  const miss = [...ctx.notes.miss.keys()];
  const fonts = miss.length ? `（${miss.slice(0, 3).join('；')}）` : '';
  // 字由、Adobe Fonts 一类工具激活的字体不装进系统字体目录，浏览器能用，字形接口找不到文件
  const hint = miss.some(k => k.includes('不在本机字体目录')) ? '\n用 Adobe Fonts 等工具临时激活的字体，要正式安装后才能转。' : '';
  F.warn('SVG 路径', `${left.length} 段勾选的字没能转为路径`, '这些字在手机上显示为备用字体。原因：\n' + [...why].map(([k, n]) => `· ${n} 段：${k}${k === WHY_TEXT.font ? fonts : ''}`).join('\n') + hint, left);
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

/** 读屏专用的隐藏文字（1px 裁切）：公众号自带标题栏，这种写法留着会被判"内容溢出容器" */
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
  if (n) F.fixed('隐藏文字', `删掉 ${n} 处只给读屏软件读的隐藏文字`, '多为给页面补的标题，公众号有自己的标题栏。这种 1px 裁切的写法会被后台的“内容结构检测”报成溢出。');
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
const withNeutral = html => /<head[\s>]/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, `<head$1><style data-wxc-tool>${NEUTRAL}</style>`)
  : `<head><style data-wxc-tool>${NEUTRAL}</style></head>` + html;
/** 给 body 里的 HTML 元素和 svg 元素编号（data-wxc）；同一份 HTML 装载几次，编号都一样 */
function tagIds(doc) {
  let n = 0;
  for (const el of doc.body.querySelectorAll('*')) if (isHtmlEl(el) || el.localName === 'svg') el.setAttribute(ID, 'e' + n++);
  return n;
}

async function convertAt(html, width, frame, ctx) {
  const F = collector();
  const doc = await loadFrame(frame, withNeutral(html), width);
  const win = doc.defaultView;
  const cs = el => win.getComputedStyle(el);

  const n = tagIds(doc);
  const original = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  const S0 = measure(doc, true), S0v = measure(doc, false);
  if (!ctx.web) ctx.web = webFamilies(doc);
  if (!ctx.plan && ctx.sizes.B) ctx.sizes.A = readSizes(doc);

  // 层叠：逐元素算出生效声明，伪元素同理
  const notes = { media: 0, fontface: 0, keyframes: 0, imports: 0, container: 0, unreadable: 0, nested: 0, otherPseudo: 0, dynamic: 0, badSel: 0 };
  const rules = collectRules(doc, notes);
  const matched = matchRules(doc, rules, notes);
  const hit = { cq: 0, rem: 0, vw: 0, pct: 0, badVar: 0, font: 0 };
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
    hit, rem, vw: win.innerWidth, fontRules: ctx.fontRules, svg: el.namespaceURI === 'http://www.w3.org/2000/svg' && pseudoAbs === undefined,
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
  const selfColor = new Map();
  for (const el of doc.body.querySelectorAll(SELF_COLORED)) if (isHtmlEl(el)) selfColor.set(el, cs(el).color);
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

  // 样式表删掉之前：读下 SVG 里的 CSS 动画（要改写成 SMIL），数一下 HTML 元素上的 CSS 动画（公众号里不会动）
  const svgState = prepareSvgs(doc);
  const htmlAnims = new Set(doc.getAnimations().filter(a => a instanceof win.CSSAnimation && isHtmlEl(a.effect.target)).map(a => a.effect.target)).size;

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
  const pseudoSrc = new Map();
  for (const p of pseudos) {
    const s = doc.createElement('span');
    const id = 'p' + pn++;
    pseudoSrc.set(id, `${p.el.getAttribute(ID)}::${p.slot}`);
    s.setAttribute(ID, id); s.setAttribute('data-wxc-pseudo', p.slot);
    if (p.style) s.setAttribute('style', p.style);
    if (p.text) s.textContent = p.text; else s.setAttribute('aria-hidden', 'true');
    if (p.slot === 'before') p.el.prepend(s); else p.el.append(s);
    want.set(id, p.forced);
  }
  let colorFixed = 0;
  for (const [el, color] of selfColor) {
    if (!el.isConnected || el.style.color) continue;
    el.style.setProperty('color', color); colorFixed++;
  }
  dropVisuallyHidden(doc, F);
  const svg = await convertSvgs(doc, svgState, ctx.svg);
  for (const [level, title, text, detail, els] of svg.findings) F[level](title, text, detail, els);
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
  const nw = ctx.o.noWrap ? keepNoWrap(doc, root) : 0;
  cleanAttributes(root);
  fixReader();
  const { moved, stuck } = correctOffsets(doc, root, target, layers);
  const pinned = pinImages(doc, root, ctx.pins);
  annotateContainerWidths(doc, root);
  // 路径放在最后：逐字位置要在最终布局里量。主宽度定字体表和单元，另一个宽度沿用同一组描述
  let outlined = null;
  if (!ctx.plan) ctx.plan = planFonts(doc, root, { picked: new Set(ctx.o.paths), web: ctx.web, sizeAt: sizeAtRef(ctx.sizes, pseudoSrc) });
  if (ctx.plan.units.length) outlined = await outline(doc, root, ctx.plan.units, ctx, ctx.notes);

  root.querySelectorAll('[data-wxc-float],[data-wxc-pseudo]').forEach(e => { e.removeAttribute('data-wxc-float'); e.removeAttribute('data-wxc-pseudo'); });
  const preview = root.outerHTML;

  if (pn) F.fixed('伪元素', `${pn} 个 ::before/::after 改成真实元素`);
  if (capped) F.fixed('最大宽度', `${capped} 处 max-width 改写成 width`, '阅读页把所有元素的 max-width 强制成 100%。');
  if (colorFixed) F.fixed('文字颜色', `${colorFixed} 个链接、mark 补上文字颜色`, '阅读页直接给这两种标签上色，不继承父级；深底浅字的地方会变色。');
  if (pinned) F.fixed('图片尺寸', `${pinned} 张图片锁住原尺寸`, '阅读页按原图宽高比重算图片高度，带边框或内边距、被拉伸或裁切的图会变形。高度用相等的 min-height 与 max-height 锁住；原来宽度不是定值的改为定宽。', [...root.querySelectorAll('img')].filter(i => { const p = ctx.pins.get(i.getAttribute(ID)); return p && (p.w || p.h); }));
  if (forcedN) F.fixed('阅读页默认样式', `${forcedN} 处被默认样式覆盖的属性写回元素上`, '阅读页正文区有 max-width、段落最小高度等默认样式。其中 max-width、box-sizing 与图片高度要带 !important 才能覆盖。');
  if (nw) F.fixed('不换行', `${nw} 处不换行的文字用不换行空格与 U+2060 固定`, '公众号会删掉 white-space: nowrap。空格换成不换行空格，字与字之间插入 U+2060（单词连接符）。后台的“正文字数”会把 U+2060 也算进去。');
  if (hit.font) F.fixed('备用字体', `${hit.font} 处字体栈补上了 iOS 与安卓自带的相近字体`, '公众号正文加载不了网页字体，读者手机上一般也没有电脑上的字体。规则见“字体”卡片里的“备用字体规则”。');
  if (ws > 200) F.fixed('空白', `清掉 ${ws} 个标签间的空白字符`, '手机上会显示成多出来的空行。');
  if (notes.fontface) F.warn('网页字体', `${notes.fontface} 个 @font-face 字体在公众号里用不了`, '读者看到的是手机自带字体。字宽不同，换行位置可能与原稿不同。');
  if (htmlAnims) F.warn('动画', `${htmlAnims} 个 HTML 元素的 CSS 动画在公众号里不播放`, '元素停在没有动画时的样子；原稿靠动画淡入的元素，粘贴后可能看不见，请在右边的预览里核对。SVG 里的动画已改写成 SMIL，不在此列。');
  if (notes.dynamic) F.warn('交互样式', `${notes.dynamic} 条 :hover、:focus 等交互样式已忽略`);
  if (notes.otherPseudo) F.warn('伪元素', `${notes.otherPseudo} 条 ::marker、::first-line 等规则无法转换，已忽略`);
  if (notes.unreadable || notes.imports) F.warn('样式表', `${notes.unreadable + notes.imports} 个样式表或 @import 读不到，相关样式缺失`);
  if (notes.container) F.warn('容器查询', `${notes.container} 条 @container 规则没有套用，相关样式缺失`);
  if (hit.badVar) F.warn('CSS 变量', `${hit.badVar} 处 var() 找不到值，这几条样式已忽略`);
  if (cascadeBad.length) F.warn('样式内联', `${cascadeBad.length} 个元素的样式写进 style 属性后，位置或尺寸与原稿不同`, cascadeBad.map(id => doc.querySelector(`[${ID}="${id}"]`)).filter(Boolean));
  if (stuck.length) F.warn('位置偏差', `${stuck.length} 个行内元素无法用位移校正`, '多为文字片段。位置可能与原稿略有偏差。', stuck.map(id => doc.querySelector(`[${ID}="${id}"]`)).filter(Boolean));
  if (notes.media) F.info('屏宽适配', `${notes.media} 条 @media 规则按正文 ${width}px 宽取值`, '成品靠等比缩放适配其他屏宽，不再随断点切换。');

  return { F, preview, original, targetV, n, moved, outlined, pageBg };
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
