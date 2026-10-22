// 当前打开的文章：路径与版本号（每打开一次加一，页面据此重新载入）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp } from './config.ts';
import { CodedError } from '../ui/convert/types.ts';

export const article = { file: '', rev: 0 };
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
/** 打开文件或文件夹（文件夹里取 index.html，或唯一的 HTML 文件）；打不开时抛出 CodedError（文案 api.*） */
export function openArticle(input) {
  const p = path.resolve(cleanPath(input));
  if (!fs.existsSync(p)) throw new CodedError('api.notFound', { path: p });
  const f = findHtml(p);
  if (!f && !fs.statSync(p).isDirectory()) throw new CodedError('api.notHtml', { path: p });
  if (!f) throw fs.readdirSync(p).some(n => /\.html?$/i.test(n)) ? new CodedError('api.manyHtml') : new CodedError('api.noHtml', { path: p });
  article.file = f; article.rev++;
  console.log(`${stamp()}  打开  ${f}`);
}
