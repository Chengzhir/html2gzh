// 公众号存储清洗探针：生成一页带编号的小样（CSS 属性、HTML 标签、SVG 结构与 SMIL 动画），贴进测试草稿保存后，
// 从预览页取回存储下来的正文，逐项比对哪些被删、被改。平台规则在服务端，会变，改转换器前可以重跑一遍。
// 用法：
//   node tools/wxprobe.mjs build [--img <mmbiz 图片地址>]   → test/out/probe.html（再用 tools/clip.mjs test/out/probe.html 放进剪贴板）
//   node tools/wxprobe.mjs check <预览链接>                 → 逐项结果，另存 test/out/probe-result.json
//   node tools/wxprobe.mjs diff <预览链接> [发出的正文]      → 转换器成品整份比对：存下来的正文与发出的有哪些差异（合并计数），另存 test/out/diff-result.json
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.ts';

const OUT = 'test/out';
const box =
  'width:200px;height:36px;background:#dde5ef;color:#1f2937;font-size:13px;line-height:36px;padding:0 6px;margin:4px 0';
const sw = (t, inner, w = 80, h = 40) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:inline-block;vertical-align:middle;background:#eee">${inner}</svg>`;

/** css：style 写在一个 section 上（section 的 style 存得住）；inner 是可选内容；html：整段标签；svg：一个 svg */
export const PROBES = [
  // 布局
  {
    t: 'grid1',
    css: 'display:grid;grid-template-columns:1fr 2fr;gap:4px;width:200px',
    inner: '<section style="background:#cbb">a</section><section style="background:#bcb">b</section>',
  },
  {
    t: 'grid2',
    css: 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:20px;column-gap:2px;row-gap:2px;width:200px',
    inner:
      '<section style="grid-column:span 2;background:#cbb">ab</section><section style="background:#bcb">c</section>',
  },
  {
    t: 'grid3',
    css: 'display:grid;grid-template-areas:"x y" "x z";grid-template-rows:auto auto;place-items:center;width:200px',
    inner:
      '<section style="grid-area:x;background:#cbb">x</section><section style="grid-area:y">y</section><section style="grid-area:z">z</section>',
  },
  {
    t: 'flex1',
    css: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;align-content:flex-start;width:200px',
    inner:
      '<section style="flex:1 1 40%;order:2;background:#cbb">a</section><section style="flex:0 0 30%;align-self:flex-end;background:#bcb">b</section>',
  },
  {
    t: 'cols',
    css: 'column-count:2;column-gap:8px;column-rule:1px solid #999;width:200px',
    inner: '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥',
  },
  { t: 'aspect', css: 'width:100px;aspect-ratio:2/1;background:#cbb' },
  {
    t: 'float',
    css: 'float:left;shape-outside:circle(50%);width:40px;height:40px;border-radius:50%;background:#cbb;margin-right:6px',
  },
  {
    t: 'logical',
    css: 'margin-inline:8px;padding-block:4px;inline-size:180px;border-inline-start:3px solid #2563eb;background:#dde5ef',
  },
  {
    t: 'scroll',
    css: 'display:flex;overflow-x:auto;scroll-snap-type:x mandatory;width:200px;-webkit-overflow-scrolling:touch',
    inner:
      '<section style="flex:none;width:160px;scroll-snap-align:start;background:#cbb">1</section><section style="flex:none;width:160px;scroll-snap-align:start;background:#bcb">2</section>',
  },
  { t: 'sticky', css: 'position:sticky;top:0;background:#cbb' },
  { t: 'inset', css: 'position:relative;inset:2px 0 auto 4px;background:#cbb' },
  // 尺寸与单位
  { t: 'calc', css: 'width:calc(50% + 10px);background:#cbb' },
  { t: 'minmax', css: 'width:min(200px,50vw);height:max(20px,3vw);font-size:clamp(12px,4vw,20px);background:#cbb' },
  { t: 'units', css: 'width:20em;height:3lh;padding-left:2ch;margin-top:1ex;background:#cbb' },
  { t: 'vunits', css: 'width:50dvw;height:5svh;min-width:40lvw;background:#cbb' },
  {
    t: 'cq',
    css: 'container-type:inline-size;container-name:card;width:200px',
    inner: '<section style="width:50cqi;height:10cqmin;background:#cbb">cq</section>',
  },
  // 颜色
  { t: 'oklch', css: `${box};background-color:oklch(70% 0.1 30);color:oklab(0.3 0 0)` },
  { t: 'lab', css: `${box};background-color:lab(80% 10 20);color:lch(30% 20 40)` },
  { t: 'colormix', css: `${box};background-color:color-mix(in srgb, #2563eb 40%, white)` },
  { t: 'p3', css: `${box};background-color:color(display-p3 0.9 0.3 0.2)` },
  { t: 'lightdark', css: `${box};color-scheme:light dark;background-color:light-dark(#fff,#000)` },
  { t: 'rgbslash', css: `${box};background-color:rgb(213 43 30 / 50%);color:hsl(20deg 30% 20%)` },
  { t: 'curcolor', css: `${box};color:#2563eb;border:2px solid currentColor;accent-color:#2563eb;caret-color:red` },
  // 背景
  { t: 'grad', css: `${box};background:linear-gradient(135deg,#2563eb 0%,#eef2f7 60%,#1f2937 100%)` },
  { t: 'radial', css: `${box};background-image:radial-gradient(circle at 30% 40%,#2563eb,transparent 60%)` },
  { t: 'conic', css: `${box};background-image:conic-gradient(from 45deg,#2563eb,#eef2f7,#1f2937,#2563eb)` },
  { t: 'repgrad', css: `${box};background-image:repeating-linear-gradient(45deg,#ddd 0 6px,#fff 6px 12px)` },
  {
    t: 'multibg',
    css: `${box};background-image:linear-gradient(#0000,#0003),linear-gradient(90deg,#2563eb,#eef2f7);background-size:100% 50%,auto;background-repeat:no-repeat,repeat;background-position:0 100%,center`,
  },
  {
    t: 'bgclip',
    css: `${box};background-image:linear-gradient(90deg,#2563eb,#2f6db3);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;font-size:22px;font-weight:900`,
    inner: '渐变文字',
  },
  {
    t: 'bgblend',
    css: `${box};background-image:linear-gradient(90deg,#2563eb,#2f6db3);background-color:#888;background-blend-mode:multiply`,
  },
  {
    t: 'bgorigin',
    css: `${box};border:6px dashed rgba(0,0,0,.3);background-origin:border-box;background-clip:padding-box;background-color:#cbb`,
  },
  // 效果
  { t: 'filter', css: `${box};filter:blur(1px) grayscale(50%) drop-shadow(2px 2px 0 #2563eb)` },
  {
    t: 'backdrop',
    css: `${box};backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);background:rgba(255,255,255,.4)`,
  },
  { t: 'blend', css: `${box};mix-blend-mode:multiply;isolation:isolate` },
  { t: 'clip', css: `${box};clip-path:polygon(0 0,100% 0,85% 100%,0 100%)` },
  { t: 'clip2', css: `${box};clip-path:inset(0 round 12px)` },
  {
    t: 'mask',
    css: `${box};-webkit-mask-image:linear-gradient(90deg,#000,transparent);mask-image:linear-gradient(90deg,#000,transparent)`,
  },
  { t: 'opacity', css: `${box};opacity:.6;visibility:visible` },
  {
    t: 'shadow',
    css: `${box};box-shadow:inset 0 0 0 2px #2563eb,0 4px 12px rgba(0,0,0,.2);border-radius:12px 4px / 8px 2px`,
  },
  { t: 'outline', css: `${box};outline:2px dashed #2563eb;outline-offset:3px` },
  { t: 'borderimg', css: `${box};border:6px solid transparent;border-image:linear-gradient(90deg,#2563eb,#2f6db3) 1` },
  // 变形
  {
    t: 'tf3d',
    css: `${box};transform:perspective(200px) rotateY(20deg) skewX(-5deg);transform-origin:left center;backface-visibility:hidden`,
  },
  { t: 'tfindiv', css: `${box};rotate:5deg;scale:0.9;translate:4px 2px` },
  {
    t: 'tfstyle',
    css: 'transform-style:preserve-3d;perspective:300px;perspective-origin:50% 50%;width:200px',
    inner: '<section style="transform:translateZ(20px) rotateX(10deg);background:#cbb">3d</section>',
  },
  // 文字
  { t: 'tshadow', css: `${box};text-shadow:1px 1px 0 #2563eb,0 0 6px rgba(0,0,0,.3)`, inner: '文字阴影' },
  {
    t: 'tstroke',
    css: `${box};-webkit-text-stroke:1px #2563eb;paint-order:stroke fill;font-size:22px;font-weight:900;color:#fff`,
    inner: '描边字',
  },
  {
    t: 'emph',
    css: `${box};text-emphasis:filled dot #2563eb;-webkit-text-emphasis:filled dot #2563eb;text-emphasis-position:under right`,
    inner: '着重号',
  },
  {
    t: 'vert',
    css: 'writing-mode:vertical-rl;text-orientation:upright;height:120px;background:#dde5ef;font-size:14px',
    inner: '竖排文字测试',
  },
  {
    t: 'vert2',
    css: 'writing-mode:vertical-lr;text-combine-upright:all;height:100px;background:#dde5ef',
    inner: '<span style="text-combine-upright:all">26</span>年',
  },
  {
    t: 'deco',
    css: `${box};text-decoration:underline wavy #2563eb 2px;text-underline-offset:4px;text-decoration-skip-ink:none`,
    inner: '波浪下划线',
  },
  {
    t: 'clamp',
    css: 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;width:120px;font-size:13px',
    inner: '多行截断多行截断多行截断多行截断多行截断多行截断多行截断',
  },
  {
    t: 'ellip',
    css: 'width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
    inner: '单行省略号单行省略号单行省略号',
  },
  {
    t: 'feat',
    css: `${box};font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"palt" 1,"liga" 0;font-kerning:none;font-synthesis:none;font-optical-sizing:none`,
    inner: '1234567890',
  },
  {
    t: 'fvar',
    css: `${box};font-variation-settings:"wght" 700,"wdth" 75;font-stretch:condensed;font-variant-caps:small-caps`,
    inner: 'Variable',
  },
  {
    t: 'textwrap',
    css: `${box};text-wrap:balance;word-break:keep-all;overflow-wrap:anywhere;line-break:strict;hanging-punctuation:first;text-spacing-trim:trim-start`,
    inner: '换行控制',
  },
  {
    t: 'wsc',
    css: `${box};white-space:pre;tab-size:4;white-space-collapse:preserve;text-indent:2em;text-align-last:justify;text-justify:inter-character`,
    inner: 'a\tb  c',
  },
  {
    t: 'fontsh',
    css: 'font:italic small-caps 700 16px/1.4 "Noto Serif CJK SC",serif;letter-spacing:.1em;word-spacing:4px',
    inner: '字体简写',
  },
  {
    t: 'ruby',
    html: '<p style="font-size:16px"><ruby>汉<rp>(</rp><rt style="font-size:9px;color:#2563eb">hàn</rt><rp>)</rp></ruby>字</p>',
  },
  // 标签
  {
    t: 'details',
    html: '<details style="background:#dde5ef;padding:4px"><summary style="color:#2563eb">展开</summary><p>折叠内容</p></details>',
  },
  {
    t: 'dl',
    html: '<dl style="margin:0"><dt style="font-weight:700">术语</dt><dd style="margin-left:2em">解释</dd></dl>',
  },
  {
    t: 'inline',
    html: '<p>H<sub style="color:#2563eb">2</sub>O x<sup>2</sup> <mark style="background:#ff0">高亮</mark> <kbd style="border:1px solid #999">Ctrl</kbd> <s>删除</s> <del>del</del> <ins>ins</ins> <u>u</u> <small>small</small> <q>引语</q> <cite>出处</cite> <abbr title="缩写全称">缩写</abbr> <time datetime="2026-10-21">时间</time> <b>b</b> <i>i</i> <em>em</em> <strong>strong</strong> <code style="background:#eee">code</code> a<wbr>b</p>',
  },
  {
    t: 'headings',
    html: '<h1 style="font-size:20px;color:#2563eb">H1</h1><h3 style="font-size:16px">H3</h3><h4>H4</h4><h6>H6</h6>',
  },
  {
    t: 'lists',
    html: '<ol style="list-style-type:cjk-ideographic;padding-left:2em" start="3"><li>甲</li><li style="list-style-type:upper-roman">乙</li></ol><ul style="list-style:square inside;padding:0"><li>方块</li></ul><ul style="list-style-type:\'— \'"><li>字符串标记</li></ul>',
  },
  {
    t: 'table',
    html: '<table style="border-collapse:collapse;width:200px;font-size:12px"><caption style="caption-side:bottom">表注</caption><thead><tr><th style="border:1px solid #999;background:#cbb" colspan="2">表头</th></tr></thead><tbody><tr><td style="border:1px solid #999" rowspan="2">合</td><td style="border:1px solid #999;vertical-align:middle;text-align:right">1</td></tr><tr><td style="border:1px solid #999">2</td></tr></tbody></table>',
  },
  {
    t: 'figure',
    html: '<figure style="margin:0;border:1px solid #999"><figcaption style="font-size:12px;color:#666">图注</figcaption></figure>',
  },
  {
    t: 'pre',
    html: '<pre style="background:#1f2937;color:#eef2f7;padding:6px;font-size:12px;overflow-x:auto"><code><span style="color:#2563eb">const</span> a = 1;\n  b();</code></pre>',
  },
  {
    t: 'canvas',
    html: '<canvas width="40" height="20" style="background:#cbb"></canvas><picture><source srcset="x.webp" type="image/webp"></picture><progress value="30" max="100"></progress><meter value="0.4"></meter>',
  },
  { t: 'custom', html: '<my-card style="display:block;background:#cbb;padding:4px">自定义元素</my-card>' },
  {
    t: 'hr',
    html: '<hr style="border:0;height:3px;background:linear-gradient(90deg,#2563eb,transparent);margin:6px 0">',
  },
  {
    t: 'attrs',
    html: '<section title="悬浮提示" lang="en" dir="ltr" hidden style="background:#cbb">hidden 属性</section><section aria-label="标签" role="note" tabindex="0" style="background:#bcb">aria</section>',
  },
  // SVG 结构
  {
    t: 'svgid',
    svg: sw(
      'svgid',
      '<rect id="r1" width="40" height="40" fill="#2563eb"/><g id="g1" class="c1"><rect x="40" width="40" height="40" fill="#2f6db3"/></g>',
    ),
  },
  {
    t: 'lingrad',
    svg: sw(
      'lingrad',
      '<defs><linearGradient id="lg1" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#2f6db3" stop-opacity=".5"/></linearGradient></defs><rect width="80" height="40" fill="url(#lg1) #0f0"/>',
    ),
  },
  {
    t: 'radgrad',
    svg: sw(
      'radgrad',
      '<defs><radialGradient id="rg1" cx=".5" cy=".5" r=".5" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#2563eb"/></radialGradient></defs><circle cx="40" cy="20" r="18" fill="url(#rg1) #0f0"/>',
    ),
  },
  {
    t: 'clippath',
    svg: sw(
      'clippath',
      '<defs><clipPath id="cp1"><circle cx="20" cy="20" r="16"/></clipPath></defs><rect width="80" height="40" fill="#2563eb" clip-path="url(#cp1)"/>',
    ),
  },
  {
    t: 'svgmask',
    svg: sw(
      'svgmask',
      '<defs><mask id="mk1"><rect width="80" height="40" fill="#fff"/><circle cx="40" cy="20" r="12" fill="#000"/></mask></defs><rect width="80" height="40" fill="#2f6db3" mask="url(#mk1)"/>',
    ),
  },
  {
    t: 'svgfilter',
    svg: sw(
      'svgfilter',
      '<defs><filter id="ft1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/><feOffset dx="2" dy="2"/></filter></defs><rect x="10" y="8" width="40" height="24" fill="#2563eb" filter="url(#ft1)"/>',
    ),
  },
  {
    t: 'pattern',
    svg: sw(
      'pattern',
      '<defs><pattern id="pt1" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#2563eb"/></pattern></defs><rect width="80" height="40" fill="url(#pt1) #0f0"/>',
    ),
  },
  {
    t: 'svgstyle',
    svg: sw(
      'svgstyle',
      '<rect width="80" height="40" style="fill:#2f6db3;stroke:#2563eb;stroke-width:4px;opacity:.8"/>',
    ),
  },
  {
    t: 'svgtext',
    svg: sw(
      'svgtext',
      '<text x="4" y="26" font-size="16" font-family="serif" font-weight="700" fill="#2563eb" letter-spacing="2" text-anchor="start" dominant-baseline="auto">SVG字</text>',
    ),
  },
  { t: 'svgimg', svg: '@IMG@' },
  {
    t: 'svgpar',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" preserveAspectRatio="xMidYMid slice" style="width:120px;height:40px;background:#eee"><circle cx="40" cy="20" r="20" fill="#2563eb"/></svg>',
  },
  {
    t: 'svgtfo',
    svg: sw(
      'svgtfo',
      '<rect x="20" y="10" width="40" height="20" fill="#2563eb" transform="rotate(20)" style="transform-origin:center;transform-box:fill-box"/>',
    ),
  },
  {
    t: 'svgpe',
    svg: sw(
      'svgpe',
      '<rect width="80" height="40" fill="#cbb" pointer-events="none" opacity="0.5" fill-opacity="0.5" stroke-dasharray="4 2" stroke="#000" vector-effect="non-scaling-stroke"/>',
    ),
  },
  // SVG 动画
  {
    t: 'anim',
    svg: sw(
      'anim',
      '<rect width="40" height="40" fill="#2f6db3"><animate attributeName="fill" values="#2f6db3;#2563eb;#2f6db3" keyTimes="0;0.5;1" dur="2s" repeatCount="indefinite" calcMode="linear"/></rect>',
    ),
  },
  {
    t: 'animclick',
    svg: sw(
      'animclick',
      '<rect width="40" height="40" fill="#2f6db3"><animate attributeName="x" from="0" to="40" begin="click" dur="0.5s" fill="freeze" restart="whenNotActive"/></rect>',
    ),
  },
  {
    t: 'animtouch',
    svg: sw(
      'animtouch',
      '<rect width="40" height="40" fill="#2f6db3"><animate attributeName="opacity" from="1" to="0.2" begin="touchstart" dur="0.3s" fill="freeze"/><animate attributeName="width" from="40" to="80" begin="mouseover;click+0.2s" dur="0.3s" fill="freeze"/></rect>',
    ),
  },
  {
    t: 'animspline',
    svg: sw(
      'animspline',
      '<circle cx="10" cy="20" r="8" fill="#2563eb"><animate attributeName="cx" values="10;70;10" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="3s" repeatCount="indefinite"/></circle>',
    ),
  },
  {
    t: 'animtf',
    svg: sw(
      'animtf',
      '<g transform="translate(40 20)"><rect x="-10" y="-10" width="20" height="20" fill="#2563eb"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="scale" values="1;1.3;1" dur="2s" additive="sum" repeatCount="indefinite"/></rect></g>',
    ),
  },
  {
    t: 'animset',
    svg: sw(
      'animset',
      '<rect width="80" height="40" fill="#cbb"><set attributeName="visibility" to="hidden" begin="click" fill="freeze"/></rect><text x="4" y="24" font-size="12" visibility="hidden">已点<set attributeName="visibility" to="visible" begin="click" fill="freeze"/></text>',
    ),
  },
  {
    t: 'animdash',
    svg: sw(
      'animdash',
      '<path d="M5 20 H75" stroke="#2563eb" stroke-width="4" stroke-dasharray="70" stroke-dashoffset="70" fill="none"><animate attributeName="stroke-dashoffset" from="70" to="0" dur="2s" fill="freeze" begin="0s"/></path>',
    ),
  },
  {
    t: 'animmorph',
    svg: sw(
      'animmorph',
      '<path d="M10 30 L40 10 L70 30 Z" fill="#2f6db3"><animate attributeName="d" values="M10 30 L40 10 L70 30 Z;M10 10 L40 30 L70 10 Z;M10 30 L40 10 L70 30 Z" dur="2s" repeatCount="indefinite"/></path>',
    ),
  },
  {
    t: 'animmotion',
    svg: sw(
      'animmotion',
      '<circle r="5" fill="#2563eb"><animateMotion path="M5 20 Q40 0 75 20" dur="2s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear"/></circle>',
    ),
  },
  {
    t: 'animacc',
    svg: sw(
      'animacc',
      '<rect width="10" height="40" fill="#2f6db3"><animate attributeName="x" by="10" dur="0.5s" begin="click" fill="freeze" additive="sum" accumulate="sum" repeatCount="3"/></rect>',
    ),
  },
  {
    t: 'animsync',
    svg: sw(
      'animsync',
      '<rect width="20" height="40" fill="#2f6db3"><animate id="a1" attributeName="x" from="0" to="30" dur="1s" begin="click" fill="freeze"/><animate attributeName="fill" to="#2563eb" dur="0.5s" begin="a1.end" fill="freeze"/></rect>',
    ),
  },
  {
    t: 'animsvgroot',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" style="display:block;width:50%;max-width:none!important;pointer-events:none;background:#eee"><rect width="80" height="40" fill="#cbb"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></rect></svg>',
  },
  // 带 #引用 的放最后：可能触发"非 mp 域名链接"的保存闸，被拦就去掉这几项重试
  {
    t: 'mpath',
    svg: sw(
      'mpath',
      '<path id="mp1" d="M5 35 Q40 -5 75 35" fill="none" stroke="#ccc"/><circle r="4" fill="#2563eb"><animateMotion dur="2s" repeatCount="indefinite"><mpath href="#mp1"/></animateMotion></circle>',
    ),
  },
  {
    t: 'use',
    svg: sw(
      'use',
      '<defs><symbol id="sy1" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#2563eb"/></symbol></defs><use href="#sy1" x="0" y="0" width="40" height="40"/><use xlink:href="#sy1" x="40" y="0" width="40" height="40"/>',
    ),
  },
  {
    t: 'textpath',
    svg: sw(
      'textpath',
      '<path id="tp1" d="M5 35 Q40 0 75 35" fill="none"/><text font-size="10" fill="#2563eb"><textPath href="#tp1" startOffset="10%">沿路径排字</textPath></text>',
    ),
  },
];

/** 第二轮：数学函数里的运算、SMIL 缓动的几种写法、SVG 里的图片与 CSS 能力（替代被删的 id 引用）。@ASSET@ 是能从外网取到的本机图片地址 */
const sp = (t, a) => ({ t, svg: sw(t, `<circle cx="10" cy="20" r="8" fill="#2563eb">${a}</circle>`) });
const pic = () => fs.readFileSync('test/fixture/pic.png').toString('base64');
export const PROBES2 = [
  { t: 'm_add', css: 'width:min(40px + 20cqw);height:20px;background:#cbb' },
  { t: 'm_sub', css: 'width:max(60cqw - 10px);height:20px;background:#cbb' },
  { t: 'm_mul', css: 'width:min(0.5 * 200px);margin-left:min(2 * 4px + 1cqw);height:20px;background:#cbb' },
  { t: 'm_clamp', css: 'width:clamp(10px, 10px + 30cqw, 400px);height:20px;background:#cbb' },
  { t: 'm_pct', css: 'width:min(50% + 10px);height:20px;background:#cbb' },
  { t: 'm_pct2', css: 'width:50%;height:20px;background:#cbb' },
  {
    t: 'm_tf',
    css: 'transform:translate(min(10px + 2cqw), max(1px + 0cqw));translate:min(3px + 1cqw) 0;height:20px;background:#cbb',
  },
  {
    t: 'm_font',
    css: 'font-size:min(12px + 1cqw);line-height:min(18px + 1.5cqw);letter-spacing:max(0.5px + 0.1cqw);margin:min(4px + 1cqw) 0',
    inner: '字号运算',
  },
  {
    t: 'm_grid',
    css: 'display:grid;grid-template-columns:min(20px + 10cqw) 1fr;gap:min(2px + 1cqw);width:200px',
    inner: '<section style="background:#cbb">a</section><section>b</section>',
  },
  { t: 'm_neg', css: 'margin-top:min(-1 * (4px + 2cqw));margin-left:max(-10px - 5cqw);height:20px;background:#cbb' },
  { t: 'm_nest', css: 'width:min(calc(10px + 20cqw));height:20px;background:#cbb' },
  { t: 'env', css: 'padding-bottom:env(safe-area-inset-bottom, 4px);height:20px;background:#cbb' },
  { t: 'wkfilter', css: '-webkit-filter:blur(1px);height:20px;background:#cbb' },
  { t: 'trans', css: 'transition:opacity .3s ease;animation:none 1s;height:20px;background:#cbb' },
  { t: 'secbgx', css: 'background-image:url(@ASSET@);background-size:cover;width:80px;height:40px' },
  sp(
    'sp1',
    '<animate attributeName="cx" values="10;70" keyTimes="0;1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="2s" repeatCount="indefinite"/>',
  ),
  sp(
    'sp2',
    '<animate attributeName="cx" values="10;70" keyTimes="0;1" calcMode="spline" keySplines="0.42,0,0.58,1" dur="2s" repeatCount="indefinite"/>',
  ),
  sp(
    'sp3',
    '<animate attributeName="cx" values="10;70" keyTimes="0;1" calcMode="spline" dur="2s" repeatCount="indefinite"/>',
  ),
  sp(
    'sp4',
    '<animate attributeName="cx" values="10;70" keyTimes="0;1" keySplines="0.42 0 0.58 1" dur="2s" repeatCount="indefinite"/>',
  ),
  sp('sp5', '<animate attributeName="cx" values="10;40;70" calcMode="discrete" dur="2s" repeatCount="indefinite"/>'),
  sp('sp6', '<animate attributeName="cx" values="10;20;70" calcMode="paced" dur="2s" repeatCount="indefinite"/>'),
  sp(
    'sp7',
    '<animateTransform attributeName="transform" type="translate" values="0 0;50 0" keyTimes="0;1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="2s" repeatCount="indefinite"/>',
  ),
  sp(
    'sp8',
    '<animateMotion path="M0 0 H50" keyTimes="0;1" keyPoints="0;1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="2s" repeatCount="indefinite"/>',
  ),
  sp(
    'sp9',
    '<animate attributeName="cx" values="10;30;70" keyTimes="0;0.2;1" calcMode="linear" dur="2s" repeatCount="indefinite" begin="0s;click"/>',
  ),
  { t: 'imgdata', svg: '@PIC@' },
  { t: 'svgimgx', svg: sw('svgimgx', '<image href="@ASSET@" width="40" height="20"/>') },
  {
    t: 'svgbgx',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" style="display:block;width:80px;height:40px;background-image:url(@ASSET@);background-size:cover"><rect width="20" height="40" fill="#2563eb" opacity="0.5"><animate attributeName="x" values="0;60;0" dur="3s" repeatCount="indefinite"/></rect></svg>',
  },
  {
    t: 'fo',
    svg: sw(
      'fo',
      '<foreignObject x="0" y="0" width="80" height="40"><section style="width:80px;height:40px;background:linear-gradient(90deg,#2563eb,#2f6db3);border-radius:8px;font-size:10px;color:#fff">FO 段落</section></foreignObject>',
    ),
  },
  {
    t: 'nested',
    svg: sw(
      'nested',
      '<svg x="0" y="0" width="40" height="40" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#2563eb"/></svg><svg x="40" width="40" height="40" viewBox="0 0 10 10" preserveAspectRatio="none"><rect width="10" height="5" fill="#2f6db3"/></svg>',
    ),
  },
  {
    t: 'svgcss',
    svg: sw('svgcss', '<rect width="80" height="40" fill="#2563eb" style="clip-path:path(\'M0 0 L80 0 L40 40 Z\')"/>'),
  },
  {
    t: 'svgfa',
    svg: sw(
      'svgfa',
      '<rect x="10" y="8" width="40" height="24" fill="#2563eb" filter="blur(2px)"/><rect x="50" y="8" width="20" height="24" fill="#2f6db3" style="filter:drop-shadow(2px 2px 0 #000)"/>',
    ),
  },
  {
    t: 'svgmaskcss',
    svg: sw(
      'svgmaskcss',
      '<rect width="80" height="40" fill="#2f6db3" style="mask-image:linear-gradient(90deg,#000,transparent);-webkit-mask-image:linear-gradient(90deg,#000,transparent)"/>',
    ),
  },
  {
    t: 'svgclipcss',
    svg: sw('svgclipcss', '<circle cx="40" cy="20" r="18" fill="#2563eb" style="clip-path:inset(0 0 50% 0)"/>'),
  },
  {
    t: 'svgtfcss',
    svg: sw(
      'svgtfcss',
      '<rect width="20" height="20" fill="#2563eb" style="transform:translate(min(10px + 1cqw), 5px) rotate(10deg);transform-box:fill-box;transform-origin:center"/>',
    ),
  },
  { t: 'svgdata', svg: sw('svgdata', '<rect width="40" height="40" fill="#2f6db3" data-k="v"/>') },
  {
    t: 'svgpaint',
    svg: sw(
      'svgpaint',
      '<rect width="80" height="40" style="fill:#2563eb;stroke:#1f2937;stroke-width:3;stroke-linejoin:round"/>',
    ),
  },
];

/** 第三轮：<animate> 能动哪些属性（第二轮里动 cx 的整条被删），以及几种替代写法 */
const AN = { num: '0;10;0', col: '#2f6db3;#2563eb;#2f6db3', len: '1;3;1', vis: 'visible;hidden;visible' };
const ATTRS = [
  ['cx', 'num'],
  ['cy', 'num'],
  ['r', 'len'],
  ['rx', 'len'],
  ['ry', 'len'],
  ['x', 'num'],
  ['y', 'num'],
  ['width', 'len'],
  ['height', 'len'],
  ['x1', 'num'],
  ['y1', 'num'],
  ['x2', 'num'],
  ['y2', 'num'],
  ['points', '0,0 10,0 5,8;0,0 20,0 10,8;0,0 10,0 5,8'],
  ['d', 'M0 0 H10;M0 0 H20;M0 0 H10'],
  ['fill', 'col'],
  ['stroke', 'col'],
  ['color', 'col'],
  ['stop-color', 'col'],
  ['flood-color', 'col'],
  ['opacity', 'len'],
  ['fill-opacity', '1;0.3;1'],
  ['stroke-opacity', '1;0.3;1'],
  ['stroke-width', 'len'],
  ['stroke-dasharray', '1 2;4 2;1 2'],
  ['stroke-dashoffset', 'num'],
  ['visibility', 'vis'],
  ['display', 'inline;none;inline'],
  ['transform', 'translate(0 0);translate(10 0);translate(0 0)'],
  ['viewBox', '0 0 80 40;0 0 40 20;0 0 80 40'],
  ['font-size', '10;14;10'],
  ['letter-spacing', '0;2;0'],
  ['dx', 'num'],
  ['dy', 'num'],
  ['rotate', 'num'],
  ['offset', '0;1;0'],
  ['pathLength', '1;2;1'],
  ['startOffset', 'num'],
  ['clip-path', 'none;inset(0 50% 0 0);none'],
  ['filter', 'none;blur(1px);none'],
  ['class', 'a;b;a'],
  ['style', 'fill:red;fill:blue;fill:red'],
  ['href', 'a;b;a'],
  ['preserveAspectRatio', 'none;xMidYMid;none'],
];
export const PROBES3 = [
  ...ATTRS.map(([a, v]) => ({
    t: 'an_' + a,
    svg: sw(
      'an_' + a,
      `<rect width="20" height="20" fill="#cbb"><animate attributeName="${a}" values="${AN[v] || v}" dur="2s" repeatCount="indefinite"/></rect>`,
    ),
  })),
  {
    t: 'set_cx',
    svg: sw(
      'set_cx',
      '<circle cx="10" cy="20" r="8" fill="#2563eb"><set attributeName="cx" to="60" begin="click" fill="freeze"/></circle>',
    ),
  },
  {
    t: 'an_cxtf',
    svg: sw(
      'an_cxtf',
      '<circle cx="10" cy="20" r="8" fill="#2563eb"><animateTransform attributeName="transform" type="translate" values="0 0;60 0;0 0" dur="2s" additive="sum" repeatCount="indefinite"/></circle>',
    ),
  },
  {
    t: 'an_attrs',
    svg: sw(
      'an_attrs',
      '<rect width="20" height="20" fill="#cbb"><animate attributeName="x" values="0;40" begin="indefinite;0.5s" end="click" min="1s" max="5s" repeatDur="6s" restart="never" dur="2s" attributeType="XML"/></rect>',
    ),
  },
  { t: 'wkcalc', css: 'width:-webkit-calc(10px + 20cqw);height:20px;background:#cbb' },
  {
    t: 'fobg',
    svg: sw(
      'fobg',
      '<foreignObject x="0" y="0" width="80" height="40"><section style="width:80px;height:40px;background-image:url(@ASSET@);background-size:cover"></section></foreignObject>',
    ),
  },
  {
    t: 'gfilter',
    svg: sw(
      'gfilter',
      '<g filter="drop-shadow(2px 2px 0 #000)"><rect x="10" y="8" width="40" height="24" fill="#2563eb"/></g>',
    ),
  },
];

/** 第四轮：白名单内属性的 <animate> 带 calcMode="spline" 能否存活（转换器的 svg.spline 开关取决于它），按转换器写出的格式 */
const SPL = '0.42 0 0.58 1;0.25 0.1 0.25 1';
const SPV = {
  opacity: '1;0.2;1',
  fill: '#2f6db3;#2563eb;#2f6db3',
  'stroke-width': '1;5;1',
  'stroke-dashoffset': '0;40;0',
  r: '4;10;4',
  x: '0;40;0',
  y: '0;10;0',
  width: '10;40;10',
  height: '10;30;10',
  d: 'M0 0 H10 V10 Z;M0 0 H30 V20 Z;M0 0 H10 V10 Z',
};
export const PROBES4 = [
  ...Object.entries(SPV).map(([a, v]) => ({
    t: 'spl_' + a,
    svg: sw(
      'spl_' + a,
      `<rect width="20" height="20" fill="#cbb" stroke="#1f2937" stroke-dasharray="20 10"><animate attributeName="${a}" values="${v}" keyTimes="0;0.5;1" calcMode="spline" keySplines="${SPL}" dur="2s" repeatCount="indefinite"/></rect>`,
    ),
  })),
  {
    t: 'spl_one',
    svg: sw(
      'spl_one',
      '<rect width="20" height="20" fill="#cbb"><animate attributeName="opacity" values="1;0.2" keyTimes="0;1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="2s" repeatCount="indefinite"/></rect>',
    ),
  },
  {
    t: 'spl_lin',
    svg: sw(
      'spl_lin',
      '<rect width="20" height="20" fill="#cbb"><animate attributeName="opacity" values="1;0.2;1;0.6" keyTimes="0;0.3333;0.6667;1" calcMode="spline" keySplines="0 0 1 1;0.42 0 0.58 1;0 0 1 1" dur="2s" begin="0.5s" fill="freeze"/></rect>',
    ),
  },
  {
    t: 'spl_comma',
    svg: sw(
      'spl_comma',
      '<rect width="20" height="20" fill="#cbb"><animate attributeName="x" values="0;40" keyTimes="0;1" calcMode="spline" keySplines="0.42,0,0.58,1" dur="2s" repeatCount="indefinite"/></rect>',
    ),
  },
  {
    t: 'spl_click',
    svg: sw(
      'spl_click',
      '<rect width="20" height="20" fill="#cbb"><animate attributeName="x" values="0;40" keyTimes="0;1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="0.6s" begin="click" fill="freeze"/></rect>',
    ),
  },
  {
    t: 'spl_set',
    svg: sw(
      'spl_set',
      '<rect width="20" height="20" fill="#cbb"><animate attributeName="opacity" values="1;0.2;1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="2s" repeatCount="indefinite"/><set attributeName="visibility" to="hidden" begin="click" fill="freeze"/></rect>',
    ),
  },
];

function build(set, img, asset) {
  const imgSvg = img
    ? sw(
        'svgimg',
        `<image href="${img}" width="40" height="40" preserveAspectRatio="xMidYMid slice"/><image xlink:href="${img}" x="40" width="40" height="40"/>`,
      )
    : '';
  const probes = ({ 2: PROBES2, 3: PROBES3, 4: PROBES4 }[set] || PROBES).filter(
    p => asset || !/@ASSET@/.test(p.css || p.svg || ''),
  );
  const parts = probes.map(p => {
    p = {
      ...p,
      css: p.css && p.css.replace(/@ASSET@/g, asset),
      svg:
        p.svg &&
        (p.svg === '@PIC@'
          ? sw('imgdata', `<image href="data:image/png;base64,${pic()}" width="40" height="20"/>`)
          : p.svg.replace(/@ASSET@/g, asset)),
    };
    const label = `<p style="margin:8px 0 0;font-size:11px;color:#64748b">${p.t}</p>`;
    if (p.css)
      return `${label}<section data-t="${p.t}" style="${p.css.replace(/"/g, '&quot;')}">${p.inner ?? p.t}</section>`;
    if (p.html) return `${label}<section data-t="${p.t}">${p.html}</section>`;
    const svg = p.svg === '@IMG@' ? imgSvg : p.svg;
    return svg ? `${label}<section data-t="${p.t}">${svg}</section>` : '';
  });
  return `<section style="font-size:14px;line-height:1.5;color:#1f2937;container-type:inline-size"><p style="font-size:12px;color:#64748b">存储清洗探针 · ${probes.length} 项</p>${parts.join('')}</section>`;
}

/** 预览页主文档的原始响应里取 #js_content（阅读页脚本加工之前） */
export async function storedHtml(browser, url) {
  const pv = await browser.newPage();
  await pv.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x28003133) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN',
  );
  let raw = '';
  pv.on('response', async r => {
    if (r.request().resourceType() === 'document' && !raw) {
      try {
        raw = await r.text();
      } catch {
        /* 重定向 */
      }
    }
  });
  await pv.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pv.close();
  const i = raw.indexOf('id="js_content"');
  if (i < 0) throw new Error('预览页原始响应里没有 #js_content（链接失效或被拦）');
  const start = raw.indexOf('>', i) + 1;
  let d = 1,
    end = raw.length;
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = start;
  for (let m; (m = re.exec(raw));) {
    d += m[0][1] === '/' ? -1 : 1;
    if (!d) {
      end = m.index;
      break;
    }
  }
  return raw.slice(start, end);
}

/**
 * probe：按 data-t 逐项比；tree：整份正文按顶层元素逐个比（用于转换器的成品），差异按种类合并计数。
 * tree 模式先抹掉粘贴时必然变的部分：图片地址（本机 → mmbiz）、编辑器给 <img> 加的 class 与 data-*、末尾的 mp-style-type
 */
async function check(url, mode = 'probe', sentFile = `${OUT}/probe.html`) {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    const stored = /^https?:/.test(url) ? await storedHtml(browser, url) : fs.readFileSync(url, 'utf8');
    fs.writeFileSync(`${OUT}/${mode === 'tree' ? 'diff' : 'probe'}-stored.html`, stored);
    const sent = fs.readFileSync(sentFile, 'utf8');
    const page = await browser.newPage();
    const res = await page.evaluate(
      (sent, stored, mode) => {
        const P = new DOMParser();
        const A = P.parseFromString(`<body>${sent}</body>`, 'text/html'),
          B = P.parseFromString(`<body>${stored}</body>`, 'text/html');
        if (mode === 'tree')
          for (const d of [A, B]) {
            for (const el of d.querySelectorAll('[style]'))
              el.setAttribute('style', el.getAttribute('style').replace(/url\((['"]?)[^)'"]*\1\)/g, 'url(U)'));
            for (const im of d.querySelectorAll('img'))
              for (const a of [...im.attributes])
                if (a.name === 'src' || a.name === 'class' || a.name.startsWith('data-')) im.removeAttribute(a.name);
            for (const m of d.querySelectorAll('mp-style-type')) (m.closest('p') || m).remove();
          }
        const scratch = document.createElement('div');
        const longhands = decl => {
          scratch.removeAttribute('style');
          scratch.setAttribute('style', decl);
          const o = {};
          for (const k of scratch.style) o[k] = scratch.style.getPropertyValue(k);
          return o;
        };
        const decls = s => {
          const out = [];
          let d = 0,
            q = '',
            cur = '';
          for (const c of s) {
            if (q) {
              cur += c;
              if (c === q) q = '';
              continue;
            }
            if (c === '"' || c === "'") {
              q = c;
              cur += c;
              continue;
            }
            if (c === '(') d++;
            if (c === ')') d--;
            if (c === ';' && !d) {
              out.push(cur);
              cur = '';
              continue;
            }
            cur += c;
          }
          if (cur.trim()) out.push(cur);
          return out.map(x => x.trim()).filter(Boolean);
        };
        const cmpStyle = (a, b) => {
          const have = longhands(b || '');
          const r = { kept: [], changed: [], dropped: [] };
          for (const d of decls(a || '')) {
            const name = d.slice(0, d.indexOf(':')).trim();
            const lh = longhands(d);
            const keys = Object.keys(lh);
            if (!keys.length) {
              r.dropped.push(name + '(浏览器不认)');
              continue;
            }
            const same = keys.filter(k => have[k] === lh[k]).length,
              present = keys.filter(k => k in have).length;
            if (same === keys.length) r.kept.push(name);
            else if (!present) r.dropped.push(name);
            else
              r.changed.push(
                `${name}: ${keys
                  .filter(k => have[k] !== lh[k])
                  .map(k => `${k}=${have[k] ?? '∅'}`)
                  .join(', ')}`,
              );
          }
          return r;
        };
        const IGN = new Set(['role', 'aria-label', 'data-pm-slice']);
        const cmpTree = (a, b, path, out) => {
          if (!b) {
            out.push(`缺 <${a.localName}> @${path}`);
            return;
          }
          if (b.localName !== a.localName) out.push(`<${a.localName}> 变成 <${b.localName}> @${path}`);
          for (const at of a.attributes) {
            if (at.name === 'style') {
              const s = cmpStyle(at.value, b.getAttribute('style'));
              if (s.dropped.length || s.changed.length)
                out.push(
                  `<${a.localName}> style ${[...s.dropped.map(x => '删 ' + x), ...s.changed.map(x => '改 ' + x)].join('；')}`,
                );
              continue;
            }
            const v = b.getAttribute(at.name);
            if (v == null) out.push(`<${a.localName}> 删属性 ${at.name}`);
            else if (v !== at.value) out.push(`<${a.localName}> ${at.name}: ${at.value} → ${v}`);
          }
          for (const at of b.attributes)
            if (!a.hasAttribute(at.name) && !IGN.has(at.name))
              out.push(`<${a.localName}> 加属性 ${at.name}="${at.value.slice(0, 40)}"`);
          // leaf 包装（span/tspan leaf）当透明层
          const kids = el => [...el.children].flatMap(k => (k.hasAttribute('leaf') ? [...k.children] : [k]));
          const ka = kids(a),
            kb = kids(b);
          ka.forEach((k, i) => cmpTree(k, kb[i], `${path}/${k.localName}[${i}]`, out));
          if (kb.length > ka.length)
            out.push(
              `多出 ${kb.length - ka.length} 个子元素 @${path}：${kb
                .slice(ka.length)
                .map(k => k.localName)
                .join(',')}`,
            );
        };
        if (mode === 'tree') {
          const notes = [];
          const ka = [...A.body.children],
            kb = [...B.body.children];
          ka.forEach((k, i) => cmpTree(k, kb[i], `${k.localName}[${i}]`, notes));
          if (kb.length > ka.length)
            notes.push(
              `多出 ${kb.length - ka.length} 个顶层元素：${kb
                .slice(ka.length)
                .map(k => k.localName)
                .join(',')}`,
            );
          // 同一种差异（去掉位置与数字）合并计数，留一个原样的例子
          const kinds = new Map();
          for (const n of notes) {
            const k = n.replace(/ @.*$/, '').replace(/-?\d+(\.\d+)?/g, '#');
            const e = kinds.get(k) || { kind: k, n: 0, example: n };
            e.n++;
            kinds.set(k, e);
          }
          const count = (d, sel) => d.querySelectorAll(sel).length;
          const tags = ['svg', 'animate', 'animateTransform', 'animateMotion', 'set', 'path', 'img', 'foreignObject'];
          return {
            total: notes.length,
            kinds: [...kinds.values()].toSorted((a, b) => b.n - a.n),
            tags: tags.map(t => [t, count(A, t), count(B, t)]),
          };
        }
        const rows = [];
        for (const a of A.querySelectorAll('[data-t]')) {
          const t = a.getAttribute('data-t');
          const b = B.querySelector(`[data-t="${t}"]`);
          if (!b) {
            rows.push({ t, status: '整项消失', notes: [] });
            continue;
          }
          const notes = [];
          const s = cmpStyle(a.getAttribute('style'), b.getAttribute('style'));
          if (s.dropped.length) notes.push('删 ' + s.dropped.join('、'));
          if (s.changed.length) notes.push('改 ' + s.changed.join('；'));
          const ka = [...a.children],
            kb = [...b.children].flatMap(k => (k.hasAttribute('leaf') ? [...k.children] : [k]));
          ka.forEach((k, i) => cmpTree(k, kb[i], k.localName, notes));
          rows.push({ t, status: notes.length ? '有改动' : '原样', notes, stored: b.innerHTML.slice(0, 600) });
        }
        return rows;
      },
      sent,
      stored,
      mode,
    );
    if (mode === 'tree') {
      fs.writeFileSync(`${OUT}/diff-result.json`, JSON.stringify(res, null, 1));
      console.log(
        '元素数（发出 → 存下）：' + res.tags.map(([t, a, b]) => `${t} ${a}${a === b ? '' : ' → ' + b}`).join('，'),
      );
      console.log(res.total ? `${res.total} 处差异，${res.kinds.length} 种：` : '没有差异');
      for (const k of res.kinds.slice(0, 40)) console.log(`  ${String(k.n).padStart(4)} × ${k.example.slice(0, 160)}`);
      return;
    }
    fs.writeFileSync(`${OUT}/probe-result.json`, JSON.stringify(res, null, 1));
    for (const r of res)
      console.log(
        `${r.status === '原样' ? '  ' : '✗ '}${r.t.padEnd(12)} ${r.status}${r.notes.length ? '  ' + r.notes.join(' | ') : ''}`,
      );
  } finally {
    await browser.close();
  }
}

const [cmd, arg] = process.argv.slice(2);
const flag = k => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : '';
};
if (cmd === 'build') {
  fs.mkdirSync(OUT, { recursive: true });
  const html = build(flag('set') || '1', flag('img'), flag('asset'));
  fs.writeFileSync(`${OUT}/probe.html`, html);
  console.log(`${OUT}/probe.html：${(html.match(/data-t="/g) || []).length} 项`);
} else if (cmd === 'check' && arg) await check(arg);
else if (cmd === 'diff' && arg) await check(arg, 'tree', process.argv[4] || `${OUT}/payload.html`);
else
  console.log(
    '用法：node tools/wxprobe.mjs build [--set 1|2|3|4] [--img <mmbiz 图片地址>] [--asset <外网可达的图片地址>] | check <预览链接或存储正文文件> | diff <预览链接> [发出的正文，默认 test/out/payload.html]',
  );
