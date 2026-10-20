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
const IMG_PORT = +opt('port', 38960);
const UI_PORT = +opt('ui', IMG_PORT + 1);
const NO_OPEN = flag('no-open');
const LAUNCH = process.platform === 'win32' ? 'serve.cmd' : 'node server.mjs';
const initialArg = argv.find((a, i) => !a.startsWith('--') && !['--port', '--ui'].includes(argv[i - 1]));

const TOKEN = crypto.randomBytes(8).toString('hex');
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.css']);
const PUBLIC_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
};
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

/** id → { buf, ext, name, hits, lastUA } */
const assets = new Map();
/** 绝对路径 → { id, mtime, size }，避免同一文件反复哈希 */
const pathCache = new Map();
function register(buf, ext, name) {
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + ext;
  if (!assets.has(id)) assets.set(id, { buf, ext, name, hits: 0, lastUA: '' });
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
  if (!fs.existsSync(p)) throw new Error('找不到：' + p);
  const f = findHtml(p);
  if (!f && !fs.statSync(p).isDirectory()) throw new Error('不是 HTML 文件：' + p);
  if (!f) throw new Error(fs.readdirSync(p).some(n => /\.html?$/i.test(n))
    ? '文件夹里有好几个 HTML 文件，不知道打开哪个：把要用的那个改名为 index.html，或者直接粘贴它的完整路径'
    : '这个文件夹里没有 HTML 文件：' + p);
  article.file = f; article.rev++;
  console.log(`${stamp()}  打开  ${f}`);
}

/* ---------- 公网出口 ---------- */
// list: [{ base, ip, seen, ok, passes, stale }]，seen = 本轮多少次探测落在这个出口
const host = { checking: false, list: [], custom: null, checkedAt: 0, probes: 0 };
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
  if (host.checking) return;
  host.checking = true;
  try {
    const jobs = [];
    for (let k = 0; k < ROUNDS; k++) for (const u of IP_SRCS) jobs.push(getText(u, 5000));
    const seen = new Map();
    for (const t of await Promise.all(jobs)) {
      const ip = t && (t.match(/\b\d{1,3}(\.\d{1,3}){3}\b/) || [])[0];
      if (ip && isPublicIPv4(ip)) seen.set(ip, (seen.get(ip) || 0) + 1);
    }
    const fresh = await Promise.all([...seen].map(async ([ip, n]) => {
      const base = `http://${ip}:${IMG_PORT}`;
      const passes = await pingN(base);
      return { base, ip, seen: n, ok: passes > 0, passes, stale: false };
    }));
    // 上一轮见过、这轮没探到的出口先留着（可能只是这轮没分到），标成 stale
    const old = host.list.filter(h => !seen.has(h.ip)).map(h => ({ ...h, seen: 0, stale: true }));
    host.list = [...fresh, ...old].sort((a, b) => b.ok - a.ok || b.seen - a.seen);
    host.probes = jobs.length;
    if (host.custom) host.custom.ok = (await pingN(host.custom.base)) > 0;
    host.checkedAt = Date.now();
    for (const h of fresh) console.log(`${stamp()}  出口  ${h.base}  ${h.ok ? '外网可达' : '不通'}  （${h.seen}/${jobs.length} 次探测走这条）`);
    if (!fresh.length) console.log(`${stamp()}  出口  查不到公网 IP`);
  } finally { host.checking = false; }
}
function pickBase() {
  if (host.custom && host.custom.ok) return { base: host.custom.base, ok: true };
  const ok = host.list.find(h => h.ok);
  if (ok) return { base: ok.base, ok: true };
  if (host.custom) return { base: host.custom.base, ok: false };
  return host.list[0] ? { base: host.list[0].base, ok: false } : null;
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
    a.hits++; a.lastUA = String(req.headers['user-agent'] || '');
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
    const hits = {};
    for (const [id, a] of assets) if (a.hits) hits[id] = a.hits;
    return json(res, 200, { app: 'wxpaste', article: { ...article, mtime }, host: { ...host, pick: pickBase() }, hits, imgPort: IMG_PORT });
  }
  if (p === '/api/article') {
    if (!article.file) return json(res, 404, { error: '尚未打开文章' });
    try { return json(res, 200, { file: article.file, rev: article.rev, html: fs.readFileSync(article.file, 'utf8') }); }
    catch (e) { return json(res, 500, { error: '读不了文件：' + e.message }); }
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
    if (!article.file) return json(res, 400, { error: '尚未打开文章' });
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
    try { return json(res, 200, await handleGlyphs(req2)); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (p === '/api/recheck') { await checkHosts(); return json(res, 200, { ok: true }); }
  if (p === '/api/custom') {
    const base = String(j().base || '').trim().replace(/\/+$/, '');
    if (!base) host.custom = null;
    else if (!/^https?:\/\/[^\s/]+$/i.test(base)) return json(res, 400, { error: '地址格式应为 http(s)://主机[:端口]' });
    else host.custom = { base, ok: await ping(base) };
    return json(res, 200, { custom: host.custom });
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
    if (s.app !== 'wxpaste') throw new Error();
  } catch {
    console.error(`页面端口 ${UI_PORT} 被别的程序占用了。换一组端口再启动，例如 ${LAUNCH} --port 40000（取图用 40000，页面用 40001）`);
    process.exit(1);
  }
  if (initialArg) {
    const r = await fetch(base + '/api/open', { method: 'POST', headers: { origin: base }, body: JSON.stringify({ path: initialArg }) });
    const j = await r.json();
    console.log(r.ok ? '已交给正在运行的工具：' + j.file : '打开失败：' + j.error);
  } else console.log('工具已在运行。');
  openBrowser(base + '/');
  process.exit(0);
}

const uiServer = http.createServer(wrap(uiRoute));
const imgServer = http.createServer(wrap(imgRoute));
uiServer.once('error', e => { if (e.code === 'EADDRINUSE') handOver(); else throw e; });
imgServer.once('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `取图端口 ${IMG_PORT} 被别的程序占用了。换一组端口再启动，例如 ${LAUNCH} --port 40000（取图用 40000，页面用 40001）` : e.message);
  process.exit(1);
});
uiServer.listen(UI_PORT, '127.0.0.1', () => {
  if (initialArg) { try { openArticle(initialArg); } catch (e) { console.error(e.message); } }
  imgServer.listen(IMG_PORT, '0.0.0.0', () => {
    console.log(`\n  页面    http://127.0.0.1:${UI_PORT}/`);
    console.log(`  取图    0.0.0.0:${IMG_PORT}（对外网开放，只提供载入过的文章里的图片）`);
    console.log('  退出    Ctrl+C\n');
    checkHosts();
    openBrowser(`http://127.0.0.1:${UI_PORT}/`);
  });
});
