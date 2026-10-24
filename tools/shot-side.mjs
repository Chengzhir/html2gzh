// 侧栏截图：看字体卡的排版。用法：node tools/shot-side.mjs <文章> [svg|text]   svg：按 test/ui.mjs 的测试勾选转为路径
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.ts';
import { pickDefault } from '../test/ui.mjs';
import { startServer } from '../test/serve.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [ARTICLE, MODE = 'svg'] = process.argv.slice(2);
if (!ARTICLE) {
  console.error('用法：node tools/shot-side.mjs <文章> [svg|text]');
  process.exit(1);
}
const IMG = 48982,
  UI = 48983;
const srv = await startServer({ article: ARTICLE, img: IMG, ui: UI });
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${UI}/`);
  await page.waitForFunction(() => window.__wxc.result, { timeout: 180000 });
  if (MODE === 'svg') await pickDefault(page);
  // 侧栏可滚动：把它撑开到内容高度再截
  const h = await page.$eval('.side', e => e.scrollHeight);
  await page.setViewport({ width: 1400, height: h + 20 });
  await page.$eval('.side', e => {
    e.style.height = 'auto';
  });
  const card = await page.$('section[aria-labelledby="fontTitle"]');
  await card.screenshot({ path: path.join(HERE, '..', 'test', 'out', `side-fonts-${MODE}.png`) });
  console.log('saved', `test/out/side-fonts-${MODE}.png`);
} finally {
  await browser.close();
  srv.stop();
}
