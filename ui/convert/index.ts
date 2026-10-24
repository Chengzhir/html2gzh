import { ID, idOf, isHtmlEl, measure, layoutRect, diffBoxes, loadFrame, sleep, viewOf } from './util.ts';
import { collectRules, matchRules, cascadeOrder, toStyle } from './cascade.ts';
import type { CascadeNotes, MatchedSlots, StyleEnv, UnitHits } from './cascade.ts';
import { convertPositions, correctOffsets, INHERITED } from './position.ts';
import { cleanStructure, keepShapes, squashWhitespace, keepNoWrap, cleanAttributes } from './structure.ts';
import { mergeWidths, annotateContainerWidths, stripTool, markIgnoreWidth } from './responsive.ts';
import { DEFAULT_OPTS, REF_W, parseRules, phoneFonts } from './fonts.ts';
import { planFonts, outline, decide, finalize, webFamilies, whyCode, missMsgs } from './outline.ts';
import type { FontPlan, OutlineNotes, OutlineResult } from './outline.ts';
import type { FontRule } from './fonts.ts';
import { READER_CSS, NEUTRAL, previewDoc, readerImages, pinImages } from './reader.ts';
import type { ImagePins } from './reader.ts';
import { prepareSvgs, convertSvgs } from './svg/index.ts';
import type { RasterHit } from './svg/raster.ts';
import { wechatClean, webkitFilter } from './wechat.ts';
import { usedWebFonts, fontFaceCss, sigOf } from './webfonts.ts';
import type { resolveWebFonts } from './webfonts.ts';
import { msg } from './types.ts';
import type {
  AddFinding,
  BoxRect,
  ConvertResult,
  Finding,
  FindingLevel,
  FindingSink,
  FontRow,
  GlyphRequest,
  GlyphResponse,
  Msg,
  OutlineVerdict,
} from './types.ts';

/** 阅读页直接给这几个标签上色、不从父级继承（在线上文章正文里逐个标签实测得出）：转换时把继承到的颜色写到它们自己身上。
 *  blockquote 不在此列：预览/发表时它身上的 color 会被删，所以 structure.ts 直接把它改成 section */
const SELF_COLORED = 'a,mark';
/** 两个转换宽度下量的字号（data-wxc → px）；t 是 335px 在两者之间的插值位置 */
interface Sizes {
  A: Map<string, number> | null;
  B: Map<string, number> | null;
  t?: number;
}
/** 两个宽度的转换共用的上下文：主宽度先跑，填好 plan、web 等，另一个宽度沿用 */
interface ConvertContext {
  o: typeof DEFAULT_OPTS;
  fontRules: FontRule[];
  glyphs: (req: GlyphRequest) => Promise<GlyphResponse>;
  fontBytes: (url: string) => Promise<string | null>;
  plan: FontPlan | null;
  web: Set<string> | null;
  webUsed: ReturnType<typeof usedWebFonts> | null;
  webSig: string;
  webResolved: ReturnType<typeof resolveWebFonts> | null;
  pins: ImagePins;
  notes: OutlineNotes;
  sizes: Sizes;
  svg: {
    raster: ((uri: string) => Promise<string>) | null;
    rasterCache: Map<string, RasterHit>;
    copyText: boolean;
  };
}
interface OutlineStat {
  units: number;
  verdicts: OutlineVerdict[];
  kept: number;
  chars: number;
  bytes: number;
}

function collector(): FindingSink {
  const list: Finding[] = [];
  // 文案代码与参数；parts 是说明后面按情况追加的句子与列表（假值跳过），els 是要在预览里标出的元素
  const add =
    (level: FindingLevel): AddFinding =>
    (code, params = {}, { parts = [], els = [] } = {}) => {
      list.push({
        level,
        code,
        params,
        parts: parts.filter(Boolean) as Finding['parts'],
        ids: els.map(el => (typeof el === 'string' ? el : idOf(el))).filter(Boolean),
      });
    };
  return { list, fixed: add('fixed'), warn: add('warn'), info: add('info'), error: add('error') };
}
const sumOf = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);
const FORCED = ['max-width', 'min-height', 'clear', 'box-sizing', 'height'];
// 微信正文样式里这几项带 !important，只有它们补回时也得带；其余内联声明本来就压得过（规范不建议用 !important）
const READER_IMPORTANT = new Set(['max-width', 'box-sizing', 'height']);
/** 内容结构检测直接把这几个宽度设成正文区宽来量（见其 xr 数组） */
const STRUCTURE_WIDTHS = [375, 585, 677];
/** 比对用的正文宽度：常见手机，加上内容结构检测用的宽度 */
const CHECK_WIDTHS = [320, 335, 353, 372, 374, 375, 460, 585, 677];
const FLOW = /^(block|flow-root|list-item)$/;

// 原稿在各比对宽度下的盒子，跨次转换复用：转换帧不运行脚本，图片与字体按内容编号引用，同一份 HTML 同一宽度量出的盒子相同。
// 只换勾选、字号下限时不必在每个宽度下重新装载原稿
let originalBoxes: { html: string; byWidth: Map<number, Map<string, BoxRect>> } = { html: '', byWidth: new Map() };
async function originalBoxesAt(frame: HTMLIFrameElement, html: string, width: number) {
  if (originalBoxes.html !== html) originalBoxes = { html, byWidth: new Map() };
  const known = originalBoxes.byWidth.get(width);
  if (known) return known;
  const doc = await loadFrame(frame, html, width);
  const boxes = measure(doc, false);
  // 字体或图片没在时限内加载完时量出的盒子不记，下次转换再量
  if (doc.fonts.status === 'loaded' && [...doc.images].every(img => img.complete))
    originalBoxes.byWidth.set(width, boxes);
  return boxes;
}

type CssAnim = CSSAnimation & { effect: KeyframeEffect };
export interface ConvertOptions {
  width: number;
  frame: HTMLIFrameElement;
  verifyFrame: HTMLIFrameElement;
  opts?: Partial<typeof DEFAULT_OPTS>;
  glyphs: (req: GlyphRequest) => Promise<GlyphResponse>;
  /** data: 地址 → 登记后的图片地址 */
  raster?: ((uri: string) => Promise<string>) | null;
  /** 网页字体地址 → 本机服务里的文件 id */
  fontBytes: (url: string) => Promise<string | null>;
}

/**
 * 输入已改写好图片地址的 HTML。按 width 与另一个宽度各转换一遍，合并成随宽度等比缩放的成品，
 * 再在多个正文宽度下与原稿逐元素比对。payload 里的本地图片地址由调用方换成公网地址。
 */
export async function convert(
  html: string,
  { width, frame, verifyFrame, opts = {}, glyphs, raster = null, fontBytes }: ConvertOptions,
): Promise<ConvertResult> {
  const options = { ...DEFAULT_OPTS, ...opts };
  const { rules: fontRules, bad: badRules } = parseRules(options.rules);
  // web：原稿用上的网页字体名；webUsed：它们的 @font-face 与文件地址；fontBytes(url) → 本机服务里的文件 id
  const ctx: ConvertContext = {
    o: options,
    fontRules,
    glyphs,
    fontBytes,
    plan: null,
    web: null,
    webUsed: null,
    webSig: '',
    webResolved: null,
    pins: new Map(),
    notes: { miss: new Map(), kinds: new Set(), server: null as Msg | null },
    sizes: { A: null, B: null },
    // copyText：画成位图的文字上方放透明文字，与转为路径的字共用一个选项
    svg: { raster, rasterCache: new Map(), copyText: options.svgCopy },
  };
  const widthB = width < 400 ? width + 64 : width - 64;
  // 字体表的字号按 335px 正文宽折算：在两个转换宽度下量原稿字号，线性插值。主宽度就是 335 时不用量
  if (width !== REF_W) {
    const sizeDoc = await loadFrame(frame, withNeutral(html), widthB);
    tagIds(sizeDoc);
    ctx.sizes.B = readSizes(sizeDoc);
  }
  ctx.sizes.t = (REF_W - width) / (widthB - width);
  const A = await convertAt(html, width, frame, ctx);
  const B = await convertAt(html, widthB, frame, ctx);
  let previewA = A.preview,
    previewB = B.preview,
    outlineStat: OutlineStat | null = null;
  if (A.outlined) {
    const resultsA = A.outlined,
      resultsB = B.outlined ?? [];
    const verdicts = decide(resultsA, resultsB);
    previewA = finalize(previewA, resultsA, verdicts);
    previewB = finalize(previewB, resultsB, verdicts);
    const stat: OutlineStat = { units: verdicts.length, verdicts, kept: 0, chars: 0, bytes: 0 };
    verdicts.forEach((verdict, i) => {
      const result = resultsA[i];
      if (!verdict.keep || !result.ok) return;
      stat.kept++;
      stat.chars += result.chars;
      stat.bytes += result.bytes;
    });
    outlineStat = stat;
  }
  const fonts = fontRows(A.plan, ctx, outlineStat && outlineStat.verdicts);
  const { html: mergedRaw, stat } = mergeWidths(previewA, previewB);
  const findings = A.findings;
  outlineFindings(findings, outlineStat, A.plan, fonts, ctx);
  // 用网页字体、又没转为路径的字：公众号正文加载不了网页字体，手机上换成别的字体
  const webLeft = new Map<string, number>();
  for (const row of fonts)
    if (row.web && row.chars > row.done) webLeft.set(row.web, (webLeft.get(row.web) || 0) + row.chars - row.done);
  if (webLeft.size) findings.warn('webfont', { n: sumOf(webLeft), fonts: [...webLeft.keys()] });
  // 超出正文区的节点会被内容结构检测判为"存在溢出问题"
  const overIds = new Set<string>();
  for (const w of STRUCTURE_WIDTHS)
    for (const id of overflowing(await loadFrame(verifyFrame, previewDoc(mergedRaw), w))) overIds.add(id);
  const { html: marked, n: ignored } = markIgnoreWidth(mergedRaw, [...overIds]);
  const merged = wechatClean(marked);
  if (ignored) findings.fixed('overflow', { n: overIds.size }, { els: [...overIds] });
  const startEnd = alignStartEnd(merged);
  if (startEnd.n) findings.info('alignStartEnd', { n: startEnd.n }, { els: startEnd.els });

  // 主宽度排最后：循环结束时 verifyFrame 停在所选宽度上（复制时的纯文本取自它）
  const widths = [...new Set([...CHECK_WIDTHS.filter(w => w !== width), width])];
  const others: ConvertResult['stats']['others'] = [];
  let visualBad: string[] = [],
    verified = 0,
    verifyBoxes = new Map<string, BoxRect>();
  for (const w of widths) {
    const target = w === width ? A.targetV : await originalBoxesAt(frame, A.original, w);
    const verifyDoc = await loadFrame(verifyFrame, previewDoc(merged), w);
    readerImages(verifyDoc);
    verifyBoxes = measure(verifyDoc, false);
    const bad = diffBoxes(new Map([...target].filter(([id]) => verifyBoxes.has(id))), verifyBoxes, 1.5);
    if (w === width) {
      visualBad = bad;
      verified = verifyBoxes.size;
    } else if (bad.length) others.push([w, bad]);
  }

  if (A.pageBg && A.pageBg !== 'rgb(255, 255, 255)') findings.warn('pageBg', { color: A.pageBg });
  if (badRules.length) findings.warn('badRules', { lines: badRules });
  if (stat.cq)
    findings.fixed('cq', { n: stat.cq }, { parts: [stat.split > 0 && msg('finding.cq.split', { n: stat.split })] });
  // 多宽度比对都过了就只是说明，不必处理
  if (stat.approx)
    (others.length ? findings.warn : findings.info)(
      'approx',
      { n: stat.approx, width },
      { parts: [!others.length && msg('finding.approx.allWithin')] },
    );
  if (stat.diverged) findings.warn('diverged', { n: stat.diverged, width });
  // 375/585/677 是内容结构检测直接用的正文宽，460 补在手机与电脑之间
  const phones = widths.filter(w => w !== width && w < 375),
    rest = widths.filter(w => w !== width && w >= 375);
  if (others.length)
    findings.warn(
      'otherWidths',
      { n: others.length },
      {
        parts: [
          { items: others.map(([w, ids]) => msg('finding.otherWidths.item', { w, n: ids.length })) },
          msg('finding.otherWidths.tail', { width }),
        ],
        els: [...new Set(others.flatMap(([, ids]) => ids))],
      },
    );
  else findings.info('otherWidthsOk', { n: phones.length + rest.length, phones, rest });

  const payload = webkitFilter(stripTool(merged));
  return {
    payload,
    preview: merged,
    original: A.original,
    findings: findings.list,
    fonts,
    stats: {
      chars: payload.length,
      elements: A.n,
      moved: A.moved,
      visualBad,
      verified,
      others,
      outline: outlineStat && {
        units: outlineStat.units,
        kept: outlineStat.kept,
        chars: outlineStat.chars,
        bytes: outlineStat.bytes,
      },
    },
    debug: {
      tv: [...A.targetV],
      v: [...verifyBoxes],
      approx: stat.where,
      verdicts:
        outlineStat &&
        outlineStat.verdicts.map((verdict, i) => ({
          ...verdict,
          id: A.plan.units[i].id,
          run: A.plan.units[i].from != null,
          text: A.plan.units[i].text.slice(0, 40),
        })),
    },
  };
}

/** 字体表：每行的字数、转为路径的字数、没转的原因（原因代码 → 字数），以及手机上的字体栈 */
function fontRows(
  { rows, units, skip }: FontPlan,
  ctx: Pick<ConvertContext, 'fontRules' | 'o'>,
  verdicts: OutlineVerdict[] | null,
): FontRow[] {
  const out = new Map(
    rows.map((row): [string, FontRow] => [
      row.key,
      {
        ...row,
        done: 0,
        why: Object.fromEntries(skip.get(row.key) || []),
        phone: phoneFonts(row.stack, row.weight, ctx.fontRules),
      },
    ]),
  );
  (verdicts || []).forEach((verdict, i) => {
    for (const [key, n] of Object.entries(units[i].rows)) {
      const row = out.get(key);
      if (!row) continue;
      if (verdict.keep) row.done += n;
      else if (ctx.o.paths.includes(key)) {
        const why = whyCode(verdict.why);
        row.why[why] = (row.why[why] || 0) + n;
      }
    }
  });
  return [...out.values()];
}

/** 每个字号（含 ::before/::after）：data-wxc → px；'' 是 body 的 */
function readSizes(doc: Document) {
  const win = viewOf(doc),
    out = new Map([['', parseFloat(win.getComputedStyle(doc.body).fontSize)]]);
  for (const el of doc.querySelectorAll(`[${ID}]`)) {
    const id = idOf(el);
    out.set(id, parseFloat(win.getComputedStyle(el).fontSize));
    if (!isHtmlEl(el)) continue;
    for (const slot of ['before', 'after'])
      out.set(`${id}::${slot}`, parseFloat(win.getComputedStyle(el, '::' + slot).fontSize));
  }
  return out;
}
/**
 * 元素的字号折算到 335px 正文宽：找最近的、两个宽度下都量过的原稿元素，按它字号随宽度的变化比例换算。
 * 原稿元素在转换中拆出来的工具元素（伪元素改成的 span 记在 pseudoSrc 里，包装元素没有 id）跟着这个比例走
 */
function sizeAtRef(sizes: Sizes, pseudoSrc: Map<string, string>) {
  return (el: Element) => {
    const px = parseFloat(viewOf(el.ownerDocument).getComputedStyle(el).fontSize);
    const { A, B, t = 0 } = sizes;
    if (!A || !B) return px;
    for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
      const id = ancestor.getAttribute(ID);
      const key = ancestor === ancestor.ownerDocument.body ? '' : id && (pseudoSrc.get(id) || id);
      const sizeA = key == null ? undefined : A.get(key),
        sizeB = key == null ? undefined : B.get(key);
      if (!sizeA || sizeB == null) continue;
      return px * (1 + t * (sizeB / sizeA - 1));
    }
    return px;
  };
}

function outlineFindings(
  findings: FindingSink,
  outlineStat: OutlineStat | null,
  plan: FontPlan,
  fonts: FontRow[],
  ctx: ConvertContext,
) {
  if (outlineStat?.kept)
    findings.fixed(
      'svgPath',
      { n: outlineStat.kept, chars: outlineStat.chars, kb: Math.round(outlineStat.bytes / 1024) },
      { parts: [msg(ctx.o.svgCopy ? 'finding.svgPath.copy' : 'finding.svgPath.noCopy')] },
    );
  if (ctx.notes.server) return findings.warn('svgPathServer', { reason: ctx.notes.server });
  // 与字体表同一组数：勾选的行中没转的字，按原因合计（含选段时就排除的字）
  const why = new Map<string, number>();
  for (const row of fonts)
    for (const [code, n] of Object.entries(row.why)) if (n > 0) why.set(code, (why.get(code) || 0) + n);
  if (!why.size) return;
  const failed = (outlineStat?.verdicts ?? []).flatMap((verdict, i) => (verdict.keep ? [] : [plan.units[i].id]));
  const left = [...new Set([...plan.skipIds, ...failed])];
  const miss = missMsgs(ctx.notes.miss).slice(0, 3);
  const item = (code: string, n: number) =>
    code === 'font' && miss.length
      ? msg('finding.svgPathLeft.itemFonts', { n, why: msg('why.' + code), fonts: { list: miss, sep: 'common.semi' } })
      : msg('finding.svgPathLeft.item', { n, why: msg('why.' + code) });
  const reasons = [...why].toSorted((a, b) => b[1] - a[1]);
  findings.warn(
    'svgPathLeft',
    { n: reasons.reduce((sum, [, n]) => sum + n, 0) },
    { parts: [{ items: reasons.map(([code, n]) => item(code, n)) }], els: left },
  );
}

/** 与内容结构检测同一判据：盒子左右任一侧超出正文区 1px 以上、且不是左右对称居中 */
function overflowing(doc: Document) {
  const box = (doc.querySelector('.rich_media_content') ?? doc.body).getBoundingClientRect();
  const out: string[] = [];
  for (const el of doc.querySelectorAll(`[${ID}]`)) {
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    const centered = Math.abs(rect.left - box.left - (box.right - rect.right)) <= 1;
    if ((rect.left < box.left - 1 || rect.right > box.right + 1) && !centered) out.push(idOf(el));
  }
  return out;
}

// 内容结构检测的分段（其开源引擎 engine/paragraph.ts，默认选项）：含有这些子元素的元素往下拆，其余子元素各算一段
const PARA_BLOCK = /^(P|DIV|SECTION|LI|H[1-6]|TABLE|WX-VIEW)$/;
const PARA_SKIP = /^(STYLE|SCRIPT|META|LINK|TITLE|HEAD|NOSCRIPT|TEMPLATE)$/;
function paragraphs(el: Element, out: Element[] = []) {
  for (const child of el.children) {
    if (PARA_SKIP.test(child.tagName)) continue;
    if (child.tagName !== 'BLOCKQUOTE' && [...child.children].some(kid => PARA_BLOCK.test(kid.tagName)))
      paragraphs(child, out);
    else out.push(child);
  }
  return out;
}
/** 内容结构检测判为"文本对齐属性使用了 start 或 end"的段落里，内联 text-align 为 start/end 的元素 */
function alignStartEnd(html: string) {
  const box = document.implementation.createHTMLDocument('').body;
  box.innerHTML = html;
  const els: string[] = [];
  let n = 0;
  for (const para of paragraphs(box)) {
    if (/^(\s|<br[^>]*>)*$/i.test(para.innerHTML)) continue;
    const hit = [para, ...para.querySelectorAll('[style]')].filter(el =>
      /(^|;)\s*text-align\s*:\s*(start|end)\s*(;|$)/i.test(el.getAttribute('style') || ''),
    );
    if (!hit.length) continue;
    n++;
    for (const el of hit) if (el.hasAttribute(ID)) els.push(idOf(el));
  }
  return { n, els };
}

/** 读屏专用的隐藏文字（1px 裁切）：公众号自带标题栏，这种写法留着会被判"内容溢出容器" */
function dropVisuallyHidden(doc: Document, findings: FindingSink) {
  const win = viewOf(doc);
  let n = 0;
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!el.isConnected || !isHtmlEl(el) || !el.textContent.trim()) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 1.5 || rect.height > 1.5 || !el.getClientRects().length) continue;
    const computed = win.getComputedStyle(el);
    if (computed.overflow === 'visible' && computed.clipPath === 'none' && computed.clip === 'auto') continue;
    el.remove();
    n++;
  }
  if (n) findings.fixed('hiddenText', { n });
}

/** 微信给所有元素加 max-width:100%!important，作者的 max-width 会失效；块级自动宽度的元素改写成 width，效果等同 min(原上限, 100%) */
function keepMaxWidth(doc: Document, root: Element) {
  const win = viewOf(doc);
  let n = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
    const style = el.style,
      computed = win.getComputedStyle(el);
    if (!style.maxWidth.endsWith('px') || (style.width && style.width !== 'auto')) continue;
    if (
      !FLOW.test(computed.display) ||
      computed.float !== 'none' ||
      computed.position !== 'static' ||
      computed.boxSizing !== 'border-box'
    )
      continue;
    if (!el.parentElement || !FLOW.test(win.getComputedStyle(el.parentElement).display)) continue;
    if (
      ![style.marginLeft, style.marginRight].every(margin => !margin || margin === 'auto' || parseFloat(margin) === 0)
    )
      continue;
    style.setProperty('width', style.maxWidth);
    style.setProperty('max-width', '100%');
    n++;
  }
  return n;
}
/** 按一个固定正文宽度转换：所有长度量成 px，供 mergeWidths 拟合 */
const withNeutral = (html: string) =>
  /<head[\s>]/i.test(html)
    ? html.replace(/<head(\s[^>]*)?>/i, `<head$1><style data-wxc-tool>${NEUTRAL}</style>`)
    : `<head><style data-wxc-tool>${NEUTRAL}</style></head>` + html;
/** 重新放回的 @font-face 要重新加载（多半来自缓存）：先排一次版让需要的字体开始加载，等加载完，最多等 8 秒 */
async function settleFonts(doc: Document) {
  doc.body.getBoundingClientRect();
  await sleep(0);
  await Promise.race([doc.fonts.ready, sleep(8000)]);
}
/** 给 body 里的 HTML 元素和 svg 元素编号（data-wxc）；同一份 HTML 装载几次，编号都一样 */
function tagIds(doc: Document) {
  let n = 0;
  for (const el of doc.body.querySelectorAll('*'))
    if (isHtmlEl(el) || el.localName === 'svg') el.setAttribute(ID, 'e' + n++);
  return n;
}

/** 伪元素改成的 span：插到 el 的开头（before）或末尾（after） */
interface PseudoPlan {
  el: HTMLElement;
  slot: 'before' | 'after';
  text: string;
  style: string;
  /** FORCED 各属性在原稿里的计算值 */
  forced: Record<string, string>;
}
interface ConvertAtResult {
  findings: FindingSink;
  preview: string;
  original: string;
  targetV: Map<string, BoxRect>;
  n: number;
  moved: number;
  outlined: OutlineResult[] | null;
  /** 主宽度定下的字体表与单元，另一个宽度沿用 */
  plan: FontPlan;
  pageBg: string | undefined;
}

/** 层叠结果换算成内联样式时要的环境：rem、视口宽、最近查询容器与包含块的尺寸；hit 记各类换算的次数 */
function styleEnv(doc: Document, fontRules: FontRule[]) {
  const win = viewOf(doc),
    computedStyleOf = (el: Element) => win.getComputedStyle(el);
  const hit: UnitHits = { cq: 0, rem: 0, vw: 0, pct: 0, badVar: 0, font: 0 };
  const rem = parseFloat(computedStyleOf(doc.documentElement).fontSize) || 16;
  // 用布局盒（不含 transform）的小数尺寸；clientWidth 会取整，换算出的 px 就差 1。
  // 每量一次都要加、删一张样式表，整页重排一遍；用到 envFor 的几步都不改版面，同一个容器只量一次
  const boxes = new Map<Element, { pw: number; ph: number; c: CSSStyleDeclaration }>();
  const box = (el: Element) =>
    boxes.getOrInsertComputed(el, () => {
      const rect = layoutRect(doc, el),
        computed = computedStyleOf(el);
      return {
        pw: rect.width - parseFloat(computed.borderLeftWidth) - parseFloat(computed.borderRightWidth),
        ph: rect.height - parseFloat(computed.borderTopWidth) - parseFloat(computed.borderBottomWidth),
        c: computed,
      };
    });
  const contentW = (el: Element) => {
    const { pw, c: computed } = box(el);
    return pw - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight);
  };
  const envFor = (el: Element, pseudoAbs?: boolean): StyleEnv => ({
    hit,
    rem,
    vw: win.innerWidth,
    fontRules,
    svg: el.namespaceURI === 'http://www.w3.org/2000/svg' && pseudoAbs === undefined,
    cq: () => {
      for (
        let ancestor = pseudoAbs !== undefined ? el : el.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        if (computedStyleOf(ancestor).containerType !== 'normal') {
          const { ph, c: computed } = box(ancestor);
          return {
            w: contentW(ancestor),
            h: ph - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom),
          };
        }
      }
      return { w: win.innerWidth, h: win.innerHeight };
    },
    // 只有绝对定位元素的 % 要换算：它改成浮动后包含块变了；其余元素的 % 在成品里照样相对原来的父级
    cbw: () => {
      const abs = pseudoAbs !== undefined ? pseudoAbs : /absolute|fixed/.test(computedStyleOf(el).position);
      if (!abs) return null;
      let ancestor = pseudoAbs !== undefined ? el : el.parentElement;
      while (ancestor && ancestor !== doc.body && computedStyleOf(ancestor).position === 'static')
        ancestor = ancestor.parentElement;
      return ancestor && ancestor !== doc.body ? box(ancestor).pw : win.innerWidth;
    },
  });
  return { hit, envFor };
}

/** 逐元素（含 ::before/::after）把层叠结果写成内联样式；want 记下原稿中 FORCED 各属性的计算值，供补回 */
function planStyles(
  doc: Document,
  matched: Map<Element, MatchedSlots>,
  envFor: (el: Element, pseudoAbs?: boolean) => StyleEnv,
  scratch: HTMLElement,
  notes: CascadeNotes,
) {
  const win = viewOf(doc);
  const forcedOf = (computed: CSSStyleDeclaration) =>
    Object.fromEntries(FORCED.map(prop => [prop, computed.getPropertyValue(prop)]));
  const want = new Map<string, Record<string, string>>();
  const plans: [Element, string][] = [],
    pseudos: PseudoPlan[] = [];
  for (const el of doc.body.querySelectorAll('*')) {
    const slots = matched.get(el);
    const inline = el.getAttribute('style');
    const id = el.getAttribute(ID);
    if (id) want.set(id, forcedOf(win.getComputedStyle(el)));
    if (slots || inline)
      plans.push([
        el,
        toStyle(cascadeOrder(slots ? slots.self : [], inline), win.getComputedStyle(el), envFor(el), scratch),
      ]);
    if (
      !slots ||
      !isHtmlEl(el) ||
      /^(img|input|video|iframe|canvas|br|hr|textarea|select|object|embed)$/.test(el.localName)
    )
      continue;
    for (const slot of ['before', 'after'] as const) {
      if (!slots[slot].length) continue;
      const pseudoComputed = win.getComputedStyle(el, '::' + slot);
      if (pseudoComputed.content === 'none' || pseudoComputed.content === 'normal' || pseudoComputed.display === 'none')
        continue;
      const text = contentText(pseudoComputed.content, el, notes);
      if (text == null) continue;
      const style = toStyle(
        cascadeOrder(slots[slot]),
        pseudoComputed,
        envFor(el, /absolute|fixed/.test(pseudoComputed.position)),
        scratch,
      );
      pseudos.push({ el, slot, text, style, forced: forcedOf(pseudoComputed) });
    }
  }
  return { want, plans, pseudos };
}

/** 根容器要带上的继承属性：作者在 html/body 上声明过的，外加行高、字号、对齐（否则会被微信默认值顶掉） */
function rootDeclarations(
  doc: Document,
  matched: Map<Element, MatchedSlots>,
  envFor: (el: Element) => StyleEnv,
  scratch: HTMLElement,
): [string, string][] {
  const win = viewOf(doc),
    bodyComputed = win.getComputedStyle(doc.body);
  const declared = new Set(['line-height', 'font-size', 'text-align']);
  for (const el of [doc.documentElement, doc.body]) {
    const slots = matched.get(el);
    for (const decl of cascadeOrder(slots ? slots.self : [], el.getAttribute('style'))) {
      declared.add(decl.prop);
      if (decl.prop === 'font')
        ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'].forEach(prop => declared.add(prop));
    }
  }
  // 取声明值而不是计算值：line-height:1.7 的计算值是 px，会让字号不同的子孙行高全错。
  // 书写方向取计算值：它可能来自 html、body 上的 dir 属性，样式表里没有声明
  if (bodyComputed.direction !== 'ltr') declared.add('direction');
  const rootScratch = doc.createElement('span');
  for (const el of [doc.documentElement, doc.body]) {
    const slots = matched.get(el);
    const styleText = toStyle(
      cascadeOrder(slots ? slots.self : [], el.getAttribute('style')),
      win.getComputedStyle(el),
      envFor(el),
      scratch,
    );
    for (const prop of (scratch.removeAttribute('style'), scratch.setAttribute('style', styleText), [...scratch.style]))
      rootScratch.style.setProperty(prop, scratch.style.getPropertyValue(prop));
  }
  return INHERITED.filter(prop => declared.has(prop)).map(prop => [
    prop,
    (prop !== 'font-size' && prop !== 'direction' && rootScratch.style.getPropertyValue(prop)) ||
      bodyComputed.getPropertyValue(prop),
  ]);
}

/** 伪元素改成真实的 span；pseudoSrc 记下每个 span 来自哪个元素的哪个伪元素 */
function insertPseudos(pseudos: PseudoPlan[], want: Map<string, Record<string, string>>) {
  const pseudoSrc = new Map<string, string>();
  pseudos.forEach((pseudo, i) => {
    const span = pseudo.el.ownerDocument.createElement('span');
    const id = 'p' + i;
    pseudoSrc.set(id, `${pseudo.el.getAttribute(ID)}::${pseudo.slot}`);
    span.setAttribute(ID, id);
    span.setAttribute('data-wxc-pseudo', pseudo.slot);
    if (pseudo.style) span.setAttribute('style', pseudo.style);
    if (pseudo.text) span.textContent = pseudo.text;
    else span.setAttribute('aria-hidden', 'true');
    if (pseudo.slot === 'before') pseudo.el.prepend(span);
    else pseudo.el.append(span);
    want.set(id, pseudo.forced);
  });
  return pseudoSrc;
}

/** 正文包进根容器：根容器自身是查询容器，原稿里没有容器祖先的 cqw 相对视口，成品里相对正文宽度，两者一致 */
function wrapRoot(doc: Document, rootDecl: [string, string][], pageBg: string | undefined) {
  const bodyComputed = viewOf(doc).getComputedStyle(doc.body);
  const root = doc.createElement('section');
  root.setAttribute(ID, 'root');
  root.setAttribute('data-ignore-width', '');
  while (doc.body.firstChild) root.appendChild(doc.body.firstChild);
  doc.body.appendChild(root);
  for (const [prop, value] of rootDecl) root.style.setProperty(prop, value);
  // 阅读页正文区还给这几项设了值（字距 0.544px、自动断词等），原稿没声明的元素会继承过去，换行全变；根容器写回原稿的值
  for (const prop of [
    'letter-spacing',
    'hyphens',
    'text-underline-position',
    'text-underline-offset',
    'text-decoration-skip-ink',
  ]) {
    if (!root.style.getPropertyValue(prop)) root.style.setProperty(prop, bodyComputed.getPropertyValue(prop));
  }
  if (pageBg) root.style.setProperty('background-color', pageBg);
  root.style.setProperty('container-type', 'inline-size');
  return root;
}

/** 套上阅读页的默认样式后，把被它顶掉、因而让元素挪位的 FORCED 属性逐个补回（最多四轮）；返回补回的属性数 */
function forceReaderProps(doc: Document, target: Map<string, BoxRect>, want: Map<string, Record<string, string>>) {
  const win = viewOf(doc);
  let forced = 0;
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (const id of diffBoxes(target, measure(doc, true))) {
      const el = doc.querySelector<HTMLElement | SVGElement>(`[${ID}="${id}"]`),
        wanted = want.get(id);
      if (!el || !wanted) continue;
      const computed = win.getComputedStyle(el);
      for (const prop of FORCED) {
        if (prop === 'height' && el.localName !== 'img') continue;
        if (prop === 'box-sizing' && el.hasAttribute('data-wxc-float')) continue;
        if (prop === 'max-width' && el.style.maxWidth === '100%') continue;
        if (computed.getPropertyValue(prop) === wanted[prop]) continue;
        const pri = READER_IMPORTANT.has(prop) ? 'important' : '';
        if (el.style.getPropertyValue(prop) === wanted[prop] && el.style.getPropertyPriority(prop) === pri) continue;
        el.style.setProperty(prop, wanted[prop], pri);
        changed++;
        forced++;
      }
    }
    if (!changed) break;
  }
  return forced;
}

async function convertAt(
  html: string,
  width: number,
  frame: HTMLIFrameElement,
  ctx: ConvertContext,
): Promise<ConvertAtResult> {
  const findings = collector();
  const doc = await loadFrame(frame, withNeutral(html), width);
  const win = viewOf(doc);
  const computedStyleOf = (el: Element) => win.getComputedStyle(el);

  const n = tagIds(doc);
  const original = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  const layoutBefore = measure(doc, true),
    visualBefore = measure(doc, false);
  if (!ctx.web) {
    ctx.web = webFamilies(doc);
    ctx.webUsed = usedWebFonts(doc);
    ctx.webSig = sigOf(ctx.webUsed);
  }
  if (!ctx.plan && ctx.sizes.B) ctx.sizes.A = readSizes(doc);

  // 层叠：逐元素算出生效声明，伪元素同理
  const notes: CascadeNotes = {
    media: 0,
    fontface: 0,
    keyframes: 0,
    imports: 0,
    container: 0,
    unreadable: 0,
    nested: 0,
    otherPseudo: 0,
    dynamic: 0,
    badSel: 0,
  };
  const rules = collectRules(doc, notes);
  const matched = matchRules(doc, rules, notes);
  const { hit, envFor } = styleEnv(doc, ctx.fontRules);
  const scratch = doc.createElement('span');
  const selfColor = new Map<HTMLElement, string>();
  for (const el of doc.body.querySelectorAll(SELF_COLORED))
    if (isHtmlEl(el)) selfColor.set(el, computedStyleOf(el).color);
  const { want, plans, pseudos } = planStyles(doc, matched, envFor, scratch, notes);
  // 编辑器把 dir="rtl" 改成 dir="auto"（按首个有方向的字判断）：dir 属性与 bdo、bdi 标签带来的书写方向写成内联样式
  const bidi = [...doc.body.querySelectorAll('[dir],bdo,bdi')]
    .filter(isHtmlEl)
    .map(el => [el, computedStyleOf(el).direction, computedStyleOf(el).unicodeBidi] as const);

  // 样式表删掉之前：读下 SVG 里的 CSS 动画（要改写成 SMIL），数一下 HTML 元素上的 CSS 动画（公众号里不会动）
  const svgState = prepareSvgs(doc);
  const htmlAnims = new Set(
    doc
      .getAnimations()
      .filter(
        (a): a is CssAnim =>
          a instanceof win.CSSAnimation && a.effect instanceof win.KeyframeEffect && isHtmlEl(a.effect.target),
      )
      .map(a => a.effect.target),
  ).size;

  const rootDecl = rootDeclarations(doc, matched, envFor, scratch);
  // 页面底色：宽屏上版心两侧露出来的那一块
  const pageBg = [doc.body, doc.documentElement]
    .map(el => computedStyleOf(el).backgroundColor)
    .find(color => color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent');

  // 网页字体的声明留在转换帧里（成品里没有）：校正位置、量字位、转为路径时，排版和原稿用同一套字体
  const faces = fontFaceCss(doc);
  doc.querySelectorAll('style:not([data-wxc-tool]),link[rel~="stylesheet"]').forEach(el => el.remove());
  // 扩展注入的样式表可能挂在 adoptedStyleSheets 上，也一并摘掉，免得校验时还在起作用
  doc.adoptedStyleSheets = [];
  if (faces) {
    const styleEl = doc.createElement('style');
    styleEl.setAttribute('data-wxc-tool', '');
    styleEl.textContent = faces;
    doc.head.appendChild(styleEl);
    await settleFonts(doc);
  }
  for (const [el, style] of plans) {
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
  }
  let bidiFixed = 0;
  for (const [el, dir, unicodeBidi] of bidi) {
    const style = el.style,
      countBefore = style.length;
    if (!style.direction) style.setProperty('direction', dir);
    if (!style.unicodeBidi && unicodeBidi !== 'normal') style.setProperty('unicode-bidi', unicodeBidi);
    if (style.length > countBefore) bidiFixed++;
  }
  doc.body.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));
  const pseudoSrc = insertPseudos(pseudos, want);
  let colorFixed = 0;
  for (const [el, color] of selfColor) {
    if (!el.isConnected || el.style.color) continue;
    el.style.setProperty('color', color);
    colorFixed++;
  }
  dropVisuallyHidden(doc, findings);
  const svg = await convertSvgs(doc, svgState, ctx.svg);
  for (const { level, code, params, parts, els } of svg.findings) findings[level](code, params, { parts, els });
  const root = wrapRoot(doc, rootDecl, pageBg);
  const capped = keepMaxWidth(doc, root);

  const layoutAfter = measure(doc, true),
    visualAfter = measure(doc, false);
  const cascadeBad = diffBoxes(
    new Map([...layoutBefore].filter(([id]) => !id.startsWith('p') && layoutAfter.has(id))),
    layoutAfter,
  );
  const target = new Map(layoutBefore),
    targetV = new Map(visualBefore);
  for (const [id, rect] of layoutAfter)
    if (id.startsWith('p')) {
      target.set(id, rect);
      const visual = visualAfter.get(id);
      if (visual) targetV.set(id, visual);
    }

  // 套上微信正文区的默认样式，把被它顶掉的属性逐个补回
  const readerStyle = doc.createElement('style');
  readerStyle.setAttribute('data-wxc-tool', '');
  readerStyle.textContent = READER_CSS;
  doc.head.appendChild(readerStyle);
  const wrap = doc.createElement('div');
  wrap.className = 'rich_media_content';
  root.before(wrap);
  wrap.appendChild(root);
  let forcedN = forceReaderProps(doc, target, want);

  const layers = convertPositions(doc, root, findings);
  cleanStructure(doc, root, findings);
  keepShapes(doc, root, findings);
  const squashed = squashWhitespace(doc, root);
  const noWrapped = ctx.o.noWrap ? keepNoWrap(doc, root) : 0;
  cleanAttributes(root);
  forcedN += forceReaderProps(doc, target, want);
  const { moved, stuck } = correctOffsets(doc, root, target, layers);
  const pinned = pinImages(doc, root, ctx.pins);
  annotateContainerWidths(doc, root);
  // 路径放在最后：逐字位置要在最终布局里量。主宽度定字体表和单元，另一个宽度沿用同一组描述
  let outlined: OutlineResult[] | null = null;
  const plan = (ctx.plan ??= planFonts(doc, root, {
    picked: new Set(ctx.o.paths),
    web: ctx.web,
    sizeAt: sizeAtRef(ctx.sizes, pseudoSrc),
  }));
  if (plan.units.length) outlined = await outline(doc, root, plan.units, ctx, ctx.notes);

  root.querySelectorAll('[data-wxc-float],[data-wxc-pseudo]').forEach(el => {
    el.removeAttribute('data-wxc-float');
    el.removeAttribute('data-wxc-pseudo');
  });
  const preview = root.outerHTML;

  if (pseudos.length) findings.fixed('pseudo', { n: pseudos.length });
  if (bidiFixed) findings.fixed('bidi', { n: bidiFixed });
  if (capped) findings.fixed('maxWidth', { n: capped });
  if (colorFixed) findings.fixed('linkColor', { n: colorFixed });
  if (pinned)
    findings.fixed(
      'imgSize',
      { n: pinned },
      {
        els: [...root.querySelectorAll('img')].filter(img => {
          const pin = ctx.pins.get(idOf(img));
          return pin && (pin.w || pin.h);
        }),
      },
    );
  if (forcedN) findings.fixed('forced', { n: forcedN });
  if (noWrapped) findings.fixed('noWrap', { n: noWrapped });
  if (hit.font) findings.fixed('fallback', { n: hit.font });
  if (squashed > 200) findings.fixed('whitespace', { n: squashed });
  if (htmlAnims) findings.warn('htmlAnim', { n: htmlAnims });
  if (notes.dynamic) findings.warn('dynamic', { n: notes.dynamic });
  if (notes.otherPseudo) findings.warn('otherPseudo', { n: notes.otherPseudo });
  if (notes.unreadable || notes.imports) findings.warn('sheetsBad', { n: notes.unreadable + notes.imports });
  if (notes.container) findings.warn('container', { n: notes.container });
  if (hit.badVar) findings.warn('badVar', { n: hit.badVar });
  if (cascadeBad.length)
    findings.warn(
      'cascade',
      { n: cascadeBad.length },
      { els: cascadeBad.filter(id => doc.querySelector(`[${ID}="${id}"]`)) },
    );
  if (stuck.length)
    findings.warn('stuck', { n: stuck.length }, { els: stuck.filter(id => doc.querySelector(`[${ID}="${id}"]`)) });
  if (notes.media) findings.info('media', { n: notes.media, width });

  return { findings, preview, original, targetV, n, moved, outlined, plan, pageBg };
}

/** 伪元素 content 计算值 → 文本；counter()/url() 无法转换返回 null */
function contentText(content: string, el: Element, notes: CascadeNotes) {
  let out = '';
  const re =
    /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)|(open-quote|close-quote|no-open-quote|no-close-quote)|([a-z-]+\([^)]*\))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m[1] != null || m[2] != null)
      out += (m[1] ?? m[2])
        .replace(/\\([0-9a-f]{1,6})\s?/gi, (whole: string, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(.)/g, '$1');
    else if (m[3]) out += el.getAttribute(m[3]) || '';
    else if (m[4]) out += m[4] === 'open-quote' ? '“' : m[4] === 'close-quote' ? '”' : '';
    else if (m[5]) {
      notes.otherPseudo++;
      return null;
    }
  }
  return out;
}
