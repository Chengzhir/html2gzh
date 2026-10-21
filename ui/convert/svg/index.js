// SVG 兼容：公众号存储时删掉 SVG 里所有 id/class/xlink:href、白名单外的 <animate>、非 mmbiz 的 <image>，样式表也留不下。
// 依赖这些的写法改成等价的；改不了的静态部分画成位图，有动画的尽量保留动画并报出近似之处
import { SVG_NS, isSvg, tally } from './dom.js';
import { captureCss, cssToSmil } from './css.js';
import { resolveTiming, touchToClick } from './timing.js';
import { fixWhitelist } from './whitelist.js';
import { normalizeHref, retarget, expandUse, inlineMpath, linksToG, imagesToFo, cleanup, danglingRefs } from './structure.js';
import { liftRigid, rasterAll } from './raster.js';
import { fixRefs } from './paint.js';

/** 样式表删掉之前调用：建 id 表，读下 SVG 上的 CSS 动画 */
export function prepareSvgs(doc) {
  const ids = new Map();
  for (const el of doc.querySelectorAll('[id]')) if (!ids.has(el.id)) ids.set(el.id, el);
  if (!doc.getElementsByTagNameNS(SVG_NS, 'svg').length) return null;
  return { ids, anims: captureCss(doc, ids) };
}

const freeze = doc => { for (const s of doc.getElementsByTagNameNS(SVG_NS, 'svg')) { s.pauseAnimations(); s.setCurrentTime(0); } };

/**
 * 层叠已内联、样式表已删掉之后调用。ctx: { raster(dataUri) → 地址, rasterCache: Map, spline }。
 * 返回 { stat, findings: [[level, title, text, els]] }
 */
export async function convertSvgs(doc, st, ctx) {
  if (!st) return { findings: [] };
  const win = doc.defaultView, t = tally(), rep = t.add;
  const stat = {};
  freeze(doc);
  normalizeHref(doc);
  stat.retarget = retarget(doc, st.ids);
  const u = expandUse(doc, st.ids, st.anims);
  stat.use = u.n; if (u.bad) rep('use:bad', null, u.bad);
  stat.mpath = inlineMpath(doc, st.ids);
  stat.links = linksToG(doc);
  const tm = resolveTiming(doc, st.ids);
  stat.timing = tm.fixed;
  for (const a of tm.broken) rep('timing', a);
  stat.css = cssToSmil(doc, st.anims, { spline: !!ctx.spline, rep });
  stat.whitelist = fixWhitelist(doc, st.ids, rep);
  stat.touch = touchToClick(doc);
  freeze(doc);
  for (const root of [...doc.getElementsByTagNameNS(SVG_NS, 'svg')].filter(s => !isSvg(s.parentElement))) {
    liftRigid(root, win, st.ids);
    stat.raster = (stat.raster || 0) + await rasterAll(root, ctx, win, st.ids, rep);
  }
  freeze(doc);
  const fr = fixRefs(doc.documentElement, st.ids, win, rep);
  stat.clip = fr.clip; stat.filter = fr.filter;
  stat.images = imagesToFo(doc, rep);
  danglingRefs(doc, rep);
  cleanup(doc);
  return { stat, findings: findings(stat, t) };
}

const CSS_WHY = { 'css:root': '动画写在最外层 svg 上（它在公众号里是普通元素，样式表留不下）', 'css:paused': '暂停状态的动画', 'css:composite': 'animation-composition 叠加',
  'css:zero': '时长为 0 的动画', 'css:easing': '不认识的缓动函数', 'css:transform': '变换写法 SMIL 表达不了（matrix、3D、各帧函数不一致）', 'css:mixed': '元素上同时有 SMIL 变换动画',
  'css:overlap': '同一元素上几个变换动画叠在一起（按先后近似）' };
/** 汇总成检查结果：[等级, 标题, 正文, 要高亮的元素] */
function findings(s, t) {
  const out = [], roots = keys => [...new Set(keys.flatMap(k => t.roots(k)))];
  const keys = [...t.m.keys()], sum = ks => ks.reduce((n, k) => n + t.n(k), 0);
  const done = [s.use && `${s.use} 处 <use> 展开成实际图形`, s.css && `${s.css} 个元素的 CSS 动画改写成 SMIL`, s.whitelist && `${s.whitelist} 条动画换成公众号支持的属性`,
    s.timing && `${s.timing} 条动画的开始/结束时间去掉了 id 引用`, s.touch && `${s.touch} 条只响应触摸的动画补上了点击触发`, s.retarget && `${s.retarget} 条动画挪进作用的元素里`,
    s.mpath && `${s.mpath} 条路径动画内联了路径`, s.images && `${s.images} 张 SVG 内的图片改成背景图（粘贴时转存）`, s.raster && `${s.raster} 组渐变/滤镜/蒙版等画成位图`,
    s.clip && `${s.clip} 处有动画的图形的裁切改写成视口或 clip-path`, s.filter && `${s.filter} 处滤镜改写成 CSS 滤镜函数`,
    s.links && `${s.links} 个 SVG 内的链接去掉了`].filter(Boolean);
  if (done.length) out.push(['fixed', 'SVG', done.join('；'), []]);
  const timing = keys.filter(k => k === 'timing');
  if (timing.length) out.push(['warn', 'SVG 动画触发', `${sum(timing)} 条动画靠别的元素（id）触发或接力，公众号会删 id，这几条不会播放。触发元素与动画元素是同一个元素时才能保留`, roots(timing)]);
  const css = keys.filter(k => k.startsWith('css:'));
  if (css.length) {
    const why = [...new Set(css.map(k => k.startsWith('css:prop:') ? `属性 ${k.slice(9)}` : CSS_WHY[k] || k))];
    out.push([css.every(k => k === 'css:overlap') ? 'info' : 'warn', 'SVG 动画', `${sum(css)} 处 CSS 动画没法改写成 SMIL，公众号里不动：${why.join('；')}`, roots(css)]);
  }
  const anim = keys.filter(k => k.startsWith('anim:'));
  if (anim.length) out.push(['warn', 'SVG 动画', `${sum(anim)} 条动画改动的属性公众号不支持，存草稿时会被删：${[...new Set(anim.map(k => k.slice(5)))].join('、')}`, roots(anim)]);
  const paint = keys.filter(k => k.startsWith('paint:'));
  if (paint.length) out.push(['warn', 'SVG 渐变', `${sum(paint)} 处有动画的图形用了渐变或图案，公众号里会失效；渐变换成了平均色，图案换成备用色或不填充`, roots(paint)]);
  const ref = keys.filter(k => k.startsWith('ref:') || k === 'clip:approx');
  if (ref.length) {
    const what = { 'ref:clip': '裁切', 'ref:filter': '滤镜', 'ref:mask': '蒙版（已去掉，图形完整显示）', 'ref:marker': '箭头等标记', 'ref:textPath': '沿路径排的文字', 'ref:other': '其他引用', 'clip:approx': '裁切（多形状 evenodd，近似）' };
    out.push(['warn', 'SVG 引用', `${sum(ref)} 处有动画的图形用了公众号不支持的效果，没法保留：${[...new Set(ref.map(k => what[k] || k))].join('、')}`, roots(ref)]);
  }
  const rf = keys.filter(k => k === 'raster:fail' || k === 'raster:image' || k === 'image:size' || k === 'use:bad');
  if (rf.length) out.push(['warn', 'SVG', `${sum(rf)} 处没能处理（画位图失败、图片读不到或引用找不到），公众号里可能显示不全`, roots(rf)]);
  if (t.n('raster:text')) out.push(['info', 'SVG 位图', `${t.n('raster:text')} 组画成位图的部分里有文字，读者不能选中复制`, t.roots('raster:text')]);
  return out;
}
