// 页面的状态与动作：载入与转换、大图压缩、轮询本机服务、复制。组件只读状态、调这里的函数
import { reactive, markRaw, nextTick } from 'vue';
import { convert } from '../convert/index.ts';
import { DEFAULT_OPTS } from '../convert/fonts.ts';
import { ASSET_ID, assetIdsIn } from '../convert/assetid.ts';
import type {
  ApiState,
  ArticleResponse,
  ConvertResult,
  GlyphRequest,
  GlyphResponse,
  HostState,
  ShrinkHow,
  ShrinkResponse,
} from '../convert/types.ts';
import { api } from './api.ts';
import { t } from './i18n.ts';
import { errText } from './fmt.ts';
import { frames, frame, frameDoc } from './frames.ts';
import { readerDoc, darkHtml, SIDE } from './phone.ts';
import { prepare, ORIGIN, EXT_OF_MIME } from './prepare.ts';
import type { ArticleMeta, PrepIO, PrepReport } from './prepare.ts';
import { entryOf } from './files.ts';
import type { RelFile } from './files.ts';

export type Opts = typeof DEFAULT_OPTS;
export type Src =
  | { kind: 'path'; file: string; rev: number; mtime: number }
  | { kind: 'files'; name: string; map: Map<string, File>; entry: string };
/** 压缩后换上的副本 */
export interface Shrunk {
  id: string;
  name: string;
  size: number;
  srcSize: number;
  how: ShrinkHow;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  over: boolean;
}
/** 超过上限、仍是原图（或压不到上限）的图片；why 是给用户看的原因，可为空 */
interface Big {
  id: string;
  name: string;
  size: number;
  why: string;
}
interface Report extends PrepReport {
  big: Big[];
  shrunk: Shrunk[];
  sizes: Map<string, number>;
  /** APNG 与动图 WebP 的名称：公众号文章里只显示第一帧 */
  stills: string[];
}
export interface Result extends ConvertResult {
  report: Report;
  /** 这次转换时勾选的字体表行与预览宽度 */
  paths: string[];
  width: number;
  /** 压缩之前的成品；改压缩设置时从它重新得出 payload 与 preview */
  base: { payload: string; preview: string };
  /** 阅读页模拟的页头与底栏：原稿里的标题、作者等，以及文件的修改时间（毫秒） */
  meta: ArticleMeta;
  mtime: number;
}
interface ShrinkOutcome {
  payload: string;
  preview: string;
  big: Big[];
  shrunk: Shrunk[];
  sizes: Map<string, number>;
}
export type NoticeKind = 'busy' | 'err';
interface Notice {
  text: string;
  kind: NoticeKind;
  shown: boolean;
  timer: number;
}
const idleNotice = (): Notice => ({ text: '', kind: 'busy', shown: false, timer: 0 });

const OPTS_KEY = 'wxc.opts',
  SHRINK_KEY = 'wxc.shrink',
  WIDTH_KEY = 'wxc.width',
  DARK_KEY = 'wxc.dark';
/** 预览屏宽：设备的屏宽与正文宽（屏宽减去两侧各 20px） */
export const WIDTHS = [
  ['android', 360],
  ['iphone', 375],
  ['iphone', 393],
  ['android', 412],
  ['iphone', 414],
] as const;
const BODY_WIDTHS = new Set<number>(WIDTHS.map(([, screen]) => screen - 2 * SIDE));
// 微信服务器下载一张图最多等约 0.5 秒，超时隔 0.5 秒再试，三次都超时就放弃（2026-10-21 实测）。
// 能否下完取决于这台电脑的上传速度和同时下载的张数，默认 1000 KB 是按常见宽带估的界线，不是平台规定
const SHRINK_DEFAULT = { on: true, kb: 1000 };

function readJson(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
// 只存和默认值不同的项：以后默认规则更新，没改过的人自动用上新的
const sameType = (saved: unknown, def: unknown) =>
  Array.isArray(def) ? Array.isArray(saved) && saved.every(x => typeof x === 'string') : typeof saved === typeof def;
function loadOpts(): Opts {
  const saved = readJson(OPTS_KEY);
  const kept = Object.entries(DEFAULT_OPTS)
    .filter(([key, def]) => key in saved && sameType(saved[key], def))
    .map(([key]) => [key, saved[key]]);
  return { ...DEFAULT_OPTS, ...Object.fromEntries(kept) };
}
function loadShrink() {
  const { on, kb } = readJson(SHRINK_KEY);
  return {
    on: typeof on === 'boolean' ? on : SHRINK_DEFAULT.on,
    kb: typeof kb === 'number' && Number.isInteger(kb) && kb >= 1 && kb <= 20000 ? kb : SHRINK_DEFAULT.kb,
  };
}
const savedWidth = Number(localStorage.getItem(WIDTH_KEY));

// result 与 server 不做深层响应（markRaw），每次整个换掉：成品 HTML、字体表、检查结果都很大，
// 而且测试脚本要从页面里原样读出它们（响应式代理传不出页面）
export const state = reactive({
  src: null as Src | null,
  result: null as Result | null,
  error: '',
  server: null as ApiState | null,
  busy: false,
  shrinking: false,
  /** 复制的时刻与当时的取图地址；之后按取图记录判断每张图下载了没有 */
  copiedAt: null as { t: number; base: string } | null,
  copyDenied: false,
  seenRev: 0,
  /** 轮询时更新：下载进度按它判断"多久没再来取" */
  now: Date.now(),
  /** 点了"重新检测"、本机服务还没开始检测时，先显示为检测中 */
  recheckPending: false,
  width: BODY_WIDTHS.has(savedWidth) ? savedWidth : 335,
  dark: localStorage.getItem(DARK_KEY) === '1',
  opts: loadOpts(),
  shrink: loadShrink(),
  current: null as { name: string; where: string } | null,
  srcNote: { text: '', kind: '' },
  panesShown: false,
  originalDoc: '',
  reader: { width: 0, dark: false, html: '', darkDoc: false },
  notices: {
    all: idleNotice(),
    reader: idleNotice(),
  },
});

/* ---------- 提示 ---------- */
// 浮在预览上方，不占位置。all：两栏都受影响（转换）；reader：只影响阅读页（深色模式）。
// 进度提示延迟一会儿才出现，很快结束的操作不闪一下；已经显示着时直接换字。错误立即显示，点 × 关闭。还没有预览时写在空白区里
const NOTICE_DELAY = 300;
export function notice(scope: 'all' | 'reader', text: string, kind: NoticeKind = 'busy') {
  const target = state.notices[scope];
  clearTimeout(target.timer);
  const show = () => {
    target.text = text;
    target.kind = kind;
    target.shown = !!text;
  };
  const showingBusy = target.shown && target.kind === 'busy';
  if (text && kind === 'busy' && !showingBusy && (scope === 'reader' || state.panesShown))
    target.timer = window.setTimeout(show, NOTICE_DELAY);
  else show();
}
export const srcNote = (text: string, kind = '') => {
  state.srcNote = { text, kind };
};

/* ---------- 字体设置 ---------- */
let rerunTimer = 0;
/** how：'now' 立刻重新转换；'soon' 停手 600ms 后再转（连点几个勾选框只转一次）；'none' 不用转 */
export function saveOpts(patch: Partial<Opts>, how: 'now' | 'soon' | 'none' = 'now') {
  Object.assign(state.opts, patch);
  const diff = Object.fromEntries(
    Object.entries(state.opts).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(DEFAULT_OPTS[key as keyof Opts]),
    ),
  );
  localStorage.setItem(OPTS_KEY, JSON.stringify(diff));
  if (how === 'none') return;
  clearTimeout(rerunTimer);
  if (how === 'soon') rerunTimer = window.setTimeout(rerun, 600);
  else rerun();
}
/* ---------- 读文件、登记文件 ---------- */
const uploaded = new WeakMap<File, string>();
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const uploadBlob = async (body: Blob | ArrayBuffer, ext: string, name: string) =>
  (await api<{ id: string }>(`/api/blob?ext=${encodeURIComponent(ext)}&name=${encodeURIComponent(name)}`, body, true))
    .id;
async function uploadDataUri(uri: string) {
  const blob = await (await fetch(uri)).blob();
  const ext = EXT_OF_MIME[blob.type];
  return ext ? uploadBlob(blob, ext, `inline.${ext}`) : null;
}
// 绑定一次转换的来源：转换中途拖入别的文件夹时，这一次仍从原来的来源取文件
const ioFor = (src: Src): PrepIO => ({
  async resolveRefs(rels) {
    const ids = new Map<string, string | null>();
    if (!rels.length) return ids;
    if (src.kind === 'path') {
      const found = await api<Record<string, string | null>>('/api/assets', { refs: rels });
      for (const rel of rels) ids.set(rel, found[rel] || null);
      return ids;
    }
    for (const rel of rels) {
      const file = src.map.get(rel);
      if (!file) {
        ids.set(rel, null);
        continue;
      }
      let id: string | null = uploaded.get(file) ?? null;
      if (!id) {
        try {
          id = await uploadBlob(file, (file.name.split('.').pop() || '').toLowerCase(), file.name);
          uploaded.set(file, id);
        } catch {
          id = null;
        }
      }
      ids.set(rel, id);
    }
    return ids;
  },
  uploadDataUri,
  async readLocalText(rel) {
    if (src.kind === 'files') {
      const file = src.map.get(rel);
      return file ? file.text() : null;
    }
    const found = await api<Record<string, string | null>>('/api/assets', { refs: [rel] });
    return found[rel] ? (await fetch('/a/' + found[rel])).text() : null;
  },
});
const glyphs = (body: GlyphRequest) => api<GlyphResponse>('/api/glyphs', body);
/** SVG 里依赖 id 的部分画成的位图：登记到图床口，返回地址（复制时和其他图片一起换成取图地址） */
const raster = async (uri: string) => {
  const id = await uploadDataUri(uri);
  if (!id) throw new Error(t('convert.rasterFail'));
  return ORIGIN + '/a/' + id;
};
/** 网页字体文件 → 本机服务里的文件 id。本地文件已经登记过；站外的、data: 的下载下来按文件头认格式再登记。按地址缓存 */
const fontIds = new Map<string, Promise<string | null>>();
const FONT_MAGIC = [
  ['wOF2', 'woff2'],
  ['wOFF', 'woff'],
  ['OTTO', 'otf'],
  ['true', 'ttf'],
  ['ttcf', 'ttc'],
  ['\u0000\u0001\u0000\u0000', 'ttf'],
];
function fontBytes(url: string): Promise<string | null> {
  const local = url.startsWith(ORIGIN + '/a/') ? url.slice(ORIGIN.length + 3) : '';
  if (ASSET_ID.test(local)) return Promise.resolve(local);
  return fontIds.getOrInsertComputed(url, () => {
    const job = (async () => {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) return null;
      const buf = await response.arrayBuffer();
      const head = String.fromCharCode(...new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
      const format = FONT_MAGIC.find(([magic]) => magic === head)?.[1];
      return format ? uploadBlob(buf, format, `font.${format}`) : null;
    })().catch((): null => null);
    // 失败的不缓存，下次转换再试
    void job.then(id => {
      if (!id) fontIds.delete(url);
    });
    return job;
  });
}

/* ---------- 大图 ---------- */
const limitBytes = () => state.shrink.kb * 1024;
/** 本地图片的大小（字节）：Map<id, size>，取自本机服务的 HEAD 响应 */
async function imageSizes(payload: string) {
  const sizes = new Map<string, number>();
  await Promise.all(
    assetIdsIn(payload).map(async id => {
      const response = await fetch('/a/' + id, { method: 'HEAD', cache: 'no-store' }).catch((): null => null);
      sizes.set(id, response?.ok ? Number(response.headers.get('content-length')) : 0);
    }),
  );
  return sizes;
}
/** 成品里的 APNG 与动图 WebP 的 id：公众号读者拿到的这两种图只有第一帧，动图只有 GIF 能保留 */
async function animatedStills(payload: string) {
  const ids = assetIdsIn(payload).filter(id => /\.(png|webp)$/.test(id));
  const animated = await Promise.all(
    ids.map(async id => {
      try {
        const response = await fetch('/a/' + id);
        if (!response.ok || !response.body) return false;
        const decoder = new ImageDecoder({ data: response.body, type: response.headers.get('content-type') || '' });
        await decoder.tracks.ready;
        const isAnimated = decoder.tracks.selectedTrack?.animated ?? false;
        decoder.close();
        return isAnimated;
      } catch {
        return false;
      }
    }),
  );
  return ids.filter((_, i) => animated[i]);
}
/** 超过 limit 字节的本地图片，从大到小 */
async function bigImages(
  payload: string,
  names: Map<string, string>,
  limit = limitBytes(),
  sizes?: Map<string, number>,
): Promise<Big[]> {
  sizes ??= await imageSizes(payload);
  return [...sizes]
    .filter(([, size]) => size > limit)
    .map(([id, size]) => ({ id, name: names.get(id) || t('img.generated'), size, why: '' }))
    .toSorted((a, b) => b.size - a.size);
}
let shrinkSeq = 0;
/**
 * 按当前的上限与开关，从原始成品（base）得出最终的成品：比 1080px 宽或超过上限的图片换成处理后的副本
 * （哪些要处理由服务端看图片本身决定）。被更新的一次调用取代时返回 null
 */
async function applyShrink({ base, report }: Pick<Result, 'base' | 'report'>): Promise<ShrinkOutcome | null> {
  const seq = ++shrinkSeq,
    limit = limitBytes(),
    names = report.names;
  let { payload, preview } = base;
  const sizes = await imageSizes(base.payload);
  const shrunk: Shrunk[] = [],
    big: Big[] = [];
  if (state.shrink.on) {
    const ids = assetIdsIn(base.payload),
      queue = [...ids],
      responses = new Map<string, ShrinkResponse | { error: string }>();
    let done = 0;
    // 同时处理 4 张
    await Promise.all(
      Array.from({ length: Math.min(4, ids.length) }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          responses.set(
            id,
            await api<ShrinkResponse>('/api/shrink', { id, max: limit }).catch((error: unknown) => ({
              error: errText(error),
            })),
          );
          if (seq === shrinkSeq) notice('all', t('shrink.progress', { n: ++done, total: ids.length }));
        }
      }),
    );
    if (seq !== shrinkSeq) return null;
    for (const id of ids) {
      // 上面每个 id 都处理过一遍
      const response = responses.get(id) ?? { error: 'missing' },
        size = sizes.get(id) || 0,
        name = names.get(id) || t('img.generated');
      if (!('id' in response)) {
        const why =
          'error' in response ? response.error : response.skip === 'fits' ? '' : t('shrink.skip.' + response.skip);
        if (size > limit) big.push({ id, name, size, why });
        continue;
      }
      payload = payload.split('/a/' + id).join('/a/' + response.id);
      preview = preview.split('/a/' + id).join('/a/' + response.id);
      names.set(response.id, name);
      sizes.set(response.id, response.size);
      shrunk.push({ ...response, name });
      if (response.over) big.push({ id: response.id, name, size: response.size, why: t('shrink.over') });
    }
  } else big.push(...(await bigImages(base.payload, names, limit, sizes)));
  if (seq !== shrinkSeq) return null;
  return { payload, preview, big, shrunk, sizes };
}
/** 换上压缩后的成品：得到新的结果对象（不改原来的） */
const withShrink = (result: Result, out: ShrinkOutcome): Result =>
  markRaw({
    ...result,
    payload: out.payload,
    preview: out.preview,
    report: { ...result.report, big: out.big, shrunk: out.shrunk, sizes: out.sizes },
  });
let shrinkAgain = false,
  shrinkRuns = 0;
/** 改了压缩设置：不用重新转换，只按新设置从原始成品重新得出最终成品。转换进行中时等它结束再做 */
export function saveShrink(patch: Partial<typeof SHRINK_DEFAULT>) {
  Object.assign(state.shrink, patch);
  localStorage.setItem(SHRINK_KEY, JSON.stringify(state.shrink));
  if (state.busy) shrinkAgain = true;
  else void reshrink();
}
async function reshrink() {
  const result = state.result;
  if (!result) return;
  state.copiedAt = null;
  state.copyDenied = false;
  shrinkRuns++;
  state.shrinking = true;
  try {
    const out = await applyShrink(result);
    if (!out || state.result !== result) return;
    state.result = withShrink(result, out);
    notice('all', '');
    await renderReader();
  } finally {
    if (!--shrinkRuns) state.shrinking = false;
  }
}
/* ---------- 载入与转换 ---------- */
let again = false;
/** 转换进行中又改了设置：等这一轮结束再按新设置转一次 */
export function rerun() {
  if (state.busy) again = true;
  else void run();
}

async function run() {
  const src = state.src;
  if (!src || state.busy) return;
  state.busy = true;
  state.copiedAt = null;
  state.copyDenied = false;
  again = false;
  shrinkAgain = false;
  srcNote('');
  notice('all', t('stage.converting'));
  // 转换器拿到的是普通对象，不是响应式代理
  const opts: Opts = { ...state.opts, paths: [...state.opts.paths] },
    width = state.width;
  try {
    let html: string, entry: string, mtime: number;
    if (src.kind === 'path') {
      const article = await api<ArticleResponse>('/api/article');
      ({ html, mtime } = article);
      entry = baseName(article.file.replace(/\\/g, '/'));
      state.current = { name: entry, where: article.file };
    } else {
      entry = src.entry;
      const file = src.map.get(entry);
      if (!file) throw new Error('entry file missing');
      html = await file.text();
      mtime = file.lastModified;
      state.current = {
        name: baseName(entry),
        where: src.name ? t('src.droppedDir', { name: src.name }) : t('src.droppedFiles', { n: src.map.size }),
      };
    }
    const prep = await prepare(html, entry, ioFor(src));
    if (opts.paths.length) notice('all', t('stage.convertingFonts'));
    const converted = await convert(prep.html, {
      width,
      frame: frame('scratch'),
      verifyFrame: frame('verify'),
      opts,
      glyphs,
      raster,
      fontBytes,
    });
    const stills = (await animatedStills(converted.payload)).map(id => prep.report.names.get(id) || t('img.generated'));
    const draft: Result = markRaw({
      ...converted,
      report: { ...prep.report, big: [], shrunk: [], sizes: new Map(), stills },
      paths: opts.paths,
      width,
      base: { payload: converted.payload, preview: converted.preview },
      meta: prep.meta,
      mtime,
    });
    const out = await applyShrink(draft);
    // 转换中途换了来源：这一次的结果作废，按新来源再转
    if (state.src !== src) {
      again = true;
      return;
    }
    state.result = out ? withShrink(draft, out) : draft;
    state.error = '';
    state.originalDoc = converted.original;
    state.panesShown = true;
    notice('all', '');
    await renderReader();
  } catch (error) {
    if (state.src !== src) {
      again = true;
      return;
    }
    console.error(error);
    state.error = errText(error);
    notice('all', t('stage.failed', { msg: state.error }), 'err');
  } finally {
    state.busy = false;
    if (again) void run();
    else if (shrinkAgain) {
      shrinkAgain = false;
      void reshrink();
    }
  }
}

let readerSeq = 0;
/** 右栏：成品套上阅读页框架。深色模式先在隐藏 iframe 里跑转换算法 */
async function renderReader() {
  const result = state.result;
  if (!result) return;
  const dark = state.dark,
    seq = ++readerSeq,
    screenWidth = result.width + 2 * SIDE;
  state.reader.width = screenWidth;
  state.reader.dark = dark;
  const doc = readerDoc(result.preview, { ...result.meta, time: result.mtime }, dark);
  if (!dark) {
    notice('reader', '');
    state.reader.darkDoc = false;
    state.reader.html = doc;
    return;
  }
  notice('reader', t('stage.darkBusy'));
  // 先让新宽度生效：深色算法按首屏判断背景，隐藏帧要和显示用的 iframe 一样高
  await nextTick();
  try {
    const html = await darkHtml(frame('dark'), doc, screenWidth, frame('paneB').clientHeight);
    if (html == null || seq !== readerSeq) return;
    state.reader.darkDoc = true;
    state.reader.html = html;
    notice('reader', '');
  } catch (error) {
    if (seq !== readerSeq) return;
    // 深色算法出错：右栏换上这次的成品（未经深色转换），不留着上一篇或空白
    state.reader.darkDoc = false;
    state.reader.html = doc;
    notice('reader', errText(error), 'err');
  }
}

/* ---------- 轮询本机服务 ---------- */
let pollGen = 0,
  pollTimer = 0,
  reloadTimer = 0;
/** 立即问一次状态（之后照常每 1.5 秒一次）；先发出的那次回来得晚，结果作废 */
export async function pollNow() {
  const gen = ++pollGen;
  clearTimeout(pollTimer);
  let server: ApiState | null = null;
  try {
    server = await api<ApiState>('/api/state');
  } catch {
    /* 本机服务关了 */
  }
  if (gen !== pollGen) return;
  state.server = server && markRaw(server);
  state.now = Date.now();
  if (server) {
    const { article } = server,
      src = state.src;
    if (article.file && article.rev !== state.seenRev) {
      state.seenRev = article.rev;
      state.src = markRaw<Src>({ kind: 'path', file: article.file, rev: article.rev, mtime: article.mtime });
      rerun();
    } else if (src?.kind === 'path' && article.mtime && article.mtime !== src.mtime) {
      src.mtime = article.mtime;
      clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(rerun, 400);
    }
  }
  pollTimer = window.setTimeout(() => void pollNow(), 1500);
}
export async function recheck() {
  state.recheckPending = true;
  try {
    await api('/api/recheck', {});
  } catch {
    /* 下一次轮询会显示本机服务的状态 */
  } finally {
    state.recheckPending = false;
    void pollNow();
  }
}
/** 保存取图地址：本机端口立即换绑，返回新的检测状态 */
export async function saveHost(form: { imgPort: string; host: string; port: string; proto: string }) {
  const { host } = await api<{ host: HostState }>('/api/host', form);
  if (state.server) state.server = markRaw({ ...state.server, host, imgPort: host.config.imgPort });
  void pollNow();
  return host;
}

/* ---------- 复制 ---------- */
export async function copy() {
  const result = state.result,
    pick = state.server?.host.pick;
  if (!result) return;
  const html = pick ? result.payload.split(ORIGIN + '/a/').join(pick.base + '/a/') : result.payload;
  const text = frameDoc('verify').querySelector<HTMLElement>('.rich_media_content')?.innerText ?? '';
  state.copyDenied = false;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
  } catch {
    const fill = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      e.clipboardData.setData('text/html', html);
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    };
    document.addEventListener('copy', fill, { once: true });
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', fill);
    if (!ok) {
      state.copyDenied = true;
      return;
    }
  }
  state.copiedAt = { t: Date.now(), base: pick ? pick.base : '' };
  state.now = Date.now();
}

/** 两边都标出这些元素；滚动原稿那边，阅读页跟着同步滚动 */
export function highlight(ids: string[]) {
  for (const pane of [frames.paneA, frames.paneB]) {
    const doc = pane?.contentDocument;
    if (!doc?.head) continue;
    let style = doc.getElementById('__wxc_hl');
    if (!style) {
      style = doc.createElement('style');
      style.id = '__wxc_hl';
      doc.head.appendChild(style);
    }
    style.textContent =
      ids.map(id => `[data-wxc="${id}"]`).join(',') + '{outline:2px solid #e8590c!important;outline-offset:1px}';
  }
  frames.paneA?.contentDocument?.querySelector(`[data-wxc="${ids[0]}"]`)?.scrollIntoView({ block: 'center' });
}

/* ---------- 输入 ---------- */
/** 拖入或选择的文件夹 */
export function useFiles(files: RelFile[], name: string) {
  const map = new Map(files.map(({ rel, file }) => [rel, file]));
  const entry = entryOf([...map.keys()]);
  if (!entry) return srcNote(t('src.noHtml'), 'err');
  state.src = markRaw<Src>({ kind: 'files', name, map, entry });
  rerun();
}
export async function openPath(input: string) {
  try {
    await api('/api/open', { path: input });
    srcNote(t('src.opening'));
    void pollNow();
  } catch (error) {
    srcNote(errText(error), 'err');
  }
}
export function setWidth(width: number) {
  state.width = width;
  localStorage.setItem(WIDTH_KEY, String(width));
  rerun();
}
export function setDark(on: boolean) {
  state.dark = on;
  localStorage.setItem(DARK_KEY, on ? '1' : '');
  if (!state.busy) void renderReader();
}
/** "重新转换"/"重新拖入文件夹"：检查结果里说怎么改完再转 */
export const redoHint = () => t(state.src?.kind === 'files' ? 'src.redoFiles' : 'src.redoPath');

// 测试与排查脚本用的钩子
Object.assign(window, { __wxc: state, __wxcNotice: notice, __wxcBig: bigImages, __wxcStills: animatedStills });
