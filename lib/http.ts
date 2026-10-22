// UI 口与取图口共用的响应与请求体读取
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stamp } from './config.ts';
import { CodedError } from '../ui/convert/types.ts';
import type { ApiErrorBody, Param } from '../ui/convert/types.ts';

export function send(res: ServerResponse, code: number, body: string | Buffer, type?: string, extra?: Record<string, string | number>) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
export const json = (res: ServerResponse, code: number, obj: unknown) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
export async function readBody(req: IncomingMessage, limit = 40 << 20): Promise<Buffer> {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new CodedError('api.tooLarge'); chunks.push(c); }
  return Buffer.concat(chunks);
}
/**
 * 接口出错的响应：文案 api.<code> 由页面显示。e 不是 CodedError 时按 fallback 处理，原文作为 msg 参数
 */
export function fail(res: ServerResponse, status: number, e: unknown, fallback = 'badRequest') {
  const err = e as Error;
  const body: ApiErrorBody = e instanceof CodedError
    ? { code: e.key.replace(/^api\./, ''), params: e.params, error: e.message }
    : { code: fallback, params: { msg: String(err && err.message || e) }, error: String(err && err.message || e) };
  return json(res, status, body);
}
/** 直接回一个错误：code 是 api.<code> 的文案 */
export const failWith = (res: ServerResponse, status: number, code: string, params?: Record<string, Param>) => fail(res, status, new CodedError('api.' + code, params));
/** 处理函数出错时记日志、回 500，进程照常运行 */
export const wrap = (fn: (req: IncomingMessage, res: ServerResponse) => unknown) => (req: IncomingMessage, res: ServerResponse) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(`${stamp()}  出错  ${e.message}`);
  if (!res.headersSent) send(res, 500, 'error');
});
