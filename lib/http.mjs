// UI 口与取图口共用的响应与请求体读取
import { stamp } from './config.mjs';

export function send(res, code, body, type, extra) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
export const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
export async function readBody(req, limit = 40 << 20) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('请求体过大'); chunks.push(c); }
  return Buffer.concat(chunks);
}
/** 处理函数出错时记日志、回 500，进程照常运行 */
export const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(`${stamp()}  出错  ${e.message}`);
  if (!res.headersSent) send(res, 500, 'error');
});
