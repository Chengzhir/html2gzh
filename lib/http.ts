// UI 口与取图口共用的响应与请求体读取
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stamp } from './config.ts';
import { CodedError, messageOf } from '../ui/convert/types.ts';
import type { ApiErrorBody, Param } from '../ui/convert/types.ts';

export function send(
  res: ServerResponse,
  code: number,
  body: string | Buffer,
  type?: string,
  extra?: Record<string, string | number>,
) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
export const json = (res: ServerResponse, code: number, body: unknown) =>
  send(res, code, JSON.stringify(body), 'application/json; charset=utf-8');
/** 解析好的 JSON 对象：字段的类型都要在用到时校验 */
export type JsonObject = Record<string, unknown>;
export const isJsonObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export async function readBody(req: IncomingMessage, limit = 40 << 20): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new CodedError('api.tooLarge');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
/**
 * 接口出错的响应：文案 api.<code> 由页面显示。e 不是 CodedError 时按 fallback 处理，原文作为 msg 参数
 */
export function fail(res: ServerResponse, status: number, error: unknown, fallback = 'badRequest') {
  const body: ApiErrorBody =
    error instanceof CodedError
      ? { code: error.key.replace(/^api\./, ''), params: error.params, error: error.message }
      : { code: fallback, params: { msg: messageOf(error) }, error: messageOf(error) };
  return json(res, status, body);
}
/** 直接回一个错误：code 是 api.<code> 的文案 */
export const failWith = (res: ServerResponse, status: number, code: string, params?: Record<string, Param>) =>
  fail(res, status, new CodedError('api.' + code, params));
/** 处理函数出错时记日志、回 500，进程照常运行 */
export const wrap =
  (handler: (req: IncomingMessage, res: ServerResponse) => unknown) => (req: IncomingMessage, res: ServerResponse) =>
    Promise.resolve(handler(req, res)).catch(error => {
      console.error(`${stamp()}  出错  ${messageOf(error)}`);
      if (!res.headersSent) send(res, 500, 'error');
    });
