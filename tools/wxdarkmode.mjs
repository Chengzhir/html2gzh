// 查找公众号文章页面内嵌的深色模式算法对应 npm 上 mp-darkmode 的哪个版本，并列出页面调用它时传入的参数
// 用法：node tools/wxdarkmode.mjs <文章链接或预览链接 | 保存下来的文章页面 .html>
// 页面中内嵌的代码与 npm 上某个版本的 dist/darkmode.min.js 逐字节相同时，报出这个版本号（各版本下载到 .cache/mp-darkmode/）。
// 调用参数原样列出，供与 ui/src/phone.ts 中的 DARK_OPTIONS 对照。
// 版本与本项目安装的不同时，运行 npm install --save-exact mp-darkmode@<版本号> 更新
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/chrome.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'mp-darkmode');
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI Language/zh_CN';
const src = process.argv[2];
if (!src) {
  console.error('用法：node tools/wxdarkmode.mjs <文章链接或预览链接 | 保存下来的文章页面 .html>');
  process.exit(1);
}

async function pageHtml() {
  if (!/^https?:/i.test(src)) return fs.readFileSync(src, 'utf8');
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    const res = await page.goto(src, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return await res.text();
  } finally {
    await browser.close();
  }
}
// Windows 上 npm 是 .cmd，只能经 shell 调用；版本号来自 npm 的输出，拼进命令前先校验
const npm = command => execSync(`npm ${command}`, { cwd: ROOT, encoding: 'utf8' });
const SAFE_VERSION = /^[\w.+-]+$/;
function distOf(version) {
  if (!SAFE_VERSION.test(version)) return '';
  const dir = path.join(CACHE, version);
  const file = path.join(dir, 'package', 'dist', 'darkmode.min.js');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    const tgz = npm(`pack mp-darkmode@${version} --silent --pack-destination "${dir}"`).trim().split('\n').at(-1);
    execFileSync('tar', ['-xzf', tgz], { cwd: dir });
  }
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const html = await pageHtml();
const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/mp-darkmode/package.json'), 'utf8')).version;
const versions = [installed, ...JSON.parse(npm('view mp-darkmode versions --json')).toReversed()];
let found = null;
for (const v of new Set(versions)) {
  const dist = distOf(v);
  if (dist && html.includes(dist)) {
    found = v;
    break;
  }
}
console.log(`本项目安装的版本：${installed}`);
console.log(
  found
    ? `页面内嵌的版本：${found}（${found === installed ? '与本项目安装的版本相同' : '与本项目安装的版本不同'}）`
    : '页面内嵌的代码与 npm 上的所有版本都不相同',
);
const call = html.indexOf('Darkmode.run(');
if (call < 0) console.log('页面中没有找到 Darkmode.run 调用');
else {
  // 参数里有回调函数，只列到 error 之前（颜色相关的几项都在前面）
  const text = html.slice(call, call + 1200);
  const end = text.indexOf('error:');
  console.log('页面调用时传入的参数：\n' + (end > 0 ? text.slice(0, end) : text).trim());
}
