// 原稿 vs 公众号预览页：逐像素叠图
// 用法：node tools/wxshot.mjs <预览链接> <文章目录> [屏宽=375] [--swap]
// 原稿按正文宽（屏宽 - 40）渲染；预览页按手机屏宽打开，只截正文根容器。产物在 test/out/wx-*.png
// --swap：把预览页正文换成 test/out/payload.html（图片按顺序沿用页面里的 mmbiz 地址），
//         用真实阅读页样式验证还没贴进草稿的新版本
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.mjs';

const SWAP = process.argv.includes('--swap');
const [url, dir, sw = '375'] = process.argv.slice(2).filter(a => a !== '--swap');
if (!url || !dir) { console.error('用法：node tools/wxshot.mjs <预览链接> <文章目录> [屏宽]'); process.exit(1); }
const SW = +sw, CW = SW - 40;
const OUT = 'test/out';
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI Language/zh_CN';

const b = await puppeteer.launch({ executablePath: findChrome(), headless: true });
try {
  // 预览页：滚到底触发懒加载图片，再截正文根容器
  const pv = await b.newPage();
  await pv.setUserAgent(UA);
  await pv.setViewport({ width: SW, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await pv.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
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
  // 懒加载：正文图先是占位图，真地址在 data-src；本地截图直接换上。再把悬浮的作者栏、底栏等 fixed 元素藏掉
  await pv.evaluate(() => {
    for (const im of document.querySelectorAll('#js_content img[data-src]')) if (im.src !== im.dataset.src) im.src = im.dataset.src;
    for (const el of document.querySelectorAll('body *')) {
      const p = getComputedStyle(el).position;
      if ((p === 'fixed' || p === 'sticky') && !el.closest('#js_content')) el.style.setProperty('visibility', 'hidden', 'important');
    }
  });
  await pv.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  await pv.evaluate(() => Promise.all([...document.querySelectorAll('#js_content img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))));
  await pv.evaluate(() => document.fonts.ready);
  const box = await pv.evaluate(() => {
    const root = document.querySelector('#js_content > section') || document.querySelector('#js_content');
    const r = root.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, missing: [...document.querySelectorAll('#js_content img')].filter(i => !i.naturalWidth || i.naturalWidth < 10 && i.width > 50).length };
  });
  if (box.missing) console.log(`预览页有 ${box.missing} 张图没加载出来`);
  const B = await pv.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h }, captureBeyondViewport: true, encoding: 'base64' });

  // 原稿：视口宽 = 正文宽，整页截
  const og = await b.newPage();
  await og.setViewport({ width: CW, height: 800, deviceScaleFactor: 1 });
  await og.goto(pathToFileURL(path.join(dir, 'index.html')).href, { waitUntil: 'networkidle0' });
  await og.evaluate(() => document.fonts.ready);
  const A = await og.screenshot({ fullPage: true, encoding: 'base64' });

  const cmp = await b.newPage();
  const r = await cmp.evaluate(async (a, bb) => {
    const load = s => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(bb)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const px = img => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), db = px(ib);
    const dc = new OffscreenCanvas(w, h), dx = dc.getContext('2d'), out = dx.createImageData(w, h);
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      const hit = d > 48; if (hit) bad++;
      out.data[i] = hit ? 255 : da[i] * 0.3 + 178; out.data[i + 1] = hit ? 0 : da[i + 1] * 0.3 + 178; out.data[i + 2] = hit ? 0 : da[i + 2] * 0.3 + 178; out.data[i + 3] = 255;
    }
    dx.putImageData(out, 0, 0);
    // 并排：原稿 | 预览 | 差异
    const gap = 12, H = Math.max(ia.height, ib.height);
    const sc = new OffscreenCanvas(w * 3 + gap * 2, H), sx = sc.getContext('2d');
    sx.fillStyle = '#fff'; sx.fillRect(0, 0, sc.width, H);
    sx.drawImage(ia, 0, 0); sx.drawImage(ib, w + gap, 0); sx.drawImage(dc, (w + gap) * 2, 0);
    const b64 = async c => { const bl = await c.convertToBlob(); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (const v of u) s += String.fromCharCode(v); return btoa(s); };
    return { bad, total: w * h, wa: ia.width, wb: ib.width, ha: ia.height, hb: ib.height, diff: await b64(dc), side: await b64(sc) };
  }, A, B);
  const sfx = SW === 375 ? '' : '-' + SW;
  fs.writeFileSync(path.join(OUT, `wx-original${sfx}.png`), Buffer.from(A, 'base64'));
  fs.writeFileSync(path.join(OUT, `wx-preview${sfx}.png`), Buffer.from(B, 'base64'));
  fs.writeFileSync(path.join(OUT, `wx-diff${sfx}.png`), Buffer.from(r.diff, 'base64'));
  fs.writeFileSync(path.join(OUT, `wx-side${sfx}.png`), Buffer.from(r.side, 'base64'));
  console.log(`屏宽 ${SW}：原稿 ${r.wa}×${r.ha}，预览正文 ${r.wb}×${r.hb}`);
  console.log(`差异像素 ${(r.bad / r.total * 100).toFixed(3)}%（${r.bad}/${r.total}）  图：${OUT}/wx-side${sfx}.png、wx-diff${sfx}.png`);
} finally {
  await b.close();
}
