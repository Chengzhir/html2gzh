// 把转换器与本机服务给的文案代码排成句子
import { t, te } from './i18n.ts';
import { CodedError } from '../convert/types.ts';
import type { Finding, Msg, Param } from '../convert/types.ts';

function value(param: Param): string | number {
  if (typeof param === 'string' || typeof param === 'number') return param;
  if (Array.isArray(param)) return param.map(value).join(t('common.sep'));
  if ('list' in param) return param.list.map(value).join(t(param.sep));
  return fmt(param);
}
function fmt(message: Msg): string {
  const named = Object.fromEntries(Object.entries(message.params || {}).map(([name, param]) => [name, value(param)]));
  return t(message.key, named);
}
const fmtKey = (key: string, params?: Record<string, Param>) => fmt({ key, params });

/** 出错时给用户看的一句话 */
export const errText = (e: unknown) =>
  e instanceof CodedError ? fmtKey(e.key, e.params) : String((e && (e as Error).message) || e);

export const kb = (bytes: number) =>
  bytes >= 1 << 20
    ? t('common.mb', { n: (bytes / (1 << 20)).toFixed(1) })
    : bytes >= 1024
      ? t('common.kb', { n: Math.round(bytes / 1024) })
      : t('common.bytes', { n: bytes });

/** 详细说明排成的段落与列表 */
export type Block = { p: string } | { ul: string[] };
/** 检查结果的结论与说明。说明 = finding.<code>.detail（有的话，换行处分段）+ parts：相邻的句子并成一段，列表另起 */
export function showFinding(f: Finding) {
  const base = 'finding.' + f.code,
    params = f.params;
  const blocks: Block[] = [];
  const lines = te(base + '.detail') ? fmtKey(base + '.detail', params).split('\n') : [];
  let para = lines.pop() ?? '';
  for (const p of lines) blocks.push({ p });
  const flush = () => {
    if (para) blocks.push({ p: para });
    para = '';
  };
  for (const part of f.parts) {
    if ('items' in part) {
      flush();
      blocks.push({ ul: part.items.map(fmt) });
    } else para += fmt(part);
  }
  flush();
  return { text: fmtKey(base + '.text', params), blocks };
}
