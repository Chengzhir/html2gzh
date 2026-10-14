import { splitTop, parseDecls, ruleType, round } from './util.js';

/** 按顺序收集作者样式规则；@media/@supports 按手机宽度当场求值 */
export function collectRules(doc, notes) {
  const win = doc.defaultView;
  const rules = []; let order = 0;
  const walk = list => {
    for (const r of list) {
      const t = ruleType(r);
      if (t === 'CSSStyleRule') {
        rules.push({ sel: r.selectorText, style: r.style, order: order++ });
        if (r.cssRules && r.cssRules.length) notes.nested++;
      } else if (t === 'CSSMediaRule') { notes.media++; if (win.matchMedia(r.media.mediaText).matches) walk(r.cssRules); }
      else if (t === 'CSSSupportsRule') { if (win.CSS.supports(r.conditionText)) walk(r.cssRules); }
      else if (t === 'CSSLayerBlockRule') walk(r.cssRules);
      else if (t === 'CSSFontFaceRule') notes.fontface++;
      else if (t === 'CSSKeyframesRule') notes.keyframes++;
      else if (t === 'CSSImportRule') notes.imports++;
      else if (t === 'CSSContainerRule') notes.container++;
    }
  };
  for (const sh of doc.styleSheets) {
    if (!sh.ownerNode || !sh.ownerNode.hasAttribute('data-wxc-author')) continue;
    try { walk(sh.cssRules); } catch { notes.unreadable++; }
  }
  return rules;
}

const NAME = '(?:[\\w-]|[^\\x00-\\x7f]|\\\\.)+';
const RE_ID = new RegExp('#' + NAME, 'g');
const RE_CLS = new RegExp('\\.' + NAME, 'g');
export const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function specificity(sel) {
  let a = 0, b = 0, c = 0;
  let s = sel.replace(/"[^"]*"|'[^']*'/g, '""');
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/gi, '');
  s = s.replace(/:(is|not|has|matches|-webkit-any)\(((?:[^()]|\([^()]*\))*)\)/gi, (m, f, inner) => {
    const best = splitTop(inner).map(specificity).sort(cmpSpec).pop() || [0, 0, 0];
    a += best[0]; b += best[1]; c += best[2];
    return ' ';
  });
  s = s.replace(/:nth-[a-z-]+\([^)]*\)/gi, () => { b++; return ''; });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ''; });
  s = s.replace(RE_ID, () => { a++; return ''; });
  s = s.replace(RE_CLS, () => { b++; return ''; });
  s = s.replace(/::[\w-]+(\([^)]*\))?/g, () => { c++; return ''; });
  s = s.replace(/:(before|after|first-line|first-letter)\b/gi, () => { c++; return ''; });
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { b++; return ''; });
  c += (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [a, b, c];
}

const DYN = /:(hover|active|focus|focus-visible|focus-within|visited|target|checked)\b/i;

/** 元素 → { self, before, after }，每项 { spec, order, decls } */
export function matchRules(doc, rules, notes) {
  const map = new Map();
  const bucket = el => { let b = map.get(el); if (!b) map.set(el, b = { self: [], before: [], after: [] }); return b; };
  for (const r of rules) {
    let decls = null;
    for (let part of splitTop(r.sel)) {
      let slot = 'self';
      const m = part.match(/::?(before|after)\s*$/i);
      if (m) {
        slot = m[1].toLowerCase();
        part = part.slice(0, m.index).trim() || '*';
        if (/[>+~]$/.test(part)) part += ' *';
      } else if (/::[\w-]+/.test(part)) { notes.otherPseudo++; continue; }
      if (DYN.test(part)) { notes.dynamic++; continue; }
      let els;
      try { els = doc.querySelectorAll(part); } catch { notes.badSel++; continue; }
      if (!els.length) continue;
      const spec = specificity(slot === 'self' ? part : part + '::' + slot);
      decls = decls || parseDecls(r.style.cssText);
      for (const el of els) bucket(el)[slot].push({ spec, order: r.order, decls });
    }
  }
  return map;
}

/** 层叠排序：作者普通 < 内联普通 < 作者 important < 内联 important，同级比特异性再比顺序 */
export function cascadeOrder(entries, inlineText) {
  const all = [];
  for (const e of entries) for (const d of e.decls) all.push({ ...d, rank: d.important ? 2 : 0, spec: e.spec, order: e.order });
  if (inlineText) for (const d of parseDecls(inlineText)) all.push({ ...d, rank: d.important ? 3 : 1, spec: [0, 0, 0], order: 1e9 });
  return all.sort((x, y) => x.rank - y.rank || cmpSpec(x.spec, y.spec) || x.order - y.order);
}

function topComma(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') d++; else if (s[i] === ')') d--; else if (s[i] === ',' && d === 0) return i;
  }
  return -1;
}
/** var() 用该元素的计算值展开；无值且无回退则整条声明无效 */
export function substVars(v, cs) {
  for (let guard = 0; guard < 30; guard++) {
    const i = v.search(/var\(/i);
    if (i < 0) return v;
    let depth = 0, j = i + 4;
    for (; j < v.length; j++) {
      if (v[j] === '(') depth++;
      else if (v[j] === ')') { if (depth === 0) break; depth--; }
    }
    const inner = v.slice(i + 4, j);
    const c = topComma(inner);
    const name = (c < 0 ? inner : inner.slice(0, c)).trim();
    let val = cs.getPropertyValue(name).trim();
    if (!val) { if (c < 0) return null; val = inner.slice(c + 1).trim(); }
    v = v.slice(0, i) + val + v.slice(j + 1);
  }
  return v;
}

const PCT_PROPS = /^(width|min-width|max-width|margin(-left|-right|-top|-bottom)?|padding(-left|-right|-top|-bottom)?|gap|column-gap|flex-basis)$/;
const NUM = '(-?\\d*\\.?\\d+)';
const RE_CQ = new RegExp(NUM + '(cqw|cqh|cqi|cqb|cqmin|cqmax)\\b', 'gi');
const RE_REM = new RegExp(NUM + 'rem\\b', 'gi');
const RE_VW = new RegExp(NUM + 'vw\\b', 'gi');
const RE_PCT = new RegExp(NUM + '%', 'g');

/** 把依赖容器/根字号/视口/包含块的长度固化成 px；env 提供惰性取值 */
export function convertUnits(prop, v, env) {
  v = v.replace(RE_CQ, (m, n, u) => {
    const c = env.cq(); u = u.toLowerCase();
    const base = u === 'cqw' || u === 'cqi' ? c.w : u === 'cqh' || u === 'cqb' ? c.h : u === 'cqmin' ? Math.min(c.w, c.h) : Math.max(c.w, c.h);
    env.hit.cq++;
    return round(n * base / 100) + 'px';
  });
  v = v.replace(RE_REM, (m, n) => { env.hit.rem++; return round(n * env.rem) + 'px'; });
  v = v.replace(RE_VW, (m, n) => { env.hit.vw++; return round(n * env.vw / 100) + 'px'; });
  if (PCT_PROPS.test(prop) && v.includes('%') && !/url\(/i.test(v)) v = v.replace(RE_PCT, (m, n) => { env.hit.pct++; return round(n * env.cbw() / 100) + 'px'; });
  if (prop === 'text-align' || prop === 'text-align-last') v = v.replace(/^start$/i, 'left').replace(/^end$/i, 'right');
  return v;
}

export const DROP = /^(content|container(-type|-name)?|transition(-.*)?|animation(-.*)?|will-change|cursor|pointer-events|user-select|-webkit-user-select|scroll-.*|content-visibility|counter-.*)$/;

/** 排好序的声明 → 内联 style 文本；简写/长写覆盖交给浏览器 CSSOM 处理 */
export function toStyle(sorted, cs, env, tmp) {
  tmp.removeAttribute('style');
  for (const d of sorted) {
    if (d.prop.startsWith('--') || DROP.test(d.prop)) continue;
    let v = d.pending ? cs.getPropertyValue(d.prop) : substVars(d.value, cs);
    if (v == null || v === '') { env.hit.badVar++; continue; }
    v = convertUnits(d.prop, v, env);
    tmp.style.setProperty(d.prop, v, d.important ? 'important' : '');
  }
  return tmp.getAttribute('style') || '';
}
