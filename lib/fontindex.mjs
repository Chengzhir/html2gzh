// 本机字体索引：扫描系统与用户字体目录，按规范化的名字找到具体字形面（TTC 成员、可变字体命名实例），再用 fontkit 取轮廓
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '..', '.cache', 'font-index.json');
const HOME = os.homedir();
const DIRS = process.platform === 'win32'
  ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')]
  : process.platform === 'darwin' ? ['/System/Library/Fonts', '/Library/Fonts', path.join(HOME, 'Library', 'Fonts')]
    : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(HOME, '.local', 'share', 'fonts'), path.join(HOME, '.fonts')];
const FONT_EXT = /\.(ttf|otf|ttc|otc)$/i;
const COLOR_TABLES = ['COLR', 'CBDT', 'sbix', 'SVG '];

/** Chrome 报的 postScriptName（如 Noto-Sans-CJK-SC-Black）和字体里的名字（NotoSansCJKsc-Black）规范化后相同 */
export const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const rec = (font, key) => { const r = font.name && font.name.records[key]; return r ? r.en || Object.values(r)[0] || '' : ''; };

function listFonts(dir, depth = 0, out = []) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && depth < 4) listFonts(p, depth + 1, out);
    else if (FONT_EXT.test(d.name)) out.push(p);
  }
  return out;
}

function facesOf(font, file, idx) {
  const tables = font.directory.tables;
  const fam = rec(font, 'preferredFamily') || rec(font, 'fontFamily');
  const sub = rec(font, 'preferredSubfamily') || rec(font, 'fontSubfamily');
  const legacy = rec(font, 'fontFamily') + ' ' + rec(font, 'fontSubfamily');
  const os2 = font['OS/2'] || {};
  const sel = os2.fsSelection || {};
  const keys = (...names) => [...new Set(names.flatMap(n => { const k = norm(n); return k ? [k, k.replace(/regular$/, '')] : []; }).filter(Boolean))];
  const fvar = tables.fvar && (tables.gvar || tables.CFF2) ? font.fvar : null;
  const base = { file, idx, upem: font.unitsPerEm, color: COLOR_TABLES.some(t => tables[t]) };
  const out = [{
    ...base, coords: null, vf: !!fvar, ps: font.postscriptName,
    weight: os2.usWeightClass || 400, italic: !!(sel.italic || sel.oblique || font.italicAngle),
    keys: keys(font.postscriptName, rec(font, 'fullName'), fam + ' ' + sub, legacy),
  }];
  // fontkit 的 namedVariations 遇到 nameID 2 的实例（没有自己的名字）会抛错，直接读 fvar
  if (fvar) for (const inst of fvar.instance) {
    const coords = Object.fromEntries(fvar.axis.map((a, i) => [a.axisTag.trim(), inst.coord[i]]));
    const iname = (inst.name && (inst.name.en || Object.values(inst.name)[0])) || sub;
    out.push({
      ...base, coords, vf: true, ps: null,
      weight: coords.wght ?? os2.usWeightClass ?? 400, italic: (coords.ital || 0) > 0 || !!coords.slnt || /italic|oblique/i.test(iname),
      keys: keys(fam + ' ' + iname, rec(font, 'fontFamily') + ' ' + iname),
    });
  }
  return out;
}

let index = null;
/** 名字 → 字形面。首次全量扫描（约 1–2 秒，冷盘更久），之后按文件大小与修改时间增量更新磁盘缓存 */
export function loadIndex() {
  if (index) return index;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { /* 首次运行 */ }
  const next = {};
  let parsed = 0;
  for (const file of DIRS.filter(Boolean).flatMap(d => listFonts(d))) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const c = cache[file];
    if (c && c.size === st.size && c.mtime === st.mtimeMs) { next[file] = c; continue; }
    const faces = [];
    try {
      const top = fontkit.create(fs.readFileSync(file));
      (top.fonts || [top]).forEach((f, i) => faces.push(...facesOf(f, file, top.fonts ? i : -1)));
    } catch { /* fontkit 读不了的字体文件 */ }
    next[file] = { size: st.size, mtime: st.mtimeMs, faces };
    parsed++;
  }
  if (parsed || Object.keys(cache).length !== Object.keys(next).length) {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(next));
  }
  // 同名时：静态字形面 > 可变字体命名实例 > 可变字体默认面。静态与实例画出来一样，但静态的不用插值
  const all = Object.values(next).flatMap(x => x.faces);
  const rank = f => !f.vf ? 0 : f.coords ? 1 : 2;
  index = new Map();
  for (const r of [0, 1, 2]) for (const f of all) if (rank(f) === r) for (const k of f.keys) if (!index.has(k)) index.set(k, f);
  return index;
}

const files = new Map(), opened = new Map();
const faceKey = f => `${f.file}#${f.idx}#${f.coords ? JSON.stringify(f.coords) : ''}`;
function openFace(face) {
  const key = faceKey(face);
  let font = opened.get(key);
  if (font) return font;
  let top = files.get(face.file);
  if (top) files.delete(face.file);
  else top = fontkit.create(fs.readFileSync(face.file));
  files.set(face.file, top);
  // 中文字体文件动辄几十 MB，只留最近用过的十几个
  if (files.size > 12) {
    const old = files.keys().next().value;
    files.delete(old);
    for (const k of [...opened.keys()]) if (k.startsWith(old + '#')) opened.delete(k);
  }
  font = face.idx >= 0 ? top.fonts[face.idx] : top;
  if (face.coords) font = font.getVariation(face.coords);
  // fontkit 按编号缓存字形对象，复合字形取部件时建的对象不带码位（分号的轮廓会带出逗号），之后排逗号拿到的还是它，
  // 字形就对不回字。码位为空时补上（顺带修正是否组合符号的判断）

  const getGlyph = font.getGlyph.bind(font);
  font.getGlyph = (id, chars = []) => {
    const g = getGlyph(id, chars);
    if (g && chars.length && !g.codePoints.length) {
      g.codePoints = [...chars];
      g.isMark = chars.every(c => /^\p{M}$/u.test(String.fromCodePoint(c)));
      g.isLigature = chars.length > 1;
    }
    return g;
  };
  opened.set(key, font);
  return font;
}
export { faceKey };

/** CSS font-feature-settings → fontkit 的 { tag: bool } */
export function parseFeatures(css) {
  const out = {};
  if (!css || css === 'normal') return out;
  for (const m of String(css).matchAll(/["']([A-Za-z0-9 ]{4})["']\s*(on|off|\d+)?/g)) out[m[1]] = !(m[2] === 'off' || m[2] === '0');
  return out;
}

const fmtN = n => String(n);
/**
 * fontkit 路径（字体单位，y 向上）→ 紧凑的相对坐标 SVG 路径。坐标先取整再求差，不累积误差。
 * 返回 { m: [x, y], d }：首个 moveto 单独给出，客户端把多个字的路径拼进同一个 <path> 时按字位加偏移。
 */
function compact(path) {
  let x = 0, y = 0, sx = 0, sy = 0, first = null, d = '', last = '';
  const R = Math.round;
  const num = (...ns) => ns.map((n, i) => (i && n >= 0 ? ' ' : '') + fmtN(n)).join('');
  const emit = (op, ...ns) => {
    const body = num(...ns);
    if (op === last && op !== 'm') d += (ns[0] >= 0 ? ' ' : '') + body;
    else d += op + body;
    last = op === 'm' ? 'l' : op;
  };
  for (const c of path.commands) {
    const a = c.args.map(R);
    if (c.command === 'moveTo') {
      // 首点由客户端写成绝对的 M（M 后面的隐式坐标对是绝对 L），所以紧跟的命令必须显式写字母
      if (!first) { first = [a[0], a[1]]; last = ''; } else emit('m', a[0] - x, a[1] - y);
      x = sx = a[0]; y = sy = a[1];
    } else if (c.command === 'lineTo') {
      const dx = a[0] - x, dy = a[1] - y;
      if (!dx && !dy) continue;
      if (!dy) emit('h', dx); else if (!dx) emit('v', dy); else emit('l', dx, dy);
      x = a[0]; y = a[1];
    } else if (c.command === 'quadraticCurveTo') {
      emit('q', a[0] - x, a[1] - y, a[2] - x, a[3] - y); x = a[2]; y = a[3];
    } else if (c.command === 'bezierCurveTo') {
      emit('c', a[0] - x, a[1] - y, a[2] - x, a[3] - y, a[4] - x, a[5] - y); x = a[4]; y = a[5];
    } else if (c.command === 'closePath') {
      d += 'z'; last = 'z'; x = sx; y = sy;
    }
  }
  return first ? { m: first, d } : null;
}

const pathCache = new Map();
/**
 * 一个字（字素簇）在某个字形面下的排版结果：[{ id, x, y }] 加总步进。
 * x/y 是字形原点相对笔位的偏移（字体单位，含 GPOS 定位）；id 指向 pathOf 的缓存键。
 */
export function shape(face, text, features, lang) {
  const font = openFace(face);
  // fontkit 会往传入的特性对象里补默认特性，每次给一份新的
  const run = font.layout(text, { ...features }, undefined, lang);
  const fk = faceKey(face);
  const glyphs = [];
  let pen = 0;
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i];
    const id = fk + '|' + g.id;
    if (!pathCache.has(id)) pathCache.set(id, compact(g.path));
    if (pathCache.get(id)) glyphs.push({ id, x: pen + p.xOffset, y: p.yOffset });
    pen += p.xAdvance;
  });
  return { glyphs, adv: pen, notdef: run.glyphs.some(g => g.id === 0) };
}
export const pathOf = id => pathCache.get(id);

// fontkit 把这些码位换成零宽的空格字形（hideDefaultIgnorables）
const IGNORABLE = /^[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]$/u;
/**
 * 一串字素整体排版（连字、上下文变体只在整词里出现），再把字形分回字素：每个字形归它首个码位所在的字素，
 * 连字跨了几个字素就并成一簇，簇里的字形坐标相对簇首字素的笔位，簇首拿全部字形和步进、其余为空。
 * 码位对不上（重排、删字等）返回 null。count 是排出的字形总数（含空格类无轮廓字形），与 Chrome 报的字形数对照
 */
export function shapeClusters(face, graphemes, features, lang) {
  const font = openFace(face);
  const owner = [], cps = [];
  graphemes.forEach((g, i) => { for (const ch of g) { owner.push(i); cps.push(ch.codePointAt(0)); } });
  const run = font.layout(graphemes.join(''), { ...features }, undefined, lang);
  const fk = faceKey(face);
  const spans = [];
  let at = 0, pen = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i], p = run.positions[i];
    let take = g.codePoints || [];
    // 被换成空格字形的默认可忽略字符
    if (take.length === 1 && take[0] === 0x20 && at < cps.length && cps[at] !== 0x20 && IGNORABLE.test(String.fromCodePoint(cps[at]))) take = [cps[at]];
    let from, to;
    if (!take.length) {
      // 多重替换拆出来的后续字形不带码位，跟着前一个字形
      if (!spans.length) return null;
      ({ from, to } = spans[spans.length - 1]);
    } else {
      for (let k = 0; k < take.length; k++) if (cps[at + k] !== take[k]) return null;
      from = owner[at]; to = owner[at + take.length - 1]; at += take.length;
    }
    const id = fk + '|' + g.id;
    if (!pathCache.has(id)) pathCache.set(id, compact(g.path));
    spans.push({ from, to, id, x: pen + p.xOffset, y: p.yOffset, pen, adv: p.xAdvance });
    pen += p.xAdvance;
  }
  if (at !== cps.length) return null;
  const out = graphemes.map(() => ({ glyphs: [], adv: 0 }));
  for (let i = 0; i < spans.length;) {
    let j = i, end = spans[i].to;
    while (j + 1 < spans.length && spans[j + 1].from <= end) end = Math.max(end, spans[++j].to);
    const head = spans[i].from, base = spans[i].pen;
    if (out[head].glyphs.length || out[head].adv) return null;
    for (let k = i; k <= j; k++) {
      const s = spans[k];
      out[head].adv += s.adv;
      if (pathCache.get(s.id)) out[head].glyphs.push({ id: s.id, x: s.x - base, y: s.y });
    }
    i = j + 1;
  }
  return { graphemes: out, count: run.glyphs.length };
}
