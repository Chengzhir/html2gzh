import { te } from './i18n.ts';
import { CodedError } from '../convert/types.ts';
import type { ApiErrorBody } from '../convert/types.ts';

/** 调本机服务的接口：body 不给为 GET，否则 POST（raw 时原样发送）。出错时抛 CodedError（文案 api.*） */
export async function api<T = unknown>(path: string, body?: unknown, raw = false): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', body: raw ? body as BodyInit : JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => ({}));
  if (response.ok) return data as T;
  const { code, params, error } = data as Partial<ApiErrorBody>;
  if (code && te('api.' + code)) throw new CodedError('api.' + code, params || {});
  if (error) throw new CodedError('common.raw', { msg: error });
  throw new CodedError('api.failed', { status: response.status });
}
