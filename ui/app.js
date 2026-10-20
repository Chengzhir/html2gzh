import { convert } from './convert/index.js';
import { DEFAULT_OPTS, parseRules, faceDefault } from './convert/fonts.js';

const $ = id => document.getElementById(id);
const ORIGIN = location.origin;
const state = {
  src: null,        // { kind:'path', file, rev, mtime } | { kind:'files', name, map:Map(rel→File), entry }
  result: null, server: null, busy: false, copiedAt: null, seenRev: 0,
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
const cleanRef = r => { try { return decodeURIComponent(r.trim().split(/[?#]/)[0]); } catch { return r.trim().split(/[?#]/)[0]; } };
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
  const report = { missing: [], remote: 0, dataUri: 0, svgImage: 0, local: 0 };

  const sheets = [];
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
    const href = link.getAttribute('href');
    if (!isLocalRef(href)) { link.remove(); report.missing.push(href + '（站外样式表，未载入）'); continue; }
    const rel = joinRel(baseDir, cleanRef(href));
    const text = await readLocalText(rel).catch(() => null);
    if (text == null) { report.missing.push(href); link.remove(); continue; }
    const st = doc.createElement('style');
    st.textContent = text; st.dataset.base = dirOf(rel);
    link.replaceWith(st); sheets.push(st);
  }

  // 第一遍：收集
  const wanted = new Set();
  const datas = new Set();
  const note = (ref, base) => {
    if (!ref) return;
    ref = ref.trim();
    if (/^data:/i.test(ref)) { datas.add(ref); return; }
    if (isLocalRef(ref)) wanted.add(joinRel(base, cleanRef(ref)));
  };
  const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  doc.querySelectorAll('img[src]').forEach(e => note(e.getAttribute('src'), baseDir));
  doc.querySelectorAll('image').forEach(e => note(e.getAttribute('href') || e.getAttribute('xlink:href'), baseDir));
  doc.querySelectorAll('[style]').forEach(e => { for (const m of e.getAttribute('style').matchAll(URL_RE)) note(m[2], baseDir); });
  doc.querySelectorAll('style').forEach(st => { for (const m of st.textContent.matchAll(URL_RE)) note(m[2], st.dataset.base ?? baseDir); });

  const ids = await resolveRefs([...wanted]);
  const dataIds = new Map();
  for (const d of datas) dataIds.set(d, await uploadDataUri(d).catch(() => null));

  // 第二遍：改写
  const swap = (ref, base) => {
    const t = (ref || '').trim();
    if (/^data:/i.test(t)) { const id = dataIds.get(t); if (id) { report.dataUri++; return ORIGIN + '/a/' + id; } report.missing.push('无法识别的 data: 图片'); return t; }
    if (/^https?:/i.test(t)) { report.remote++; return t; }
    if (!isLocalRef(t)) return t;
    const rel = joinRel(base, cleanRef(t));
    const id = ids.get(rel);
    if (!id) { report.missing.push(rel); return t; }
    report.local++;
    return ORIGIN + '/a/' + id;
  };
  const swapCss = (css, base) => css.replace(URL_RE, (m, q, u) => `url("${swap(u, base)}")`);
  doc.querySelectorAll('img').forEach(e => {
    e.removeAttribute('srcset'); e.removeAttribute('loading');
    if (e.hasAttribute('src')) e.setAttribute('src', swap(e.getAttribute('src'), baseDir));
  });
  doc.querySelectorAll('image').forEach(e => {
    for (const a of ['href', 'xlink:href']) if (e.hasAttribute(a)) { e.setAttribute(a, swap(e.getAttribute(a), baseDir)); report.svgImage++; }
  });
  doc.querySelectorAll('[style]').forEach(e => e.setAttribute('style', swapCss(e.getAttribute('style'), baseDir)));
  // 打标记：转换时只认文章自己的样式表，浏览器扩展往 iframe 里注入的样式不算
  doc.querySelectorAll('style').forEach(st => { st.textContent = swapCss(st.textContent, st.dataset.base ?? baseDir); st.removeAttribute('data-base'); st.setAttribute('data-wxc-author', ''); });
  doc.querySelectorAll('script').forEach(e => e.remove());
  return { html: '<!DOCTYPE html>' + doc.documentElement.outerHTML, report };
}
/* ---------- 载入与转换 ---------- */
function banner(text, err) {
  const b = $('status');
  b.hidden = !text; b.textContent = text || ''; b.className = 'banner' + (err ? ' err' : '');
}
const width = () => +$('width').value;

/* ---------- 字体设置 ---------- */
// 只存和默认值不同的项：以后默认规则更新，没改过的人自动用上新的
const OPTS_KEY = 'wxc.opts';
function loadOpts() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') || {}; } catch { /* 坏数据当没存 */ }
  const o = { ...DEFAULT_OPTS };
  for (const k of Object.keys(DEFAULT_OPTS)) if (k in saved && typeof saved[k] === typeof DEFAULT_OPTS[k]) o[k] = saved[k];
  return o;
}
let opts = loadOpts();
function saveOpts(patch) {
  opts = { ...opts, ...patch };
  const diff = Object.fromEntries(Object.entries(opts).filter(([k, v]) => v !== DEFAULT_OPTS[k]));
  localStorage.setItem(OPTS_KEY, JSON.stringify(diff));
  renderOpts();
  rerun();
}
function renderOpts() {
  for (const r of document.querySelectorAll('input[name="fontMode"]')) r.checked = r.value === opts.fontMode;
  $('svgOpts').hidden = opts.fontMode !== 'svg';
  if (document.activeElement !== $('svgMin')) $('svgMin').value = opts.svgMin;
  $('svgCopy').checked = opts.svgCopy;
  renderFaces();
  $('noWrap').checked = opts.noWrap;
  if (document.activeElement !== $('rules')) $('rules').value = opts.rules;
  const { rules, bad } = parseRules(opts.rules);
  $('rulesNote').textContent = (opts.rules === DEFAULT_OPTS.rules ? '默认规则' : '已修改') + `，${rules.length} 条` + (bad.length ? `；第 ${bad.join('、')} 行格式不对，已跳过` : '');
}
/* 每套字一行：样例用原字体画、字数与字号范围、手机上会换成什么、三档选择。只在字体集合变了时重建，免得抢走键盘焦点 */
const PICKS = [['all', '全部转轮廓'], ['big', '只转大字'], ['text', '保留文字']];
let faceSig = '';
function renderFaces() {
  const list = $('faceList');
  const fonts = state.result && state.result.fonts || [];
  if (!fonts.length) { faceSig = ''; list.innerHTML = '<p class="muted small">载入文章后列出。</p>'; return; }
  const sig = fonts.map(f => f.key + (f.web ? '|web' : '')).join('\n');
  if (sig !== faceSig) {
    faceSig = sig; list.textContent = '';
    fonts.forEach((f, i) => {
      const fs = document.createElement('fieldset'); fs.dataset.key = f.key;
      const lg = document.createElement('legend'); lg.className = 'sr-only';
      // 样例放在 legend 外：legend 按内容定宽，省略号截不住长样例
      const sm = document.createElement('p'); sm.className = 'sample'; sm.setAttribute('aria-hidden', 'true');
      sm.style.setProperty('font-family', f.stack);
      sm.style.setProperty('font-weight', f.weight);
      sm.style.setProperty('font-style', f.italic ? 'italic' : 'normal');
      sm.style.setProperty('font-stretch', f.stretch);
      sm.textContent = f.sample;
      lg.textContent = `${f.family} ${f.weight}${f.italic ? ' 斜体' : ''}`;
      const meta = document.createElement('p'); meta.className = 'meta';
      const picks = document.createElement('div'); picks.className = 'picks';
      // 网络字体只能留成文字，不给选项
      if (!f.web) for (const [v, label] of PICKS) {
        const lab = document.createElement('label');
        const r = document.createElement('input'); r.type = 'radio'; r.name = 'face' + i; r.value = v;
        r.onchange = () => {
          const faces = { ...opts.faces };
          if (v === faceDefault(f.family)) delete faces[f.key]; else faces[f.key] = v;
          saveOpts({ faces });
        };
        lab.append(r, document.createTextNode(label));
        picks.appendChild(lab);
      }
      fs.append(lg, sm, meta, picks);
      list.appendChild(fs);
    });
  }
  for (const fs of list.children) {
    const f = fonts.find(x => x.key === fs.dataset.key);
    if (!f) continue;
    const pick = opts.faces[f.key] || faceDefault(f.family);
    fs.classList.toggle('changed', f.key in opts.faces);
    for (const r of fs.querySelectorAll('input')) r.checked = r.value === pick;
    const done = opts.fontMode === 'svg' && state.result.stats.outline ? `，已转 ${f.outlined} 字` : '';
    fs.querySelector('.meta').textContent = `${f.family} ${f.weight}${f.italic ? ' 斜体' : ''} · ${f.chars} 字 · ${f.min === f.max ? f.min : f.min + '–' + f.max}px${done}。${f.note}`;
  }
}
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
for (const r of document.querySelectorAll('input[name="fontMode"]')) r.onchange = () => saveOpts({ fontMode: r.value });
$('svgMin').oninput = debounce(() => { const v = parseFloat($('svgMin').value); if (v >= 6 && v <= 200) saveOpts({ svgMin: v }); }, 500);
$('svgMin').onblur = () => renderOpts();
$('facesReset').onclick = () => saveOpts({ faces: {} });
$('svgCopy').onchange = () => saveOpts({ svgCopy: $('svgCopy').checked });
$('noWrap').onchange = () => saveOpts({ noWrap: $('noWrap').checked });
$('rules').oninput = debounce(() => saveOpts({ rules: $('rules').value }), 700);
$('rulesReset').onclick = () => { $('rules').value = DEFAULT_OPTS.rules; saveOpts({ rules: DEFAULT_OPTS.rules }); };
renderOpts();

const glyphs = body => api('/api/glyphs', body);
let again = false;
/** 转换进行中又改了设置：等这一轮结束再按新设置转一次 */
function rerun() { if (state.busy) again = true; else run(); }

async function run() {
  if (!state.src || state.busy) return;
  state.busy = true; state.copiedAt = null; again = false;
  $('copy').disabled = true; $('fetchLine').hidden = true;
  banner('转换中…');
  try {
    let html, entry, label, where;
    if (state.src.kind === 'path') {
      const j = await api('/api/article');
      html = j.html; entry = j.file.replace(/\\/g, '/').split('/').pop();
      label = entry; where = j.file;
    } else {
      entry = state.src.entry; html = await state.src.map.get(entry).text();
      label = entry.split('/').pop(); where = '拖入的文件夹 ' + state.src.name + '（改了原文件要重新拖入）';
    }
    showCurrent(label, where);
    const prep = await prepare(html, entry);
    banner(opts.fontMode === 'svg' ? '转换中…（大字转轮廓，第一次要启动字体服务，稍慢）' : '转换中…');
    const res = await convert(prep.html, { width: width(), frame: $('scratch'), verifyFrame: $('paneB'), opts, glyphs });
    state.result = { ...res, report: prep.report };
    for (const f of [$("paneA"), $("paneB")]) { f.style.width = width() + "px"; f.style.height = ""; }
    $('paneA').srcdoc = res.original;
    $('panes').hidden = false; $('empty').hidden = true;
    renderChecks();
    renderFaces();
    banner('');
  } catch (e) {
    console.error(e);
    banner('转换失败：' + e.message, true);
  } finally {
    state.busy = false;
    refreshCopy();
    if (again) run();
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
  if (report.missing.length) items.unshift({ level: 'error', title: '图片缺失', text: `${report.missing.length} 个文件找不到：${report.missing.slice(0, 4).join('、')}${report.missing.length > 4 ? ' 等' : ''}。粘贴后会变成错误卡片，草稿存不了`, ids: [] });
  if (report.dataUri) items.push({ level: 'fixed', title: '内嵌图片', text: `${report.dataUri} 张 data: 图片转成了文件（微信不收 data: 图片）`, ids: [] });
  if (report.svgImage) items.push({ level: 'warn', title: 'SVG 内图片', text: `${report.svgImage} 处 svg <image> 的图片地址会被微信删掉`, ids: [] });
  if (report.remote) items.push({ level: 'info', title: '外链图片', text: `${report.remote} 张网络图片由微信直接去原地址抓取，对方防盗链时会失败`, ids: [] });
  if (stats.visualBad.length) items.push({ level: 'warn', title: '和原稿不一致', text: `${stats.visualBad.length} 个元素粘贴后的位置或尺寸与原稿相差超过 1.5px`, ids: stats.visualBad });
  else items.push({ level: 'info', title: '比对', text: `${stats.verified} 个元素的位置和尺寸与原稿一致（同一台电脑、同一套字体下）`, ids: [] });
  items.push({ level: 'info', title: '体积', text: `正文 ${stats.chars.toLocaleString()} 字符`, ids: [] });

  const groups = [['error', '必须处理'], ['warn', '需要留意'], ['fixed', '已自动处理'], ['info', '说明']];
  const box = $('checks');
  box.textContent = '';
  for (const [lv, name] of groups) {
    const list = items.filter(i => i.level === lv);
    if (!list.length) continue;
    const h = document.createElement('h3'); h.textContent = name; box.appendChild(h);
    const ul = document.createElement('ul');
    for (const it of list) {
      const li = document.createElement('li'); li.className = lv;
      const b = document.createElement('b'); b.textContent = it.title;
      li.append(b, document.createTextNode(it.text));
      if (it.ids.length) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '在预览里标出';
        btn.onclick = () => highlight(it.ids);
        li.appendChild(btn);
      }
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
}

function highlight(ids) {
  for (const f of [$('paneA'), $('paneB')]) {
    const d = f.contentDocument;
    if (!d) continue;
    let st = d.getElementById('__wxc_hl');
    if (!st) { st = d.createElement('style'); st.id = '__wxc_hl'; d.head.appendChild(st); }
    st.textContent = ids.map(i => `[data-wxc="${i}"]`).join(',') + '{outline:2px solid #e8590c!important;outline-offset:1px}';
    const el = d.querySelector(`[data-wxc="${ids[0]}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }
}

/* ---------- 图床状态 ---------- */
const HOST_KEY = 'wxc.host';
const hostOptions = h => [...h.list, ...(h.custom ? [{ ...h.custom, custom: true }] : [])];
/** 当前用哪个出口：用户选过且还在列表里就用它，否则用服务端推荐的 */
function chosen() {
  const h = state.server && state.server.host;
  if (!h) return null;
  const mine = localStorage.getItem(HOST_KEY);
  const hit = mine && hostOptions(h).find(x => x.base === mine);
  return hit ? { base: hit.base, ok: hit.ok, manual: true } : h.pick;
}

let hostSig = '';
function renderHost() {
  const h = state.server && state.server.host;
  const line = $('hostLine'), help = $('hostHelp');
  if (!h) { line.className = 'status err'; line.textContent = '连不上本地服务，serve.cmd 的窗口还开着吗？'; $('hostPick').hidden = true; return; }
  const c = chosen();
  const opts = hostOptions(h);
  if (!opts.length) {
    line.className = h.checking ? 'status' : 'status err';
    line.textContent = h.checking ? '检测公网出口中…' : '查不到公网 IP';
    help.hidden = h.checking; help.textContent = '本机可能没联网。也可以在下面填一个隧道地址。';
  } else if (c && c.ok) {
    line.className = 'status ok'; line.textContent = '图片用 ' + c.base;
    help.hidden = true;
  } else {
    line.className = 'status warn'; line.textContent = '图片用 ' + (c ? c.base : '—') + '（未确认可达）';
    help.hidden = false;
    help.textContent = `从外网回连这个出口的 ${state.server.imgPort} 端口没通：可能这条线是运营商 NAT（没有真公网 IP）、路由器没把这条线的端口转发过来，或者路由器不支持回环。能选"外网可达"的就选它；都不通时粘贴后看抓取计数。`;
  }
  $('hostWhen').textContent = h.checking ? '检测中…' : h.checkedAt ? `上次 ${new Date(h.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}，每 5 分钟自动检测` : '';
  $('recheck').disabled = h.checking;

  // 只在内容变化时重画，避免每次轮询抢走键盘焦点
  const sig = JSON.stringify([opts.map(x => [x.base, x.ok, x.seen, x.stale]), c && c.base, h.probes]);
  if (sig === hostSig) return;
  hostSig = sig;
  const box = $('hostList'); box.textContent = '';
  $('hostPick').hidden = !opts.length;
  for (const x of opts) {
    const lab = document.createElement('label');
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'host'; r.value = x.base; r.checked = !!c && c.base === x.base;
    r.onchange = () => { localStorage.setItem(HOST_KEY, x.base); hostSig = ''; renderHost(); refreshCopy(); };
    const ip = document.createElement('span'); ip.className = 'ip'; ip.textContent = x.custom ? x.base : x.ip;
    const tag = document.createElement('span');
    tag.className = 'tag ' + (x.stale ? 'stale' : x.ok ? 'ok' : 'no');
    tag.textContent = x.stale ? '本轮没探到' : x.ok ? '外网可达' : '不通';
    lab.append(r, ip, tag);
    if (!x.custom && !x.stale && h.probes) {
      const n = document.createElement('span'); n.className = 'n';
      n.textContent = `${x.seen}/${h.probes} 次`;
      n.title = '本轮出口探测中有多少次连接走了这条线';
      lab.appendChild(n);
    }
    box.appendChild(lab);
  }
}

function localImageIds() {
  if (!state.result) return [];
  return [...new Set([...state.result.payload.matchAll(/\/a\/([0-9a-f]{16}\.[a-z0-9]+)/g)].map(m => m[1]))];
}
function refreshCopy() {
  const btn = $('copy'), note = $('copyNote');
  if (!state.result) { btn.disabled = true; note.textContent = '载入文章后可复制。'; return; }
  const imgs = localImageIds();
  const pick = chosen();
  if (imgs.length && !pick) { btn.disabled = true; note.textContent = `有 ${imgs.length} 张本地图片，需要先有可用的图片外链才能复制。`; return; }
  btn.disabled = state.busy;
  if (state.copiedAt) { note.textContent = '已复制。到公众号后台正文里 Ctrl+V。'; return; }
  note.textContent = imgs.length ? `复制后到公众号后台正文里 Ctrl+V。${imgs.length} 张图片会由微信从本机抓取，抓完前别关 serve.cmd。` : '复制后到公众号后台正文里 Ctrl+V。';
}

async function copy() {
  const pick = chosen();
  const html = pick ? state.result.payload.split(ORIGIN + '/a/').join(pick.base + '/a/') : state.result.payload;
  const text = $('paneB').contentDocument.body.innerText;
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
    if (!ok) { $('copyNote').textContent = '浏览器拒绝写入剪贴板，请再点一次。'; return; }
  }
  state.copiedAt = { hits: { ...(state.server.hits || {}) }, base: pick ? pick.base : '' };
  $('copyNote').textContent = '已复制。到公众号后台正文里 Ctrl+V。';
  renderFetch();
}

function renderFetch() {
  const el = $('fetchLine');
  const ids = localImageIds();
  if (!state.copiedAt || !ids.length) { el.hidden = true; return; }
  const hits = state.server.hits || {};
  const got = ids.filter(id => (hits[id] || 0) > (state.copiedAt.hits[id] || 0)).length;
  el.hidden = false;
  el.className = 'status ' + (got === ids.length ? 'ok' : got ? 'warn' : '');
  el.textContent = got === ids.length ? `图片已全部被抓取（${got}/${ids.length}），可以关掉 serve.cmd 了` : `等待微信抓图：${got}/${ids.length}（经 ${state.copiedAt.base}）。一直是 0 的话换一个出口重新复制粘贴`;
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
  if (!htmls.length) return banner('这个文件夹里没有 HTML 文件。', true);
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
  if (out.length === 1) banner('只拖进了一个 HTML 文件，浏览器拿不到它旁边的图片。请拖整个文件夹，或在左边粘贴文件路径。', true);
  else useFiles(out, '拖入的文件');
});

$('pathForm').onsubmit = async e => {
  e.preventDefault();
  const p = $('pathInput').value.trim();
  if (!p) return;
  try { await api('/api/open', { path: p }); banner('打开中…'); }
  catch (err) { banner(err.message, true); }
};
$('customForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const j = await api('/api/custom', { base: $('customInput').value });
    if (j.custom) localStorage.setItem(HOST_KEY, j.custom.base); else localStorage.removeItem(HOST_KEY);
    hostSig = '';
  } catch (err) { banner(err.message, true); }
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
$('width').onchange = () => { localStorage.setItem(W_KEY, $('width').value); run(); };

// 两个预览同步滚动（按比例）
let syncing = false;
for (const [a, b] of [['paneA', 'paneB'], ['paneB', 'paneA']]) {
  $(a).addEventListener('load', () => {
    $(a).contentWindow.addEventListener('scroll', () => {
      if (syncing) return; syncing = true;
      const wa = $(a).contentWindow, wb = $(b).contentWindow;
      const ra = wa.scrollY / Math.max(1, wa.document.documentElement.scrollHeight - wa.innerHeight);
      wb.scrollTo(0, ra * (wb.document.documentElement.scrollHeight - wb.innerHeight));
      requestAnimationFrame(() => { syncing = false; });
    });
  });
}

window.__wxc = state;
poll();
