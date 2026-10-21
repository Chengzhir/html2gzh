// 原稿 vs 公众号预览页：逐像素叠图
// 用法：node tools/wxshot.mjs <预览链接> <文章目录> [屏宽=375] [--swap] [--at 0.37,1.13,0.5@0.75]
// 原稿按正文宽（屏宽 - 40）渲染；预览页按手机屏宽打开，只截正文根容器。产物在 test/out/wx-*.png
// 动画先冻结再截（默认只比 t=0）。--at 另比这几个时刻；t@c 表示冻结在 t、点一遍标了 data-click 的元素、再跳到 c，
// 与 e2e 的动画采样相同。非 0 时刻屏蔽标了 data-sample-skip 的元素，任何时刻都屏蔽 data-pixel-skip
// --swap：把预览页正文换成 test/out/payload.html（图片按顺序沿用页面里的 mmbiz 地址），
//         用真实阅读页样式验证还没贴进草稿的新版本
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.mjs';
import { NEUTRAL } from '../ui/convert/reader.js';
import { pixelDiff } from '../test/pixeldiff.mjs';

const pos = [], AT = [];
let SWAP = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--swap') SWAP = true;
  else if (a === '--at') {
    for (const s of (process.argv[++i] || '').split(',')) {
      const [t, c] = s.split('@').map(Number);
      if (Number.isFinite(t)) AT.push({ t, c: Number.isFinite(c) ? c : null });
    }
  } else pos.push(a);
}
const [url, dir, sw = '375'] = pos;
if (!url || !dir) { console.error('用法：node tools/wxshot.mjs <预览链接> <文章目录> [屏宽] [--swap] [--at 时刻,…]'); process.exit(1); }
const SW = +sw, CW = SW - 40;
const OUT = 'test/out';
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI Language/zh_CN';

const b = await puppeteer.launch({ executablePath: findChrome(), headless: true, protocolTimeout: 300000 });
/** CSS 动画的时钟停住（use 影子树里的动画 getAnimations 拿不到，只能这样停在 0）；SMIL 在 freeze 里停 */
async function stopClock(pg) {
  const cdp = await pg.createCDPSession();
  await cdp.send('Animation.enable').then(() => cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })).catch(() => {});
}
const freeze = (pg, t) => pg.evaluate(t => {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
  for (const s of document.querySelectorAll('svg')) { s.pauseAnimations(); s.setCurrentTime(t); }
}, t);

async function openPreview() {
  const pv = await b.newPage();
  await pv.setUserAgent(UA);
  await pv.setViewport({ width: SW, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await stopClock(pv);
  await pv.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  // 滚到底触发懒加载图片
  await pv.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  });
  if (SWAP) {
    const html = fs.readFileSync(path.join(OUT, 'payload.html'), 'utf8');
    const n = await pv.evaluate(h => {
      const jc = document.querySelector('#js_content');
      const srcs = [...jc.querySelectorAll('img')].map(i => i.dataset.src || i.src).filter(s => /mmbiz/.test(s));
      jc.innerHTML = h;
      const imgs = [...jc.querySelectorAll('img')];
      imgs.forEach((im, i) => { if (srcs[i]) im.src = srcs[i]; });
      return [imgs.length, srcs.length];
    }, html);
    console.log(`已换成本地成品：${n[0]} 张图，沿用 ${n[1]} 个 mmbiz 地址`);
  }
  // 懒加载：正文图先是占位图，真地址在 data-src；背景图换成 1×1 占位，真地址在 data-lazy-bgimg。
  // 懒加载模块要等微信客户端的接口就绪才启动，无头浏览器里不会运行，这里直接换上。再把悬浮的作者栏、底栏等 fixed 元素藏掉
  await pv.evaluate(() => {
    for (const im of document.querySelectorAll('#js_content img[data-src]')) if (im.src !== im.dataset.src) im.src = im.dataset.src;
    for (const el of document.querySelectorAll('#js_content [data-lazy-bgimg]')) el.style.backgroundImage = `url("${el.getAttribute('data-lazy-bgimg')}")`;
    for (const el of document.querySelectorAll('body *')) {
      const p = getComputedStyle(el).position;
      if ((p === 'fixed' || p === 'sticky') && !el.closest('#js_content')) el.style.setProperty('visibility', 'hidden', 'important');
    }
  });
  await pv.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  await pv.evaluate(() => Promise.all([
    ...[...document.querySelectorAll('#js_content img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })),
    ...[...document.querySelectorAll('#js_content [data-lazy-bgimg]')].map(el => new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = el.getAttribute('data-lazy-bgimg'); })),
  ]));
  await pv.evaluate(() => document.fonts.ready);
  return pv;
}
async function openOriginal() {
  const og = await b.newPage();
  await og.setViewport({ width: CW, height: 800, deviceScaleFactor: 1 });
  await stopClock(og);
  await og.goto(pathToFileURL(path.join(dir, 'index.html')).href, { waitUntil: 'networkidle0' });
  // 和转换器的"原稿"一致：去掉 html/body 的外边距与滚动条（转换时同样先加这段样式再量）
  await og.addStyleTag({ content: NEUTRAL });
  await og.evaluate(() => document.fonts.ready);
  return og;
}
const rootBox = pg => pg.evaluate(() => {
  const root = document.querySelector('#js_content > section') || document.querySelector('#js_content');
  const r = root.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, missing: [...document.querySelectorAll('#js_content img')].filter(i => !i.naturalWidth || i.naturalWidth < 10 && i.width > 50).length };
});
/** 不比像素的区域，坐标相对截图左上角 */
const maskRects = (pg, sampled, o) => pg.evaluate((sampled, o) => [...document.querySelectorAll(sampled ? '[data-pixel-skip],[data-sample-skip]' : '[data-pixel-skip]')]
  .map(e => { const r = e.getBoundingClientRect(); return [r.left + scrollX - o.x, r.top + scrollY - o.y, r.width, r.height]; }), sampled, o);

/** 逐像素比：屏蔽区域外扩 3px 画成浅蓝，不计入；返回差异图与并排图（原稿 | 预览 | 差异） */
async function compare(A, B, masks) {
  const cmp = await b.newPage();
  const r = await pixelDiff(cmp, A, B, masks, { side: true });
  await cmp.close();
  return r;
}

try {
  const pv = await openPreview(), og = await openOriginal();
  const sfx = SW === 375 ? '' : '-' + SW;
  for (const s of [{ t: 0, c: null }, ...AT]) {
    // 点击会改变状态，每个点击时刻重开两边的页面
    const fresh = s.c != null;
    const P = fresh ? await openPreview() : pv, O = fresh ? await openOriginal() : og;
    await freeze(P, s.t); await freeze(O, s.t);
    if (fresh) {
      // 无头浏览器不给后台标签页排版出帧：点击（要等元素进入视口）和截图前，先把那一页切到前台。
      // 预览页的点击不往上冒泡：阅读页在 document 上挂了点击处理（图片预览等）；同一元素上的 SMIL 点击触发不受影响
      const tap = h => Promise.race([h.click(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
      await P.bringToFront();
      await P.evaluate(() => { for (const e of document.querySelectorAll('#js_content [data-click]')) e.addEventListener('click', ev => ev.stopPropagation()); });
      for (const h of await P.$$('#js_content [data-click]')) await tap(h);
      await O.bringToFront();
      for (const h of await O.$$('[data-click]')) await tap(h);
      await freeze(P, s.c); await freeze(O, s.c);
    }
    const box = await rootBox(P);
    if (box.missing) console.log(`预览页有 ${box.missing} 张图没加载出来`);
    const sampled = s.t !== 0 || fresh;
    const masks = [...await maskRects(P, sampled, box), ...await maskRects(O, sampled, { x: 0, y: 0 })];
    await P.bringToFront();
    const B = await P.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h }, captureBeyondViewport: true, encoding: 'base64' });
    await O.bringToFront();
    const A = await O.screenshot({ fullPage: true, encoding: 'base64' });
    const r = await compare(A, B, masks);
    const tag = sfx + (fresh ? `-t${s.t}c${s.c}` : s.t ? `-t${s.t}` : '');
    fs.writeFileSync(path.join(OUT, `wx-original${tag}.png`), Buffer.from(A, 'base64'));
    fs.writeFileSync(path.join(OUT, `wx-preview${tag}.png`), Buffer.from(B, 'base64'));
    fs.writeFileSync(path.join(OUT, `wx-diff${tag}.png`), Buffer.from(r.diff, 'base64'));
    fs.writeFileSync(path.join(OUT, `wx-side${tag}.png`), Buffer.from(r.side, 'base64'));
    const when = fresh ? `冻结在 ${s.t}s、点击后跳到 ${s.c}s` : `t=${s.t}s`;
    console.log(`屏宽 ${SW}，${when}：原稿 ${r.wa}×${r.ha}，预览正文 ${r.wb}×${r.hb}`);
    console.log(`  差异像素 ${(r.bad / (r.total - r.area) * 100).toFixed(3)}%（${r.bad}/${r.total - r.area}${r.area ? `，屏蔽 ${(r.area / r.total * 100).toFixed(1)}%` : ''}）  图：${OUT}/wx-side${tag}.png`);
    if (fresh) { await P.close(); await O.close(); }
  }
} finally {
  await b.close();
}
