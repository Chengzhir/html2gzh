// 原稿与成品逐元素偏差超过 0.2px 的列出来，附两边的 HTML 片段。用法：node tools/debug.mjs [文章路径]   默认用 test/fixture
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.mjs';
const ART = process.argv[2] || 'test/fixture';
const srv = spawn(process.execPath, ['server.mjs', ART, '--port', '48970', '--ui', '48971', '--no-open'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const b = await puppeteer.launch({ executablePath: findChrome(), headless: true });
const p = await b.newPage();
await p.goto('http://127.0.0.1:48971/');
await p.waitForFunction(() => window.__wxc.result, { timeout: 90000 });
const r = await p.evaluate(() => {
  const s = window.__wxc.result;
  const A = new DOMParser().parseFromString(s.original, 'text/html');
  const B = new DOMParser().parseFromString(s.preview, 'text/html');
  const V = new Map(s.debug.v);
  const f = b => `${b.x.toFixed(2)},${b.y.toFixed(2)} ${b.w.toFixed(2)}x${b.h.toFixed(2)}`;
  const out = [];
  for (const [id, a] of s.debug.tv) {
    const v = V.get(id); if (!v) continue;
    const d = Math.max(Math.abs(a.x - v.x), Math.abs(a.y - v.y), Math.abs(a.w - v.w), Math.abs(a.h - v.h));
    if (d > 0.2) {
      const ea = A.querySelector(`[data-wxc="${id}"]`), eb = B.querySelector(`[data-wxc="${id}"]`);
      out.push(`${id} d=${d.toFixed(2)}  ${f(a)} → ${f(v)}\n   A: ${ea ? ea.outerHTML.slice(0, 70) : '-'}\n   B: ${eb ? eb.outerHTML.slice(0, 260) : '-'}`);
    }
  }
  return out;
});
console.log(r.join('\n'));
await b.close(); srv.kill();
