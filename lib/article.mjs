// 当前打开的文章：路径与版本号（每打开一次加一，页面据此重新载入）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp } from './config.mjs';

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
/** 打开文件或文件夹（文件夹里取 index.html，或唯一的 HTML 文件）；打不开时抛出给用户看的说明 */
export function openArticle(input) {
  const p = path.resolve(cleanPath(input));
  if (!fs.existsSync(p)) throw new Error('路径不存在：' + p);
  const f = findHtml(p);
  if (!f && !fs.statSync(p).isDirectory()) throw new Error('不是 HTML 文件：' + p);
  if (!f) throw new Error(fs.readdirSync(p).some(n => /\.html?$/i.test(n))
    ? '文件夹中有多个 HTML 文件，无法确定要打开哪一个：请把要使用的文件改名为 index.html，或直接粘贴它的完整路径'
    : '这个文件夹中没有 HTML 文件：' + p);
  article.file = f; article.rev++;
  console.log(`${stamp()}  打开  ${f}`);
}
