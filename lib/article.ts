// 当前打开的文章：路径与版本号（每打开一次加一，页面据此重新载入）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp } from './config.ts';
import { CodedError } from '../ui/convert/types.ts';

export const article = { file: '', rev: 0 };
function findHtml(target: string): string | null {
  const stats = fs.statSync(target);
  if (stats.isFile()) return /\.html?$/i.test(target) ? target : null;
  const names = fs.readdirSync(target).filter(name => /\.html?$/i.test(name));
  const pick = names.find(name => /^index\.html?$/i.test(name)) || (names.length === 1 ? names[0] : null);
  return pick ? path.join(target, pick) : null;
}
function cleanPath(input: unknown) {
  let text = String(input || '')
    .trim()
    .replace(/^["']|["']$/g, '');
  if (/^file:\/\//i.test(text)) text = fileURLToPath(text);
  return text;
}
/** 打开文件或文件夹（文件夹里取 index.html，或唯一的 HTML 文件）；打不开时抛出 CodedError（文案 api.*） */
export function openArticle(input: unknown) {
  const target = path.resolve(cleanPath(input));
  if (!fs.existsSync(target)) throw new CodedError('api.notFound', { path: target });
  const file = findHtml(target);
  if (!file && !fs.statSync(target).isDirectory()) throw new CodedError('api.notHtml', { path: target });
  if (!file)
    throw fs.readdirSync(target).some(name => /\.html?$/i.test(name))
      ? new CodedError('api.manyHtml')
      : new CodedError('api.noHtml', { path: target });
  article.file = file;
  article.rev++;
  console.log(`${stamp()}  打开  ${file}`);
}
