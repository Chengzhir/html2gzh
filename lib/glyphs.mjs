// 字形接口：无头 Chrome 告诉我们每个字实际用的是哪个字形面（CDP CSS.getPlatformFontsForNode），fontkit 给出轮廓
import { loadIndex, norm, shape, shapeClusters, pathOf, parseFeatures, faceKey } from './fontindex.mjs';
import { findChrome } from './chrome.mjs';

const IDLE_MS = 5 * 60000;
const LIMITS = { items: 300, chars: 6000, str: 400, char: 16, runs: 1500, run: 400, runChars: 20000 };
const STYLE = { family: 'font-family', weight: 'font-weight', style: 'font-style', stretch: 'font-stretch', features: 'font-feature-settings', variations: 'font-variation-settings', ligatures: 'font-variant-ligatures' };
const SEG = new Intl.Segmenter('und', { granularity: 'grapheme' });
const graphemes = s => [...SEG.segment(s)].map(x => x.segment);
// 标点挤压（text-spacing-trim / halt）会把全角标点排成半宽，这几段字符额外给出 halt 字形，由客户端按实测宽度挑
const CJK_PUNCT = /^[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\u2018\u2019\u201c\u201d\u2014\u2026\u00b7]$/u;
const OT_LANG = [[/^zh-(hk|mo)/i, 'ZHH '], [/^zh-(tw|hant)/i, 'ZHT '], [/^zh/i, 'ZHS '], [/^ja/i, 'JAN '], [/^ko/i, 'KOR ']];

let browserP = null, idle = 0, queue = Promise.resolve();
async function session() {
  clearTimeout(idle);
  idle = setTimeout(() => { const b = browserP; browserP = null; if (b) b.then(x => x.browser.close()).catch(() => {}); }, IDLE_MS);
  idle.unref();
  if (!browserP) {
    const p = browserP = (async () => {
      const exe = findChrome();
      if (!exe) throw new Error('找不到 Chrome 或 Edge：转轮廓要靠它确定每个字实际用的字体（装在别处的话设环境变量 CHROME_PATH）');
      const { default: puppeteer } = await import('puppeteer-core');
      const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--disable-extensions'] });
      // 浏览器崩了或被关掉时丢掉缓存，下次请求重新启动
      browser.once('disconnected', () => { if (browserP === p) browserP = null; });
      const page = await browser.newPage();
      const cdp = await page.createCDPSession();
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      return { browser, page, cdp };
    })();
  }
  try { return await browserP; } catch (e) { browserP = null; throw e; }
}

/** 校验请求：只收字体相关的几个属性，字符串都限长 */
function clean(body) {
  const items = Array.isArray(body && body.items) ? body.items : null;
  if (!items || items.length > LIMITS.items) throw new Error('items 格式不对或太多');
  let total = 0, runs = 0, runChars = 0;
  return items.map(it => {
    const out = { lang: typeof it.lang === 'string' ? it.lang.slice(0, 35) : '', spaced: it.spaced === true };
    for (const k of Object.keys(STYLE)) {
      const v = it[k] == null ? '' : String(it[k]);
      if (v.length > LIMITS.str) throw new Error(k + ' 太长');
      out[k] = v;
    }
    if (!Array.isArray(it.chars)) throw new Error('chars 应为数组');
    out.chars = it.chars.map(c => String(c));
    if (out.chars.some(c => !c || c.length > LIMITS.char)) throw new Error('chars 里有空串或过长的字');
    total += out.chars.length;
    if (total > LIMITS.chars) throw new Error('字太多');
    if (it.runs != null && !Array.isArray(it.runs)) throw new Error('runs 应为数组');
    out.runs = (it.runs || []).map(r => String(r));
    if (out.runs.some(r => !r || r.length > LIMITS.run)) throw new Error('runs 里有空串或过长的词');
    runs += out.runs.length; runChars += out.runs.reduce((n, r) => n + r.length, 0);
    if (runs > LIMITS.runs || runChars > LIMITS.runChars) throw new Error('词太多');
    return out;
  });
}
/**
 * 问 Chrome 每个字最终用了哪个字形面：每个字放一个行内块，彼此不连排（相邻的 f、i 会被排成连字，后一个字就报不出字体）。
 * 每个词另放一段、照原样设字距，记下 Chrome 排它用了各字形面多少个字形，供整词排版对照。都按样式缓存
 */
const resolved = new Map(), runCount = new Map();
const styleKey = it => JSON.stringify([it.family, it.weight, it.style, it.stretch, it.features, it.variations, it.ligatures, it.lang]);
const runKey = (it, w) => styleKey(it) + (it.spaced ? '\u0001' : '\u0000') + w;
async function resolveFaces(items) {
  const todo = [], words = [];
  items.forEach((it, i) => {
    const need = new Set(it.chars);
    for (const w of new Set(it.runs)) {
      for (const g of graphemes(w)) if (g.length <= LIMITS.char) need.add(g);
      if (!runCount.has(runKey(it, w))) words.push([i, w]);
    }
    for (const c of need) if (c.trim() && !resolved.has(styleKey(it) + '\u0000' + c)) todo.push([i, c]);
  });
  if (!todo.length && !words.length) return;
  const { page, cdp } = await session();
  // 内容不经过 HTML 解析：样式逐项 setProperty（非法值浏览器直接丢弃），文字用 textContent
  await page.evaluate((items, todo, words, STYLE) => {
    document.body.textContent = '';
    const boxes = items.map(it => {
      const d = document.createElement('div');
      if (it.lang) d.lang = it.lang;
      for (const [k, prop] of Object.entries(STYLE)) if (it[k]) d.style.setProperty(prop, it[k]);
      d.style.setProperty('font-size', '40px');
      document.body.appendChild(d);
      return d;
    });
    for (const [i, c] of todo) { const s = document.createElement('span'); s.style.display = 'inline-block'; s.textContent = c; boxes[i].appendChild(s); }
    for (const [i, w] of words) { const p = document.createElement('p'); if (items[i].spaced) p.style.letterSpacing = '1px'; p.textContent = w; boxes[i].appendChild(p); }
    // getPlatformFontsForNode 读的是排版结果，不先排版会返回空列表
    return document.body.offsetHeight;
  }, items, todo, words, STYLE);
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const nodes = async sel => (await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: sel })).nodeIds;
  const spans = await nodes('body > div > span'), paras = await nodes('body > div > p');
  if (spans.length !== todo.length || paras.length !== words.length) throw new Error('字体查询页结构不对');
  const fontsOf = async ids => {
    const out = [];
    for (let k = 0; k < ids.length; k += 200) out.push(...await Promise.all(ids.slice(k, k + 200).map(nodeId => cdp.send('CSS.getPlatformFontsForNode', { nodeId }))));
    return out.map(r => r.fonts);
  };
  (await fontsOf(spans)).forEach((fonts, j) => {
    const [i, c] = todo[j];
    const best = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
    resolved.set(styleKey(items[i]) + '\u0000' + c, best ? { ps: best.postScriptName, family: best.familyName, custom: best.isCustomFont } : null);
  });
  (await fontsOf(paras)).forEach((fonts, j) => {
    const [i, w] = words[j];
    runCount.set(runKey(items[i], w), Object.fromEntries(fonts.map(f => [f.postScriptName, f.glyphCount])));
  });
}

/**
 * CSS 的连字开关 → OpenType 特性。字距不为 0 时 Chrome 关掉常用连字和上下文变体（实测 Calibri「office」排 6 个字形，
 * 写了 common-ligatures 也一样；Segoe Script 只有连 calt 一起关，整词步进才和 Chrome 一致）
 */
function featuresFor(it) {
  const f = {};
  for (const v of it.ligatures.split(/\s+/)) {
    if (v === 'none') Object.assign(f, { liga: false, clig: false, dlig: false, hlig: false, calt: false });
    else if (v === 'no-common-ligatures') Object.assign(f, { liga: false, clig: false });
    else if (v === 'discretionary-ligatures' || v === 'no-discretionary-ligatures') f.dlig = v[0] !== 'n';
    else if (v === 'historical-ligatures' || v === 'no-historical-ligatures') f.hlig = v[0] !== 'n';
    else if (v === 'no-contextual') f.calt = false;
  }
  if (it.spaced) Object.assign(f, { liga: false, clig: false, calt: false });
  return { ...f, ...parseFeatures(it.features) };
}

const otLang = lang => { const hit = OT_LANG.find(([re]) => re.test(lang || '')); return hit ? hit[1] : undefined; };

/**
 * POST /api/glyphs 的处理：{ items:[{ family, weight, style, stretch, features, variations, ligatures, lang, spaced, chars:[字], runs:[词] }] }
 * → { faces:[{ upem, weight, italic, name }], paths:[{ m, d }], items:[{ chars:[ 字形 | { miss, ps? } | { space } ], runs:[ 词结果 ] }] }
 * 字形 = { f, adv, g:[[路径号, x, y]], halt? }。词结果：null 表示逐字排版就是对的；
 * 数组表示整词排版与逐字不同（连字、上下文变体），按字素给出替换（null 为不变、{ adv, g } 为簇首、{ adv:0, g:[] } 为连字的后续字）；
 * 'bad' 表示对不上 Chrome 的排版，这个词不能画
 */
export function handleGlyphs(body) {
  const job = queue.then(() => run(clean(body)));
  queue = job.catch(() => {});
  return job;
}
// 汉字、假名、谚文、全角标点：逐字排版，不参与整词比较（连字与上下文变体只出现在拼音文字里，汉字和西文混排时脚本切分也难对上 Chrome）
const CJK = /[\u1100-\u11ff\u2e80-\u2fff\u3000-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{3ffff}]/u;
async function run(items) {
  const index = loadIndex();
  await resolveFaces(items);
  const faces = [], faceNo = new Map(), paths = [], pathNo = new Map();
  const pathRef = id => {
    if (!pathNo.has(id)) { pathNo.set(id, paths.length); paths.push(pathOf(id)); }
    return pathNo.get(id);
  };
  const glyphsOf = gs => gs.map(g => [pathRef(g.id), g.x, g.y]);
  const faceOf = (it, c) => {
    const hit = resolved.get(styleKey(it) + '\u0000' + c);
    if (!hit) return { miss: 'nofont' };
    if (hit.custom) return { miss: 'webfont', ps: hit.ps };
    const face = index.get(norm(hit.ps)) || index.get(norm(hit.family));
    if (!face) return { miss: 'notindexed', ps: hit.ps };
    if (face.color) return { miss: 'color', ps: hit.ps };
    const fk = faceKey(face);
    if (!faceNo.has(fk)) { faceNo.set(fk, faces.length); faces.push({ upem: face.upem, weight: face.weight, italic: face.italic, name: hit.ps }); }
    return { face, ps: hit.ps };
  };
  const out = items.map(it => {
    const feats = featuresFor(it);
    const lang = otLang(it.lang);
    const chars = it.chars.map(c => {
      if (!c.trim()) return { space: true };
      const fc = faceOf(it, c);
      if (fc.miss) return fc;
      let r;
      try { r = shape(fc.face, c, feats, lang); } catch { return { miss: 'shape', ps: fc.ps }; }
      if (r.notdef) return { miss: 'notdef', ps: fc.ps };
      const g = { f: faceNo.get(faceKey(fc.face)), adv: r.adv, g: glyphsOf(r.glyphs) };
      if (CJK_PUNCT.test(c) && !feats.halt) {
        const h = shape(fc.face, c, { ...feats, halt: true }, lang);
        if (h.adv !== r.adv) g.halt = { adv: h.adv, g: glyphsOf(h.glyphs) };
      }
      return g;
    });
    const runs = it.runs.map(w => contextual(it, w, feats, lang, faceOf, glyphsOf));
    return { chars, runs };
  });
  return { faces, paths, items: out };
}

/**
 * 一个词（同一样式、中间无空格）整体排版，和逐字排版比：字形或字形内偏移不同就给出按字素的替换。
 * 词按字形面切段（混排时西文、汉字可能各用一套字），汉字逐字成段。
 * 最后核对每个字形面排出的字形数与 Chrome 一致：连字成没成、回落到哪套字，两边必须相同
 */
function contextual(it, word, feats, lang, faceOf, glyphsOf) {
  const gs = graphemes(word);
  const fcs = gs.map(g => g.length > LIMITS.char ? { miss: 'long' } : faceOf(it, g));
  if (fcs.some(f => f.miss)) return 'bad';
  const want = runCount.get(runKey(it, word));
  if (!want) return 'bad';
  const got = {}, over = gs.map(() => null);
  let differs = false;
  for (let i = 0; i < gs.length;) {
    let j = i + 1;
    if (!CJK.test(gs[i])) while (j < gs.length && fcs[j].face === fcs[i].face && !CJK.test(gs[j])) j++;
    const part = gs.slice(i, j), face = fcs[i].face;
    let whole;
    try { whole = shapeClusters(face, part, feats, lang); } catch { return 'bad'; }
    if (!whole) return 'bad';
    got[fcs[i].ps] = (got[fcs[i].ps] || 0) + whole.count;
    part.forEach((g, k) => {
      const each = shape(face, g, feats, lang).glyphs, w = whole.graphemes[k];
      const same = each.length === w.glyphs.length && each.every((e, q) => e.id === w.glyphs[q].id && Math.abs(e.x - w.glyphs[q].x) < 0.5 && Math.abs(e.y - w.glyphs[q].y) < 0.5);
      if (!same) { differs = true; over[i + k] = { adv: w.adv, g: glyphsOf(w.glyphs) }; }
    });
    i = j;
  }
  const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
  for (const k of keys) if ((want[k] || 0) !== (got[k] || 0)) return 'bad';
  return differs ? over : null;
}
