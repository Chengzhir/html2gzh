// 端到端：起真服务 → 无头 Chrome 打开页面 → 转换文章 → 检查成品 + 原稿/成品逐像素比对 + 端口安全探测
// 用法：node test/e2e.mjs [文章路径]   默认用 test/fixture
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { findChrome } from '../lib/chrome.ts';
import { alignUnits } from './align.mjs';
import { previewDoc, readerImages } from '../ui/convert/reader.ts';
import { WX_ANIM_OK } from '../ui/convert/svg/dom.ts';
import { settled, pickDefault, openFontList, isChecked, setChecked, typeNumber, setContentReady } from './ui.mjs';
import { buildWebfontFixture, serveRemote } from './webfonts.mjs';
import { startServer } from './serve.mjs';
import { pixelDiff, WINDOW } from './pixeldiff.mjs';
import { assetIdsIn } from '../ui/convert/assetid.ts';
import { apngOf } from './apng.mjs';

const HERE = import.meta.dirname;
const args = process.argv.slice(2);
const SVG_MODE = args.includes('--svg');
const ARTICLE = path.resolve(args.find(a => !a.startsWith('--')) || path.join(HERE, 'fixture'));
const IMG = 48960,
  UI = 48961;
const CHROME = findChrome();
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) fails++;
};
const raw = (port, p, opts = {}) =>
  new Promise(res => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: opts.headers || {} },
      r => {
        let b = '';
        r.on('data', c => {
          b += c;
        });
        r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers }));
      },
    );
    req.on('error', () => res({ status: 0, body: '' }));
    req.end(opts.body);
  });

// 网页字体测试稿：先生成字体文件，再起模拟字体网站的跨域服务
const WEBFONT = ARTICLE === path.join(HERE, 'fixture-webfont');
let remote = null;
if (WEBFONT) {
  await buildWebfontFixture(ARTICLE);
  remote = await serveRemote(ARTICLE);
}
// 设置文件放 test/out：测试里改端口不碰用户的 settings.json
const SETTINGS = path.join(OUT, 'e2e-settings.json');
fs.rmSync(SETTINGS, { force: true });
const srv = await startServer({ article: ARTICLE, img: IMG, ui: UI, settings: SETTINGS });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  // “压缩大图”默认勾选；回归比的是转换本身，先关掉，压缩在“大图压缩”一节单独测
  await page.evaluateOnNewDocument(() => {
    if (window === window.top) localStorage.setItem('wxc.shrink', JSON.stringify({ on: false, kb: 1000 }));
  });
  // 模拟浏览器扩展往 iframe 里注入样式：转换器不能把它当成文章样式
  await page.evaluateOnNewDocument(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      set(v) {
        d.set.call(
          this,
          String(v).replace(
            /<\/head>/i,
            '<style>@keyframes extfake{to{opacity:1}}@keyframes extfake2{}html{--extvar:1}</style></head>',
          ),
        );
      },
      get() {
        return d.get.call(this);
      },
    });
  });
  await page.goto(`http://127.0.0.1:${UI}/`);
  await page.waitForFunction(() => window.__wxc.result || window.__wxc.error, { timeout: 90000 });
  const foldedAtStart = await page.evaluate(() => !document.getElementById('faceBox').open);
  // --svg：在字体表里勾选测试用的行，等重新转换完
  if (SVG_MODE && (await page.evaluate(() => !!window.__wxc.result))) await pickDefault(page);
  const r = await page.evaluate(() => {
    const s = window.__wxc;
    return s.result
      ? {
          findings: s.result.findings,
          fonts: s.result.fonts,
          report: s.result.report,
          stats: s.result.stats,
          payload: s.result.payload,
          preview: s.result.preview,
          original: s.result.original,
          approx: s.result.debug.approx,
          verdicts: s.result.debug.verdicts,
          tv: s.result.debug.tv,
          v: s.result.debug.v,
        }
      : { error: s.error };
  });
  console.log('\n文章 ' + ARTICLE);
  if (r.error) {
    check(false, '转换', r.error);
    throw new Error('stop');
  }
  check(!errors.length, '页面无脚本错误', errors.slice(0, 3).join(' | '));
  // 两栏各自滚动，整页不该能滚（侧栏里的绝对定位元素曾把页面撑出一截空白）
  const pageScroll = [];
  for (const [w, h] of [
    [1400, 900],
    [1920, 1080],
    [1280, 640],
  ]) {
    await page.setViewport({ width: w, height: h });
    const d = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    if (d > 0) pageScroll.push(`${w}×${h} 多出 ${d}px`);
  }
  await page.setViewport({ width: 1400, height: 900 });
  check(!pageScroll.length, '整页不能滚动，只有两栏各自滚动', pageScroll.join(' | '));
  // 进度与错误提示浮在预览上方，不改变两栏的位置
  const toastMoves = await page.evaluate(async () => {
    const pos = () =>
      ['paneA', 'paneB']
        .map(id => document.getElementById(id).getBoundingClientRect())
        .map(r => [r.left, r.top].join(','));
    const before = JSON.stringify(pos()),
      out = [];
    for (const [scope, kind] of [
      ['all', 'busy'],
      ['all', 'err'],
      ['reader', 'busy'],
    ]) {
      window.__wxcNotice(scope, '测试提示', kind);
      await new Promise(r => setTimeout(r, 400));
      const t = document.getElementById(scope === 'all' ? 'toastAll' : 'toastReader');
      if (!t.classList.contains('on')) out.push(`${scope}/${kind} 没显示`);
      if (JSON.stringify(pos()) !== before) out.push(`${scope}/${kind} 挤动了预览`);
      window.__wxcNotice(scope, '');
    }
    return out;
  });
  check(!toastMoves.length, '提示浮在预览上方，两栏位置不变', toastMoves.join(' | '));
  const shown = await page.evaluate(
    fs => fs.map(f => window.__wxcFinding(f)),
    r.findings.toSorted((a, b) => a.level.localeCompare(b.level)),
  );
  r.findings
    .toSorted((a, b) => a.level.localeCompare(b.level))
    .forEach((f, i) => console.log(`    [${f.level}] ${f.code} ${shown[i].text}`));
  console.log(
    `    图片 本地 ${r.report.local} · 缺失 ${r.report.missing.length} · data: ${r.report.dataUri} · 外链 ${r.report.remote}`,
  );

  const p = r.payload;
  const count = re => (p.match(re) || []).length;
  console.log('\n成品检查');
  check(count(/<div\b/g) === 0, '没有 div', String(count(/<div\b/g)));
  check(
    count(/<blockquote\b/g) === 0,
    '没有 blockquote（阅读页会删它的 color、强加灰字和竖条）',
    String(count(/<blockquote\b/g)),
  );
  check(count(/\sclass=/g) === 0, '没有 class');
  if (ARTICLE === path.join(HERE, 'fixture')) {
    check(!p.includes('星标'), '伪元素 content 里斜杠后的替代文字不写进正文');
    const codes = r.findings.map(f => f.code);
    check(
      codes.includes('zFlex') && !codes.includes('zLost'),
      '容器里有隐藏的子元素时，仍能改为纵向 flex 保留 z-index',
      codes.filter(c => c.startsWith('z')).join(',') || '无',
    );
  }
  if (ARTICLE === path.join(HERE, 'fixture-svg')) {
    // 有动画的渐变图形换成平均色：红、白、蓝各占一半的渐变（offset 写成百分数），平均约为 rgb(191,128,191)
    const fill = /<circle\b[^>]*\bcx="88"[^>]*>/
      .exec(p)?.[0]
      .match(/fill:\s*rgba?\(([^)]*)\)/)?.[1]
      .split(',')
      .map(Number);
    check(
      !!fill && Math.abs(fill[0] - 191) < 8 && Math.abs(fill[2] - 191) < 8,
      '渐变的 offset 写成百分数时，平均色按 0–1 的位置算',
      fill ? fill.slice(0, 3).join(',') : '没找到',
    );
  }
  check(count(/[\s;"]position\s*:/g) === 0, '没有 position', String(count(/[\s;"]position\s*:/g)));
  check(count(/var\(|--[a-z]/g) === 0, '没有 CSS 变量');
  check(count(/\d(rem|vh|cq[hb])\b/g) === 0, '没有 rem/vh/cqh');
  check(count(/calc\(|min\(|max\(|clamp\(/g) === 0, '没有 calc()/min()/max()（微信存储会删整条声明）');
  const imp = [...p.matchAll(/([a-z-]+):[^;"]*!important/g)].map(m => m[1]);
  check(
    imp.every(k => /^(max-width|box-sizing|height)$/.test(k)),
    '!important 只用在微信强制的属性上',
    `${imp.length} 处 ${[...new Set(imp)].join(',')}`,
  );
  check(
    /^<section data-ignore-width="" style="[^"]*container-type: inline-size/.test(p),
    '根容器是查询容器且豁免宽度检测',
  );
  const prev = previewDoc(r.preview);
  // 编辑器粘贴后弹出的"内容结构检测"：用它的开源引擎（test/vendor）检查正文区的内容
  {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 335, height: 800 });
    await pg.setContent(prev, { waitUntil: 'load' });
    const html = await pg.evaluate(() => document.querySelector('.rich_media_content').innerHTML);
    await pg.setViewport({ width: 677, height: 800 });
    await pg.goto('about:blank');
    await pg.evaluate(fs.readFileSync(path.join(HERE, 'vendor', 'verify-article-structure.browser.js'), 'utf8'));
    const res = await pg.evaluate(async html => {
      const box = document.createElement('div');
      box.innerHTML = html;
      return window.VerifyArticleStructure.verifyArticleStructure(box);
    }, html);
    await pg.close();
    const { 'text-align': ta, ...rest } = res.inValidInfo;
    const found = Object.entries(rest).flatMap(([k, g]) =>
      g.items.map(it => `[${k}] 第 ${it.paragraphIndex} 段 ${it.rules || ''} ${(it.outerHTML || '').slice(0, 80)}`),
    );
    check(!found.length, '编辑器的内容结构检测除文字对齐外不报问题', found.slice(0, 3).join(' | '));
    // start/end 对齐会被列出（可忽略）：段数要与检查结果里的说明一致
    const said = r.findings.find(f => f.code === 'alignStartEnd');
    check(
      (ta ? ta.items.length : 0) === (said ? said.params.n : 0),
      '内容结构检测列出的对齐方式为 start/end 的段落数与检查结果一致',
      `检测 ${ta ? ta.items.length : 0} 段，检查结果 ${said ? said.params.n : 0} 段`,
    );
  }
  // 测试稿里标了书写方向与对齐方式的段落：存草稿后 dir="rtl" 变成 auto，书写方向靠内联样式保住；start/end 原样保留
  {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 335, height: 800 });
    await pg.setContent(prev, { waitUntil: 'load' });
    const marks = await pg.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('[data-expect-dir]')) {
        const range = document.createRange();
        range.selectNodeContents(e);
        const t = range.getBoundingClientRect(),
          b = e.getBoundingClientRect(),
          c = getComputedStyle(e);
        const right = b.right - parseFloat(c.borderRightWidth) - parseFloat(c.paddingRight);
        const flush = e.dataset.expectDir === 'rtl' ? Math.abs(t.right - right) < 1.5 : true;
        out.push({
          kind: 'dir',
          ok: c.direction === e.dataset.expectDir && flush,
          got: `${e.getAttribute('dir')} ${c.direction} 文字右缘距 ${(right - t.right).toFixed(1)}px`,
        });
      }
      for (const e of document.querySelectorAll('[data-expect-align]')) {
        const v = (e.getAttribute('style').match(/(?:^|;)\s*text-align:\s*([^;]+)/) || [])[1];
        out.push({ kind: 'align', ok: v === e.dataset.expectAlign, got: v, id: e.getAttribute('data-wxc') });
      }
      return out;
    });
    await pg.close();
    const said = r.findings.find(f => f.code === 'alignStartEnd');
    for (const m of marks.filter(m => m.kind === 'dir'))
      check(m.ok, '存草稿后（dir="auto"）从右到左的段落仍按原书写方向排列', m.got);
    for (const m of marks.filter(m => m.kind === 'align'))
      check(
        m.ok && !!said && said.ids.includes(m.id),
        '样式表里的 text-align: end 原样保留，并列入检查结果',
        `${m.got}${said && said.ids.includes(m.id) ? '' : '，未列入'}`,
      );
  }
  // 文字颜色：逐元素比原稿与"套了微信正文样式"的成品（只比有直接文字的元素）
  const colorsOf = async html => {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 335, height: 800 });
    await setContentReady(pg, html);
    const m = await pg.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('[data-wxc]')]
          .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.data.trim()))
          .map(e => [e.getAttribute('data-wxc'), getComputedStyle(e).color]),
      ),
    );
    await pg.close();
    return m;
  };
  const [ca, cb] = [await colorsOf(r.original), await colorsOf(prev)];
  const wrongColor = Object.keys(ca).filter(k => k in cb && ca[k] !== cb[k]);
  check(
    !wrongColor.length,
    '文字颜色与原稿一致',
    wrongColor
      .slice(0, 4)
      .map(k => `${k}: ${ca[k]} → ${cb[k]}`)
      .join(' | '),
  );
  check(count(/<(style|script|link)\b/g) === 0, '没有 style/script/link');
  const svgLeft = await page.evaluate(
    ([html, ok]) => {
      const d = document.createElement('div');
      d.innerHTML = html;
      const out = [];
      for (const e of d.querySelectorAll('svg, svg *')) {
        if (e.hasAttribute('id') || e.hasAttribute('class')) out.push(`${e.localName} 有 id/class`);
        if (/^(animate|set)$/.test(e.localName) && !ok.includes(e.getAttribute('attributeName')))
          out.push(`${e.localName} ${e.getAttribute('attributeName')}`);
        if (
          e.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
          /^(animate|set|animatetransform|animatemotion)$/.test(e.localName)
        )
          out.push('foreignObject 里的动画');
        for (const a of e.attributes)
          if (
            /url\(\s*["']?#/.test(a.value) ||
            (a.name === 'href' && a.value.startsWith('#')) ||
            a.name.startsWith('xlink:')
          )
            out.push(`${e.localName} ${a.name}`);
        if (e.localName === 'image' && !/^https?:\/\/mmbiz\./.test(e.getAttribute('href') || ''))
          out.push('非 mmbiz 的 <image>');
      }
      return out;
    },
    [p, [...WX_ANIM_OK]],
  );
  check(
    !svgLeft.length,
    'SVG 不依赖公众号会删的东西（id/class/xlink、url(#)、白名单外的动画、本机 <image>）',
    svgLeft.slice(0, 4).join(' | '),
  );
  check(count(/href="#/g) === 0, '没有页内锚点');
  if (r.findings.some(f => f.code === 'svg.rasterTextCopy')) {
    // 位图上方的透明文字：放在位图（foreignObject）之后、落在位图的范围内
    const pg = await browser.newPage();
    await pg.setViewport({ width: 335, height: 800 });
    await setContentReady(pg, previewDoc(r.preview));
    const copies = await pg.evaluate(() =>
      [...document.querySelectorAll('svg text')]
        .filter(t => getComputedStyle(t).fillOpacity === '0')
        .map(t => {
          let fo = t.previousElementSibling;
          while (fo && fo.localName !== 'foreignObject') fo = fo.previousElementSibling;
          if (!fo) return null;
          const a = t.getBoundingClientRect(),
            b = fo.getBoundingClientRect();
          const inside =
            a.left >= b.left - 2 && a.right <= b.right + 2 && a.top >= b.top - 2 && a.bottom <= b.bottom + 2;
          return { text: t.textContent, inside };
        })
        .filter(Boolean),
    );
    await pg.close();
    check(
      copies.length > 0 && copies.every(c => c.inside),
      '画成位图的文字上方有透明文字，位置落在位图内',
      copies.map(c => `${c.text}${c.inside ? '' : '（超出位图）'}`).join(' | ') || '没有找到',
    );
  }
  check(count(/data-wxc/g) === 0, '没有工具属性');
  check(!r.findings.some(f => f.code === 'htmlAnim') && !/extfake|extvar/.test(p), '忽略非文章样式表（扩展注入）');
  check(count(/>\s*\n\s*</g) === 0, '没有标签间换行');
  check(
    r.stats.visualBad.length === 0,
    '成品与原稿逐元素一致',
    `${r.stats.verified} 个元素，偏差 ${r.stats.visualBad.length}：${r.stats.visualBad.slice(0, 8).join(',')}`,
  );
  const otherIds = new Set(r.stats.others.flatMap(([, b]) => b));
  const listed = new Set(
    r.findings.filter(f => f.code === 'otherWidths' || f.code === 'otherWidthsOk').flatMap(f => f.ids),
  );
  check(
    [...otherIds].every(id => listed.has(id)),
    '其他宽度下逐元素一致，或偏差已列入检查结果',
    r.stats.others.map(([w, b]) => `${w}px:${b.length}(${b.slice(0, 5).join(',')})`).join(' ') || '无偏差',
  );
  if (SVG_MODE) {
    const o = r.stats.outline;
    check(
      o && o.kept > 0,
      'SVG 模式下有大字转成轮廓',
      o ? `${o.kept}/${o.units} 段，${o.chars} 字，约 ${Math.round(o.bytes / 1024)} KB` : '无统计',
    );
    // 检查结果与字体表说的是同一组数：勾选的行中没转的字数、各原因的字数
    if (!r.findings.some(f => f.code === 'svgPathServer')) {
      const table = {};
      for (const row of r.fonts)
        for (const [code, n] of Object.entries(row.why)) if (n > 0) table[code] = (table[code] || 0) + n;
      const total = Object.values(table).reduce((a, b) => a + b, 0);
      const left = r.findings.find(f => f.code === 'svgPathLeft');
      const listed = left ? left.parts.flatMap(p => p.items ?? []).map(m => [m.params.why.key, m.params.n]) : [];
      const same =
        (left ? left.params.n : 0) === total &&
        listed.length === Object.keys(table).length &&
        listed.every(([key, n]) => table[key.replace(/^why\./, '')] === n);
      check(
        same,
        '检查结果中没转为路径的字数与原因和字体表一致',
        `表 ${JSON.stringify(table)}；检查结果 ${left ? left.params.n : 0} 字 ${JSON.stringify(listed)}`,
      );
    }
    // 复制层：每个轮廓的透明文字连起来要等于它替换掉的原文
    const lost = await page.evaluate(html => {
      const d = document.createElement('div');
      d.innerHTML = html;
      const norm = s => s.replace(/[\s\u00a0]+/g, ' ').trim();
      return [...d.querySelectorAll('svg[aria-label]')]
        .filter(s => s.querySelector('path') && s.querySelector('text'))
        .map(s => [
          norm(s.getAttribute('aria-label')),
          norm([...s.querySelectorAll('text')].map(t => t.textContent).join('')),
        ])
        .filter(([a, b]) => a !== b);
    }, p);
    check(
      !lost.length,
      '轮廓的透明复制层文字与原文一致',
      lost
        .slice(0, 2)
        .map(([a, b]) => `${a} ≠ ${b}`)
        .join(' | '),
    );
    // 竖排轮廓的复制层：每个透明的字落在原稿同一个字的字框上（比字框中线与上沿）
    const charBoxes = async (html, ids) => {
      const pg = await browser.newPage();
      await pg.setViewport({ width: 335, height: 800 });
      await pg.goto(`http://127.0.0.1:${UI}/__blank`);
      await setContentReady(pg, html);
      const out = await pg.evaluate(ids => {
        ids ??= [...document.querySelectorAll('svg[data-wxc-unit]')]
          .filter(s => getComputedStyle(s).writingMode !== 'horizontal-tb' && s.parentElement.hasAttribute('data-wxc'))
          .map(s => s.parentElement.getAttribute('data-wxc'));
        const range = document.createRange();
        return ids.map(id => {
          const el = document.querySelector(`[data-wxc="${id}"]`);
          const texts = [...el.querySelectorAll('text')].filter(t => getComputedStyle(t).fillOpacity === '0');
          const nodes = [];
          const walk = n => (n.nodeType === 3 ? nodes.push(n) : n.childNodes.forEach(walk));
          (texts.length ? texts : [el]).forEach(walk);
          const boxes = [];
          for (const t of nodes)
            for (let i = 0; i < t.data.length; i++) {
              if (!t.data[i].trim() || t.data[i] === '\u00a0' || t.data[i] === '\u2060') continue;
              range.setStart(t, i);
              range.setEnd(t, i + 1);
              const b = range.getBoundingClientRect();
              boxes.push([t.data[i], b.left + b.width / 2, b.top]);
            }
          return [id, boxes];
        });
      }, ids);
      await pg.close();
      return out;
    };
    const vc = await charBoxes(prev, null);
    if (vc.length) {
      const vo = new Map(
        await charBoxes(
          r.original,
          vc.map(([id]) => id),
        ),
      );
      const off = [];
      let n = 0;
      for (const [id, cs] of vc) {
        const os = vo.get(id) || [];
        if (cs.length !== os.length) off.push(`${id} 字数 ${cs.length}/${os.length}`);
        else
          cs.forEach(([ch, x, y], i) => {
            n++;
            const [oc, ox, oy] = os[i];
            if (ch !== oc || Math.abs(x - ox) > 1 || Math.abs(y - oy) > 1)
              off.push(`${id} ${ch} Δ${(x - ox).toFixed(1)},${(y - oy).toFixed(1)}`);
          });
      }
      check(
        !off.length,
        '竖排轮廓的透明复制层逐字落在原稿的字框上',
        off.slice(0, 4).join(' | ') || `${vc.length} 段 ${n} 字`,
      );
    }
    // 测试稿里用 data-expect 标了哪些该转、哪些不该转
    const wrong = await page.evaluate(html => {
      const d = document.createElement('div');
      d.innerHTML = html;
      return [...d.querySelectorAll('[data-expect]')]
        .filter(e => (e.dataset.expect === 'svg') !== !!e.querySelector('svg[data-wxc-unit]'))
        .map(e => `${e.dataset.expect}: ${e.textContent.slice(0, 12)}`);
    }, r.preview);
    check(!wrong.length, '该转的转了、不该转的没转（data-expect）', wrong.join(' | '));
    // 连字：轮廓里每个字形以一个绝对 M 开头，数出来要等于测试稿标的字形数
    const glyphN = await page.evaluate(html => {
      const d = document.createElement('div');
      d.innerHTML = html;
      return [...d.querySelectorAll('[data-expect-glyphs]')].map(e => [
        e.dataset.expectGlyphs,
        [...e.querySelectorAll('svg[data-wxc-unit] path')].reduce(
          (n, p) => n + (p.getAttribute('d').match(/M/g) || []).length,
          0,
        ),
        e.textContent.slice(0, 16),
      ]);
    }, r.preview);
    if (glyphN.length)
      check(
        glyphN.every(([a, b]) => +a === b),
        '连字按整词排版画出（字形数与 Chrome 一致）',
        glyphN.map(([a, b, t]) => `${t}: ${b}/${a}`).join(' | '),
      );
    for (const v of r.verdicts || [])
      if (!v.keep)
        console.log(
          `    未转 ${v.why}${v.side ? '（另一宽度）' : ''}${v.dev ? ' 偏差[宽,高,字x,基线,字号]=' + v.dev.join(',') : ''}${v.detail ? ' 挪位 ' + v.detail.join(' | ') : ''}  ${v.id}${v.run ? '（行内段）' : ''} ${v.text}`,
        );
  }
  {
    const tv = new Map(r.tv),
      worst = [0, 0, 0, 0, ''];
    for (const [k, b] of r.v) {
      const a = tv.get(k);
      if (!a) continue;
      const d = [Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)];
      d.forEach((v, i) => {
        if (v > worst[i]) {
          worst[i] = v;
          if (i === 1) worst[4] = k;
        }
      });
    }
    console.log(
      `    主宽度逐元素最大偏差 x ${worst[0].toFixed(3)} · y ${worst[1].toFixed(3)}（${worst[4]}）· w ${worst[2].toFixed(3)} · h ${worst[3].toFixed(3)} px`,
    );
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
  // hide：不比的元素（data-wxc），它们在这张图里的框追加到 hidden
  const shot = async (html, w, masks, t = 0, clicks = null, hide = [], hidden = []) => {
    const pg = await browser.newPage();
    await pg.setViewport({ width: w, height: 800 });
    // 在本机服务的源下写入内容：原稿引用的本地字体（/a/…）同源，不用跨域
    await pg.goto(`http://127.0.0.1:${UI}/__blank`);
    const cdp = await pg.createCDPSession();
    await cdp
      .send('Animation.enable')
      .then(() => cdp.send('Animation.setPlaybackRate', { playbackRate: 0 }))
      .catch(() => {});
    await setContentReady(pg, html);
    if (masks) await pg.evaluate(`(${readerImages})(document, true)`);
    const freeze = t =>
      pg.evaluate(t => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t * 1000;
        }
        for (const s of document.querySelectorAll('svg')) {
          s.pauseAnimations();
          s.setCurrentTime(t);
        }
      }, t);
    await freeze(t);
    if (clicks != null) {
      for (const h of await pg.$$('[data-click]')) await h.click().catch(() => {});
      await freeze(clicks);
    }
    // 不比像素的区域：轮廓（另做逐单元对位检查），以及测试稿里标了 data-pixel-skip 的元素
    if (masks)
      masks.push(
        ...(await pg.evaluate(
          sampled =>
            [
              ...[...document.querySelectorAll('svg[data-wxc-unit]')].map(s => s.parentElement),
              ...document.querySelectorAll(sampled ? '[data-pixel-skip],[data-sample-skip]' : '[data-pixel-skip]'),
            ].map(e => {
              const b = e.getBoundingClientRect();
              return [b.left + scrollX, b.top + scrollY, b.width, b.height];
            }),
          !!(t || clicks != null),
        )),
      );
    if (hide.length)
      hidden.push(
        ...(await pg.evaluate(
          ids =>
            ids.flatMap(id =>
              [...document.querySelectorAll(`[data-wxc="${id}"]`)].map(e => {
                const b = e.getBoundingClientRect();
                return [b.left + scrollX, b.top + scrollY, b.width, b.height];
              }),
            ),
          hide,
        )),
      );
    const b = await pg.screenshot({ fullPage: true, encoding: 'base64' });
    await pg.close();
    return b;
  };
  // 成片差异的门槛：测试稿与本机文章里字形的亚像素位移腐蚀后每个方块至多剩 32 个，20×20 的缺块剩 256 个
  const SOLID_MAX = 64;
  if (SVG_MODE) {
    // 轮廓区域单独量：逐个单元的亚像素偏移与墨量（3 倍像素密度，接近手机）。
    // 偏移门槛：Chrome 把 svg 盒子对齐到整 CSS 像素而字形保留小数位置，横向差最多 0.5px；纵向文字基线也取整，两次取整最多差 1px。
    // 祖先带旋转时，Chrome 画 svg 前还会把它的位置取整到整 CSS 像素（svg 挪 0.5px，量到的横向偏移在 3 倍、6 倍下都跳 1px），横向再多 0.5px
    console.log('\n轮廓对位（3x）');
    const al = await alignUnits(browser, r.original, prevHtml, width, 3, `http://127.0.0.1:${UI}`);
    const off = al.filter(
      a => Math.abs(a.dx) > (a.rotated ? 1.05 : 0.55) || Math.abs(a.dy) > 1.1 || a.ink < 0.85 || a.ink > 1.15,
    );
    if (al.length)
      check(
        !off.length,
        '每个轮廓与原稿字形对齐（横向 ≤0.55px、在旋转的容器里 ≤1.05px，纵向 ≤1.1px，墨量差 ≤15%）',
        off.length
          ? off
              .slice(0, 4)
              .map(a => `#${a.unit} dx${a.dx} dy${a.dy} ink${a.ink}`)
              .join(' | ')
          : `${al.length} 段，最大 |dx| ${Math.max(...al.map(a => Math.abs(a.dx))).toFixed(2)}、|dy| ${Math.max(...al.map(a => Math.abs(a.dy))).toFixed(2)}，墨量 ${Math.min(...al.map(a => a.ink)).toFixed(2)}–${Math.max(...al.map(a => a.ink)).toFixed(2)}`,
      );
  }
  console.log('\n逐像素');
  for (const w of [width, 320, 460, 637]) {
    const sfx = w === width ? '' : '-' + w;
    const masks = [],
      hide = w === width ? [] : [...listed];
    const [a, b] = [
      await shot(r.original, w, null, 0, null, hide, masks),
      await shot(prevHtml, w, masks, 0, null, hide, masks),
    ];
    fs.writeFileSync(path.join(OUT, `original${sfx}.png`), Buffer.from(a, 'base64'));
    fs.writeFileSync(path.join(OUT, `converted${sfx}.png`), Buffer.from(b, 'base64'));
    const diff = await pixelDiff(a, b, masks);
    fs.writeFileSync(path.join(OUT, `diff${sfx}.png`), Buffer.from(diff.diff, 'base64'));
    check(Math.abs(diff.ha - diff.hb) <= 2, `${w}px 页面高度一致`, `${diff.ha} vs ${diff.hb}`);
    // 已列入检查结果（这个宽度下有偏差）的元素在两张图里都不比
    check(
      diff.solid <= SOLID_MAX,
      `${w}px 没有成片的差异（${WINDOW}×${WINDOW} 方块里腐蚀后 ≤${SOLID_MAX} 个不同的像素）` +
        (diff.area ? `，不含屏蔽区域 ${((diff.area / diff.total) * 100).toFixed(1)}%` : ''),
      `最多 ${diff.solid} 个，在 (${diff.at})；不同的像素共 ${diff.bad} 个（test/out/diff${sfx}.png）`,
    );
  }

  // SVG 动画：主宽度下再冻结在几个时刻比一次，最后点一遍 data-click 元素看点击动画
  if (/<(animate|set|animateTransform|animateMotion)\b|@keyframes/.test(r.original)) {
    console.log('\n动画采样');
    const bad = [];
    for (const [t, clicks] of [
      [0.37, null],
      [1.13, null],
      [2.71, null],
      [0.5, 0.75],
      [0.5, 1.7],
    ]) {
      const masks = [];
      const [a, b] = [await shot(r.original, width, null, t, clicks), await shot(prevHtml, width, masks, t, clicks)];
      const d = await pixelDiff(a, b, masks);
      if (d.solid > SOLID_MAX) {
        const tag = clicks == null ? `t=${t}s` : `点击后 ${Math.round((clicks - t) * 100) / 100}s`;
        bad.push(`${tag} ${d.solid} 个，在 (${d.at})`);
        fs.writeFileSync(path.join(OUT, `diff-anim-${t}-${clicks ?? 'x'}.png`), Buffer.from(d.diff, 'base64'));
      }
    }
    check(!bad.length, '动画在各采样时刻与原稿一致（没有成片的差异）', bad.join(' | ') || '5 个时刻');
  }

  // 字体表（放在逐像素之后：勾选会触发重新转换）
  console.log('\n字体表');
  {
    const fonts = await page.evaluate(() => window.__wxc.result.fonts);
    check(foldedAtStart, '字体列表默认折叠');
    await openFontList(page);
    const summary = await page.$eval('#faceBox > summary', e => e.textContent);
    check(summary.includes(`共 ${fonts.length} 行`), '折叠的标题中写出行数与勾选的行数', summary);
    const rows = await page.$$eval('#faceList [data-key]', els => els.map(t => t.dataset.key));
    check(
      rows.length === fonts.length && rows.length > 0 && fonts.every(f => rows.includes(f.key)),
      '每套字的每个字号列成一行',
      `${rows.length} 行：` +
        fonts
          .slice(0, 8)
          .map(f => `${f.family} ${f.weight} ${f.size}px（${f.chars} 字${f.done ? `，已转 ${f.done}` : ''}）`)
          .join('、') +
        (fonts.length > 8 ? ' …' : ''),
    );
    const keyed = sel => `#faceList [data-key="${sel.replace(/["\\]/g, String.raw`\$&`)}"] [role="checkbox"]`;
    if (SVG_MODE) {
      const t = fonts.find(f => f.done > 0);
      if (t) {
        const before = r.stats.outline.chars;
        await page.click(keyed(t.key));
        await settled(page);
        const after = await page.evaluate(k => {
          const s = window.__wxc.result;
          return { chars: s.stats.outline ? s.stats.outline.chars : 0, done: s.fonts.find(f => f.key === k).done };
        }, t.key);
        check(
          after.chars < before && after.done < t.done,
          '取消勾选一行后重新转换，这一行转为路径的字变少',
          `${t.family} ${t.weight} ${t.size}px：${t.done} → ${after.done} 字；总计 ${before} → ${after.chars} 字`,
        );
      }
    }
    if (!SVG_MODE) {
      // 字号按 335px 正文宽折算：换预览宽度，行不变（主宽度不是 335 时走两宽度插值）
      const w0 = await page.$eval('#width', e => e.value);
      await page.select('#width', '320');
      await settled(page);
      const k320 = await page.evaluate(() => window.__wxc.result.fonts.map(f => f.key));
      const a = fonts.map(f => f.key).filter(k => !k320.includes(k)),
        b = k320.filter(k => !fonts.some(f => f.key === k));
      check(
        !a.length && !b.length,
        '换预览宽度后字体表的行不变',
        a.length || b.length
          ? `只在 ${w0}px：${a.slice(0, 3).join('，')}；只在 320px：${b.slice(0, 3).join('，')}`
          : `${k320.length} 行`,
      );
      await page.select('#width', w0);
      await settled(page);
    }
    if (ARTICLE === path.join(HERE, 'fixture')) {
      const all = '#faceList [role="checkbox"][data-scope="all"]';
      await page.click(all);
      await settled(page);
      if (!(await isChecked(page, all))) {
        await page.click(all);
        await settled(page);
      }
      const on = await page.evaluate(() => {
        const s = window.__wxc.result;
        return { paths: s.paths.length, rows: s.fonts.length, units: s.stats.outline ? s.stats.outline.units : 0 };
      });
      await page.click(all);
      await settled(page);
      const off = await page.evaluate(() => ({
        paths: window.__wxc.result.paths.length,
        outline: window.__wxc.result.stats.outline,
      }));
      check(
        on.paths === on.rows && on.units > 0 && !off.paths && !off.outline,
        '表头勾选框全选、全不选',
        `全选 ${on.paths}/${on.rows} 行、${on.units} 段；全不选后 ${off.paths} 行`,
      );
    }
  }

  // 阅读页模拟：右栏是成品套上阅读页框架（浅色、深色），比对与复制用的是隐藏的 #verify
  console.log('\n阅读页模拟');
  {
    const errs0 = errors.length;
    const frameOk = () =>
      page.waitForFunction(
        () => {
          const d = document.getElementById('paneB').contentDocument;
          return !!(d && d.documentElement && d.getElementById('js_content') && d.readyState === 'complete');
        },
        { timeout: 30000 },
      );
    await frameOk();
    const light = await page.evaluate(() => {
      const f = document.getElementById('paneB'),
        d = f.contentDocument,
        c = d.getElementById('js_content').getBoundingClientRect();
      return {
        title: !!d.querySelector('.rich_media_title'),
        bar: !!d.querySelector('.wx_bar'),
        left: c.left,
        right: f.clientWidth - c.right,
        n: d.querySelectorAll('#js_content [data-wxc]').length,
        bg: getComputedStyle(d.body).backgroundColor,
        verify: document.getElementById('verify').contentDocument.querySelector('.rich_media_content').innerText.trim()
          .length,
      };
    });
    check(
      light.title &&
        light.bar &&
        light.left === 20 &&
        light.right === 20 &&
        light.n > 0 &&
        light.bg === 'rgb(255, 255, 255)',
      '浅色：标题、底栏、正文左右各 20px',
      `左 ${light.left} 右 ${light.right}，${light.n} 个元素，底色 ${light.bg}`,
    );
    check(light.verify > 0, '比对用的隐藏 iframe 里有正文（复制时的纯文本取自这里）', `${light.verify} 字`);
    // 页头与底栏取自原稿：<title>、作者（没有站点名时作为公众号名称）、文件修改时间、网站图标（没有声明时取 favicon.ico）
    {
      const entry = fs.statSync(ARTICLE).isDirectory() ? path.join(ARTICLE, 'index.html') : ARTICLE;
      const src = fs.readFileSync(entry, 'utf8');
      const title = (src.match(/<title>([^<]*)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim() || '文章标题';
      const author = (src.match(/<meta name="author" content="([^"]*)"/) || [])[1] || '';
      const d = new Date(fs.statSync(entry).mtimeMs),
        pad = n => String(n).padStart(2, '0');
      const time = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const hasIcon = fs.existsSync(path.join(path.dirname(entry), 'favicon.ico'));
      await page
        .waitForFunction(
          () => {
            const img = document.getElementById('paneB').contentDocument.querySelector('.wx_avatar img');
            return !img || img.complete;
          },
          { timeout: 10000 },
        )
        .catch(() => {});
      const frame = await page.evaluate(() => {
        const d = document.getElementById('paneB').contentDocument,
          img = d.querySelector('.wx_avatar img');
        return {
          title: d.querySelector('.rich_media_title').textContent,
          name: d.querySelector('.wx_name').textContent,
          bar: d.querySelector('.wx_bar_name').textContent,
          time: d.querySelector('.wx_time').textContent,
          icon: img ? { src: img.getAttribute('src'), w: img.naturalWidth } : null,
        };
      });
      const iconOk = hasIcon ? !!frame.icon && frame.icon.src.endsWith('.ico') && frame.icon.w === 32 : !frame.icon;
      check(
        frame.title === title &&
          frame.name === (author || '公众号名称') &&
          frame.bar === frame.name &&
          frame.time === time &&
          iconOk,
        '页头与底栏：原稿的标题、作者、文件修改时间与网站图标',
        JSON.stringify(frame),
      );
    }
    // 侧栏里每行末尾的 "?" 靠右对齐成一列
    const helpRights = await page.$$eval('.side .row > .tip-anchor:last-child > .help', els => [
      ...new Set(els.map(e => Math.round(e.getBoundingClientRect().right))),
    ]);
    check(helpRights.length === 1, '侧栏中行末的说明按钮对齐成一列', `右边缘 ${helpRights.join('、')}px`);
    await page.screenshot({ path: path.join(OUT, `stage-light${SVG_MODE ? '-svg' : ''}.png`) });
    await page.click('#dark');
    await page
      .waitForFunction(
        () => {
          const d = document.getElementById('paneB').contentDocument;
          return !!(
            d &&
            d.documentElement &&
            d.documentElement.classList.contains('data_color_scheme_dark') &&
            d.readyState === 'complete'
          );
        },
        { timeout: 60000 },
      )
      .catch(() => {});
    const dark = await page.evaluate(() => {
      const d = document.getElementById('paneB').contentDocument;
      return {
        cls: d.documentElement.classList.contains('data_color_scheme_dark'),
        bg: getComputedStyle(d.body).backgroundColor,
        scripts: d.querySelectorAll('script').length,
        n: d.querySelectorAll('#js_content [data-wxc]').length,
        rules: [...d.querySelectorAll('style')].some(s => /data_color_scheme_dark/.test(s.textContent)),
      };
    });
    check(
      dark.cls && dark.bg === 'rgb(25, 25, 25)' && !dark.scripts && dark.n === light.n,
      '深色：转换算法跑过、页面底色 #191919、不带脚本、元素一个不少',
      `${dark.cls ? '有' : '无'} data_color_scheme_dark，${dark.rules ? '有' : '无'}转换规则，底色 ${dark.bg}，脚本 ${dark.scripts}，${dark.n}/${light.n} 个元素`,
    );
    await page.screenshot({ path: path.join(OUT, `stage-dark${SVG_MODE ? '-svg' : ''}.png`) });
    await page.click('#dark');
    await frameOk();
    // 左栏与右栏底栏以上的可见区同宽、同高、上沿对齐
    const panesBox = await page.evaluate(() => {
      const a = document.getElementById('paneA').getBoundingClientRect(),
        b = document.getElementById('paneB'),
        rb = b.getBoundingClientRect(),
        bar = b.contentDocument.querySelector('.wx_bar').getBoundingClientRect().height,
        body = b.contentDocument.getElementById('js_content').getBoundingClientRect().width;
      return { a: [a.width, a.top, a.height], b: [body, rb.top, rb.height - bar] };
    });
    check(
      panesBox.a.every((v, i) => Math.abs(v - panesBox.b[i]) <= 1),
      '左栏原网页预览与右栏正文可见区同宽、同高、上沿对齐',
      `宽/上沿/高 左 ${panesBox.a.map(v => v.toFixed(1)).join('/')}，右 ${panesBox.b.map(v => v.toFixed(1)).join('/')}`,
    );
    // 原网页顶上留出与标题区等高的空白：同一元素在两栏的高度相同，滚动前后都一样（同步滚动是一比一）
    const sameHeight = await page.evaluate(async () => {
      const a = document.getElementById('paneA'),
        b = document.getElementById('paneB');
      await new Promise(r => setTimeout(r, 300));
      const at = () => {
        for (const el of a.contentDocument.querySelectorAll('[data-wxc]')) {
          const twin = b.contentDocument.querySelector(`[data-wxc="${el.getAttribute('data-wxc')}"]`);
          const ra = el.getBoundingClientRect();
          if (!twin || !ra.height) continue;
          const top = ra.top + a.getBoundingClientRect().top,
            twinTop = twin.getBoundingClientRect().top + b.getBoundingClientRect().top;
          return [el.getAttribute('data-wxc'), top - twinTop];
        }
        return ['', NaN];
      };
      const [id, before] = at();
      a.contentWindow.scrollTo(0, 200);
      await new Promise(r => setTimeout(r, 300));
      const [, after] = at();
      return { id, before, after, scrolled: [a.contentWindow.scrollY, b.contentWindow.scrollY] };
    });
    check(
      Math.abs(sameHeight.before) <= 1 && Math.abs(sameHeight.after) <= 1,
      '两栏中同一元素高度相同，同步滚动后仍相同',
      `${sameHeight.id} 高度差 ${sameHeight.before.toFixed(1)} → ${sameHeight.after.toFixed(1)}px，滚动 ${sameHeight.scrolled.join('/')}`,
    );
    check(errors.length === errs0, '切换深色、同步滚动时页面无脚本错误', errors.slice(errs0, errs0 + 3).join(' | '));
  }

  console.log('\n端口安全');
  const ids = assetIdsIn(p).filter(id => /\.(png|jpe?g|gif|webp|svg)$/.test(id));
  if (ids.length) check((await raw(IMG, '/a/' + ids[0])).status === 200, '图床口能取到已登记图片');
  check((await raw(IMG, '/api/state')).status === 404, '图床口不暴露 API');
  check((await raw(IMG, '/a/..%2f..%2fserver.ts')).status === 404, '图床口路径穿越 404');
  check((await raw(IMG, '/a/0000000000000000.png')).status === 404, '图床口未登记 id 404');
  const css = assetIdsIn(p).filter(id => id.endsWith('.css'));
  if (css.length) check((await raw(IMG, '/a/' + css[0])).status === 404, '图床口不出非图片文件');
  check(
    (await raw(UI, '/api/state', { headers: { host: 'evil.example:' + UI } })).status === 403,
    'UI 口拒绝陌生 Host',
  );
  check(
    (
      await raw(UI, '/api/open', {
        method: 'POST',
        headers: { host: '127.0.0.1:' + UI, origin: 'http://evil.example' },
        body: '{"path":"C:/"}',
      })
    ).status === 403,
    'UI 口拒绝跨站 POST',
  );
  check(
    (await raw(UI, '/api/open', { method: 'POST', headers: { host: '127.0.0.1:' + UI }, body: '{"path":"C:/"}' }))
      .status === 403,
    'UI 口拒绝不带 Origin 的 POST',
  );
  if (ids.length) {
    const h = (await raw(IMG, '/a/' + ids[0])).headers;
    check(
      /sandbox/.test(h['content-security-policy'] || '') && h['x-content-type-options'] === 'nosniff',
      '取图口的文件带 CSP sandbox 与 nosniff（文章里的 SVG 脚本跑不起来）',
    );
  }
  {
    // 文章文件夹外的文件不登记：用相对路径指向仓库里的 ui/src/app.css
    const dir = fs.statSync(ARTICLE).isDirectory() ? ARTICLE : path.dirname(ARTICLE);
    const outside = path
      .relative(dir, path.join(HERE, '..', 'ui', 'src', 'app.css'))
      .split(path.sep)
      .join('/');
    const r2 = await raw(UI, '/api/assets', {
      method: 'POST',
      headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI },
      body: JSON.stringify({ refs: [outside] }),
    });
    check(r2.status === 200 && JSON.parse(r2.body)[outside] === null, '不登记文章文件夹以外的文件', outside);
  }
  {
    // 资源管理器“复制文件地址”得到的路径带双引号。指向没有 HTML 的 test/vendor，不会换掉当前文章
    const noHtml = path.join(HERE, 'vendor');
    const r3 = await raw(UI, '/api/open', {
      method: 'POST',
      headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI },
      body: JSON.stringify({ path: ` "${noHtml}" ` }),
    });
    const reply = JSON.parse(r3.body);
    check(
      r3.status === 400 && reply.code === 'noHtml' && reply.params?.path === noHtml,
      '打开的路径去掉前后的空格与引号',
      `${r3.status} ${reply.code} ${reply.params?.path}`,
    );
  }

  // 下载进度：照微信服务器的请求规律模拟——下载成功只来一次；超时（约 0.5 秒）隔 0.5 秒重试，三次后放弃
  console.log('\n下载进度');
  {
    const uniq = [...new Set(ids)];
    if (uniq.length) {
      // 上面的端口检查刚请求过这几张图，隔开一段（超过判断"同一串"的 1.5 秒），免得算进复制之后的请求
      await new Promise(r => setTimeout(r, 1600));
      // 复制时刻取页面的时钟、请求时刻取服务进程的时钟，两者相差可达 1–2 毫秒：紧跟着发的请求可能被记在复制之前。
      // 真实的取图在粘贴之后，至少晚几秒，所以这里也隔开一点
      const markCopied = async () => {
        await page.evaluate(() => {
          window.__wxc.copiedAt = { t: Date.now(), base: 'http://test.invalid' };
        });
        await new Promise(r => setTimeout(r, 100));
      };
      await markCopied();
      const [first, ...rest] = uniq;
      const bad = rest.length ? rest[0] : first;
      if (rest.length) await raw(IMG, '/a/' + first);
      for (let k = 0; k < 3; k++) {
        await raw(IMG, '/a/' + bad);
        await new Promise(r => setTimeout(r, 500));
      }
      // 只请求一次的图要过 2 秒没有重试才算下载完成，等两个条件同时成立
      const want = `已下载 ${rest.length ? 1 : 0}/${uniq.length}`;
      await page
        .waitForFunction(
          w => {
            const t = document.getElementById('fetchLine').textContent;
            return /连续三次/.test(t) && t.includes(w);
          },
          { timeout: 15000 },
          want,
        )
        .catch(() => {});
      const fl = await page.evaluate(() => {
        const e = document.getElementById('fetchLine');
        return { text: e.textContent, cls: e.className, hidden: e.hidden };
      });
      check(
        !fl.hidden && /连续三次下载超时/.test(fl.text) && /err/.test(fl.cls) && fl.text.includes(want),
        '同一张图 0.5 秒间隔连续请求三次：报为下载超时，其余按成功计',
        fl.text.slice(0, 90),
      );
      await new Promise(r => setTimeout(r, 1600));
      await markCopied();
      for (const id of uniq) await raw(IMG, '/a/' + id);
      await page
        .waitForFunction(() => /已下载全部/.test(document.getElementById('fetchLine').textContent), { timeout: 15000 })
        .catch(() => {});
      const all = await page.evaluate(
        ids => ({
          text: document.getElementById('fetchLine').textContent,
          now: window.__wxc.result
            ? (window.__wxc.result.payload.match(/\/a\/[0-9a-f]{16}\.[a-z0-9]+/g) || []).length
            : -1,
          missing: [
            ...new Set(
              (window.__wxc.result.payload.match(/\/a\/([0-9a-f]{16}\.[a-z0-9]+)/g) || []).map(s => s.slice(3)),
            ),
          ].filter(id => !ids.includes(id)),
        }),
        uniq,
      );
      check(
        /已下载全部/.test(all.text),
        '每张图各请求一次、2 秒内不再请求：报为全部下载完成',
        /已下载全部/.test(all.text)
          ? ''
          : `${all.text.slice(0, 60)}；成品里不在测试列表中的图：${all.missing.join(',') || '无'}`,
      );
      await page.evaluate(() => {
        window.__wxc.copiedAt = null;
      });
    }
    // 超过 1 MB 的本地图片列进检查结果（大小取自本机服务的 HEAD 响应）
    const big = await raw(UI, '/api/blob?ext=png&name=big.png', {
      method: 'POST',
      headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI },
      body: Buffer.alloc(1100000),
    });
    const bid = JSON.parse(big.body).id;
    const found = await page.evaluate(
      id => window.__wxcBig(`<img src="/a/${id}"><img src="/a/${id}">`, new Map([[id, 'img/big.png']])),
      bid,
    );
    check(
      found.length === 1 && found[0].name === 'img/big.png' && found[0].size === 1100000,
      '超过上限（默认 1000 KB）的图片按名字和大小列出（同一张只算一次）',
      JSON.stringify(found),
    );
  }

  // 大图压缩：服务端把比 1080px 宽的图缩到 1080 宽、在上限内选编码；勾选后成品换成压缩后的副本
  console.log('\n大图压缩');
  {
    const blob = async (buf, ext, name) =>
      JSON.parse(
        (
          await raw(UI, `/api/blob?ext=${ext}&name=${name}`, {
            method: 'POST',
            headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI },
            body: buf,
          })
        ).body,
      ).id;
    const shrinkApi = async body =>
      JSON.parse(
        (
          await raw(UI, '/api/shrink', {
            method: 'POST',
            headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI },
            body: JSON.stringify(body),
          })
        ).body,
      );
    // 像照片的图：渐变加伪随机噪点（固定种子，每次相同）
    const W = 2400,
      H = 1600,
      px = Buffer.alloc(W * H * 3);
    let seed = 7;
    for (let i = 0; i < px.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const x = ((i / 3) | 0) % W,
        y = (i / 3 / W) | 0;
      px[i] = 128 + 90 * Math.sin((x + (i % 3) * 40) / 83) * Math.cos(y / 57) + (seed % 48) - 24;
    }
    const photo = await sharp(px, { raw: { width: W, height: H, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const photoId = await blob(photo, 'jpg', 'photo.jpg');
    // 读者拿到的图最宽 1080px：更宽的先缩到 1080 宽，再在上限内选尽量高的画质
    const r1 = await shrinkApi({ id: photoId, max: 400 << 10 });
    check(
      r1.id &&
        r1.width === 1080 &&
        r1.height === 720 &&
        r1.id.endsWith('.jpg') &&
        r1.size <= 400 << 10 &&
        r1.srcSize === photo.length &&
        !r1.over,
      '比 1080px 宽的照片缩到 1080px 宽，在上限内用尽量高的画质，存为 JPEG',
      `${photo.length} → ${r1.size} 字节，${r1.width}×${r1.height}，${JSON.stringify(r1.how)}`,
    );
    const roomy = await shrinkApi({ id: photoId, max: photo.length - 1024 });
    check(
      roomy.width === 1080 && roomy.how && roomy.how.fmt === 'jpeg' && roomy.how.q === 92 && !roomy.over,
      '上限宽裕时缩到 1080px 宽、用最高一档画质',
      `${roomy.width}×${roomy.height}，${JSON.stringify(roomy.how)}，${roomy.size} 字节`,
    );
    // 原图在上限内、只是比 1080px 宽：副本不超过原图。这张质量 80 的图缩到 1080 宽后，质量 92 是原图的 114%、90 是 97%
    const light = await sharp(px, { raw: { width: W, height: H, channels: 3 } })
      .resize(1200, 800)
      .jpeg({ quality: 80 })
      .toBuffer();
    const r5 = await shrinkApi({ id: await blob(light, 'jpg', 'light.jpg'), max: 1000 << 10 });
    check(
      r5.width === 1080 && r5.size <= light.length && r5.how?.q >= 85 && r5.how?.q < 92 && !r5.over,
      '比 1080px 宽、不超过上限的图片缩到 1080px 宽，副本不超过原图',
      `${light.length} → ${r5.size} 字节，${r5.width}×${r5.height}，${JSON.stringify(r5.how)}`,
    );
    const served = r1.id ? await raw(IMG, '/a/' + r1.id) : { status: 0, headers: {} };
    check(
      served.status === 200 && served.headers['content-type'] === 'image/jpeg',
      '压缩后的副本由取图端口提供',
      `${served.status} ${served.headers['content-type']}`,
    );
    const small = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#468' } })
      .jpeg()
      .toBuffer();
    const r0 = await shrinkApi({ id: await blob(small, 'jpg', 'small.jpg'), max: 400 << 10 });
    check(r0.skip === 'fits', '不到 1080px 宽且不超过上限的图片不处理', JSON.stringify(r0));
    const TW = 900,
      TH = 2400,
      tall = Buffer.alloc(TW * TH * 3);
    for (let i = 0; i < tall.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      tall[i] = 128 + (seed % 96) - 48;
    }
    const tallBuf = await sharp(tall, { raw: { width: TW, height: TH, channels: 3 } })
      .jpeg({ quality: 98 })
      .toBuffer();
    const r4 = await shrinkApi({ id: await blob(tallBuf, 'jpg', 'tall.jpg'), max: 600 << 10 });
    check(
      r4.width === TW && r4.height === TH && (r4.size <= 600 << 10 || r4.over),
      '不到 1080px 宽但超过上限的图片保持原尺寸，降低画质',
      `${tallBuf.length} → ${r4.size} 字节，${r4.width}×${r4.height}，${JSON.stringify(r4.how)}${r4.over ? '，仍超过上限' : ''}`,
    );
    const alpha = await sharp({
      create: { width: 1600, height: 1600, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 0.5 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const r2 = await shrinkApi({ id: await blob(alpha, 'png', 'alpha.png'), max: 400 << 10 });
    const r2meta = r2.id
      ? await sharp(Buffer.from(await (await fetch(`http://127.0.0.1:${UI}/a/${r2.id}`)).arrayBuffer())).metadata()
      : {};
    check(
      (r2.id || '').endsWith('.png') && r2meta.hasAlpha && r2.width === 1080,
      '有透明部分的图片存为 PNG，保留透明；比 1080px 宽时缩到 1080px 宽',
      JSON.stringify({ id: r2.id, w: r2.width, alpha: r2meta.hasAlpha, how: r2.how }),
    );
    const r3 = await shrinkApi({
      id: await blob(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'svg', 'v.svg'),
      max: 1024,
    });
    check(r3.skip === 'vector', 'SVG 不压缩', JSON.stringify(r3));
    // 动图：sharp 读 APNG 只读第一帧，压缩会丢掉动画
    const frames = (width, height) =>
      Promise.all(
        ['#c33', '#36c'].map(color =>
          sharp({ create: { width, height, channels: 3, background: color } })
            .png()
            .toBuffer(),
        ),
      );
    const apng = apngOf(await frames(1600, 200));
    const r6 = await shrinkApi({ id: await blob(apng, 'png', 'anim.png'), max: 1000 << 10 });
    check(r6.skip === 'animated', '比 1080px 宽的 APNG 不压缩，保留动画', JSON.stringify(r6));
    // 公众号读者拿到的 APNG 与动图 WebP 只有第一帧，GIF 与静态图不算
    const tiny = await frames(40, 20);
    const stillIds = {
      apng: await blob(apngOf(tiny), 'png', 'a.png'),
      webp: await blob(
        await sharp(tiny, { join: { animated: true } })
          .webp()
          .toBuffer(),
        'webp',
        'a.webp',
      ),
      gif: await blob(
        await sharp(tiny, { join: { animated: true } })
          .gif()
          .toBuffer(),
        'gif',
        'a.gif',
      ),
      png: await blob(tiny[0], 'png', 'b.png'),
    };
    const stills = await page.evaluate(
      ids =>
        window.__wxcStills(
          Object.values(ids)
            .map(id => `<img src="/a/${id}">`)
            .join(''),
        ),
      stillIds,
    );
    check(
      stills.length === 2 && stills.includes(stillIds.apng) && stills.includes(stillIds.webp),
      '检查结果列出 APNG 与动图 WebP（只显示第一帧），不列 GIF 与静态 PNG',
      JSON.stringify(stills),
    );

    // 页面：把照片放进成品，勾选“压缩大图”、上限 400 KB → 成品里换成压缩后的副本；取消勾选后换回原图
    const saved = await page.evaluate(id => {
      const r = window.__wxc.result,
        keep = r.base;
      const tag = `<img src="${location.origin}/a/${id}" style="display:block;width:100%">`;
      r.base = { payload: r.base.payload + tag, preview: r.base.preview + tag };
      r.report.names.set(id, 'img/photo.jpg');
      return keep;
    }, photoId);
    const setShrink = async (on, kbv) => {
      await typeNumber(page, '#shrinkKb', kbv);
      await setChecked(page, '#shrinkOn', on);
    };
    await setShrink(true, 400);
    await page
      .waitForFunction(
        id => {
          const r = window.__wxc.result;
          return (
            !window.__wxc.shrinking && r.report.shrunk && r.report.shrunk.length && !r.payload.includes('/a/' + id)
          );
        },
        { timeout: 30000 },
        photoId,
      )
      .catch(() => {});
    const on = await page.evaluate(id => {
      const r = window.__wxc.result;
      return {
        kb: window.__wxc.shrink.kb,
        has: r.payload.includes('/a/' + id),
        shrunk: (r.report.shrunk || []).map(s => s.id),
        check: document.getElementById('checks').textContent.includes('张图片已缩小或压缩'),
      };
    }, photoId);
    check(
      on.kb === 400 && !on.has && on.shrunk.includes(r1.id) && on.check,
      '勾选后成品中的大图换成压缩后的副本，检查结果列出已缩小或压缩的图片',
      JSON.stringify(on),
    );
    await setShrink(false, 1000);
    await page
      .waitForFunction(
        id => !window.__wxc.shrinking && window.__wxc.result.payload.includes('/a/' + id),
        { timeout: 30000 },
        photoId,
      )
      .catch(() => {});
    const off = await page.evaluate(id => {
      const r = window.__wxc.result;
      return {
        kb: window.__wxc.shrink.kb,
        has: r.payload.includes('/a/' + id),
        big: (r.report.big || []).map(b => b.name),
      };
    }, photoId);
    check(
      off.kb === 1000 && off.has && off.big.includes('img/photo.jpg'),
      '取消勾选后换回原图，超过上限的图片列为“图片过大”',
      JSON.stringify(off),
    );
    await page.evaluate(keep => {
      window.__wxc.result.base = keep;
    }, saved);
    await setChecked(page, '#shrinkOn', false);
    await page.waitForFunction(() => !window.__wxc.shrinking, { timeout: 30000 }).catch(() => {});
  }

  // 取图地址：本机端口立即换绑并存进设置文件，被占时保持原端口；公网地址、端口、协议拼成取图地址（放在最后：之后图床口不在 IMG 上了）
  console.log('\n取图地址');
  {
    const post = body =>
      raw(UI, '/api/host', {
        method: 'POST',
        headers: { host: '127.0.0.1:' + UI, origin: 'http://127.0.0.1:' + UI },
        body: JSON.stringify(body),
      });
    const NEW = IMG + 2;
    const busy = http.createServer().listen(IMG + 3, '0.0.0.0');
    await new Promise(r => busy.once('listening', r));
    const submit = async (fields, until) => {
      const { hfProto, ...text } = fields;
      await page.evaluate(f => {
        for (const [id, v] of Object.entries(f)) {
          const e = document.getElementById(id);
          e.value = v;
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, text);
      if (hfProto) await page.click(`#hfProto .n-radio-button:has(input[value="${hfProto}"])`);
      await page.click('#hostForm button[type="submit"]');
      await page.waitForFunction(until, { timeout: 10000 }).catch(() => {});
    };
    const settingsNow = () => {
      try {
        return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
      } catch {
        return {};
      }
    };
    await submit(
      { hfPort: String(NEW), hfHost: '', hfPubPort: '' },
      `window.__wxc.server && window.__wxc.server.imgPort === ${NEW}`,
    );
    const imgNow = await page.evaluate(() => window.__wxc.server && window.__wxc.server.imgPort);
    const id = ids[0];
    const onNew = id ? (await raw(NEW, '/a/' + id)).status : 0,
      onOld = id ? (await raw(IMG, '/a/' + id)).status : 0;
    check(
      imgNow === NEW && settingsNow().imgPort === NEW && (!id || (onNew === 200 && onOld === 0)),
      '改本机端口：立即换绑、旧端口关闭、存进设置文件',
      `端口 ${imgNow}，设置文件 ${settingsNow().imgPort}` +
        (id ? `，新端口取图 ${onNew}，旧端口 ${onOld || '连不上'}` : ''),
    );
    // 粘贴完整地址拆进三格；默认端口不写进地址。.invalid 域名按规范解析不到，自测必然不通过
    await submit(
      { hfHost: 'https://tunnel.example.invalid' },
      `(window.__wxc.server.host.pick || {}).base === 'https://tunnel.example.invalid'`,
    );
    const form = await page.evaluate(() => ({
      host: hfHost.value,
      port: hfPubPort.value,
      proto: document.querySelector('#hfProto input:checked').value,
      pick: window.__wxc.server.host.pick,
      list: window.__wxc.server.host.list.length,
    }));
    check(
      form.host === 'tunnel.example.invalid' &&
        form.port === '443' &&
        form.proto === 'https' &&
        form.pick &&
        form.pick.base === 'https://tunnel.example.invalid' &&
        !form.list,
      '粘贴完整地址：拆成协议、地址、端口，取图地址不带默认端口，不再自动检测',
      JSON.stringify(form),
    );
    await submit(
      { hfHost: 'pic.example.invalid', hfPubPort: '', hfProto: 'http' },
      `(window.__wxc.server.host.pick || {}).base === 'http://pic.example.invalid:${NEW}'`,
    );
    const p2 = await page.evaluate(() => window.__wxc.server.host);
    check(
      p2.pick.base === `http://pic.example.invalid:${NEW}` &&
        p2.config.proto === 'http' &&
        settingsNow().host === 'pic.example.invalid',
      'http 时公网端口留空与本机端口相同',
      `${p2.pick.base}，协议 ${p2.config.proto}`,
    );
    await submit(
      { hfHost: 'pic.example.invalid', hfProto: 'https', hfPubPort: '' },
      `(window.__wxc.server.host.pick || {}).base === 'https://pic.example.invalid'`,
    );
    const p3 = await page.evaluate(() => ({ base: window.__wxc.server.host.pick.base, ph: hfPubPort.placeholder }));
    check(
      p3.base === 'https://pic.example.invalid' && /443/.test(p3.ph),
      'https 时公网端口留空使用 443',
      JSON.stringify(p3),
    );
    // 第一次提交起的公网 IP 检测（查 IP 5 秒、回连 6 秒）此时多半还在进行：改设置要中止它，新地址的结果不等它
    const askedAt = performance.now();
    await page.waitForFunction(() => window.__wxc.server.host.pick.ok === false, { timeout: 30000 }).catch(() => {});
    const waited = (performance.now() - askedAt) / 1000;
    check(
      (await page.evaluate(
        () =>
          window.__wxc.server.host.pick.ok === false &&
          /无法访问/.test(document.getElementById('hostLine').textContent),
      )) && waited < 5,
      '连不通的地址显示“无法访问”，不等之前的检测结束',
      `${waited.toFixed(1)} 秒`,
    );
    const helpNow = await page.evaluate(() => {
      const h = document.getElementById('hostHelp');
      return { shown: !h.hidden, items: h.querySelectorAll('li').length, text: h.textContent };
    });
    check(
      helpNow.shown &&
        helpNow.items >= 2 &&
        /内网穿透/.test(helpNow.text) &&
        helpNow.text.includes(String(NEW)) &&
        /以粘贴后显示的已下载图片数为准/.test(helpNow.text),
      '无法访问时列出可能的原因（含本机端口），并说明以实际下载为准',
      JSON.stringify(helpNow).slice(0, 160),
    );
    const taken = await post({ imgPort: IMG + 3, host: '', port: '', proto: 'http' });
    const stay = id ? (await raw(NEW, '/a/' + id)).status : 200;
    check(
      taken.status === 409 && JSON.parse(taken.body).code === 'portBusy' && stay === 200,
      '本机端口被占用时报错并保持原端口',
      `${taken.status} ${taken.body}`,
    );
    const bad = await Promise.all(
      [
        { imgPort: 80 },
        { imgPort: UI },
        { imgPort: 'x' },
        { imgPort: NEW, port: 70000 },
        { imgPort: NEW, port: 'x' },
        { imgPort: NEW, host: '192.168.1.10' },
        { imgPort: NEW, host: 'localhost' },
        { imgPort: NEW, host: 'a.com/path' },
        { imgPort: NEW, host: 'fd00::1' },
      ].map(post),
    );
    check(
      bad.every(r => r.status === 400),
      '不合法的设置被拒绝（端口越界、与页面端口相同、内网地址、带路径）',
      bad.map(r => r.status).join(','),
    );
    busy.close();
  }
} catch (error) {
  if (error.message !== 'stop') {
    console.error(error);
    fails++;
  }
} finally {
  await browser.close();
  if (remote) remote.close();
  // 等服务真正退出、端口释放，紧接着再跑一轮时才不会撞上旧进程
  const exited = new Promise(r => srv.proc.once('exit', r));
  srv.stop();
  await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]);
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
