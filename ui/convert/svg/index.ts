// SVG 兼容：公众号存储时删掉 SVG 里所有 id/class/xlink:href、白名单外的 <animate>、非 mmbiz 的 <image>，样式表也留不下。
// 依赖这些的写法改成等价的；改不了的静态部分画成位图，有动画的尽量保留动画并报出近似之处
import { SVG_NS, isSvg, tally } from './dom.ts';
import { captureCss, cssToSmil } from './css.ts';
import { resolveTiming, touchToClick } from './timing.ts';
import { fixWhitelist } from './whitelist.ts';
import {
  normalizeHref,
  retarget,
  expandUse,
  inlineMpath,
  linksToG,
  imagesToFo,
  cleanup,
  danglingRefs,
} from './structure.ts';
import { liftRigid, rasterAll } from './raster.ts';
import type { RasterContext } from './raster.ts';
import type { CssAnims } from './css.ts';
import { fixRefs } from './paint.ts';
import { msg } from '../types.ts';
import type { FindingLevel, FindingPart, Msg, Param } from '../types.ts';
import { viewOf } from '../util.ts';

/** SVG 转换的检查结果：文案 finding.svg.<code>，els 是要标出的最外层 svg */
export interface SvgFinding {
  level: FindingLevel;
  code: string;
  params: Record<string, Param>;
  parts: FindingPart[];
  els: Element[];
}

/** prepareSvgs 的结果：id 表与 SVG 上的 CSS 动画 */
export interface SvgState {
  ids: Map<string, Element>;
  anims: CssAnims;
}
/** 样式表删掉之前调用：建 id 表，读下 SVG 上的 CSS 动画 */
export function prepareSvgs(doc: Document): SvgState | null {
  const ids = new Map<string, Element>();
  for (const el of doc.querySelectorAll('[id]')) ids.getOrInsert(el.id, el);
  if (!doc.getElementsByTagNameNS(SVG_NS, 'svg').length) return null;
  return { ids, anims: captureCss(doc, ids) };
}

/** 各类改写的处数 */
interface SvgStat {
  retarget?: number;
  use?: number;
  mpath?: number;
  links?: number;
  timing?: number;
  css?: number;
  whitelist?: number;
  touch?: number;
  raster?: number;
  clip?: number;
  filter?: number;
  images?: number;
}
const freeze = (doc: Document) => {
  for (const svg of doc.getElementsByTagNameNS(SVG_NS, 'svg') as HTMLCollectionOf<SVGSVGElement>) {
    svg.pauseAnimations();
    svg.setCurrentTime(0);
  }
};

/**
 * 层叠已内联、样式表已删掉之后调用。ctx: { raster(dataUri) → 地址, rasterCache: Map, copyText }。
 * 返回 { stat, findings: SvgFinding[] }
 */
export async function convertSvgs(
  doc: Document,
  st: SvgState | null,
  ctx: RasterContext,
): Promise<{ stat?: SvgStat; findings: SvgFinding[] }> {
  if (!st) return { findings: [] };
  const win = viewOf(doc),
    counts = tally(),
    rep = counts.add;
  const stat: SvgStat = {};
  freeze(doc);
  normalizeHref(doc);
  stat.retarget = retarget(doc, st.ids);
  const used = expandUse(doc, st.ids, st.anims);
  stat.use = used.n;
  if (used.bad) rep('use:bad', null, used.bad);
  stat.mpath = inlineMpath(doc, st.ids);
  stat.links = linksToG(doc);
  const timing = resolveTiming(doc, st.ids);
  stat.timing = timing.fixed;
  for (const anim of timing.broken) rep('timing', anim);
  stat.css = cssToSmil(doc, st.anims, rep);
  stat.whitelist = fixWhitelist(doc, st.ids, rep);
  stat.touch = touchToClick(doc);
  freeze(doc);
  for (const root of [...doc.getElementsByTagNameNS(SVG_NS, 'svg')].filter(svg => !isSvg(svg.parentElement))) {
    liftRigid(root, win, st.ids);
    stat.raster = (stat.raster || 0) + (await rasterAll(root, ctx, win, st.ids, rep));
  }
  freeze(doc);
  const refs = fixRefs(doc.documentElement, st.ids, win, rep);
  stat.clip = refs.clip;
  stat.filter = refs.filter;
  stat.images = imagesToFo(doc, rep);
  danglingRefs(doc, rep);
  cleanup(doc);
  return { stat, findings: findings(stat, counts) };
}

/** 对 SVG 做了的改写，按这个顺序列出；文案 finding.svg.done.<键> */
const DONE: (keyof SvgStat)[] = [
  'use',
  'css',
  'whitelist',
  'timing',
  'touch',
  'retarget',
  'mpath',
  'images',
  'raster',
  'clip',
  'filter',
  'links',
];
/** CSS 动画改写不了的原因（文案 svgWhy.<键>）；css:prop:<属性> 另说 */
const CSS_WHY = new Set(['root', 'paused', 'composite', 'zero', 'easing', 'transform', 'mixed']);
/** 有动画的图形上保留不了的效果（文案 svgRef.<键>） */
const REF_WHAT = new Set(['clip', 'filter', 'mask', 'marker', 'textPath', 'other']);
/** 汇总成检查结果 */
function findings(stat: SvgStat, counts: ReturnType<typeof tally>): SvgFinding[] {
  const out: SvgFinding[] = [],
    roots = (keys: string[]) => [...new Set(keys.flatMap(k => counts.roots(k)))];
  const keys = [...counts.m.keys()],
    sum = (subset: string[]) => subset.reduce((n, k) => n + counts.n(k), 0);
  const add = (
    level: FindingLevel,
    code: string,
    params: Record<string, Param>,
    els: Element[] = [],
    parts: FindingPart[] = [],
  ) => out.push({ level, code: 'svg.' + code, params, parts, els });
  const done = DONE.flatMap(k => {
    const n = stat[k];
    return n ? [msg('finding.svg.done.' + k, { n })] : [];
  });
  if (done.length) add('fixed', 'done', { n: done.length }, [], [{ items: done }]);
  const timing = keys.filter(k => k === 'timing');
  if (timing.length) add('warn', 'timing', { n: sum(timing) }, roots(timing));
  const css = keys.filter(k => k.startsWith('css:') && k !== 'css:overlap');
  if (css.length) {
    const why = new Map<string, Msg>();
    for (const k of css) {
      const reason = k.slice(4);
      if (reason.startsWith('prop:')) why.set(k, msg('svgWhy.prop', { name: reason.slice(5) }));
      else why.set(reason, CSS_WHY.has(reason) ? msg('svgWhy.' + reason) : msg('common.raw', { msg: k }));
    }
    add('warn', 'css', { n: sum(css) }, roots(css), [{ items: [...why.values()] }]);
  }
  if (counts.n('css:overlap')) add('info', 'overlap', { n: counts.n('css:overlap') }, counts.roots('css:overlap'));
  const anim = keys.filter(k => k.startsWith('anim:'));
  if (anim.length) add('warn', 'anim', { n: sum(anim), attrs: [...new Set(anim.map(k => k.slice(5)))] }, roots(anim));
  const paint = keys.filter(k => k === 'paint:avg' || k === 'paint:lost');
  if (paint.length) add('warn', 'paint', { n: sum(paint) }, roots(paint));
  if (counts.n('paint:frozen'))
    add('warn', 'paintFrozen', { n: counts.n('paint:frozen') }, counts.roots('paint:frozen'));
  const ref = keys.filter(k => k.startsWith('ref:'));
  if (ref.length) {
    const what = [...new Set(ref)].map(k =>
      REF_WHAT.has(k.slice(4)) ? msg('svgRef.' + k.slice(4)) : msg('common.raw', { msg: k }),
    );
    add('warn', 'ref', { n: sum(ref), what }, roots(ref));
  }
  if (counts.n('clip:approx')) add('info', 'clipApprox', { n: counts.n('clip:approx') }, counts.roots('clip:approx'));
  const failed = keys.filter(k => k === 'raster:fail' || k === 'raster:image' || k === 'image:size' || k === 'use:bad');
  if (failed.length) add('warn', 'fail', { n: sum(failed) }, roots(failed));
  if (counts.n('raster:text')) add('info', 'rasterText', { n: counts.n('raster:text') }, counts.roots('raster:text'));
  if (counts.n('raster:textCopy'))
    add('info', 'rasterTextCopy', { n: counts.n('raster:textCopy') }, counts.roots('raster:textCopy'));
  return out;
}
