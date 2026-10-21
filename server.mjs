#!/usr/bin/env node
// 两个端口：UI 口只绑 127.0.0.1；图床口绑 0.0.0.0，只出已登记的图片（按内容哈希命名），供微信服务端抓取。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleGlyphs } from './lib/glyphs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, 'ui');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = k => argv.includes('--' + k);
// 页面上改的设置（取图端口、内网穿透地址）存在这里，重启后沿用；命令行参数优先
const SETTINGS = path.resolve(opt('settings', path.join(HERE, 'settings.json')));
function loadSettings() {
  try { const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
const settings = loadSettings();
function saveSettings(patch) {
  Object.assign(settings, patch);
  try { fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n'); }
  catch (e) { console.error(`${stamp()}  设置保存失败（${e.message}）`); }
}
const validPort = n => Number.isInteger(n) && n >= 1024 && n <= 65535;
const UI_PORT = +opt('ui', opt('port') ? +opt('port') + 1 : 38961);
const DEFAULT_IMG = 38960;
const savedImg = validPort(settings.imgPort) && settings.imgPort !== UI_PORT ? settings.imgPort : 0;
let IMG_PORT = opt('port') ? +opt('port') : savedImg || DEFAULT_IMG;
const NO_OPEN = flag('no-open');
const LAUNCH = process.platform === 'win32' ? 'serve.cmd' : 'node server.mjs';
const initialArg = argv.find((a, i) => !a.startsWith('--') && !['--port', '--ui', '--settings'].includes(argv[i - 1]));

const TOKEN = crypto.randomBytes(8).toString('hex');
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.ttc', '.otc', '.css']);
const PUBLIC_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.otc': 'font/collection', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
};
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

/** id → { buf, ext, name, fetches: 最近几次外部取图的时刻（毫秒）, lastUA } */
const assets = new Map();
/** 绝对路径 → { id, mtime, size }，避免同一文件反复哈希 */
const pathCache = new Map();
function register(buf, ext, name) {
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + ext;
  if (!assets.has(id)) assets.set(id, { buf, ext, name, fetches: [], lastUA: '' });
  return id;
}
function registerFile(abs) {
  const st = fs.statSync(abs);
  const c = pathCache.get(abs);
  if (c && c.mtime === st.mtimeMs && c.size === st.size && assets.has(c.id)) return c.id;
  const id = register(fs.readFileSync(abs), path.extname(abs).toLowerCase(), path.basename(abs));
  pathCache.set(abs, { id, mtime: st.mtimeMs, size: st.size });
  return id;
}

const article = { file: '', rev: 0 };
function findHtml(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return /\.html?$/i.test(p) ? p : null;
  const names = fs.readdirSync(p).filter(n => /\.html?$/i.test(n));
  const pick = names.find(n => /^index\.html?$/i.test(n)) || (names.length === 1 ? names[0] : null);
  return pick ? path.join(p, pick) : null;
}
function cleanPath(s) {
  s = String(s || '').trim().replace(/^["']|["']$/g, '');
  if (/^file:\/\//i.test(s)) s = fileURLToPath(s);
  return s;
}
function openArticle(input) {
  const p = path.resolve(cleanPath(input));
  if (!fs.existsSync(p)) throw new Error('路径不存在：' + p);
  const f = findHtml(p);
  if (!f && !fs.statSync(p).isDirectory()) throw new Error('不是 HTML 文件：' + p);
  if (!f) throw new Error(fs.readdirSync(p).some(n => /\.html?$/i.test(n))
    ? '文件夹中有多个 HTML 文件，无法确定要打开哪一个：请把要使用的文件改名为 index.html，或直接粘贴它的完整路径'
    : '这个文件夹中没有 HTML 文件：' + p);
  article.file = f; article.rev++;
  console.log(`${stamp()}  打开  ${f}`);
}

/* ---------- 取图地址 ---------- */
// 取图地址 = 协议 + 公网地址 + 公网端口，和端口映射软件的写法一样。公网地址留空时自动检测本机的公网 IP（只能是 http），
// 公网端口为 0 时：http 与本机端口相同（路由器端口转发通常两边一致），https 用 443（只有内网穿透、反向代理才给得出 https）
const validPub = n => Number.isInteger(n) && n >= 1 && n <= 65535;
const PUB = { host: typeof settings.host === 'string' ? settings.host : '', port: validPub(settings.port) ? settings.port : 0, proto: 'http' };
if (PUB.host && settings.proto === 'https') PUB.proto = 'https';
// list：自动检测到的出口 [{ base, ip, seen, ok, passes, stale }]，seen = 本轮多少次探测落在这个出口；manual：填了公网地址时它的自测结果
const host = { checking: false, list: [], manual: null, checkedAt: 0, probes: 0 };
let recheck = false, gen = 0;
const bracket = h => h.includes(':') ? `[${h}]` : h;
function baseOf(h) {
  const def = PUB.proto === 'https' ? 443 : 80, port = PUB.port || (PUB.proto === 'https' ? 443 : IMG_PORT);
  return `${PUB.proto}://${bracket(h)}${port === def ? '' : ':' + port}`;
}
const IP_SRCS = ['https://myip.ipip.net', 'http://ddns.oray.com/checkip', 'https://ip.3322.net', 'http://members.3322.org/dyndns/getip',
  'https://api-ipv4.ip.sb/ip', 'https://ifconfig.me/ip', 'https://checkip.amazonaws.com', 'https://v4.ident.me', 'https://ipv4.icanhazip.com'];
const ROUNDS = 3;

/** 每次都新建 TCP 连接：多线负载均衡按连接分流，复用连接就永远只看到同一个出口 */
function getText(u, ms) {
  return new Promise(resolve => {
    const lib = u.startsWith('https:') ? https : http;
    const req = lib.get(u, { agent: false, family: 4, timeout: ms, headers: { 'user-agent': 'curl/8' } }, r => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', c => { if (b.length < 4096) b += c; });
      r.on('end', () => resolve(r.statusCode === 200 ? b : null));
      // 读到一半连接断开或超时被掐断时没有 end，只有 close；不 resolve 的话这一轮检测永远结束不了
      r.on('close', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
async function ping(base) {
  const t = await getText(base.replace(/\/+$/, '') + '/__ping', 6000);
  return t != null && t.trim() === TOKEN;
}
// 内网和保留地址微信永远连不上；查 IP 的网站被劫持（如校园网认证页）时回的可能就是本机内网地址，回连自测照样能通
function isPublicIPv4(ip) {
  const o = ip.split('.').map(Number);
  if (o.some(n => n > 255)) return false;
  const [a, b] = o;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)));
}
/** 自测回连也会被分到不同出口，一个出口试三次，有一次通就算通 */
async function pingN(base, n = 3) {
  const r = await Promise.all(Array.from({ length: n }, () => ping(base)));
  return r.filter(Boolean).length;
}
async function checkHosts() {
  // 检测进行中又要求检测：这一轮结束后再测一轮；这一轮里设置改了（gen 变了），结果作废
  if (host.checking) { recheck = true; return; }
  host.checking = true;
  const g = gen;
  try {
    if (PUB.host) {
      // 填了公网地址就不查公网 IP，只测这个地址
      const base = baseOf(PUB.host), ok = (await pingN(base)) > 0;
      if (g !== gen) return;
      Object.assign(host, { manual: { base, ok }, list: [], probes: 0, checkedAt: Date.now() });
      console.log(`${stamp()}  取图地址  ${base}  ${ok ? '自测通过' : '自测未通过'}`);
      return;
    }
    const jobs = [];
    for (let k = 0; k < ROUNDS; k++) for (const u of IP_SRCS) jobs.push(getText(u, 5000));
    const seen = new Map();
    for (const t of await Promise.all(jobs)) {
      const ip = t && (t.match(/\b\d{1,3}(\.\d{1,3}){3}\b/) || [])[0];
      if (ip && isPublicIPv4(ip)) seen.set(ip, (seen.get(ip) || 0) + 1);
    }
    const fresh = await Promise.all([...seen].map(async ([ip, n]) => {
      const base = baseOf(ip);
      const passes = await pingN(base);
      return { base, ip, seen: n, ok: passes > 0, passes, stale: false };
    }));
    if (g !== gen) return;
    // 上一轮见过、这轮没探到的出口先留着（可能只是这轮没分到），标成 stale
    const old = host.list.filter(h => !seen.has(h.ip)).map(h => ({ ...h, seen: 0, stale: true }));
    Object.assign(host, { list: [...fresh, ...old].sort((a, b) => b.ok - a.ok || b.seen - a.seen), manual: null, probes: jobs.length, checkedAt: Date.now() });
    for (const h of fresh) console.log(`${stamp()}  取图地址  ${h.base}  ${h.ok ? '自测通过' : '自测未通过'}  （${jobs.length} 次查询中有 ${h.seen} 次查到这个 IP）`);
    if (!fresh.length) console.log(`${stamp()}  取图地址  没有检测到公网 IP`);
  } finally {
    host.checking = false;
    if (recheck || g !== gen) { recheck = false; checkHosts(); }
  }
}
/** 设置改了：清掉旧结果重测 */
function resetHosts() { gen++; Object.assign(host, { list: [], manual: null, checkedAt: 0, probes: 0 }); checkHosts(); }
function pickBase() {
  if (PUB.host) return host.manual || { base: baseOf(PUB.host), ok: null };
  const ok = host.list.find(h => h.ok);
  if (ok) return { base: ok.base, ok: true };
  return host.list[0] ? { base: host.list[0].base, ok: false } : null;
}
const hostState = () => ({ checking: host.checking, list: host.list, checkedAt: host.checkedAt, probes: host.probes, pick: pickBase(),
  config: { imgPort: IMG_PORT, host: PUB.host, port: PUB.port, proto: PUB.proto } });
/** 公网地址：域名、IPv4 或 IPv6，不带协议、端口和路径；内网地址微信服务器连不上，不收 */
function cleanHost(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let u = null;
  try { u = new URL(`http://${s.includes(':') && !s.startsWith('[') ? `[${s}]` : s}/`); } catch { /* 下面报错 */ }
  if (!u || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) throw new Error('公网地址应为域名或 IP，不含协议、端口与路径。以 http:// 或 https:// 开头的完整地址可以整体粘贴，将自动拆分');
  const h = u.hostname.replace(/^\[|\]$/g, '');
  const inner = /^localhost$/i.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) && !isPublicIPv4(h) || h.includes(':') && /^(::1?$|::ffff:|f[cd]|fe[89ab])/i.test(h);
  if (inner) throw new Error(`${h} 是内网地址，微信服务器无法访问`);
  return h;
}

/* ---------- HTTP ---------- */
function send(res, code, body, type, extra) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
async function readBody(req, limit = 40 << 20) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('请求体过大'); chunks.push(c); }
  return Buffer.concat(chunks);
}
function serveAsset(req, res, id, countHit) {
  const a = assets.get(id);
  if (!a || (countHit && !PUBLIC_EXT.has(a.ext))) return send(res, 404, 'not found');
  if (countHit) {
    // 记下时刻而不只是次数：微信服务器下载一张图超时（约 0.5 秒）会隔 0.5 秒再试，共三次，页面据此区分成功与失败
    a.fetches.push(Date.now()); if (a.fetches.length > 12) a.fetches.shift();
    a.lastUA = String(req.headers['user-agent'] || '');
    // 取图口对外网开放，请求头里的控制字符（终端转义序列等）不原样打进日志
    const safe = s => String(s).replace(/[\x00-\x1f\x7f]/g, '');
    console.log(`${stamp()}  取图  ${a.name}  经 ${safe(req.headers.host || '?')}  ← ${req.socket.remoteAddress}  ${safe(a.lastUA).slice(0, 50)}`);
  }
  // 文章里的 SVG 可能带脚本：直接打开这个地址时不让它在本页同源下运行（内嵌的字体和图片照常显示）
  res.writeHead(200, { 'Content-Type': MIME[a.ext] || 'application/octet-stream', 'Content-Length': a.buf.length, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox" });
  res.end(req.method === 'HEAD' ? undefined : a.buf);
}

const LOCAL_HOSTS = new Set([`127.0.0.1:${UI_PORT}`, `localhost:${UI_PORT}`]);
const HOST_TTL = 5 * 60000;
async function uiRoute(req, res) {
  // 防 DNS rebinding 与跨站请求：Host 必须是本机；POST 必须带本页的 Origin（浏览器发 POST 都会带）
  if (!LOCAL_HOSTS.has(req.headers.host || '')) return send(res, 403, 'forbidden');
  if (req.method === 'POST' && !LOCAL_HOSTS.has(String(req.headers.origin || '').replace(/^https?:\/\//, ''))) return send(res, 403, 'forbidden');
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/state') {
    // 页面开着（每 1.5 秒来问一次）才定期重测取图地址；没人看时不去打扰查 IP 的网站
    if (!host.checking && Date.now() - host.checkedAt > HOST_TTL) checkHosts();
    let mtime = 0;
    try { if (article.file) mtime = fs.statSync(article.file).mtimeMs; } catch { /* 文件被删 */ }
    const fetches = {};
    for (const [id, a] of assets) if (a.fetches.length) fetches[id] = a.fetches;
    return json(res, 200, { app: 'html2gzh', article: { ...article, mtime }, host: hostState(), fetches, imgPort: IMG_PORT });
  }
  if (p === '/api/article') {
    if (!article.file) return json(res, 404, { error: '尚未载入文章' });
    try { return json(res, 200, { file: article.file, rev: article.rev, html: fs.readFileSync(article.file, 'utf8') }); }
    catch (e) { return json(res, 500, { error: '无法读取文件：' + e.message }); }
  }
  if (req.method !== 'POST') {
    if (p.startsWith('/a/')) return serveAsset(req, res, p.slice(3), false);
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const file = path.resolve(UI_DIR, rel);
    if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  }

  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 413, { error: e.message }); }
  const j = () => JSON.parse(body.toString('utf8') || '{}');

  if (p === '/api/open') {
    try { openArticle(j().path); return json(res, 200, { file: article.file, rev: article.rev }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (p === '/api/assets') {
    // refs 是相对文章所在目录的路径；只认白名单扩展名
    if (!article.file) return json(res, 400, { error: '尚未载入文章' });
    const dir = path.dirname(article.file);
    const out = {};
    for (const ref of j().refs || []) {
      const abs = path.resolve(dir, String(ref));
      const ext = path.extname(abs).toLowerCase();
      // 只认文章所在文件夹里的文件（和拖入文件夹时一样）：别处的 HTML 不能借相对路径把电脑上其他文件放到取图口上
      const rel = path.relative(dir, abs);
      const inside = rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
      try {
        if (!inside || !ASSET_EXT.has(ext) || !fs.statSync(abs).isFile()) { out[ref] = null; continue; }
        out[ref] = registerFile(abs);
      } catch { out[ref] = null; }
    }
    return json(res, 200, out);
  }
  if (p === '/api/blob') {
    const ext = '.' + String(url.searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
    if (!ASSET_EXT.has(ext)) return json(res, 400, { error: '不支持的文件类型 ' + ext });
    return json(res, 200, { id: register(body, ext, url.searchParams.get('name') || 'blob' + ext) });
  }
  if (p === '/api/glyphs') {
    let req2;
    try { req2 = j(); } catch { return json(res, 400, { error: '请求不是 JSON' }); }
    try { return json(res, 200, await handleGlyphs(req2, id => { const a = assets.get(id); return a ? a.buf : null; })); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (p === '/api/recheck') { await checkHosts(); return json(res, 200, { ok: true }); }
  if (p === '/api/host') {
    // { imgPort, host, port, proto }：先全部校验，再换绑本机端口，最后存设置、重测
    let b;
    try { b = j(); } catch { return json(res, 400, { error: '请求不是 JSON' }); }
    // 空串表示留空；其余按数字解析，解析不出是 NaN，下面的校验会拒绝
    const num = v => v == null || String(v).trim() === '' ? 0 : Number(v);
    const imgPort = num(b.imgPort), port = num(b.port);
    if (!validPort(imgPort)) return json(res, 400, { error: '本机端口应为 1024–65535 之间的整数' });
    if (imgPort === UI_PORT) return json(res, 400, { error: `${imgPort} 是本页面使用的端口，请改用其他端口` });
    if (port !== 0 && !validPub(port)) return json(res, 400, { error: '公网端口应为 1–65535 之间的整数，或者留空' });
    let h;
    try { h = cleanHost(b.host); } catch (e) { return json(res, 400, { error: e.message }); }
    if (imgPort !== IMG_PORT) {
      try { await changeImgPort(imgPort); }
      catch (e) { return json(res, 409, { error: e.code === 'EADDRINUSE' ? `端口 ${imgPort} 已被其他程序占用，仍使用 ${IMG_PORT}` : `无法改用端口 ${imgPort}（${e.message}），仍使用 ${IMG_PORT}` }); }
    }
    Object.assign(PUB, { host: h, port, proto: h && b.proto === 'https' ? 'https' : 'http' });
    saveSettings({ imgPort: IMG_PORT, host: PUB.host, port: PUB.port, proto: PUB.proto });
    resetHosts();
    return json(res, 200, { host: hostState() });
  }
  return send(res, 404, 'not found');
}

function imgRoute(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__ping') return send(res, 200, TOKEN);
  if ((req.method === 'GET' || req.method === 'HEAD') && /^\/a\/[0-9a-f]{16}\.[a-z0-9]+$/.test(url.pathname)) return serveAsset(req, res, url.pathname.slice(3), true);
  send(res, 404, 'not found');
}

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(`${stamp()}  出错  ${e.message}`);
  if (!res.headersSent) send(res, 500, 'error');
});

function openBrowser(u) {
  if (NO_OPEN) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', u]]
    : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

/** UI 口被占：若占用者是本工具，就把文章交给它，自己退出 */
async function handOver() {
  const base = `http://127.0.0.1:${UI_PORT}`;
  try {
    const s = await (await fetch(base + '/api/state', { signal: AbortSignal.timeout(2000) })).json();
    if (s.app !== 'html2gzh') throw new Error();
  } catch {
    console.error(`页面端口 ${UI_PORT} 已被其他程序占用。请改用其他端口启动，例如 ${LAUNCH} --port 40000（本机端口为 40000，页面端口为 40001）`);
    process.exit(1);
  }
  if (initialArg) {
    const r = await fetch(base + '/api/open', { method: 'POST', headers: { origin: base }, body: JSON.stringify({ path: initialArg }) });
    const j = await r.json();
    console.log(r.ok ? '已在运行中的 html2gzh 里打开：' + j.file : '打开失败：' + j.error);
  } else console.log('html2gzh 已在运行。');
  openBrowser(base + '/');
  process.exit(0);
}

const uiServer = http.createServer(wrap(uiRoute));
const imgServer = http.createServer(wrap(imgRoute));
/** 取图口绑到 port；成功 resolve，失败 reject（EADDRINUSE 等） */
function listenImg(port) {
  return new Promise((resolve, reject) => {
    const fail = e => { imgServer.off('listening', ok); reject(e); };
    const ok = () => { imgServer.off('error', fail); IMG_PORT = port; resolve(); };
    imgServer.once('error', fail);
    imgServer.once('listening', ok);
    imgServer.listen(port, '0.0.0.0');
  });
}
/** 换本机端口：先放开旧端口再绑新的，新端口被占就绑回旧端口 */
async function changeImgPort(port) {
  const old = IMG_PORT;
  imgServer.closeAllConnections();
  await new Promise(r => imgServer.close(() => r()));
  try { await listenImg(port); }
  catch (e) { await listenImg(old); throw e; }
  console.log(`${stamp()}  取图  本机端口改为 ${port}`);
}
uiServer.once('error', e => { if (e.code === 'EADDRINUSE') handOver(); else throw e; });
uiServer.listen(UI_PORT, '127.0.0.1', async () => {
  if (initialArg) { try { openArticle(initialArg); } catch (e) { console.error(e.message); } }
  try { await listenImg(IMG_PORT); }
  catch (e) {
    // 上次在页面里存的端口被占了：退回默认端口，页面里可以再改
    const fallback = !opt('port') && savedImg && IMG_PORT !== DEFAULT_IMG && e.code === 'EADDRINUSE';
    if (fallback) {
      console.error(`本机端口 ${IMG_PORT}（上次在页面中设置）已被其他程序占用，改用 ${DEFAULT_IMG}`);
      try { await listenImg(DEFAULT_IMG); } catch { /* 下面统一报错 */ }
    }
    if (!imgServer.listening) {
      console.error(e.code === 'EADDRINUSE' ? `本机端口 ${IMG_PORT} 已被其他程序占用。请改用其他端口启动，例如 ${LAUNCH} --port 40000（本机端口为 40000，页面端口为 40001）` : e.message);
      process.exit(1);
    }
  }
  console.log(`\n  页面    http://127.0.0.1:${UI_PORT}/`);
  console.log(`  取图    0.0.0.0:${IMG_PORT}（对外网开放，只提供已载入文章中的图片；端口可在页面中修改）`);
  console.log('  退出    Ctrl+C\n');
  checkHosts();
  openBrowser(`http://127.0.0.1:${UI_PORT}/`);
});
