// 拖入或选择的文件夹：逐层读出文件（跳过 node_modules 与 .git），按相对路径排好
export interface RelFile { rel: string; file: File }

const fileOf = (entry: FileSystemFileEntry) => new Promise<File | null>(resolve => entry.file(resolve, () => resolve(null)));
/** 目录里的全部条目：readEntries 一次只给一批，读到空批为止 */
function readDir(reader: FileSystemDirectoryReader) {
  const { promise, resolve } = Promise.withResolvers<FileSystemEntry[]>();
  const entries: FileSystemEntry[] = [];
  const next = () => reader.readEntries(batch => { if (!batch.length) return resolve(entries); entries.push(...batch); next(); }, () => resolve(entries));
  next();
  return promise;
}
async function walk(entry: FileSystemEntry, base: string, out: RelFile[]) {
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry);
    if (file) out.push({ rel: base + entry.name, file });
    return;
  }
  if (/^(node_modules|\.git)$/.test(entry.name)) return;
  for (const child of await readDir((entry as FileSystemDirectoryEntry).createReader())) await walk(child, base + entry.name + '/', out);
}

/** 拖放的内容：只拖入一个文件夹时取其中的文件（路径不含文件夹名），否则取拖入的各项 */
export async function droppedFiles(transfer: DataTransfer): Promise<{ files: RelFile[]; name: string; single: boolean } | null> {
  const entries = [...transfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return null;
  const files: RelFile[] = [];
  if (entries.length === 1 && entries[0].isDirectory) {
    for (const child of await readDir((entries[0] as FileSystemDirectoryEntry).createReader())) await walk(child, '', files);
    return { files, name: entries[0].name, single: false };
  }
  for (const entry of entries) await walk(entry, '', files);
  return { files, name: '', single: files.length === 1 };
}

/** <input webkitdirectory> 选出的文件：去掉最外层的文件夹名 */
export function pickedFiles(list: FileList): { files: RelFile[]; name: string } | null {
  const files = [...list];
  if (!files.length) return null;
  const stripTop = (path: string) => path.slice(path.indexOf('/') + 1);
  return { files: files.map(file => ({ rel: stripTop(file.webkitRelativePath), file })), name: files[0].webkitRelativePath.split('/')[0] };
}

/** 入口 HTML：层级最浅的那些里优先 index.html */
export function entryOf(rels: string[]): string | null {
  const depth = (rel: string) => rel.split('/').length;
  const isIndex = (rel: string) => /(^|\/)index\.html?$/i.test(rel);
  const htmls = rels.filter(rel => /\.html?$/i.test(rel)).sort((a, b) => depth(a) - depth(b) || Number(isIndex(b)) - Number(isIndex(a)));
  if (!htmls.length) return null;
  const top = htmls.filter(rel => depth(rel) === depth(htmls[0]));
  return top.find(isIndex) || top[0];
}
