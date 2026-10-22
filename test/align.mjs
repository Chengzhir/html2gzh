// 轮廓对位：逐个轮廓单元截原稿与成品的同一区域，用墨迹投影互相关量亚像素偏移，再比墨量。
// 被 e2e.mjs --svg 调用；也可单独跑：node test/align.mjs <文章路径> [设备像素比…]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.ts';
import { previewDoc, readerImages } from '../ui/convert/reader.ts';

const VIEW_H = 900;
// origin：先打开本机服务的一个页面再写入内容，原稿引用的本地字体（/a/…）与页面同源，不用跨域
const load = async (browser, html, width, dpr, reader, origin) => {
  const pg = await browser.newPage();
  await pg.setViewport({ width, height: VIEW_H, deviceScaleFactor: dpr });
  if (origin) await pg.goto(origin + '/__blank');
  await pg.setContent(html, { waitUntil: 'networkidle0' });
  await pg.evaluate(() => document.fonts.ready);
  if (reader) await pg.evaluate(`(${readerImages})(document, true)`);
  return pg;
};
// 整页撑成一个超高视口再裁图，超过 Chrome 的截图尺寸上限（约 16384 设备像素）会截错位置；改成逐个滚到视口里截
async function grab(pg, b) {
  // 裁剪框用文档坐标，puppeteer 会和滚动后的视口求交；页尾的框滚不到视口顶部，高度限制在视口内
  const top = await pg.evaluate(y => {
    scrollTo(0, Math.max(0, y));
    return scrollY;
  }, b.y - 40);
  const y = b.y - 4;
  return pg.screenshot({
    clip: { x: b.x - 4, y, width: b.w + 8, height: Math.max(1, Math.min(b.h + 8, top + VIEW_H - y, VIEW_H - 48)) },
    captureBeyondViewport: false,
    encoding: 'base64',
  });
}

/** → [{ unit, dx, dy, ink }]，dx/dy 是成品相对原稿的偏移（CSS px），ink 是成品墨量 / 原稿墨量 */
export async function alignUnits(browser, original, preview, width, dpr, origin) {
  const pc = await load(browser, preview, width, dpr, true, origin);
  // svg 只占第一行，后面几行的字画在它的溢出区：取它所在块的框（文档坐标）
  const boxes = await pc.evaluate(() =>
    [...document.querySelectorAll('svg[data-wxc-unit]')].map(s => {
      const b = s.parentElement.getBoundingClientRect();
      return { i: +s.dataset.wxcUnit, x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height };
    }),
  );
  const C = [];
  for (const b of boxes) C.push(await grab(pc, b));
  await pc.close();
  const po = await load(browser, original, width, dpr, false, origin);
  const O = [];
  for (const b of boxes) O.push(await grab(po, b));
  if (process.env.WXC_ALIGN_DUMP)
    boxes.forEach((b, n) => {
      fs.writeFileSync(path.join(process.env.WXC_ALIGN_DUMP, `align-${b.i}-o.png`), Buffer.from(O[n], 'base64'));
      fs.writeFileSync(path.join(process.env.WXC_ALIGN_DUMP, `align-${b.i}-c.png`), Buffer.from(C[n], 'base64'));
    });
  const res = await po.evaluate(
    async (O, C) => {
      const img = s =>
        new Promise(r => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = 'data:image/png;base64,' + s;
        });
      const px = im => {
        const cv = new OffscreenCanvas(im.width, im.height);
        const x = cv.getContext('2d');
        x.drawImage(im, 0, 0);
        return x.getImageData(0, 0, im.width, im.height).data;
      };
      const out = [];
      for (let n = 0; n < O.length; n++) {
        const [io, ic] = await Promise.all([img(O[n]), img(C[n])]);
        const A = px(io),
          B = px(ic),
          w = io.width,
          h = io.height;
        const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // 背景取出现最多的亮度，墨迹 = 与背景的亮度差（深底浅字、浅底深字都适用）
        const hist = new Map();
        for (let i = 0; i < A.length; i += 4) {
          const k = Math.round(lum(A, i));
          hist.set(k, (hist.get(k) || 0) + 1);
        }
        const bg = [...hist].sort((a, b) => b[1] - a[1])[0][0];
        const prof = (d, ax) => {
          const o = new Float64Array(ax ? h : w);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) o[ax ? y : x] += Math.abs(lum(d, (y * w + x) * 4) - bg);
          return o;
        };
        const shift = (a, b) => {
          const corr = s => {
            let t = 0;
            for (let i = 0; i < a.length; i++) {
              const j = i + s;
              if (j >= 0 && j < b.length) t += a[i] * b[j];
            }
            return t;
          };
          let best = 0,
            bv = -1;
          for (let s = -6; s <= 6; s++) {
            const v = corr(s);
            if (v > bv) {
              bv = v;
              best = s;
            }
          }
          const l = corr(best - 1),
            r = corr(best + 1);
          return best + (l - r) / (2 * (l - 2 * bv + r) || 1);
        };
        const sum = a => a.reduce((s, v) => s + v, 0);
        const ox = prof(A, 0),
          cx = prof(B, 0);
        out.push({ dx: shift(ox, cx), dy: shift(prof(A, 1), prof(B, 1)), ink: sum(cx) / sum(ox) });
      }
      return out;
    },
    O,
    C,
  );
  await po.close();
  return boxes.map((b, n) => ({
    unit: b.i,
    dx: +(res[n].dx / dpr).toFixed(3),
    dy: +(res[n].dy / dpr).toFixed(3),
    ink: +res[n].ink.toFixed(3),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ARTICLE = path.resolve(process.argv[2]);
  const DPRS = process.argv.slice(3).map(Number).filter(Boolean);
  const IMG = 48980,
    UI = 48981;
  const { startServer } = await import('./serve.mjs');
  const srv = await startServer({ article: ARTICLE, img: IMG, ui: UI });
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    const ui = await browser.newPage();
    await ui.goto(`http://127.0.0.1:${UI}/`);
    await ui.waitForFunction(() => window.__wxc.result, { timeout: 180000 });
    const { pickDefault } = await import('./ui.mjs');
    await pickDefault(ui);
    const r = await ui.evaluate(() => ({
      original: window.__wxc.result.original,
      preview: window.__wxc.result.preview,
      verdicts: window.__wxc.result.debug.verdicts,
    }));
    r.preview = previewDoc(r.preview);
    const rows = [];
    for (const dpr of DPRS.length ? DPRS : [1, 3])
      for (const a of await alignUnits(browser, r.original, r.preview, 335, dpr, `http://127.0.0.1:${UI}`))
        rows.push({ dpr, ...a, text: (r.verdicts[a.unit] || {}).text });
    console.table(rows);
  } finally {
    await browser.close();
    srv.stop();
  }
}
