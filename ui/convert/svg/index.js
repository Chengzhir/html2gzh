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
 * 返回 { stat, findings: [[level, title, text, detail, els]] }
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

const CSS_WHY = { 'css:root': '动画作用在最外层的 svg 元素上，本工具只改写 svg 内部元素上的动画。如需播放，请把动画移到内层的 <g> 元素上', 'css:paused': '处于暂停状态的动画', 'css:composite': 'animation-composition 叠加',
  'css:zero': '时长为 0 的动画', 'css:easing': '无法识别的缓动函数', 'css:transform': 'SMIL 无法表示的变换写法（matrix、3D、各关键帧的变换函数不一致）', 'css:mixed': '同一元素上还有 SMIL 变换动画',
};
/** 汇总成检查结果：[等级, 标题, 结论, 详细说明, 要高亮的元素] */
function findings(s, t) {
  const out = [], roots = keys => [...new Set(keys.flatMap(k => t.roots(k)))];
  const keys = [...t.m.keys()], sum = ks => ks.reduce((n, k) => n + t.n(k), 0);
  const done = [s.use && `${s.use} 处 <use> 展开为实际图形`, s.css && `${s.css} 个元素的 CSS 动画改写为 SMIL`, s.whitelist && `${s.whitelist} 条动画改用公众号支持的属性`,
    s.timing && `${s.timing} 条动画的开始、结束时间删除了 id 引用`, s.touch && `${s.touch} 条只响应触摸的动画添加了点击触发`, s.retarget && `${s.retarget} 条动画移入其作用的元素`,
    s.mpath && `${s.mpath} 条路径动画内联了路径数据`, s.images && `${s.images} 张 SVG 内的图片改为背景图（粘贴时由微信转存）`, s.raster && `${s.raster} 组渐变、滤镜、蒙版等效果绘制为位图`,
    s.clip && `${s.clip} 处有动画的图形，裁切改写为嵌套视口或 clip-path`, s.filter && `${s.filter} 处滤镜改写为 CSS 滤镜函数`,
    s.links && `${s.links} 个 SVG 内的链接已删除`].filter(Boolean);
  if (done.length) out.push(['fixed', 'SVG', `对 SVG 进行了 ${done.length} 类改写`, '公众号会删除 SVG 的 id、class、xlink:href 与样式表，依赖这些内容的引用与 CSS 动画都会失效，因此改写为不依赖它们的写法；其中 CSS 动画改写为公众号支持的 SMIL 写法（<animate> 等元素）。\n' + done.map(d => '· ' + d).join('\n'), []]);
  const timing = keys.filter(k => k === 'timing');
  if (timing.length) out.push(['warn', 'SVG 动画触发', `${sum(timing)} 条动画由其他元素触发或衔接，不会播放`, '公众号会删除 id，按 id 引用的触发方式（如 btn.click、a1.end）随之失效。只有触发元素与动画元素是同一个元素时才能保留。', roots(timing)]);
  const css = keys.filter(k => k.startsWith('css:') && k !== 'css:overlap');
  if (css.length) {
    const why = [...new Set(css.map(k => k.startsWith('css:prop:') ? `属性 ${k.slice(9)}` : CSS_WHY[k] || k))];
    out.push(['warn', 'SVG 动画', `${sum(css)} 处 CSS 动画无法改写为 SMIL，在公众号文章中不会播放`, '原因：\n' + why.map(w => '· ' + w).join('\n'), roots(css)]);
  }
  if (t.n('css:overlap')) out.push(['info', 'SVG 动画', `${t.n('css:overlap')} 处叠加的变换动画已按先后顺序近似改写`, '同一元素上有多个变换动画同时运行，SMIL 只能按先后顺序叠加，效果可能与原稿略有不同。', t.roots('css:overlap')]);
  const anim = keys.filter(k => k.startsWith('anim:'));
  if (anim.length) out.push(['warn', 'SVG 动画', `${sum(anim)} 条动画改变的属性不受公众号支持，保存草稿时会被删除`, `属性：${[...new Set(anim.map(k => k.slice(5)))].join('、')}。`, roots(anim)]);
  const paint = keys.filter(k => k.startsWith('paint:'));
  if (paint.length) out.push(['warn', 'SVG 渐变', `${sum(paint)} 处有动画的图形使用了渐变或图案，已改为纯色`, '公众号会删除 id，渐变与图案因此无法引用。渐变改为各色标的平均色；图案改为 fill 或 stroke 中声明的备用颜色，没有声明备用颜色时不填充。', roots(paint)]);
  const ref = keys.filter(k => k.startsWith('ref:'));
  if (ref.length) {
    const what = { 'ref:clip': '裁切', 'ref:filter': '滤镜', 'ref:mask': '蒙版（已删除，图形完整显示）', 'ref:marker': '箭头等标记', 'ref:textPath': '沿路径排列的文字', 'ref:other': '其他引用' };
    out.push(['warn', 'SVG 效果', `${sum(ref)} 处有动画的图形使用了公众号不支持的效果`, `无法保留：${[...new Set(ref.map(k => what[k] || k))].join('、')}。`, roots(ref)]);
  }
  if (t.n('clip:approx')) out.push(['info', 'SVG 效果', `${t.n('clip:approx')} 处有动画的图形，裁切已近似保留`, '原稿用多个形状按 evenodd 规则裁切，改写后的裁切区域只能近似。', t.roots('clip:approx')]);
  const rf = keys.filter(k => k === 'raster:fail' || k === 'raster:image' || k === 'image:size' || k === 'use:bad');
  if (rf.length) out.push(['warn', 'SVG', `${sum(rf)} 处未能处理，在公众号文章中可能显示不全`, '可能的原因：绘制位图失败、图片无法读取，或者引用的元素不存在。', roots(rf)]);
  if (t.n('raster:text')) out.push(['info', 'SVG 位图', `${t.n('raster:text')} 组绘制为位图的内容含有文字，读者无法选中、复制这些文字`, '这些文字带有渐变、滤镜、蒙版等效果，或者位于带有这些效果的图形中，因此与图形一起绘制为位图。如需保留为文字，请去掉文字上的这些效果，或者把文字移出这些图形。', t.roots('raster:text')]);
  return out;
}
