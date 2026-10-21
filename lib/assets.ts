// 已登记的文件：文章里的图片、字体、样式表，页面生成的位图与压缩后的副本。按内容哈希命名，UI 口与取图口都从这里取
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stamp } from './config.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { send } from './http.ts';

export const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.ttc', '.otc', '.css']);
/** 取图口只对外提供图片 */
export const PUBLIC_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
export const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.otc': 'font/collection', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
};

/** id → { buf, ext, name, fetches: 最近几次外部取图的时刻（毫秒）, lastUA } */
export interface Asset { buf: Buffer; ext: string; name: string; fetches: number[]; lastUA: string }
export const assets = new Map<string, Asset>();
/** 绝对路径 → { id, mtime, size }，避免同一文件反复哈希 */
const pathCache = new Map<string, { id: string; mtime: number; size: number }>();
/** id 的格式见 ui/convert/assetid.ts */
export function register(buf: Buffer, ext: string, name: string) {
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + ext;
  if (!assets.has(id)) assets.set(id, { buf, ext, name, fetches: [], lastUA: '' });
  return id;
}
export function registerFile(abs: string) {
  const st = fs.statSync(abs);
  const c = pathCache.get(abs);
  if (c && c.mtime === st.mtimeMs && c.size === st.size && assets.has(c.id)) return c.id;
  const id = register(fs.readFileSync(abs), path.extname(abs).toLowerCase(), path.basename(abs));
  pathCache.set(abs, { id, mtime: st.mtimeMs, size: st.size });
  return id;
}

/** countHit：取图口来的请求，只给图片，并记下取图时刻 */
export function serveAsset(req: IncomingMessage, res: ServerResponse, id: string, countHit: boolean) {
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
