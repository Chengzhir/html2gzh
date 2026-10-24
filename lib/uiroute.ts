// UI 口（只绑 127.0.0.1）：页面文件、/a/ 下的已登记文件与页面调用的接口
import fs from 'node:fs';
import path from 'node:path';
import { UI_DIR, UI_PORT, IMG_PORT } from './config.ts';
import { assets, ASSET_EXT, PUBLIC_EXT, MIME, register, registerFile, serveAsset } from './assets.ts';
import { article, openArticle } from './article.ts';
import { checkHosts, checkIfStale, hostState, parseHostForm, applyHost } from './host.ts';
import { changeImgPort } from './imgserver.ts';
import { send, json, readBody, fail, failWith, isJsonObject, type JsonObject } from './http.ts';
import { handleGlyphs } from './glyphs.ts';
import { shrink } from './shrink.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { errorCode, messageOf } from '../ui/convert/types.ts';
import type { ApiState, ArticleResponse, ShrinkResponse, ShrinkResult } from '../ui/convert/types.ts';

const LOCAL_HOSTS = new Set([`127.0.0.1:${UI_PORT}`, `localhost:${UI_PORT}`]);

function apiState(req: IncomingMessage, res: ServerResponse) {
  checkIfStale();
  let mtime = 0;
  try {
    if (article.file) mtime = fs.statSync(article.file).mtimeMs;
  } catch {
    /* 文件被删 */
  }
  const fetches: ApiState['fetches'] = {};
  for (const [id, asset] of assets) if (asset.fetches.length) fetches[id] = asset.fetches;
  return json(res, 200, {
    app: 'html2gzh',
    article: { ...article, mtime },
    host: hostState(),
    fetches,
    imgPort: IMG_PORT,
  } satisfies ApiState);
}
function apiArticle(req: IncomingMessage, res: ServerResponse) {
  if (!article.file) return failWith(res, 404, 'noArticle');
  try {
    const html = fs.readFileSync(article.file, 'utf8');
    return json(res, 200, {
      file: article.file,
      rev: article.rev,
      mtime: fs.statSync(article.file).mtimeMs,
      html,
    } satisfies ArticleResponse);
  } catch (error) {
    return failWith(res, 500, 'readFailed', { msg: messageOf(error) });
  }
}
function serveUi(res: ServerResponse, pathname: string) {
  if (!fs.existsSync(path.join(UI_DIR, 'index.html')))
    return send(res, 503, '页面还没有构建：请在本工具的目录中运行 npm run build，然后刷新本页。');
  const file = path.resolve(UI_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
    return send(res, 404, 'not found');
  return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}
/** 页面生成的位图、内嵌图片：原样登记 */
function apiBlob(res: ServerResponse, url: URL, body: Buffer) {
  const ext = '.' + (url.searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
  if (!ASSET_EXT.has(ext)) return failWith(res, 400, 'badExt', { ext });
  return json(res, 200, { id: register(body, ext, url.searchParams.get('name') || 'blob' + ext) });
}

/** "id|max" → /api/shrink 的结果。同一张图同样的上限只压缩一次 */
const shrunk = new Map<string, ShrinkResponse>();
// 收 JSON 的接口：body 是解析好的请求体
const POST: Record<string, (res: ServerResponse, body: JsonObject) => unknown> = {
  '/api/open': (res, body) => {
    try {
      openArticle(body.path);
      return json(res, 200, { file: article.file, rev: article.rev });
    } catch (error) {
      return fail(res, 400, error);
    }
  },
  // refs 是相对文章所在目录的路径；只认白名单扩展名
  '/api/assets': (res, body) => {
    if (!article.file) return failWith(res, 400, 'noArticle');
    const articleDir = path.dirname(article.file);
    const out: Record<string, string | null> = {};
    for (const ref of Array.isArray(body.refs) ? body.refs.map(String) : []) {
      const filePath = path.resolve(articleDir, ref);
      const ext = path.extname(filePath).toLowerCase();
      // 只认文章所在文件夹里的文件（和拖入文件夹时一样）：别处的 HTML 不能借相对路径把电脑上其他文件放到取图口上
      const relative = path.relative(articleDir, filePath);
      const inside =
        relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      try {
        if (!inside || !ASSET_EXT.has(ext) || !fs.statSync(filePath).isFile()) {
          out[ref] = null;
          continue;
        }
        out[ref] = registerFile(filePath);
      } catch {
        out[ref] = null;
      }
    }
    return json(res, 200, out);
  },
  // { id, max }：处理已登记的图片，结果另行登记（原文件与原 id 不变）
  '/api/shrink': async (res, body) => {
    const asset = assets.get(typeof body.id === 'string' ? body.id : '');
    const maxBytes = Math.floor(Number(body.max));
    if (!asset || !PUBLIC_EXT.has(asset.ext)) return failWith(res, 404, 'noImage');
    if (!(maxBytes >= 1024)) return failWith(res, 400, 'badParams');
    const key = `${body.id}|${maxBytes}`;
    let response = shrunk.get(key);
    if (!response) {
      let result: ShrinkResult;
      try {
        result = await shrink(asset.buf, maxBytes);
      } catch (error) {
        return failWith(res, 500, 'shrinkFailed', { msg: messageOf(error) });
      }
      const base = asset.name.replace(/\.[^.]+$/, '');
      response = result.skip
        ? { skip: result.skip, size: asset.buf.length }
        : {
            id: register(result.buf, result.ext, `${base}（压缩）${result.ext}`),
            size: result.buf.length,
            srcSize: asset.buf.length,
            how: result.how,
            width: result.width,
            height: result.height,
            srcWidth: result.srcWidth,
            srcHeight: result.srcHeight,
            over: result.over,
          };
      shrunk.set(key, response);
      const oldest = shrunk.keys().next();
      if (shrunk.size > 200 && !oldest.done) shrunk.delete(oldest.value);
    }
    return json(res, 200, response);
  },
  '/api/glyphs': async (res, body) => {
    try {
      return json(
        res,
        200,
        await handleGlyphs(body, id => {
          const asset = assets.get(id);
          return asset ? asset.buf : null;
        }),
      );
    } catch (error) {
      return fail(res, 400, error);
    }
  },
  '/api/recheck': async res => {
    await checkHosts();
    return json(res, 200, { ok: true });
  },
  // { imgPort, host, port, proto }：先全部校验，再换绑本机端口，最后存设置、重测
  '/api/host': async (res, body) => {
    let config;
    try {
      config = parseHostForm(body);
    } catch (error) {
      return fail(res, 400, error);
    }
    if (config.imgPort !== IMG_PORT) {
      try {
        await changeImgPort(config.imgPort);
      } catch (error) {
        return errorCode(error) === 'EADDRINUSE'
          ? failWith(res, 409, 'portBusy', { port: config.imgPort, old: IMG_PORT })
          : failWith(res, 409, 'portFailed', { port: config.imgPort, msg: messageOf(error), old: IMG_PORT });
      }
    }
    applyHost(config);
    return json(res, 200, { host: hostState() });
  },
};

export async function uiRoute(req: IncomingMessage, res: ServerResponse) {
  // 防 DNS rebinding 与跨站请求：Host 必须是本机；POST 必须带本页的 Origin（浏览器发 POST 都会带）
  if (!LOCAL_HOSTS.has(req.headers.host || '')) return send(res, 403, 'forbidden');
  if (req.method === 'POST' && !LOCAL_HOSTS.has((req.headers.origin || '').replace(/^https?:\/\//, '')))
    return send(res, 403, 'forbidden');
  const url = new URL(req.url ?? '/', 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api/state') return apiState(req, res);
  if (pathname === '/api/article') return apiArticle(req, res);
  if (req.method !== 'POST')
    return pathname.startsWith('/a/') ? serveAsset(req, res, pathname.slice(3), false) : serveUi(res, pathname);

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (error) {
    return fail(res, 413, error);
  }
  if (pathname === '/api/blob') return apiBlob(res, url, body);
  const handler = POST[pathname];
  if (!handler) return send(res, 404, 'not found');
  let fields: unknown;
  try {
    fields = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    return failWith(res, 400, 'notJson');
  }
  if (!isJsonObject(fields)) return failWith(res, 400, 'notJson');
  return handler(res, fields);
}
