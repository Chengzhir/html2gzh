// 与公众号编辑器里量到的盒子比对：本地按同一正文宽度渲染成品，按文档顺序配对
// 用法：node tools/wxdiff.mjs [宽度] [boxes.txt]
// boxes.txt 第一行是编辑器里根容器的宽度，第二行是 "标签,x,y,w,h" 空格分隔，坐标为相对根容器左上角
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.ts';

const W = +(process.argv[2] || 578);
const file = process.argv[3] || 'test/out/wxboxes.txt';
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
const editorW = +lines[0];
const TAGS = new Set(['SECTION', 'P', 'FIGURE', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'IMG']);
const LETTERS = new Set([...TAGS].map(t => t[0]));
const theirs = lines[1].trim().split(/\s+/).map(s => [s[0], ...s.slice(1).split(',').map(Number)])
  .filter(r => LETTERS.has(r[0]) && (r[3] || r[4]));

// 图片走本机那个正在跑的服务，否则量出来全是 0 高
const payload = fs.readFileSync('test/out/payload.html', 'utf8')
  .replace(/https?:\/\/[^\s"'<>]+\/a\//g, 'http://127.0.0.1:38960/a/');
const READER = `.rich_media_content{color:rgba(0,0,0,.9);font-size:17px;overflow:hidden;text-align:justify;position:relative;z-index:0;line-height:1.6;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.rich_media_content *{max-width:100%!important;box-sizing:border-box!important;word-wrap:break-word!important}
.rich_media_content p{clear:both;min-height:1em}
.rich_media_content img{height:auto!important}`;
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}${READER}</style></head><body><div class="rich_media_content">${payload}</div></body></html>`;

const b = await puppeteer.launch({ executablePath: findChrome(), headless: true });
const pg = await b.newPage();
await pg.setViewport({ width: W, height: 900 });
await pg.setContent(html, { waitUntil: 'networkidle0' });
const got = await pg.evaluate(tags => {
  const root = document.querySelector('.rich_media_content').firstElementChild;
  const base = root.getBoundingClientRect();
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (!tags.includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    out.push([el.tagName[0], Math.round(r.left - base.left), Math.round(r.top - base.top), Math.round(r.width), Math.round(r.height)]);
  }
  return { w: Math.round(base.width), out };
}, [...TAGS]);
await b.close();

console.log(`宽度 ${W}：编辑器根容器 ${editorW}，本地根容器 ${got.w}`);
console.log(`块级盒：编辑器 ${theirs.length}，本地 ${got.out.length}`);
let bad = 0, worst = 0;
const n = Math.min(theirs.length, got.out.length);
for (let i = 0; i < n; i++) {
  const a = got.out[i], c = theirs[i];
  const d = Math.max(Math.abs(a[1] - c[1]), Math.abs(a[2] - c[2]), Math.abs(a[3] - c[3]), Math.abs(a[4] - c[4]));
  worst = Math.max(worst, d);
  if (d > 2) { bad++; if (bad <= 15) console.log(`  #${i} ${a[0]}/${c[0]} 差 ${d}px   本地 ${a.slice(1).join(',')}   编辑器 ${c.slice(1).join(',')}`); }
}
console.log(bad ? `${bad}/${n} 个盒子偏差 > 2px，最大 ${worst}px` : `全部一致（最大偏差 ${worst}px）`);
