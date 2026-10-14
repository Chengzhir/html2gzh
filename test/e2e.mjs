// 端到端：起真服务 → 无头 Chrome 打开页面 → 转换文章 → 检查成品 + 原稿/成品逐像素比对 + 端口安全探测
// 用法：node test/e2e.mjs [文章路径]   默认用 test/fixture
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTICLE = path.resolve(process.argv[2] || path.join(HERE, 'fixture'));
const IMG = 48960, UI = 48961;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (ok, label, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const raw = (port, p, opts = {}) => new Promise(res => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: opts.headers || {} }, r => {
    let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b }));
  });
  req.on('error', () => res({ status: 0, body: '' }));
  req.end(opts.body);
});

const srv = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs'), ARTICLE, '--port', String(IMG), '--ui', String(UI), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
for (let i = 0; i < 50 && !log.includes('页面'); i++) await new Promise(r => setTimeout(r, 100));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // 模拟浏览器扩展往 iframe 里注入样式：转换器不能把它当成文章样式
  await page.evaluateOnNewDocument(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      set(v) { d.set.call(this, String(v).replace(/<\/head>/i, '<style>@keyframes extfake{to{opacity:1}}@keyframes extfake2{}html{--extvar:1}</style></head>')); },
      get() { return d.get.call(this); },
    });
  });
  await page.goto(`http://127.0.0.1:${UI}/`);
  await page.waitForFunction(() => window.__wxc.result || document.querySelector('.banner.err:not([hidden])'), { timeout: 90000 });
  const r = await page.evaluate(() => {
    const s = window.__wxc;
    return s.result ? { findings: s.result.findings, report: s.result.report, stats: s.result.stats, payload: s.result.payload, preview: s.result.preview, original: s.result.original, approx: s.result.debug.approx }
      : { error: document.getElementById('status').textContent };
  });
  console.log('\n文章 ' + ARTICLE);
  if (r.error) { check(false, '转换', r.error); throw new Error('stop'); }
  check(!errors.length, '页面无脚本错误', errors.slice(0, 3).join(' | '));
  for (const f of [...r.findings].sort((a, b) => a.level.localeCompare(b.level))) console.log(`    [${f.level}] ${f.title}：${f.text}`);
  console.log(`    图片 本地 ${r.report.local} · 缺失 ${r.report.missing.length} · data: ${r.report.dataUri} · 外链 ${r.report.remote}`);

  const p = r.payload;
  const count = re => (p.match(re) || []).length;
  console.log('\n成品检查');
  check(count(/<div\b/g) === 0, '没有 div', String(count(/<div\b/g)));
  check(count(/<blockquote\b/g) === 0, '没有 blockquote（阅读页会删它的 color、强加灰字和竖条）', String(count(/<blockquote\b/g)));
  check(count(/\sclass=/g) === 0, '没有 class');
  check(count(/[\s;"]position\s*:/g) === 0, '没有 position', String(count(/[\s;"]position\s*:/g)));
  check(count(/var\(|--[a-z]/g) === 0, '没有 CSS 变量');
  check(count(/\d(rem|vh|cq[hb])\b/g) === 0, '没有 rem/vh/cqh');
  check(count(/calc\(|min\(|max\(|clamp\(/g) === 0, '没有 calc()/min()/max()（微信存储会删整条声明）');
  const imp = [...p.matchAll(/([a-z-]+):[^;"]*!important/g)].map(m => m[1]);
  check(imp.every(k => /^(max-width|box-sizing|height)$/.test(k)), '!important 只用在微信强制的属性上', `${imp.length} 处 ${[...new Set(imp)].join(',')}`);
  check(/^<section data-ignore-width="" style="[^"]*container-type: inline-size/.test(p), '根容器是查询容器且豁免宽度检测');
  // 检测器的段落级溢出只看段落节点自身属性：在 375/585/677 屏宽（正文 335/545/637）下逐个复核
  const prev = await page.evaluate(async frag => (await import('./convert/index.js')).previewDoc(frag), r.preview);
  const unexempt = [];
  for (const w of [335, 545, 637]) {
    const pg = await browser.newPage();
    await pg.setViewport({ width: w, height: 800 });
    await pg.setContent(prev, { waitUntil: 'networkidle0' });
    unexempt.push(...await pg.evaluate(() => {
      const box = document.querySelector('.rich_media_content').getBoundingClientRect();
      return [...document.querySelectorAll('.rich_media_content *')].filter(el => {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return false;
        const centered = Math.abs((r.left - box.left) - (box.right - r.right)) <= 1;
        if (!((r.left < box.left - 1 || r.right > box.right + 1) && !centered)) return false;
        for (let a = el; a && a.classList && !a.classList.contains('rich_media_content'); a = a.parentElement) if (!a.hasAttribute('data-ignore-width')) return true;
        return false;
      }).map(el => el.tagName + ' ' + (el.getAttribute('style') || '').slice(0, 50));
    }));
    await pg.close();
  }
  check(!unexempt.length, '超出正文区的节点及其祖先链都带 data-ignore-width', unexempt.slice(0, 3).join(' | '));
  // 文字颜色：逐元素比原稿与"套了微信正文样式"的成品（只比有直接文字的元素）
  const colorsOf = async html => {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 335, height: 800 });
    await pg.setContent(html, { waitUntil: 'networkidle0' });
    const m = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-wxc]')]
      .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.data.trim()))
      .map(e => [e.getAttribute('data-wxc'), getComputedStyle(e).color])));
    await pg.close();
    return m;
  };
  const [ca, cb] = [await colorsOf(r.original), await colorsOf(prev)];
  const wrongColor = Object.keys(ca).filter(k => k in cb && ca[k] !== cb[k]);
  check(!wrongColor.length, '文字颜色与原稿一致', wrongColor.slice(0, 4).map(k => `${k}: ${ca[k]} → ${cb[k]}`).join(' | '));
  check(count(/<(style|script|link)\b/g) === 0, '没有 style/script/link');
  check(count(/href="#/g) === 0, '没有页内锚点');
  check(count(/data-wxc/g) === 0, '没有工具属性');
  check(!r.findings.some(f => f.title === '动画') && !/extfake|extvar/.test(p), '忽略非文章样式表（扩展注入）');
  check(count(/>\s*\n\s*</g) === 0, '没有标签间换行');
  check(r.stats.visualBad.length === 0, '成品与原稿逐元素一致', `${r.stats.verified} 个元素，偏差 ${r.stats.visualBad.length}：${r.stats.visualBad.slice(0, 8).join(',')}`);
  const otherIds = new Set(r.stats.others.flatMap(([, b]) => b));
  const listed = new Set(r.findings.filter(f => f.title === '其他宽度').flatMap(f => f.ids));
  check([...otherIds].every(id => listed.has(id)), '其他宽度下逐元素一致，或偏差已列入检查结果', r.stats.others.map(([w, b]) => `${w}px:${b.length}(${b.slice(0, 5).join(',')})`).join(' ') || '无偏差');
  console.log(`    正文 ${p.length} 字符，translate 校正 ${r.stats.moved} 处`);
  for (const a of r.approx || []) console.log('    近似 ' + a);
  fs.writeFileSync(path.join(OUT, 'payload.html'), p);

  // 逐像素：原稿与成品各截一张整页图，在页面里用 canvas 比
  const width = await page.$eval('#width', e => +e.value);
  const prevHtml = await page.evaluate(async frag => (await import('./convert/index.js')).previewDoc(frag), r.preview);
  const shot = async (html, w) => {
    const pg = await browser.newPage();
    await pg.setViewport({ width: w, height: 800 });
    await pg.setContent(html, { waitUntil: 'networkidle0' });
    await pg.evaluate(() => document.fonts.ready);
    const b = await pg.screenshot({ fullPage: true, encoding: 'base64' });
    await pg.close();
    return b;
  };
  console.log('\n逐像素');
  for (const w of [width, 320, 460, 637]) {
  const sfx = w === width ? '' : '-' + w;
  const [a, b] = [await shot(r.original, w), await shot(prevHtml, w)];
  fs.writeFileSync(path.join(OUT, `original${sfx}.png`), Buffer.from(a, 'base64'));
  fs.writeFileSync(path.join(OUT, `converted${sfx}.png`), Buffer.from(b, 'base64'));
  const diff = await page.evaluate(async (a, b) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const px = img => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), db = px(ib);
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d'), out = x.createImageData(w, h);
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      const hit = d > 48; if (hit) bad++;
      out.data[i] = hit ? 255 : da[i] * 0.3 + 178; out.data[i + 1] = hit ? 0 : da[i + 1] * 0.3 + 178; out.data[i + 2] = hit ? 0 : da[i + 2] * 0.3 + 178; out.data[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    const blob = await c.convertToBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const v of buf) s += String.fromCharCode(v);
    return { bad, total: w * h, ha: ia.height, hb: ib.height, png: btoa(s) };
  }, a, b);
  fs.writeFileSync(path.join(OUT, `diff${sfx}.png`), Buffer.from(diff.png, 'base64'));
  const ratio = diff.bad / diff.total;
  check(Math.abs(diff.ha - diff.hb) <= 2, `${w}px 页面高度一致`, `${diff.ha} vs ${diff.hb}`);
  // 主宽度要求 0.3%；其他宽度下图片重采样、斜排文字的亚像素位置不同，放宽到 0.5%（逐元素比对另有 1.5px 硬门槛）
  check(ratio < (w === width ? 0.003 : 0.005), `${w}px 差异像素 < ${w === width ? '0.3' : '0.5'}%`, `${(ratio * 100).toFixed(3)}%（test/out/diff${sfx}.png）`);
  }

  console.log('\n端口安全');
  const ids = [...p.matchAll(/\/a\/([0-9a-f]{16}\.(png|jpe?g|gif|webp|svg))/g)].map(m => m[1]);
  if (ids.length) check((await raw(IMG, '/a/' + ids[0])).status === 200, '图床口能取到已登记图片');
  check((await raw(IMG, '/api/state')).status === 404, '图床口不暴露 API');
  check((await raw(IMG, '/a/..%2f..%2fserver.mjs')).status === 404, '图床口路径穿越 404');
  check((await raw(IMG, '/a/0000000000000000.png')).status === 404, '图床口未登记 id 404');
  const css = [...p.matchAll(/\/a\/([0-9a-f]{16}\.css)/g)];
  if (css.length) check((await raw(IMG, '/a/' + css[0][1])).status === 404, '图床口不出非图片文件');
  check((await raw(UI, '/api/state', { headers: { host: 'evil.example:' + UI } })).status === 403, 'UI 口拒绝陌生 Host');
  check((await raw(UI, '/api/open', { method: 'POST', headers: { host: '127.0.0.1:' + UI, origin: 'http://evil.example' }, body: '{"path":"C:/"}' })).status === 403, 'UI 口拒绝跨站 POST');
} catch (e) {
  if (e.message !== 'stop') { console.error(e); fails++; }
} finally {
  await browser.close();
  srv.kill();
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
