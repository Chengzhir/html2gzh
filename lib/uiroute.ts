// UI 口（只绑 127.0.0.1）：页面文件、/a/ 下的已登记文件与页面调用的接口
import fs from 'node:fs';
import path from 'node:path';
import { UI_DIR, UI_PORT, IMG_PORT } from './config.ts';
import { assets, ASSET_EXT, PUBLIC_EXT, MIME, register, registerFile, serveAsset } from './assets.ts';
import { article, openArticle } from './article.ts';
import { checkHosts, checkIfStale, hostState, parseHostForm, applyHost } from './host.ts';
import { changeImgPort } from './imgserver.ts';
import { send, json, readBody, fail, failWith } from './http.ts';
import { handleGlyphs } from './glyphs.ts';
import { shrink } from './shrink.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiState, ArticleResponse, ShrinkOutput, ShrinkResponse, ShrinkSkip } from '../ui/convert/types.ts';

const LOCAL_HOSTS = new Set([`127.0.0.1:${UI_PORT}`, `localhost:${UI_PORT}`]);

function apiState(req: IncomingMessage, res: ServerResponse) {
  checkIfStale();
  let mtime = 0;
  try { if (article.file) mtime = fs.statSync(article.file).mtimeMs; } catch { /* 文件被删 */ }
  const fetches: ApiState['fetches'] = {};
  for (const [id, a] of assets) if (a.fetches.length) fetches[id] = a.fetches;
  return json(res, 200, { app: 'html2gzh', article: { ...article, mtime }, host: hostState(), fetches, imgPort: IMG_PORT } satisfies ApiState);
}
function apiArticle(req: IncomingMessage, res: ServerResponse) {
  if (!article.file) return failWith(res, 404, 'noArticle');
  try {
    const html = fs.readFileSync(article.file, 'utf8');
    return json(res, 200, { file: article.file, rev: article.rev, mtime: fs.statSync(article.file).mtimeMs, html } satisfies ArticleResponse);
  }
  catch (e) { return failWith(res, 500, 'readFailed', { msg: e.message }); }
}
function serveUi(res: ServerResponse, p: string) {
  if (!fs.existsSync(path.join(UI_DIR, 'index.html'))) return send(res, 503, '页面还没有构建：请在本工具的目录中运行 npm run build，然后刷新本页。');
  const file = path.resolve(UI_DIR, p === '/' ? 'index.html' : p.slice(1));
  if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
  return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}
/** 页面生成的位图、内嵌图片：原样登记 */
function apiBlob(res: ServerResponse, url: URL, body: Buffer) {
  const ext = '.' + String(url.searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
  if (!ASSET_EXT.has(ext)) return failWith(res, 400, 'badExt', { ext });
  return json(res, 200, { id: register(body, ext, url.searchParams.get('name') || 'blob' + ext) });
}

/** "id|scale|max" → /api/shrink 的结果。同一张图同样的参数只压缩一次 */
const shrunk = new Map<string, ShrinkResponse>();
// 收 JSON 的接口：b 是解析好的请求体
const POST: Record<string, (res: ServerResponse, b: any) => unknown> = {
  '/api/open': (res, b) => {
    try { openArticle(b.path); return json(res, 200, { file: article.file, rev: article.rev }); }
    catch (e) { return fail(res, 400, e); }
  },
  // refs 是相对文章所在目录的路径；只认白名单扩展名
  '/api/assets': (res, b) => {
    if (!article.file) return failWith(res, 400, 'noArticle');
    const dir = path.dirname(article.file);
    const out: Record<string, string | null> = {};
    for (const ref of b.refs || []) {
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
  },
  // { id, scale, max }：处理已登记的图片，结果另行登记（原文件与原 id 不变）
  '/api/shrink': async (res, b) => {
    const a = assets.get(String(b.id || ''));
    const max = Math.floor(Number(b.max));
    const scale = b.scale == null ? null : Number(b.scale);
    if (!a || !PUBLIC_EXT.has(a.ext)) return failWith(res, 404, 'noImage');
    if (!(max >= 1024) || scale != null && !(scale > 0)) return failWith(res, 400, 'badParams');
    const key = `${b.id}|${scale}|${max}`;
    if (!shrunk.has(key)) {
      let r: Omit<Partial<ShrinkOutput>, 'skip'> & { skip?: ShrinkSkip };
      try { r = await shrink(a.buf, { scale, max }); } catch (e) { return failWith(res, 500, 'shrinkFailed', { msg: e.message }); }
      const base = a.name.replace(/\.[^.]+$/, '');
      shrunk.set(key, r.skip ? { skip: r.skip, size: a.buf.length } : {
        id: register(r.buf, r.ext, `${base}（压缩）${r.ext}`), size: r.buf.length, srcSize: a.buf.length, how: r.how,
        width: r.width, height: r.height, srcWidth: r.srcWidth, srcHeight: r.srcHeight, over: r.over,
      });
      if (shrunk.size > 200) shrunk.delete(shrunk.keys().next().value);
    }
    return json(res, 200, shrunk.get(key));
  },
  '/api/glyphs': async (res, b) => {
    try { return json(res, 200, await handleGlyphs(b, id => { const a = assets.get(id); return a ? a.buf : null; })); }
    catch (e) { return fail(res, 400, e); }
  },
  '/api/recheck': async res => { await checkHosts(); return json(res, 200, { ok: true }); },
  // { imgPort, host, port, proto }：先全部校验，再换绑本机端口，最后存设置、重测
  '/api/host': async (res, b) => {
    let cfg;
    try { cfg = parseHostForm(b); } catch (e) { return fail(res, 400, e); }
    if (cfg.imgPort !== IMG_PORT) {
      try { await changeImgPort(cfg.imgPort); }
      catch (e) { return e.code === 'EADDRINUSE' ? failWith(res, 409, 'portBusy', { port: cfg.imgPort, old: IMG_PORT }) : failWith(res, 409, 'portFailed', { port: cfg.imgPort, msg: e.message, old: IMG_PORT }); }
    }
    applyHost(cfg);
    return json(res, 200, { host: hostState() });
  },
};

export async function uiRoute(req: IncomingMessage, res: ServerResponse) {
  // 防 DNS rebinding 与跨站请求：Host 必须是本机；POST 必须带本页的 Origin（浏览器发 POST 都会带）
  if (!LOCAL_HOSTS.has(req.headers.host || '')) return send(res, 403, 'forbidden');
  if (req.method === 'POST' && !LOCAL_HOSTS.has(String(req.headers.origin || '').replace(/^https?:\/\//, ''))) return send(res, 403, 'forbidden');
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/api/state') return apiState(req, res);
  if (p === '/api/article') return apiArticle(req, res);
  if (req.method !== 'POST') return p.startsWith('/a/') ? serveAsset(req, res, p.slice(3), false) : serveUi(res, p);

  let body: Buffer;
  try { body = await readBody(req); } catch (e) { return fail(res, 413, e); }
  if (p === '/api/blob') return apiBlob(res, url, body);
  const handler = POST[p];
  if (!handler) return send(res, 404, 'not found');
  let b;
  try { b = JSON.parse(body.toString('utf8') || '{}'); } catch { return failWith(res, 400, 'notJson'); }
  return handler(res, b);
}
