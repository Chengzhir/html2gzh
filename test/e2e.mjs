// 端到端：起真服务 → 无头 Chrome 打开页面 → 转换文章 → 检查成品 + 原稿/成品逐像素比对 + 端口安全探测
// 用法：node test/e2e.mjs [文章路径]   默认用 test/fixture
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.mjs';
import { alignUnits } from './align.mjs';
import { previewDoc, readerImages } from '../ui/convert/reader.js';
import { WX_ANIM_OK } from '../ui/convert/svg/dom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const SVG_MODE = args.includes('--svg');
const ARTICLE = path.resolve(args.find(a => !a.startsWith('--')) || path.join(HERE, 'fixture'));
const IMG = 48960, UI = 48961;
const CHROME = findChrome();
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (ok, label, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const raw = (port, p, opts = {}) => new Promise(res => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: opts.headers || {} }, r => {
    let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers }));
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
  await page.evaluateOnNewDocument(svg => {
    if (window === window.top) localStorage.setItem('wxc.opts', JSON.stringify(svg ? { fontMode: 'svg' } : {}));
  }, SVG_MODE);
  await page.goto(`http://127.0.0.1:${UI}/`);
  await page.waitForFunction(() => window.__wxc.result || document.querySelector('.banner.err:not([hidden])'), { timeout: 90000 });
  const r = await page.evaluate(() => {
    const s = window.__wxc;
    return s.result ? { findings: s.result.findings, report: s.result.report, stats: s.result.stats, payload: s.result.payload, preview: s.result.preview, original: s.result.original, approx: s.result.debug.approx, verdicts: s.result.debug.verdicts, tv: s.result.debug.tv, v: s.result.debug.v }
      : { error: document.getElementById('status').textContent };
  });
  console.log('\n文章 ' + ARTICLE);
  if (r.error) { check(false, '转换', r.error); throw new Error('stop'); }
  check(!errors.length, '页面无脚本错误', errors.slice(0, 3).join(' | '));
  // 两栏各自滚动，整页不该能滚（侧栏里的绝对定位元素曾把页面撑出一截空白）
  const pageScroll = [];
  for (const [w, h] of [[1400, 900], [1920, 1080], [1280, 640]]) {
    await page.setViewport({ width: w, height: h });
    const d = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    if (d > 0) pageScroll.push(`${w}×${h} 多出 ${d}px`);
  }
  await page.setViewport({ width: 1400, height: 900 });
  check(!pageScroll.length, '整页不能滚动，只有两栏各自滚动', pageScroll.join(' | '));
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
  const prev = previewDoc(r.preview);
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
  const svgLeft = await page.evaluate(([html, ok]) => {
    const d = document.createElement('div'); d.innerHTML = html;
    const out = [];
    for (const e of d.querySelectorAll('svg, svg *')) {
      if (e.hasAttribute('id') || e.hasAttribute('class')) out.push(`${e.localName} 有 id/class`);
      if (/^(animate|set)$/.test(e.localName) && !ok.includes(e.getAttribute('attributeName'))) out.push(`${e.localName} ${e.getAttribute('attributeName')}`);
      if (e.namespaceURI === 'http://www.w3.org/1999/xhtml' && /^(animate|set|animatetransform|animatemotion)$/.test(e.localName)) out.push('foreignObject 里的动画');
      for (const a of e.attributes) if (/url\(\s*["']?#/.test(a.value) || a.name === 'href' && a.value.startsWith('#') || a.name.startsWith('xlink:')) out.push(`${e.localName} ${a.name}`);
      if (e.localName === 'image' && !/^https?:\/\/mmbiz\./.test(e.getAttribute('href') || '')) out.push('非 mmbiz 的 <image>');
    }
    return out;
  }, [p, [...WX_ANIM_OK]]);
  check(!svgLeft.length, 'SVG 不依赖公众号会删的东西（id/class/xlink、url(#)、白名单外的动画、本机 <image>）', svgLeft.slice(0, 4).join(' | '));
  check(count(/href="#/g) === 0, '没有页内锚点');
  check(count(/data-wxc/g) === 0, '没有工具属性');
  check(!r.findings.some(f => f.title === '动画') && !/extfake|extvar/.test(p), '忽略非文章样式表（扩展注入）');
  check(count(/>\s*\n\s*</g) === 0, '没有标签间换行');
  check(r.stats.visualBad.length === 0, '成品与原稿逐元素一致', `${r.stats.verified} 个元素，偏差 ${r.stats.visualBad.length}：${r.stats.visualBad.slice(0, 8).join(',')}`);
  const otherIds = new Set(r.stats.others.flatMap(([, b]) => b));
  const listed = new Set(r.findings.filter(f => f.title === '其他宽度').flatMap(f => f.ids));
  check([...otherIds].every(id => listed.has(id)), '其他宽度下逐元素一致，或偏差已列入检查结果', r.stats.others.map(([w, b]) => `${w}px:${b.length}(${b.slice(0, 5).join(',')})`).join(' ') || '无偏差');
  if (SVG_MODE) {
    const o = r.stats.outline;
    check(o && o.kept > 0, 'SVG 模式下有大字转成轮廓', o ? `${o.kept}/${o.units} 段，${o.chars} 字，约 ${Math.round(o.bytes / 1024)} KB` : '无统计');
    // 复制层：每个轮廓的透明文字连起来要等于它替换掉的原文
    const lost = await page.evaluate(html => {
      const d = document.createElement('div'); d.innerHTML = html;
      const norm = s => s.replace(/[\s\u00a0]+/g, ' ').trim();
      return [...d.querySelectorAll('svg[aria-label]')].filter(s => s.querySelector('path') && s.querySelector('text'))
        .map(s => [norm(s.getAttribute('aria-label')), norm([...s.querySelectorAll('text')].map(t => t.textContent).join(''))])
        .filter(([a, b]) => a !== b);
    }, p);
    check(!lost.length, '轮廓的透明复制层文字与原文一致', lost.slice(0, 2).map(([a, b]) => `${a} ≠ ${b}`).join(' | '));
    // 测试稿里用 data-expect 标了哪些该转、哪些不该转
    const wrong = await page.evaluate(html => {
      const d = document.createElement('div'); d.innerHTML = html;
      return [...d.querySelectorAll('[data-expect]')].filter(e => (e.dataset.expect === 'svg') !== !!e.querySelector('svg[data-wxc-unit]')).map(e => `${e.dataset.expect}: ${e.textContent.slice(0, 12)}`);
    }, r.preview);
    check(!wrong.length, '该转的转了、不该转的没转（data-expect）', wrong.join(' | '));
    // 连字：轮廓里每个字形以一个绝对 M 开头，数出来要等于测试稿标的字形数
    const glyphN = await page.evaluate(html => {
      const d = document.createElement('div'); d.innerHTML = html;
      return [...d.querySelectorAll('[data-expect-glyphs]')].map(e => [e.dataset.expectGlyphs,
        [...e.querySelectorAll('svg[data-wxc-unit] path')].reduce((n, p) => n + (p.getAttribute('d').match(/M/g) || []).length, 0), e.textContent.slice(0, 16)]);
    }, r.preview);
    if (glyphN.length) check(glyphN.every(([a, b]) => +a === b), '连字按整词排版画出（字形数与 Chrome 一致）', glyphN.map(([a, b, t]) => `${t}: ${b}/${a}`).join(' | '));
    for (const v of r.verdicts || []) if (!v.keep) console.log(`    未转 ${v.why}${v.side ? '（另一宽度）' : ''}${v.dev ? ' 偏差[宽,高,字x,基线,字号]=' + v.dev.join(',') : ''}${v.detail ? ' 挪位 ' + v.detail.join(' | ') : ''}  ${v.id}${v.run ? '（行内段）' : ''} ${v.text}`);
  }
  {
    const tv = new Map(r.tv), worst = [0, 0, 0, 0, ''];
    for (const [k, b] of r.v) {
      const a = tv.get(k);
      if (!a) continue;
      const d = [Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)];
      d.forEach((v, i) => { if (v > worst[i]) { worst[i] = v; if (i === 1) worst[4] = k; } });
    }
    console.log(`    主宽度逐元素最大偏差 x ${worst[0].toFixed(3)} · y ${worst[1].toFixed(3)}（${worst[4]}）· w ${worst[2].toFixed(3)} · h ${worst[3].toFixed(3)} px`);
  }
  console.log(`    正文 ${p.length} 字符，translate 校正 ${r.stats.moved} 处`);
  for (const a of r.approx || []) console.log('    近似 ' + a);
  fs.writeFileSync(path.join(OUT, 'payload.html'), p);

  // 逐像素：原稿与成品各截一张整页图，在页面里用 canvas 比
  const width = await page.$eval('#width', e => +e.value);
  const prevHtml = previewDoc(r.preview);
  // masks 只在截成品时传：成品要先跑一遍阅读页的图片尺寸脚本（小数宽度版，见 readerImages 的 exact）。
  // 动画一律冻结在时刻 t（默认 0）：CSS 动画暂停并跳到 t，每个 svg（嵌套的有自己的时间线）的 SMIL 也跳到 t；
  // use 影子树里的 CSS 动画 getAnimations 拿不到，靠 CDP 把整页时间线的播放速度设成 0（只能停在 0）。
  // clicks：先点一遍标了 data-click 的元素，再跳到这个时刻。非 0 时刻时，标了 data-sample-skip 的也屏蔽
  const shot = async (html, w, masks, t = 0, clicks = null) => {
    const pg = await browser.newPage();
    await pg.setViewport({ width: w, height: 800 });
    const cdp = await pg.createCDPSession();
    await cdp.send('Animation.enable').then(() => cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })).catch(() => {});
    await pg.setContent(html, { waitUntil: 'networkidle0' });
    await pg.evaluate(() => document.fonts.ready);
    if (masks) await pg.evaluate(`(${readerImages})(document, true)`);
    const freeze = t => pg.evaluate(t => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
      for (const s of document.querySelectorAll('svg')) { s.pauseAnimations(); s.setCurrentTime(t); }
    }, t);
    await freeze(t);
    if (clicks != null) {
      for (const h of await pg.$$('[data-click]')) await h.click().catch(() => {});
      await freeze(clicks);
    }
    // 不比像素的区域：轮廓（另做逐单元对位检查），以及测试稿里标了 data-pixel-skip 的元素
    if (masks) masks.push(...await pg.evaluate(sampled => [...document.querySelectorAll('svg[data-wxc-unit]')].map(s => s.parentElement)
      .concat([...document.querySelectorAll(sampled ? '[data-pixel-skip],[data-sample-skip]' : '[data-pixel-skip]')])
      .map(e => { const b = e.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height]; }), !!(t || clicks != null)));
    const b = await pg.screenshot({ fullPage: true, encoding: 'base64' });
    await pg.close();
    return b;
  };
  const pixelDiff = (a, b, masks) => page.evaluate(async (a, b, masks) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const px = img => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), db = px(ib);
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d'), out = x.createImageData(w, h);
    // 屏蔽区域外扩 3px（容纳超出盒子的字形墨迹），不参与逐像素比较，画成浅蓝
    const masked = new Uint8Array(w * h);
    for (const [mx, my, mw, mh] of masks || []) {
      for (let y = Math.max(0, Math.floor(my - 3)); y < Math.min(h, Math.ceil(my + mh + 3)); y++)
        for (let X = Math.max(0, Math.floor(mx - 3)); X < Math.min(w, Math.ceil(mx + mw + 3)); X++) masked[y * w + X] = 1;
    }
    let bad = 0, area = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (masked[i / 4]) { area++; out.data[i] = 200; out.data[i + 1] = 225; out.data[i + 2] = 245; out.data[i + 3] = 255; continue; }
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      const hit = d > 48; if (hit) bad++;
      out.data[i] = hit ? 255 : da[i] * 0.3 + 178; out.data[i + 1] = hit ? 0 : da[i + 1] * 0.3 + 178; out.data[i + 2] = hit ? 0 : da[i + 2] * 0.3 + 178; out.data[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    const blob = await c.convertToBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const v of buf) s += String.fromCharCode(v);
    return { bad, area, total: w * h, ha: ia.height, hb: ib.height, png: btoa(s) };
  }, a, b, masks);
  if (SVG_MODE) {
    // 轮廓区域单独量：逐个单元的亚像素偏移与墨量（3 倍像素密度，接近手机）。
    // 偏移门槛：Chrome 把 svg 盒子对齐到整 CSS 像素而字形保留小数位置，横向差最多 0.5px；纵向文字基线也取整，两次取整最多差 1px
    console.log('\n轮廓对位（3x）');
    const al = await alignUnits(browser, r.original, prevHtml, width, 3);
    const off = al.filter(a => Math.abs(a.dx) > 0.55 || Math.abs(a.dy) > 1.1 || a.ink < 0.85 || a.ink > 1.15);
    if (al.length) check(!off.length, '每个轮廓与原稿字形对齐（横向 ≤0.55px、纵向 ≤1.1px、墨量差 ≤15%）',
      off.length ? off.slice(0, 4).map(a => `#${a.unit} dx${a.dx} dy${a.dy} ink${a.ink}`).join(' | ')
        : `${al.length} 段，最大 |dx| ${Math.max(...al.map(a => Math.abs(a.dx))).toFixed(2)}、|dy| ${Math.max(...al.map(a => Math.abs(a.dy))).toFixed(2)}，墨量 ${Math.min(...al.map(a => a.ink)).toFixed(2)}–${Math.max(...al.map(a => a.ink)).toFixed(2)}`);
  }
  console.log('\n逐像素');
  for (const w of [width, 320, 460, 637]) {
  const sfx = w === width ? '' : '-' + w;
  const masks = [];
  const [a, b] = [await shot(r.original, w), await shot(prevHtml, w, masks)];
  fs.writeFileSync(path.join(OUT, `original${sfx}.png`), Buffer.from(a, 'base64'));
  fs.writeFileSync(path.join(OUT, `converted${sfx}.png`), Buffer.from(b, 'base64'));
  const diff = await pixelDiff(a, b, masks);
  fs.writeFileSync(path.join(OUT, `diff${sfx}.png`), Buffer.from(diff.png, 'base64'));
  const ratio = diff.bad / (diff.total - diff.area);
  check(Math.abs(diff.ha - diff.hb) <= 2, `${w}px 页面高度一致`, `${diff.ha} vs ${diff.hb}`);
  // 主宽度要求 0.3%；其他宽度下图片重采样、斜排文字的亚像素位置不同，放宽到 0.5%（逐元素比对另有 1.5px 硬门槛）
  check(ratio < (w === width ? 0.003 : 0.005), `${w}px 差异像素 < ${w === width ? '0.3' : '0.5'}%` + (diff.area ? `（不含屏蔽区域 ${(diff.area / diff.total * 100).toFixed(1)}%）` : ''),
    `${(ratio * 100).toFixed(3)}%（test/out/diff${sfx}.png）`);
  }

  // SVG 动画：主宽度下再冻结在几个时刻比一次，最后点一遍 data-click 元素看点击动画
  if (/<(animate|set|animateTransform|animateMotion)\b|@keyframes/.test(r.original)) {
    console.log('\n动画采样');
    const bad = [];
    for (const [t, clicks] of [[0.37, null], [1.13, null], [2.71, null], [0.5, 0.75], [0.5, 1.7]]) {
      const masks = [];
      const [a, b] = [await shot(r.original, width, null, t, clicks), await shot(prevHtml, width, masks, t, clicks)];
      const d = await pixelDiff(a, b, masks);
      const ratio = d.bad / (d.total - d.area);
      if (ratio >= 0.003) {
        const tag = clicks == null ? `t=${t}s` : `点击后 ${Math.round((clicks - t) * 100) / 100}s`;
        bad.push(`${tag} ${(ratio * 100).toFixed(2)}%`);
        fs.writeFileSync(path.join(OUT, `diff-anim-${t}-${clicks ?? 'x'}.png`), Buffer.from(d.png, 'base64'));
      }
    }
    check(!bad.length, '动画在各采样时刻与原稿一致（差异像素 < 0.3%）', bad.join(' | ') || '5 个时刻');
  }

  if (SVG_MODE) {
    // 设置面板：每套字一行；把一套已转的字改成"保留文字"，重新转换后这套字一个也不转（放在逐像素之后：会触发重新转换）
    console.log('\n字体设置面板');
    const rows = await page.$$eval('#faceList fieldset', fs => fs.length);
    const fonts = await page.evaluate(() => window.__wxc.result.fonts);
    check(rows === fonts.length && rows > 0, '每套字列成一行', `${rows} 行：` + fonts.map(f => `${f.family} ${f.weight}（${f.chars} 字，已转 ${f.outlined}）`).join('、'));
    const target = fonts.findIndex(f => f.outlined > 0);
    if (target >= 0) {
      const key = fonts[target].key, before = r.stats.outline.chars;
      await page.click(`#faceList fieldset:nth-child(${target + 1}) input[value="text"]`);
      const after = await page.waitForFunction(k => {
        const s = window.__wxc;
        const f = !s.busy && s.result && s.result.fonts.find(x => x.key === k);
        return f && f.outlined === 0 && JSON.parse(localStorage.getItem('wxc.opts')).faces[k] === 'text' && s.result.stats.outline;
      }, { timeout: 180000 }, key).then(h => h.jsonValue()).catch(() => null);
      check(!!after && after.chars < before, '改成"保留文字"后重新转换，这套字不再转轮廓', after ? `轮廓字数 ${before} → ${after.chars}` : '超时或没生效');
    }
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
  check((await raw(UI, '/api/open', { method: 'POST', headers: { host: '127.0.0.1:' + UI }, body: '{"path":"C:/"}' })).status === 403, 'UI 口拒绝不带 Origin 的 POST');
  if (ids.length) {
    const h = (await raw(IMG, '/a/' + ids[0])).headers;
    check(/sandbox/.test(h['content-security-policy'] || '') && h['x-content-type-options'] === 'nosniff', '取图口的文件带 CSP sandbox 与 nosniff（文章里的 SVG 脚本跑不起来）');
  }
  {
    // 文章文件夹外的文件不登记：用相对路径指向仓库里的 ui/app.css
    const dir = fs.statSync(ARTICLE).isDirectory() ? ARTICLE : path.dirname(ARTICLE);
    const outside = path.relative(dir, path.join(HERE, '..', 'ui', 'app.css')).split(path.sep).join('/');
    const r2 = await raw(UI, '/api/assets', { method: 'POST', headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI }, body: JSON.stringify({ refs: [outside] }) });
    check(r2.status === 200 && JSON.parse(r2.body)[outside] === null, '不登记文章文件夹以外的文件', outside);
  }
} catch (e) {
  if (e.message !== 'stop') { console.error(e); fails++; }
} finally {
  await browser.close();
  // 等服务真正退出、端口释放，紧接着再跑一轮时才不会撞上旧进程
  const exited = new Promise(r => srv.once('exit', r));
  srv.kill();
  await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]);
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
