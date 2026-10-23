// 取图口：绑 0.0.0.0，供微信服务器抓取；只出已登记的图片（按内容哈希命名）和自测用的 /__ping
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stamp, TOKEN, IMG_PORT, setImgPort } from './config.ts';
import { serveAsset } from './assets.ts';
import { send, wrap } from './http.ts';
import { ASSET_ID } from '../ui/convert/assetid.ts';

function imgRoute(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/__ping') return send(res, 200, TOKEN);
  const id = url.pathname.startsWith('/a/') ? url.pathname.slice(3) : '';
  if ((req.method === 'GET' || req.method === 'HEAD') && ASSET_ID.test(id)) return serveAsset(req, res, id, true);
  send(res, 404, 'not found');
}

export const imgServer = http.createServer(wrap(imgRoute));
/** 取图口绑到 port；成功 resolve，失败 reject（EADDRINUSE 等） */
export function listenImg(port: number) {
  return new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      imgServer.off('listening', ok);
      reject(error);
    };
    const ok = () => {
      imgServer.off('error', fail);
      setImgPort(port);
      resolve();
    };
    imgServer.once('error', fail);
    imgServer.once('listening', ok);
    imgServer.listen(port, '0.0.0.0');
  });
}
/** 换本机端口：先放开旧端口再绑新的，新端口被占就绑回旧端口 */
export async function changeImgPort(port: number) {
  const old = IMG_PORT;
  imgServer.closeAllConnections();
  await new Promise<void>(done => imgServer.close(() => done()));
  try {
    await listenImg(port);
  } catch (error) {
    await listenImg(old);
    throw error;
  }
  console.log(`${stamp()}  取图  本机端口改为 ${port}`);
}
