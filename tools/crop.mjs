// e2e 逐像素比对没过时，从 test/out/diff*.png 里挑差异最多的几段，原稿 | 成品 | 差异并排裁出来存 test/out/crop*.png。用法：node tools/crop.mjs [宽度后缀，如 320]
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.ts';
const b = await puppeteer.launch({ executablePath: findChrome(), headless: true });
const p = await b.newPage();
const res = await p.evaluate(
  async (d, o, c) => {
    const load = s =>
      new Promise(r => {
        const i = new Image();
        i.onload = () => r(i);
        i.src = 'data:image/png;base64,' + s;
      });
    const [im, io, ic] = await Promise.all([load(d), load(o), load(c)]);
    const w = im.width,
      h = im.height;
    const cv = new OffscreenCanvas(w, h);
    const x = cv.getContext('2d');
    x.drawImage(im, 0, 0);
    const px = x.getImageData(0, 0, w, h).data;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let i = 0; i < w; i++) {
        const k = (y * w + i) * 4;
        if (px[k] === 255 && px[k + 1] === 0) n++;
      }
      rows.push(n);
    }
    const bands = [];
    let cur = null;
    rows.forEach((n, y) => {
      if (n > 2) {
        if (!cur || y - cur[1] > 12) bands.push((cur = [y, y, 0]));
        cur[1] = y;
        cur[2] += n;
      }
    });
    const top = bands.sort((a, b) => b[2] - a[2]).slice(0, 4);
    const crops = [];
    for (const [y0, y1] of top) {
      const ys = Math.max(0, y0 - 20),
        hh = Math.min(h - ys, y1 - y0 + 40, 420);
      const c2 = new OffscreenCanvas(w * 3 + 20, hh),
        x2 = c2.getContext('2d');
      x2.fillStyle = '#fff';
      x2.fillRect(0, 0, c2.width, hh);
      x2.drawImage(io, 0, ys, w, hh, 0, 0, w, hh);
      x2.drawImage(ic, 0, ys, w, hh, w + 10, 0, w, hh);
      x2.drawImage(im, 0, ys, w, hh, 2 * w + 20, 0, w, hh);
      const bl = await c2.convertToBlob();
      const u = new Uint8Array(await bl.arrayBuffer());
      let s = '';
      for (const v of u) s += String.fromCharCode(v);
      crops.push(btoa(s));
    }
    return { bands: top.map(t => t.join('-')), crops };
  },
  ...['diff', 'original', 'converted'].map(n =>
    fs.readFileSync(`test/out/${n}${process.argv[2] ? '-' + process.argv[2] : ''}.png`).toString('base64'),
  ),
);
console.log(res.bands);
res.crops.forEach((c, i) => fs.writeFileSync(`test/out/crop${i}.png`, Buffer.from(c, 'base64')));
await b.close();
