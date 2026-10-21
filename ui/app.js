import { convert } from './convert/index.js';
import { DEFAULT_OPTS, parseRules } from './convert/fonts.js';
import { WHY_TEXT } from './convert/outline.js';
import { setTip } from './tip.js';
import { readerDoc, darkHtml, SIDE } from './phone.js';
import { readerImages } from './convert/reader.js';
import { imageScales } from './convert/images.js';

const $ = id => document.getElementById(id);
// Windows 上用 serve.cmd 启动；别的系统在终端里跑 node server.mjs
const WIN = /Windows/.test(navigator.userAgent);
const SERVICE = WIN ? ' serve.cmd 窗口' : '运行 server.mjs 的终端';
if (!WIN) $('dropCmd').hidden = true;
const ORIGIN = location.origin;
const state = {
  src: null,        // { kind:'path', file, rev, mtime } | { kind:'files', name, map:Map(rel→File), entry }
  result: null, error: '', server: null, busy: false, copiedAt: null, seenRev: 0,
};
const uploaded = new WeakMap();   // File → asset id

/* ---------- 路径工具 ---------- */
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
/** 把 ref 接到 base 目录下并规范化；越出根目录时保留前导 ..（路径模式由服务端判定） */
function joinRel(base, ref) {
  const out = [];
  for (const seg of (base + ref).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length && out[out.length - 1] !== '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}
const isLocalRef = r => r && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r.trim());
// Windows 上写出来的 HTML 常有 images\a.png 这种反斜杠路径，浏览器会当成 /，这里也一样
const cleanRef = r => { const s = r.trim().split(/[?#]/)[0].replace(/\\/g, '/'); try { return decodeURIComponent(s); } catch { return s; } };
const EXT_OF_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' };

async function api(path, body, raw) {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', body: raw ? body : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `请求失败 ${r.status}`);
  return j;
}

/** 把一批本地相对路径（相对文章根）换成 /a/<id>；缺失返回 null */
async function resolveRefs(rels) {
  const out = new Map();
  if (!rels.length) return out;
  if (state.src.kind === 'path') {
    const j = await api('/api/assets', { refs: rels });
    for (const r of rels) out.set(r, j[r] || null);
    return out;
  }
  for (const r of rels) {
    const f = state.src.map.get(r);
    if (!f) { out.set(r, null); continue; }
    let id = uploaded.get(f);
    if (!id) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      try { id = (await api(`/api/blob?ext=${encodeURIComponent(ext)}&name=${encodeURIComponent(f.name)}`, f, true)).id; uploaded.set(f, id); }
      catch { id = null; }
    }
    out.set(r, id);
  }
  return out;
}
async function uploadDataUri(uri) {
  const blob = await (await fetch(uri)).blob();
  const ext = EXT_OF_MIME[blob.type];
  if (!ext) return null;
  return (await api(`/api/blob?ext=${ext}&name=inline.${ext}`, blob, true)).id;
}
async function readLocalText(rel) {
  if (state.src.kind === 'files') { const f = state.src.map.get(rel); return f ? f.text() : null; }
  const j = await api('/api/assets', { refs: [rel] });
  if (!j[rel]) return null;
  return (await fetch('/a/' + j[rel])).text();
}

/**
 * 读文章、把所有本地资源换成本机地址：<img>、svg <image>、style 属性与 <style> 里的 url()、外链样式表（内联进来）。
 * 返回 { html, report }。
 */
async function prepare(html, entryRel) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseDir = dirOf(entryRel);
  // missing 只放 <img> 的图（粘贴后变错误卡片、草稿存不了）；样式表、CSS 与 svg <image> 引用的文件缺了只影响效果。
  // names：图片 id → 文章文件夹里的相对路径，提示图片过大、下载超时时用
  const report = { missing: [], sheets: [], refs: [], remote: 0, dataUri: 0, badData: 0, local: 0, names: new Map() };

  // 外链样式表与 @import 读进来，内联成 <style>，各自记下自己的基准（本地是相对文章根的目录，站外是绝对地址）。
  // 站外的要对方允许跨域读取（Google Fonts 等字体服务都允许），读不了的列进检查结果
  const absUrl = s => /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//');
  const loadSheet = async (href, base) => {
    href = href.trim();
    if (absUrl(href) || absUrl(base)) {
      let u;
      try { u = new URL(href, absUrl(base) ? base : location.href); } catch { return null; }
      if (!/^https?:$/.test(u.protocol)) return null;
      const r = await fetch(u.href, { mode: 'cors', credentials: 'omit' }).catch(() => null);
      return r && r.ok ? { text: await r.text(), base: r.url || u.href } : null;
    }
    const rel = joinRel(base, cleanRef(href));
    const text = await readLocalText(rel).catch(() => null);
    return text == null ? null : { text, base: dirOf(rel) };
  };
  const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
  /** 样式表文本 → 依次排列的若干段 { text, base, media, supports }：@import 就地展开（最多四层），条件跟着它那一段 */
  const expand = async (text, base, media, depth = 0) => {
    const out = [];
    let rest = text;
    if (depth < 4) {
      for (const m of [...text.matchAll(IMPORT_RE)]) {
        const cond = m[5].trim().replace(/\blayer(\([^)]*\))?/i, '').trim();
        const sup = cond.match(/^supports\(((?:[^()]|\([^()]*\))*)\)\s*/i);
        const mq = (sup ? cond.slice(sup[0].length) : cond).trim();
        const sub = await loadSheet(m[2] || m[4], base);
        if (!sub) { report.sheets.push(m[2] || m[4]); continue; }
        for (const c of await expand(sub.text, sub.base, mq || media, depth + 1)) out.push(sup ? { ...c, supports: sup[1] } : c);
      }
      rest = text.replace(IMPORT_RE, '');
    }
    out.push({ text: rest, base, media });
    return out;
  };
  const styleEls = chunks => chunks.map(c => {
    const st = doc.createElement('style');
    st.textContent = c.supports ? `@supports (${c.supports}){${c.text}}` : c.text;
    st.dataset.base = c.base;
    if (c.media) st.media = c.media;
    return st;
  });
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
    const href = link.getAttribute('href'), media = link.getAttribute('media') || '';
    const sheet = await loadSheet(href, baseDir);
    if (!sheet) { report.sheets.push(href); link.remove(); continue; }
    link.replaceWith(...styleEls(await expand(sheet.text, sheet.base, media === 'all' ? '' : media)));
  }
  for (const st of [...doc.querySelectorAll('style')]) {
    if (st.dataset.base != null || !/@import/i.test(st.textContent)) continue;
    st.replaceWith(...styleEls(await expand(st.textContent, baseDir, st.media || '')));
  }

  // 第一遍：收集。@font-face 里的地址是字体文件，不是图片：本地的登记成文件，data: 与站外的原样保留，都不计入图片数
  const wanted = new Set();
  const datas = new Set();
  const note = (ref, base) => {
    if (!ref) return;
    ref = ref.trim();
    if (/^data:/i.test(ref)) { datas.add(ref); return; }
    if (isLocalRef(ref) && !absUrl(base)) wanted.add(joinRel(base, cleanRef(ref)));
  };
  const noteFont = (ref, base) => { if (isLocalRef(ref) && !absUrl(base)) wanted.add(joinRel(base, cleanRef(ref.trim()))); };
  const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const FACE_RE = /@font-face\s*\{[^}]*\}/gi;
  /** 样式文本按 @font-face 块切开：[[文本, 是不是 @font-face], …] */
  const segments = css => {
    const out = [];
    let at = 0;
    for (const m of css.matchAll(FACE_RE)) { out.push([css.slice(at, m.index), false], [m[0], true]); at = m.index + m[0].length; }
    out.push([css.slice(at), false]);
    return out;
  };
  doc.querySelectorAll('img[src]').forEach(e => note(e.getAttribute('src'), baseDir));
  doc.querySelectorAll('image').forEach(e => note(e.getAttribute('href') || e.getAttribute('xlink:href'), baseDir));
  doc.querySelectorAll('[style]').forEach(e => { for (const m of e.getAttribute('style').matchAll(URL_RE)) note(m[2], baseDir); });
  doc.querySelectorAll('style').forEach(st => {
    const base = st.dataset.base ?? baseDir;
    for (const [text, face] of segments(st.textContent)) for (const m of text.matchAll(URL_RE)) (face ? noteFont : note)(m[2], base);
  });

  const ids = await resolveRefs([...wanted]);
  const dataIds = new Map();
  for (const d of datas) dataIds.set(d, await uploadDataUri(d).catch(() => null));

  // 第二遍：改写。站外样式表里的相对地址按样式表自己的地址补全
  const swap = (ref, base, lost = report.missing) => {
    const t = (ref || '').trim();
    if (/^data:/i.test(t)) { const id = dataIds.get(t); if (id) { report.dataUri++; report.names.set(id, '内嵌图片（data:）'); return ORIGIN + '/a/' + id; } report.badData++; return t; }
    if (isLocalRef(t) && absUrl(base)) { try { report.remote++; return new URL(t, base).href; } catch { return t; } }
    if (/^(https?:)?\/\//i.test(t)) { report.remote++; return t; }
    if (!isLocalRef(t)) return t;
    const rel = joinRel(base, cleanRef(t));
    const id = ids.get(rel);
    if (!id) { lost.push(rel); return t; }
    report.local++;
    report.names.set(id, rel);
    return ORIGIN + '/a/' + id;
  };
  const swapFont = (ref, base) => {
    const t = (ref || '').trim();
    if (!isLocalRef(t)) return t;
    if (absUrl(base)) { try { return new URL(t, base).href; } catch { return t; } }
    const rel = joinRel(base, cleanRef(t)), id = ids.get(rel);
    if (!id) { report.refs.push(rel); return t; }
    return ORIGIN + '/a/' + id;
  };
  const swapCss = (css, base) => segments(css).map(([text, face]) => text.replace(URL_RE, (m, q, u) => `url("${face ? swapFont(u, base) : swap(u, base, report.refs)}")`)).join('');
  doc.querySelectorAll('img').forEach(e => {
    e.removeAttribute('srcset'); e.removeAttribute('loading');
    if (e.hasAttribute('src')) e.setAttribute('src', swap(e.getAttribute('src'), baseDir));
  });
  doc.querySelectorAll('image').forEach(e => {
    for (const a of ['href', 'xlink:href']) if (e.hasAttribute(a)) e.setAttribute(a, swap(e.getAttribute(a), baseDir, report.refs));
  });
  doc.querySelectorAll('[style]').forEach(e => e.setAttribute('style', swapCss(e.getAttribute('style'), baseDir)));
  // 打标记：转换时只认文章自己的样式表，浏览器扩展往 iframe 里注入的样式不算
  doc.querySelectorAll('style').forEach(st => { st.textContent = swapCss(st.textContent, st.dataset.base ?? baseDir); st.removeAttribute('data-base'); st.setAttribute('data-wxc-author', ''); });
  doc.querySelectorAll('script').forEach(e => e.remove());
  return { html: '<!DOCTYPE html>' + doc.documentElement.outerHTML, report };
}
/* ---------- 提示 ---------- */
// 浮在预览上方，不占位置。all：两栏都受影响（转换）；reader：只影响阅读页（深色模式）。
// 进度提示延迟一会儿才出现，很快结束的操作不闪一下；错误立即显示，点 × 关闭。还没有预览时写在空白区里
const NOTICE_DELAY = 300;
const notices = { all: { el: $('toastAll'), dim: $('panes'), timer: 0 }, reader: { el: $('toastReader'), dim: $('screen'), timer: 0 } };
function notice(scope, text, kind = 'busy') {
  const n = notices[scope];
  clearTimeout(n.timer);
  if (scope === 'all' && $('panes').hidden) {
    $('emptyIdle').hidden = !!text;
    const m = $('emptyMsg');
    m.hidden = !text; m.textContent = text || ''; m.className = kind === 'err' ? 'err' : '';
    return;
  }
  const show = () => {
    n.el.className = `toast toast-${scope}` + (text ? ` on ${kind}` : '');
    n.el.querySelector('.toast-text').textContent = text || '';
    n.el.querySelector('.toast-x').hidden = !text || kind !== 'err';
    n.dim.classList.toggle('dim', !!text && kind === 'busy');
  };
  if (text && kind === 'busy') n.timer = setTimeout(show, NOTICE_DELAY); else show();
}
for (const scope of Object.keys(notices)) notices[scope].el.querySelector('.toast-x').onclick = () => notice(scope, '');
/** 文章卡片里的一行提示：打开失败、拖入的内容不对等 */
function srcNote(text, kind = '') {
  const n = $('srcNote');
  n.hidden = !text; n.textContent = text || ''; n.className = 'note small' + (kind ? ' ' + kind : '');
}

/* ---------- 载入与转换 ---------- */
const width = () => +$('width').value;

/* ---------- 字体设置 ---------- */
// 只存和默认值不同的项：以后默认规则更新，没改过的人自动用上新的
const OPTS_KEY = 'wxc.opts';
const sameType = (a, b) => Array.isArray(b) ? Array.isArray(a) && a.every(x => typeof x === 'string') : typeof a === typeof b;
function loadOpts() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') || {}; } catch { /* 坏数据当没存 */ }
  const o = { ...DEFAULT_OPTS };
  for (const k of Object.keys(DEFAULT_OPTS)) if (k in saved && sameType(saved[k], DEFAULT_OPTS[k])) o[k] = saved[k];
  return o;
}
let opts = loadOpts();
let rerunTimer = 0;
/** how：'now' 立刻重新转换；'soon' 停手 600ms 后再转（连点几个勾选框只转一次）；'none' 不用转 */
function saveOpts(patch, how = 'now') {
  opts = { ...opts, ...patch };
  const diff = Object.fromEntries(Object.entries(opts).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULT_OPTS[k])));
  localStorage.setItem(OPTS_KEY, JSON.stringify(diff));
  renderOpts();
  if (how === 'none') return;
  clearTimeout(rerunTimer);
  if (how === 'soon') rerunTimer = setTimeout(rerun, 600); else rerun();
}
function renderOpts() {
  if (document.activeElement !== $('svgMin')) $('svgMin').value = opts.svgMin;
  $('svgCopy').checked = opts.svgCopy;
  $('noWrap').checked = opts.noWrap;
  if (document.activeElement !== $('rules')) $('rules').value = opts.rules;
  const { rules, bad } = parseRules(opts.rules);
  $('rulesNote').textContent = (opts.rules === DEFAULT_OPTS.rules ? '默认规则' : '已修改') + `，共 ${rules.length} 条` + (bad.length ? `；第 ${bad.join('、')} 行格式有误，已跳过` : '');
  renderFaces();
}

/* 字体表：每套字（字体+字重+斜体）一组，组里每个字号一行。样例用原字体画。
   表格只在行的集合或内容变了时重建（免得抢走键盘焦点），勾选与状态每次就地更新 */
const fontsOf = () => state.result ? state.result.fonts : [];
function faceGroups(fonts) {
  const m = new Map();
  for (const f of fonts) { if (!m.has(f.face)) m.set(f.face, []); m.get(f.face).push(f); }
  const gs = [...m.values()].map(rows => rows.sort((a, b) => b.size - a.size));
  return gs.sort((a, b) => b[0].size - a[0].size);
}
const faceName = f => `${f.family} ${f.weight}${f.italic ? ' 斜体' : ''}`;
const fmtPx = n => String(Math.round(n * 2) / 2);
let faceSig = '';
function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function tipButton(cls, text, tip) {
  const b = elem('button', 'tipbtn ' + cls, text);
  b.type = 'button';
  setTip(b, tip);
  return b;
}
function checkbox(scope, label) {
  const c = elem('input');
  c.type = 'checkbox'; c.dataset.scope = scope;
  c.setAttribute('aria-label', label);
  return c;
}
/** 组标题下的一行：不转路径时手机上的备用字体；悬停看完整的字体栈 */
function phoneLine(f) {
  const p = elem('div', 'mob');
  const { names, stack, thin } = f.phone;
  const tip = (names.length ? '' : '没有匹配的备用字体规则，手机上按下列字体栈显示。\n') + `手机上的 font-family（按顺序使用第一个已安装的字体）：\n${stack}`;
  p.append(tipButton('', '备用字体', tip), '：' + (names.length ? names.slice(0, 2).join('、') + (names.length > 2 ? ' 等' : '') : '无'));
  if (thin) p.append(tipButton('tag', '偏细', `iPhone 上的 PingFang SC 最粗为 600（Semibold），比原稿的 ${f.weight} 细。如需保留原稿的粗细，请勾选这一组的行，转为 SVG 路径。`));
  if (f.web) p.append(tipButton('tag', '网页字体', `原稿通过 @font-face 引用的字体（${f.web}）。公众号正文无法加载网页字体，保留为文字时显示为备用字体或手机的默认字体。转为 SVG 路径时，字形取自原稿引用的字体文件。`));
  return p;
}
function renderFaces() {
  const box = $('faceList');
  const fonts = fontsOf();
  if (!fonts.length) { faceSig = ''; box.innerHTML = '<p class="muted small">载入文章后列出。</p>'; $('pickBig').disabled = true; return; }
  $('pickBig').disabled = false;
  const sig = JSON.stringify(fonts.map(f => [f.key, f.chars, f.sample, f.web, f.phone]));
  if (sig !== faceSig) {
    faceSig = sig;
    const t = elem('table');
    const head = elem('thead'), hr = elem('tr');
    const all = elem('th'); all.scope = 'col'; all.appendChild(checkbox('all', '全选'));
    hr.append(all, ...['字号', '样例', '字数', '状态'].map(s => { const th = elem('th', null, s); th.scope = 'col'; return th; }));
    head.appendChild(hr); t.appendChild(head);
    for (const g of faceGroups(fonts)) {
      const tb = elem('tbody'), gr = elem('tr', 'group');
      const gc = elem('td'); gc.appendChild(checkbox('face:' + g[0].face, faceName(g[0]) + ' 全部'));
      const gh = elem('th'); gh.scope = 'rowgroup'; gh.colSpan = 4;
      const name = elem('div', 'gname');
      name.append(elem('b', null, faceName(g[0])), elem('span', 'muted', `${g.reduce((n, f) => n + f.chars, 0)} 字`));
      gh.append(name, phoneLine(g[0]));
      gr.append(gc, gh); tb.appendChild(gr);
      for (const f of g) {
        const tr = elem('tr'); tr.dataset.key = f.key;
        const c = elem('td'); c.appendChild(checkbox('row', `${faceName(f)} ${fmtPx(f.size)}px`));
        const sm = elem('td', 'sample', f.sample);
        for (const [k, v] of [['font-family', f.stack], ['font-weight', f.weight], ['font-style', f.italic ? 'italic' : 'normal'], ['font-stretch', f.stretch]]) sm.style.setProperty(k, v);
        tr.append(c, elem('td', 'num', fmtPx(f.size)), sm, elem('td', 'num', String(f.chars)), elem('td', 'st'));
        tb.appendChild(tr);
      }
      t.appendChild(tb);
    }
    box.replaceChildren(t);
  }
  syncFaces();
}
/** 勾选（含组与全选的三态）、状态列、过期标记 */
function syncFaces() {
  const box = $('faceList'), t = box.querySelector('table');
  if (!t) return;
  const fonts = fontsOf(), byKey = new Map(fonts.map(f => [f.key, f]));
  const on = new Set(opts.paths);
  const tri = (c, rows) => {
    const n = rows.filter(f => on.has(f.key)).length;
    c.checked = !!rows.length && n === rows.length; c.indeterminate = n > 0 && n < rows.length; c.disabled = !rows.length;
  };
  for (const c of t.querySelectorAll('input[data-scope]')) {
    const s = c.dataset.scope;
    if (s === 'all') tri(c, fonts);
    else if (s.startsWith('face:')) tri(c, fonts.filter(f => f.face === s.slice(5)));
  }
  const ran = new Set(state.result.paths);
  for (const tr of t.querySelectorAll('tr[data-key]')) {
    const f = byKey.get(tr.dataset.key), c = tr.querySelector('input');
    c.checked = on.has(f.key);
    tr.classList.toggle('on', c.checked);
    statusCell(tr.querySelector('.st'), f, ran.has(f.key));
  }
  const ranStr = JSON.stringify([...ran].filter(k => byKey.has(k)).sort()), nowStr = JSON.stringify(opts.paths.filter(k => byKey.has(k)).sort());
  box.classList.toggle('stale', state.busy || ranStr !== nowStr);
}
/** 状态列按上一次转换的结果写：picked 是那次转换时这一行勾没勾 */
function statusCell(td, f, picked) {
  let text = '', tip = '', cls = '';
  const left = f.chars - f.done;
  const why = Object.entries(f.why).filter(([, n]) => n > 0).map(([k, n]) => `${n} 字：${WHY_TEXT[k] || k}`).join('\n');
  const along = '这一行没有勾选，但所在段落中的大部分文字属于已勾选的行，因此随段落一起转为 SVG 路径（同一段落的文字全部转为 SVG 路径，或全部保留为文字）。';
  if (f.done && !left) { text = '已转为路径'; cls = 'ok'; tip = picked ? '' : along; }
  else if (f.done) { text = '部分转为路径'; cls = 'part'; tip = `${f.done} 字已转为 SVG 路径，其余 ${left} 字保留为文字。` + (picked ? '原因：\n' + why : '\n' + along); }
  else if (picked) { text = '保留为文字'; cls = 'no'; tip = '未能转为 SVG 路径，原因：\n' + why; }
  const want = tip ? 'BUTTON' : 'SPAN';
  let s = td.firstElementChild;
  if (!s || s.tagName !== want) { s = want === 'BUTTON' ? tipButton('', '', '') : elem('span'); td.replaceChildren(s); }
  s.textContent = text;
  s.className = (tip ? 'tipbtn ' : '') + cls;
  if (tip) setTip(s, tip);
}

$('faceList').addEventListener('change', e => {
  const c = e.target;
  if (!(c instanceof HTMLInputElement) || !c.dataset.scope) return;
  const fonts = fontsOf();
  const s = c.dataset.scope;
  const keys = s === 'all' ? fonts.map(f => f.key) : s.startsWith('face:') ? fonts.filter(f => f.face === s.slice(5)).map(f => f.key) : [c.closest('tr').dataset.key];
  const set = new Set(opts.paths);
  for (const k of keys) { if (c.checked) set.add(k); else set.delete(k); }
  saveOpts({ paths: [...set] }, 'soon');
});
$('pickBig').onclick = () => {
  const fonts = fontsOf();
  const set = new Set(opts.paths);
  for (const f of fonts) { if (f.size >= opts.svgMin - 0.01) set.add(f.key); else set.delete(f.key); }
  saveOpts({ paths: [...set] });
};
$('svgMin').oninput = () => { const v = parseFloat($('svgMin').value); if (v > 0 && v <= 400) saveOpts({ svgMin: v }, 'none'); };
$('svgMin').onblur = () => renderOpts();
$('svgCopy').onchange = () => saveOpts({ svgCopy: $('svgCopy').checked });
$('noWrap').onchange = () => saveOpts({ noWrap: $('noWrap').checked });
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
$('rules').oninput = debounce(() => saveOpts({ rules: $('rules').value }), 700);
$('rulesReset').onclick = () => { $('rules').value = DEFAULT_OPTS.rules; saveOpts({ rules: DEFAULT_OPTS.rules }); };
renderOpts();

const glyphs = body => api('/api/glyphs', body);
/** SVG 里依赖 id 的部分画成的位图：登记到图床口，返回地址（复制时和其他图片一起换成取图地址） */
const raster = async uri => { const id = await uploadDataUri(uri); if (!id) throw new Error('位图登记失败'); return ORIGIN + '/a/' + id; };
/** 网页字体文件 → 本机服务里的文件 id。本地文件已经登记过；站外的、data: 的下载下来按文件头认格式再登记。按地址缓存 */
const fontIds = new Map();
const FONT_MAGIC = [['wOF2', 'woff2'], ['wOFF', 'woff'], ['OTTO', 'otf'], ['true', 'ttf'], ['ttcf', 'ttc'], ['\u0000\u0001\u0000\u0000', 'ttf']];
function fontBytes(url) {
  const local = url.startsWith(ORIGIN + '/a/') ? url.slice(ORIGIN.length + 3) : '';
  if (/^[0-9a-f]{16}\.[a-z0-9]+$/.test(local)) return Promise.resolve(local);
  if (!fontIds.has(url)) {
    const job = (async () => {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const head = String.fromCharCode(...new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
      const hit = FONT_MAGIC.find(([m]) => m === head);
      if (!hit) return null;
      return (await api(`/api/blob?ext=${hit[1]}&name=font.${hit[1]}`, buf, true)).id;
    })().catch(() => null);
    // 失败的不缓存，下次转换再试
    job.then(id => { if (!id) fontIds.delete(url); });
    fontIds.set(url, job);
  }
  return fontIds.get(url);
}
/** 正文里由本机提供的图片 id（去重） */
const imageIdsIn = html => [...new Set([...html.matchAll(/\/a\/([0-9a-f]{16}\.[a-z0-9]+)/g)].map(m => m[1]))];

/* ---------- 大图 ---------- */
// 微信服务器下载一张图最多等约 0.5 秒，超时隔 0.5 秒再试，三次都超时就放弃（2026-10-21 实测）。
// 能否下完取决于这台电脑的上传速度和同时下载的张数，默认 1000 KB 是按常见宽带估的界线，不是平台规定
const SHRINK_KEY = 'wxc.shrink';
const SHRINK_DEFAULT = { on: true, kb: 1000 };
function loadShrink() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SHRINK_KEY) || '{}') || {}; } catch { /* 坏数据当没存 */ }
  return { on: typeof s.on === 'boolean' ? s.on : SHRINK_DEFAULT.on, kb: Number.isInteger(s.kb) && s.kb >= 1 && s.kb <= 20000 ? s.kb : SHRINK_DEFAULT.kb };
}
let shrinkOpts = loadShrink();
const limitBytes = () => shrinkOpts.kb * 1024;
/** 本地图片的大小（字节）：Map<id, size>，取自本机服务的 HEAD 响应 */
async function imageSizes(payload) {
  const sizes = new Map();
  await Promise.all(imageIdsIn(payload).map(async id => {
    const r = await fetch('/a/' + id, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    sizes.set(id, r && r.ok ? +r.headers.get('content-length') : 0);
  }));
  return sizes;
}
/** 超过 limit 字节的本地图片：[{ id, name, size }]，从大到小 */
async function bigImages(payload, names, limit = limitBytes(), sizes = null) {
  sizes = sizes || await imageSizes(payload);
  return [...sizes].filter(([, s]) => s > limit).map(([id, size]) => ({ id, name: names.get(id) || '转换生成的位图', size })).sort((a, b) => b.size - a.size);
}
const kb = n => n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
const SKIP_WHY = { vector: 'SVG 不压缩', animated: '动图不压缩', unreadable: '格式无法读取', noGain: '无法再缩小', fits: '' };
let shrinkSeq = 0;
/**
 * 按当前的上限与开关，从转换结果的原始成品（base）得出最终的成品：比 1080px 宽或超过上限的图片换成处理后的副本
 * （哪些要处理由服务端看图片本身决定）。结果写回 state.result 的 payload、preview 与 report.big / report.shrunk。
 * 返回 false 表示被更新的一次调用取代
 */
async function applyShrink() {
  const r = state.result, seq = ++shrinkSeq;
  if (!r) return false;
  const { base } = r, limit = limitBytes();
  let payload = base.payload, preview = base.preview;
  const sizes = await imageSizes(base.payload);
  const shrunk = [], left = [];
  if (shrinkOpts.on) {
    const ids = imageIdsIn(base.payload), queue = [...ids], results = new Map();
    let n = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        const scale = r.scales.has(id) ? r.scales.get(id) : null;
        results.set(id, await api('/api/shrink', { id, scale, max: limit }).catch(e => ({ error: e.message })));
        if (seq === shrinkSeq) notice('all', `正在处理图片（${++n}/${ids.length}）…`);
      }
    }));
    if (seq !== shrinkSeq) return false;
    for (const id of ids) {
      const res = results.get(id), size = sizes.get(id) || 0, name = r.report.names.get(id) || '转换生成的位图';
      if (res.error || res.skip) { if (size > limit) left.push({ id, name, size, why: res.skip ? SKIP_WHY[res.skip] : res.error }); continue; }
      payload = payload.split('/a/' + id).join('/a/' + res.id);
      preview = preview.split('/a/' + id).join('/a/' + res.id);
      r.report.names.set(res.id, name);
      sizes.set(res.id, res.size);
      shrunk.push({ name, ...res });
      if (res.over) left.push({ id: res.id, name, size: res.size, why: '降到最低一档画质仍超过上限' });
    }
  } else left.push(...await bigImages(base.payload, r.report.names, limit, sizes));
  if (seq !== shrinkSeq) return false;
  Object.assign(r, { payload, preview });
  Object.assign(r.report, { big: left, shrunk, sizes });
  return true;
}
function renderShrinkOpts() {
  $('shrinkOn').checked = shrinkOpts.on;
  if (document.activeElement !== $('shrinkKb')) $('shrinkKb').value = shrinkOpts.kb;
}
let shrinkAgain = false;
/** 改了压缩设置：不用重新转换，只按新设置从原始成品重新得出最终成品。转换进行中时等它结束再做 */
function saveShrink(patch) {
  shrinkOpts = { ...shrinkOpts, ...patch };
  localStorage.setItem(SHRINK_KEY, JSON.stringify(shrinkOpts));
  renderShrinkOpts();
  if (state.busy) shrinkAgain = true; else reshrink();
}
async function reshrink() {
  if (!state.result) return;
  state.copiedAt = null; state.shrinking = true;
  refreshCopy();
  try {
    if (!await applyShrink()) return;
    notice('all', '');
    renderChecks(); renderFetch();
    await renderReader();
  } finally { state.shrinking = false; refreshCopy(); }
}
$('shrinkOn').onchange = () => saveShrink({ on: $('shrinkOn').checked });
$('shrinkKb').onchange = () => { const v = Math.round(+$('shrinkKb').value); if (v >= 1 && v <= 20000) saveShrink({ kb: v }); else renderShrinkOpts(); };
renderShrinkOpts();
let again = false;
/** 转换进行中又改了设置：等这一轮结束再按新设置转一次 */
function rerun() { if (state.busy) again = true; else run(); }

async function run() {
  if (!state.src || state.busy) return;
  state.busy = true; state.copiedAt = null; again = false; shrinkAgain = false;
  $('copy').disabled = true; $('fetchLine').hidden = true;
  srcNote('');
  notice('all', '正在转换…');
  syncFaces();
  const o = opts, w = width();
  try {
    let html, entry, label, where;
    if (state.src.kind === 'path') {
      const j = await api('/api/article');
      html = j.html; entry = j.file.replace(/\\/g, '/').split('/').pop();
      label = entry; where = j.file;
    } else {
      entry = state.src.entry; html = await state.src.map.get(entry).text();
      label = entry.split('/').pop();
      where = (state.src.name ? `拖入的文件夹 ${state.src.name}` : `拖入的 ${state.src.map.size} 个文件`) + '（修改原文件后需重新拖入）';
    }
    showCurrent(label, where);
    const prep = await prepare(html, entry);
    if (o.paths.length) notice('all', '正在转换…（首次转为 SVG 路径时需要读取本机的字体目录，耗时较长）');
    const res = await convert(prep.html, { width: w, frame: $('scratch'), verifyFrame: $('verify'), opts: o, glyphs, raster, fontBytes });
    // 转换结束时 #verify 停在所选宽度的成品上，并已跑过阅读页的图片脚本：在这里量每张图需要的分辨率
    const scales = imageIdsIn(res.payload).length ? await imageScales($('verify').contentDocument, w) : new Map();
    state.result = { ...res, report: prep.report, paths: o.paths, width: w, scales, base: { payload: res.payload, preview: res.preview } };
    await applyShrink();
    state.error = '';
    $('paneA').style.width = w + 'px';
    $('paneA').srcdoc = res.original;
    $('panes').hidden = false; $('empty').hidden = true;
    notice('all', '');
    renderChecks();
    renderFaces();
    await renderReader();
  } catch (e) {
    console.error(e);
    state.error = e.message;
    notice('all', '转换失败：' + e.message, 'err');
  } finally {
    state.busy = false;
    refreshCopy();
    syncFaces();
    if (again) run();
    else if (shrinkAgain) { shrinkAgain = false; reshrink(); }
  }
}

function showCurrent(name, where) {
  $('current').hidden = false;
  $('curName').textContent = name;
  $('curWhere').textContent = where;
}

function renderChecks() {
  const { findings, report, stats } = state.result;
  const items = [...findings];
  const few = a => a.slice(0, 4).join('、') + (a.length > 4 ? ' 等' : '');
  const redo = redoHint();
  const add = (level, title, text, detail = '', ids = []) => ({ level, title, text, detail, ids });
  if (report.missing.length) items.unshift(add('error', '图片缺失', `${report.missing.length} 张图片不存在：${few(report.missing)}`, `粘贴后，这些图片的位置会显示粘贴失败的提示，草稿无法保存。请将图片放入文章文件夹中的对应位置，然后${redo}。`));
  if (report.badData) items.push(add('warn', '内嵌图片', `${report.badData} 张 data: 图片的格式无法识别，没有转为文件`, `公众号不接受 data: 地址的图片，粘贴后这些图片无法显示。请把它们另存为 PNG 或 JPEG 文件放入文章文件夹，在原稿中改为引用文件，然后${redo}。`));
  const big = report.big || [], shrunk = (report.shrunk || []).filter(s => !s.over);
  const limitKb = `${shrinkOpts.kb} KB`;
  if (big.length) {
    const why = '粘贴后，微信服务器从本机下载图片，每次最多等待约 0.5 秒，连续三次超时即放弃。图片较大或这台电脑的上传速度较慢时，这些图片的位置会显示“系统繁忙”，草稿无法保存。';
    const fix = shrinkOpts.on
      ? `超长的图片可以在原稿中拆成几张；动图可以降低尺寸或帧数；无法读取的格式请另存为 JPEG 或 PNG。处理后${redo}。`
      : `勾选“复制到剪贴板”下方的“压缩大图”，即可自动处理这些图片（原文件不变）；也可以自行压缩，然后${redo}。`;
    items.push(add('warn', '图片过大', `${big.length} 张图片超过上限（${limitKb}）：${few(big.map(b => `${b.name}（${kb(b.size)}${b.why ? '，' + b.why : ''}）`))}`,
      why + fix + '通过内网穿透提供图片时，下载速度通常更慢，可以把上限调得更低。'));
  }
  if (shrunk.length) {
    const line = s => `· ${s.name}：${kb(s.srcSize)} → ${kb(s.size)}，` + (s.width === s.srcWidth ? `尺寸不变，${s.how}` : `${s.srcWidth}×${s.srcHeight} → ${s.width}×${s.height}，${s.how}`);
    items.push(add('fixed', '图片压缩', `${shrunk.length} 张图片换成了压缩后的副本`,
      shrunk.slice(0, 8).map(line).join('\n') + (shrunk.length > 8 ? `\n等 ${shrunk.length} 张` : '')
      + '\n读者在微信里看到、保存的图片最宽 1080px；更宽的图片由微信自己缩小、重新压缩，画质较差。因此比 1080px 宽的图片先用 Lanczos 算法缩到 1080px 宽，画质从高到低逐级尝试，直到不超过单张上限；不到 1080px 宽但超过上限的图片，在原尺寸下降低画质。只压缩提供给微信服务器的副本，原文件不变。'));
  }
  if (report.sheets.length) items.push(add('warn', '样式表', `${report.sheets.length} 个样式表无法读取：${few(report.sheets)}`, '可能的原因：本地样式表的文件不存在；站外样式表所在的网站不允许跨域读取，或者无法访问。两侧预览中都没有这些样式表的效果。'));
  if (report.refs.length) items.push(add('warn', '引用的文件', `样式或 SVG 引用的 ${report.refs.length} 个文件不存在：${few(report.refs)}`, `这些文件多为字体与背景图，两侧预览中均未加载。请将文件放入文章文件夹中的对应位置，然后${redo}。`));
  if (report.dataUri) items.push(add('fixed', '内嵌图片', `${report.dataUri} 张 data: 图片转为了文件`, '公众号不接受 data: 地址的图片。这些图片与文章文件夹中的图片一样，通过取图地址提供给微信服务器。'));
  if (report.remote) items.push(add('info', '网络图片', `${report.remote} 张网络图片由微信服务器从原网址下载`, '原网站设有防盗链时，微信服务器无法下载这些图片。遇到这种情况，请把图片下载到文章文件夹中，改为引用本地文件。'));
  if (stats.visualBad.length) items.push(add('warn', '与原稿不一致', `${stats.visualBad.length} 个元素的位置或尺寸与原稿相差超过 1.5px`, '', stats.visualBad));
  else {
    // 排在"其他宽度"那条前面：先说当前宽度一致，再说其他宽度也一致
    const at = items.findIndex(i => i.level === 'info');
    items.splice(at < 0 ? items.length : at, 0, add('info', '比对', `${stats.verified} 个元素的位置、尺寸与原稿一致`, '比对使用这台电脑上的字体。没有转为 SVG 路径的字，在手机上没有原稿字体时显示为备用字体，字形与换行可能与原稿不同。'));
  }
  items.push(add('info', '代码长度', `${stats.chars.toLocaleString()} 个字符`, '包括排版代码，不是正文字数。'));

  const groups = [['error', '必须处理'], ['warn', '需要留意'], ['fixed', '已自动处理'], ['info', '说明']];
  const box = $('checks');
  box.textContent = '';
  const nErr = items.filter(i => i.level === 'error').length, nWarn = items.filter(i => i.level === 'warn').length;
  const sum = elem('p', 'verdict', nErr ? `有 ${nErr} 项必须处理，否则草稿可能无法保存` : nWarn ? `没有必须处理的问题，有 ${nWarn} 项需要留意` : '没有需要处理的问题');
  box.appendChild(sum);
  for (const [lv, name] of groups) {
    const list = items.filter(i => i.level === lv);
    if (!list.length) continue;
    // 已自动处理的不用动手，默认收起
    let host = box;
    if (lv === 'fixed') {
      host = elem('details', 'fixed-group');
      host.appendChild(elem('summary', null, `${name}（${list.length} 项）`));
      box.appendChild(host);
    } else box.appendChild(elem('h3', null, name));
    const ul = elem('ul');
    for (const it of list) {
      const li = elem('li', lv);
      const head = [elem('b', null, it.title), document.createTextNode(it.text)];
      const btn = it.ids.length ? elem('button', null, '在预览中标出') : null;
      if (btn) { btn.type = 'button'; btn.onclick = () => highlight(it.ids); }
      if (it.detail) {
        const d = elem('details'), s = elem('summary');
        s.append(...head);
        d.append(s, elem('p', 'detail', it.detail));
        if (btn) d.appendChild(btn);
        li.appendChild(d);
      } else { li.append(...head); if (btn) li.appendChild(btn); }
      ul.appendChild(li);
    }
    host.appendChild(ul);
  }
}

/** 两边都标出这些元素；滚动原稿那边，阅读页跟着同步滚动 */
function highlight(ids) {
  for (const f of [$('paneA'), $('paneB')]) {
    const d = f.contentDocument;
    if (!d || !d.head) continue;
    let st = d.getElementById('__wxc_hl');
    if (!st) { st = d.createElement('style'); st.id = '__wxc_hl'; d.head.appendChild(st); }
    st.textContent = ids.map(i => `[data-wxc="${i}"]`).join(',') + '{outline:2px solid #e8590c!important;outline-offset:1px}';
  }
  const el = $('paneA').contentDocument && $('paneA').contentDocument.querySelector(`[data-wxc="${ids[0]}"]`);
  if (el) el.scrollIntoView({ block: 'center' });
}

/* ---------- 取图地址 ---------- */
// 和端口映射软件一样分三项：本机端口（取图服务监听的端口），公网地址与公网端口（微信连接的地址）。
// 公网地址留空时自动检测公网 IP；公网端口留空时与本机端口相同（路由器端口转发通常两边一致）
const hostCfg = () => state.server && state.server.host.config;
let hostDirty = false, hostSig = '';
function fillHostForm(c) {
  $('hfPort').value = c.imgPort;
  $('hfHost').value = c.host;
  $('hfPubPort').value = c.port || '';
  $('hfProto').value = c.proto;
  hostDirty = false;
  syncHostForm();
}
/** 自动检测时只能是 http：裸 IP 没有证书。公网端口留空时 http 同本机端口、https 用 443，和服务端 baseOf 一致 */
function syncHostForm() {
  const auto = !$('hfHost').value.trim();
  if (auto) $('hfProto').value = 'http';
  $('hfProto').disabled = auto;
  $('hfPubPort').placeholder = $('hfProto').value === 'https' ? '留空则使用 443' : `留空则与本机端口相同（${$('hfPort').value.trim() || '本机端口'}）`;
}
/** 粘贴的完整地址（https://abc.example.com:8443）拆进协议、地址、端口三格 */
function splitHostInput() {
  const v = $('hfHost').value.trim();
  if (!/^https?:\/\//i.test(v)) return;
  let u;
  try { u = new URL(v); } catch { return; }
  $('hfProto').value = u.protocol.slice(0, -1);
  $('hfHost').value = u.hostname;
  $('hfPubPort').value = u.port || (u.protocol === 'https:' ? '443' : '80');
  syncHostForm();
}
$('hostForm').addEventListener('input', e => {
  hostDirty = true;
  $('hostNote').textContent = '';
  if (e.target === $('hfHost') && e.inputType === 'insertFromPaste') splitHostInput();
  syncHostForm();
});
$('hfHost').addEventListener('change', splitHostInput);
$('hostForm').onsubmit = async e => {
  e.preventDefault();
  splitHostInput();
  const note = $('hostNote'), btn = $('hostForm').querySelector('button[type="submit"]');
  const val = id => $(id).value.trim();
  btn.disabled = true; note.className = 'note'; note.textContent = '正在保存…';
  try {
    const j = await api('/api/host', { imgPort: val('hfPort'), host: val('hfHost'), port: val('hfPubPort'), proto: $('hfProto').value });
    if (state.server) state.server.host = j.host;
    fillHostForm(j.host.config);
    hostSig = JSON.stringify(j.host.config);
    note.className = 'note ok'; note.textContent = '已保存，正在检测';
    renderHost(); refreshCopy();
  } catch (err) { note.className = 'note err'; note.textContent = err.message; }
  finally { btn.disabled = false; }
};
const TAG = { ok: ['ok', '可以访问'], no: ['no', '无法访问'], wait: ['wait', '正在检测'] };
function tag(kind) { const [cls, text] = TAG[kind]; return elem('span', 'tag ' + cls, text); }
// 从本机访问自己的公网地址要靠路由器回环，有的路由器不支持，所以本机检测不通不等于外网不通
const NOT_SURE = '检测结果不一定准确，以粘贴后显示的已下载图片数为准。';
/** 无法访问、没有检测到公网 IP 时的说明：[开头一句, 可能的原因, 结尾一句] */
function hostHelpFor(h, c) {
  if (!h.pick) return h.checking ? null : ['这台电脑可能没有联网，或者无法访问查询 IP 的网站。可以在“公网地址”中直接填写域名或 IP。', [], ''];
  if (h.pick.ok !== false || h.checking) return null;
  if (c.host) return ['可能的原因：', [
    `使用内网穿透时：内网穿透工具没有运行，没有把本机的 ${c.imgPort} 端口映射到这个地址，或者“公网地址”“公网端口”“协议”与内网穿透工具提供的不一致。`,
    `使用端口转发时：路由器没有把公网端口转发到这台电脑的 ${c.imgPort} 端口，或者防火墙阻止了外网的连接。`], NOT_SURE];
  return ['可能的原因：', [
    '没有公网 IP：请改用内网穿透，见“填写说明”。',
    `有公网 IP，但路由器没有把端口转发到这台电脑的 ${c.imgPort} 端口，或者防火墙阻止了外网的连接。`], NOT_SURE];
}
let exitSig = '', helpSig = '';
function renderHelp(help, content) {
  const sig = JSON.stringify(content);
  help.hidden = !content;
  if (sig === helpSig) return;
  helpSig = sig;
  if (!content) { help.replaceChildren(); return; }
  const [lead, items, tail] = content;
  help.replaceChildren(elem('p', null, lead));
  if (items.length) {
    const ul = elem('ul');
    ul.append(...items.map(t => elem('li', null, t)));
    help.appendChild(ul);
  }
  if (tail) help.appendChild(elem('p', 'help-tail', tail));
}
function renderHost() {
  const h = state.server && state.server.host;
  const line = $('hostLine'), help = $('hostHelp');
  if (!h) {
    line.className = 'status err'; line.textContent = `无法连接本机服务，请确认${SERVICE}没有关闭`;
    renderHelp(help, null); $('exitBox').hidden = true;
    return;
  }
  const c = h.config, sig = JSON.stringify(c);
  if (!hostDirty && sig !== hostSig) { hostSig = sig; fillHostForm(c); }
  for (const s of document.querySelectorAll('.guide-port')) s.textContent = c.imgPort;
  const p = h.pick;
  if (!p) {
    line.className = h.checking ? 'status' : 'status err';
    line.textContent = h.checking ? '正在检测公网 IP…' : '没有检测到公网 IP';
  } else {
    const kind = p.ok == null || h.checking && !p.ok ? 'wait' : p.ok ? 'ok' : 'no';
    line.className = 'status ' + (kind === 'ok' ? 'ok' : kind === 'no' ? 'warn' : '');
    line.replaceChildren('当前地址', tag(kind), elem('span', 'url', p.base));
  }
  renderHelp(help, hostHelpFor(h, c));
  $('hostWhen').textContent = h.checking ? '' : h.checkedAt ? `上次检测 ${new Date(h.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}，每 5 分钟自动检测` : '';
  $('recheck').disabled = h.checking;

  // 自动检测到多个公网 IP（多条宽带按连接分流）时列出来；只在内容变化时重画
  const many = !c.host && h.list.length > 1;
  $('exitBox').hidden = !many;
  const es = JSON.stringify([many, h.list.map(x => [x.ip, x.ok, x.stale]), p && p.base]);
  if (!many || es === exitSig) return;
  exitSig = es;
  $('exitSum').textContent = `检测到 ${h.list.length} 个公网 IP`;
  $('exitList').replaceChildren(...h.list.map(x => {
    const li = elem('li');
    li.append(elem('span', 'ip', x.ip), x.stale ? elem('span', 'tag wait', '本轮未检测到') : tag(x.ok ? 'ok' : 'no'));
    if (p && p.base === x.base) li.append(elem('span', 'n', '使用中'));
    return li;
  }));
}

// 实测：粘贴后第一次保存时编辑器还没给图片补上 data-ratio，存下的正文在预览页里图片不加载；保存后编辑器才补上
const SAVE_TWICE = '第一次保存草稿时，编辑器尚未为图片添加尺寸信息，此时保存的正文在后台的“预览”中不显示图片。因此请点击两次“保存为草稿”：提示已保存后，再点击一次。';
const copiedNote = () => localImageIds().length ? '已复制。请在公众号后台的正文中按 Ctrl+V，然后等待下方显示图片已全部下载。'
  : /<img\b/.test(state.result.payload) ? '已复制。请在公众号后台的正文中按 Ctrl+V。' + SAVE_TWICE : '已复制。请在公众号后台的正文中按 Ctrl+V。';
const localImageIds = () => state.result ? imageIdsIn(state.result.payload) : [];
const redoHint = () => state.src && state.src.kind === 'files' ? '重新拖入文件夹' : '点击“重新转换”';
function refreshCopy() {
  const btn = $('copy'), note = $('copyNote');
  if (!state.result) { btn.disabled = true; note.textContent = '载入文章后可复制。'; return; }
  const imgs = localImageIds();
  const pick = picked();
  if (imgs.length && !pick) {
    const checking = state.server && state.server.host.checking;
    btn.disabled = true;
    note.textContent = checking ? `文中有 ${imgs.length} 张本地图片。正在检测公网 IP，检测完成后即可复制。` : `文中有 ${imgs.length} 张本地图片，还没有可用的取图地址，请在下方“取图地址”中填写。`;
    return;
  }
  btn.disabled = state.busy || !!state.shrinking;
  if (state.copiedAt) { note.textContent = copiedNote(); return; }
  const errs = state.result.findings.filter(f => f.level === 'error').length + (state.result.report.missing.length ? 1 : 0);
  note.textContent = (errs ? `有 ${errs} 项必须处理（见下方检查结果），否则草稿可能无法保存。` : '')
    + (imgs.length ? `复制后，在公众号后台的正文中按 Ctrl+V。${imgs.length} 张图片由微信从本机下载，下载完成前请不要关闭${SERVICE}。` : '复制后，在公众号后台的正文中按 Ctrl+V。');
}
const picked = () => state.server && state.server.host.pick;

async function copy() {
  const pick = picked();
  const html = pick ? state.result.payload.split(ORIGIN + '/a/').join(pick.base + '/a/') : state.result.payload;
  const text = $('verify').contentDocument.querySelector('.rich_media_content').innerText;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    const on = e => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text); e.preventDefault(); };
    document.addEventListener('copy', on, { once: true });
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', on);
    if (!ok) { $('copyNote').textContent = '浏览器拒绝写入剪贴板，请再点击一次。'; return; }
  }
  state.copiedAt = { t: Date.now(), base: pick ? pick.base : '' };
  $('copyNote').textContent = copiedNote();
  renderFetch();
}

/**
 * 复制之后这张图的下载情况。微信服务器下载超时会隔约 0.5 秒重试，三次都超时就放弃，
 * 所以只看最后一串（间隔不到 1.5 秒的）请求：三次及以上算失败，一两次且之后 2 秒没有再来算成功
 */
const BURST_GAP = 1500, SETTLE = 2000;
function fetchState(times, since, now) {
  const t = (times || []).filter(x => x >= since);
  if (!t.length) return 'wait';
  let k = t.length - 1;
  while (k > 0 && t[k] - t[k - 1] < BURST_GAP) k--;
  if (t.length - k >= 3) return 'fail';
  return now - t[t.length - 1] < SETTLE ? 'busy' : 'ok';
}
function renderFetch() {
  const el = $('fetchLine');
  const ids = localImageIds();
  if (!state.copiedAt || !ids.length || !state.server) { el.hidden = true; return; }
  const fetches = state.server.fetches || {}, now = Date.now();
  const st = ids.map(id => fetchState(fetches[id], state.copiedAt.t, now));
  const got = st.filter(s => s === 'ok').length, failed = ids.filter((id, i) => st[i] === 'fail');
  // 转换生成的位图没有文件名，同名的合并计数
  const names = new Map();
  for (const id of failed) { const n = state.result.report.names.get(id) || '转换生成的位图'; names.set(n, (names.get(n) || 0) + 1); }
  const listed = [...names].map(([n, k]) => k > 1 ? `${n}（${k} 张）` : n);
  el.hidden = false;
  el.className = 'status ' + (failed.length ? 'err' : got === ids.length ? 'ok' : got ? 'warn' : '');
  if (failed.length) {
    // 超时的图里最小的一张，在这条线路上都没能在时限内下完：上限要比它小。几十 KB 的图都下不完，问题在线路，不在图片大小
    const sizes = state.result.report.sizes || new Map();
    const least = Math.min(...failed.map(id => sizes.get(id) || Infinity));
    const lead = shrinkOpts.on ? '请' : '请勾选“压缩大图”，并';
    const fix = !Number.isFinite(least) ? `${lead}调低单张上限，`
      : least < 50 << 10 ? '这么小的图片也没能在时限内下载完，问题多半在网络：请检查这台电脑的上传速度，使用内网穿透时检查内网穿透服务是否正常，'
      : `${lead}把单张上限调到 ${kb(least)} 以下（这条线路上，这么大的图片没能在时限内下载完），`;
    el.textContent = `微信已下载 ${got}/${ids.length} 张图片。${failed.length} 张图片连续三次下载超时：${listed.slice(0, 4).join('、')}${listed.length > 4 ? ' 等' : ''}。`
      + `编辑器中这些图片的位置会显示“系统繁忙”，草稿无法保存。${fix}然后删除已粘贴的正文，重新复制、粘贴。`;
  } else if (got === ids.length) {
    el.textContent = `微信已下载全部 ${got} 张图片，可以关闭${SERVICE}。${SAVE_TWICE}`;
  } else {
    el.textContent = `微信已下载 ${got}/${ids.length} 张图片（取图地址 ${state.copiedAt.base}）。如果粘贴半分钟后已下载的图片数仍为 0，通常是微信服务器无法访问取图地址：请检查“取图地址”的设置，修改后删除已粘贴的正文，重新复制、粘贴。`;
  }
}

/* ---------- 轮询 ---------- */
let reloadTimer = 0;
async function poll() {
  try {
    const s = await api('/api/state');
    const first = !state.server;
    state.server = s;
    const a = s.article;
    if (a.file && a.rev !== state.seenRev) {
      state.seenRev = a.rev;
      state.src = { kind: 'path', file: a.file, rev: a.rev, mtime: a.mtime };
      run();
    } else if (state.src && state.src.kind === 'path' && a.mtime && a.mtime !== state.src.mtime) {
      state.src.mtime = a.mtime;
      clearTimeout(reloadTimer); reloadTimer = setTimeout(run, 400);
    }
    if (first) renderHost();
  } catch { state.server = null; }
  renderHost(); refreshCopy(); renderFetch();
  setTimeout(poll, 1500);
}
/* ---------- 输入 ---------- */
function useFiles(files, name) {
  const map = new Map();
  for (const { rel, file } of files) map.set(rel, file);
  const htmls = [...map.keys()].filter(r => /\.html?$/i.test(r)).sort((a, b) => a.split('/').length - b.split('/').length || (/index\.html?$/i.test(b) - /index\.html?$/i.test(a)));
  if (!htmls.length) return srcNote('这个文件夹中没有 HTML 文件。', 'err');
  const top = htmls.filter(r => r.split('/').length === htmls[0].split('/').length);
  const entry = top.find(r => /(^|\/)index\.html?$/i.test(r)) || top[0];
  state.src = { kind: 'files', name, map, entry };
  run();
}
const fileOf = en => new Promise(r => en.file(r, () => r(null)));
const readDir = rd => new Promise(r => { const out = []; const step = () => rd.readEntries(es => { if (!es.length) return r(out); out.push(...es); step(); }, () => r(out)); step(); });
async function walk(en, base, out) {
  if (en.isFile) { const f = await fileOf(en); if (f) out.push({ rel: base + en.name, file: f }); return; }
  if (/^(node_modules|\.git)$/.test(en.name)) return;
  for (const c of await readDir(en.createReader())) await walk(c, base + en.name + '/', out);
}

const drop = $('drop');
drop.onclick = () => $('dirInput').click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('dirInput').click(); } };
$('pickDir').onclick = () => $('dirInput').click();
$('dirInput').onchange = e => {
  const fs = [...e.target.files];
  if (!fs.length) return;
  const strip = p => p.slice(p.indexOf('/') + 1);
  useFiles(fs.map(f => ({ rel: strip(f.webkitRelativePath), file: f })), fs[0].webkitRelativePath.split('/')[0]);
  e.target.value = '';
};
for (const t of [drop, document.body]) {
  t.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('on'); });
  t.addEventListener('dragleave', e => { if (e.target === drop) drop.classList.remove('on'); });
}
document.body.addEventListener('drop', async e => {
  e.preventDefault(); drop.classList.remove('on');
  const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return;
  if (entries.length === 1 && entries[0].isDirectory) {
    const out = [];
    for (const c of await readDir(entries[0].createReader())) await walk(c, '', out);
    return useFiles(out, entries[0].name);
  }
  const out = [];
  for (const en of entries) await walk(en, '', out);
  if (out.length === 1) srcNote('只拖入了一个 HTML 文件，浏览器无法读取同一文件夹中的图片。请拖入整个文件夹，或在上方粘贴文件路径。', 'err');
  else useFiles(out, '');
});

$('pathForm').onsubmit = async e => {
  e.preventDefault();
  const p = $('pathInput').value.trim();
  if (!p) return;
  try { await api('/api/open', { path: p }); srcNote('正在打开…'); }
  catch (err) { srcNote(err.message, 'err'); }
};
$('recheck').onclick = () => {
  if (state.server) state.server.host.checking = true;
  renderHost();
  api('/api/recheck', {}).catch(() => {});
};
$('reload').onclick = run;
$('copy').onclick = copy;
const W_KEY = 'wxc.width';
$('width').value = localStorage.getItem(W_KEY) || '335';
$('width').onchange = () => { localStorage.setItem(W_KEY, $('width').value); rerun(); };

/* ---------- 阅读页模拟 ---------- */
const DARK_KEY = 'wxc.dark';
$('dark').checked = localStorage.getItem(DARK_KEY) === '1';
let readerSeq = 0;
/** 右栏：成品套上阅读页框架。深色模式先在隐藏 iframe 里跑转换算法 */
async function renderReader() {
  const r = state.result;
  if (!r) return;
  const dark = $('dark').checked, seq = ++readerSeq;
  const pb = $('paneB'), w = r.width + 2 * SIDE;
  pb.style.width = w + 'px';
  $('device').classList.toggle('dark', dark);
  const doc = readerDoc(r.preview, dark);
  if (!dark) { notice('reader', ''); pb.dataset.dark = ''; pb.srcdoc = doc; return; }
  notice('reader', '正在生成深色模式…');
  try {
    const html = await darkHtml($('darkFrame'), doc, w, pb.clientHeight);
    if (html == null || seq !== readerSeq) return;
    pb.dataset.dark = '1';
    pb.srcdoc = html;
    notice('reader', '');
  } catch (e) { if (seq === readerSeq) notice('reader', e.message, 'err'); }
}
$('dark').onchange = () => {
  localStorage.setItem(DARK_KEY, $('dark').checked ? '1' : '');
  if (!state.busy) renderReader();
};

// 两栏同步滚动。阅读页的正文在标题和作者行下面（高 T）：开头一屏（高 H）内阅读页滚得快些，追平 T，之后两边差一个固定的 T
const readerTop = () => { const d = $('paneB').contentDocument, c = d && d.getElementById('js_content'); return c ? c.getBoundingClientRect().top + d.defaultView.scrollY : 0; };
const toReader = (y, T, H) => y >= H ? y + T : y * (1 + T / H);
const toOriginal = (y, T, H) => y >= H + T ? y - T : y / (1 + T / H);
let syncing = false;
for (const id of ['paneA', 'paneB']) {
  $(id).addEventListener('load', () => {
    const f = $(id);
    // 深色的在隐藏 iframe 里已经照阅读页脚本改过图片尺寸
    if (id === 'paneB' && !f.dataset.dark) readerImages(f.contentDocument);
    f.contentWindow.addEventListener('scroll', () => {
      const other = $(id === 'paneA' ? 'paneB' : 'paneA');
      if (syncing || !other.contentWindow) return;
      syncing = true;
      const T = readerTop(), H = Math.max(1, $('paneA').clientHeight), y = f.contentWindow.scrollY;
      other.contentWindow.scrollTo(0, id === 'paneA' ? toReader(y, T, H) : toOriginal(y, T, H));
      requestAnimationFrame(() => { syncing = false; });
    });
  });
}

window.__wxc = state;
window.__wxcNotice = notice;
window.__wxcBig = bigImages;
poll();
