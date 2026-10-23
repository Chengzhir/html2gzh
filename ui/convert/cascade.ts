import { splitTop, parseDecls, ruleType, round, eachAuthorSheet, viewOf } from './util.ts';
import type { Declaration } from './util.ts';
import { mobileFonts } from './fonts.ts';
import type { FontRule } from './fonts.ts';

/** 层叠过程中的计数：collectRules、matchRules 与伪元素 content 解析各记一部分 */
export interface CascadeNotes {
  media: number;
  fontface: number;
  keyframes: number;
  imports: number;
  container: number;
  unreadable: number;
  nested: number;
  otherPseudo: number;
  dynamic: number;
  badSel: number;
}
export interface CollectedRule {
  sel: string;
  style: CSSStyleDeclaration;
  order: number;
}
/** [id 数, 类/属性/伪类数, 标签/伪元素数] */
export type Specificity = [number, number, number];
export interface MatchedEntry {
  spec: Specificity;
  order: number;
  decls: Declaration[];
}
export interface MatchedSlots {
  self: MatchedEntry[];
  before: MatchedEntry[];
  after: MatchedEntry[];
}
/** rank：0 作者普通、1 内联普通、2 作者 important、3 内联 important */
export interface RankedDeclaration extends Declaration {
  rank: number;
  spec: Specificity;
  order: number;
}
/** 各类换算命中的次数 */
export interface UnitHits {
  cq: number;
  rem: number;
  vw: number;
  pct: number;
  badVar: number;
  font: number;
}
export interface UnitEnv {
  hit: UnitHits;
  rem: number;
  vw: number;
  /** 最近查询容器的内容宽高 */
  cq: () => { w: number; h: number };
  /** 需要换算 % 时包含块的宽度，不需要为 null */
  cbw: () => number | null;
}
export interface StyleEnv extends UnitEnv {
  svg: boolean;
  fontRules: FontRule[];
}

/** 按顺序收集作者样式规则；@media/@supports 按手机宽度当场求值 */
export function collectRules(doc: Document, notes: CascadeNotes): CollectedRule[] {
  const win = viewOf(doc);
  const rules: CollectedRule[] = [];
  let order = 0;
  const walk = (list: CSSRuleList) => {
    for (const rule of list) {
      const type = ruleType(rule);
      if (type === 'CSSStyleRule') {
        const styleRule = rule as CSSStyleRule;
        rules.push({ sel: styleRule.selectorText, style: styleRule.style, order: order++ });
        if (styleRule.cssRules && styleRule.cssRules.length) notes.nested++;
      } else if (type === 'CSSMediaRule') {
        notes.media++;
        if (win.matchMedia((rule as CSSMediaRule).media.mediaText).matches) walk((rule as CSSMediaRule).cssRules);
      } else if (type === 'CSSSupportsRule') {
        if (win.CSS.supports((rule as CSSSupportsRule).conditionText)) walk((rule as CSSSupportsRule).cssRules);
      } else if (type === 'CSSLayerBlockRule') walk((rule as CSSLayerBlockRule).cssRules);
      else if (type === 'CSSFontFaceRule') notes.fontface++;
      else if (type === 'CSSKeyframesRule') notes.keyframes++;
      else if (type === 'CSSImportRule') notes.imports++;
      else if (type === 'CSSContainerRule') notes.container++;
    }
  };
  eachAuthorSheet(doc, walk, () => {
    notes.unreadable++;
  });
  return rules;
}

const NAME = /(?:[\w-]|[^\x00-\x7f]|\\.)+/.source;
const RE_ID = new RegExp('#' + NAME, 'g');
const RE_CLS = new RegExp(/\./.source + NAME, 'g');
const cmpSpec = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function specificity(sel: string): Specificity {
  let a = 0,
    b = 0,
    c = 0;
  let stripped = sel.replace(/"[^"]*"|'[^']*'/g, '""');
  stripped = stripped.replace(/:where\((?:[^()]|\([^()]*\))*\)/gi, '');
  stripped = stripped.replace(
    /:(is|not|has|matches|-webkit-any)\(((?:[^()]|\([^()]*\))*)\)/gi,
    (whole: string, fn: string, inner: string) => {
      const best = splitTop(inner).map(specificity).sort(cmpSpec).pop() || [0, 0, 0];
      a += best[0];
      b += best[1];
      c += best[2];
      return ' ';
    },
  );
  stripped = stripped.replace(/:nth-[a-z-]+\([^)]*\)/gi, () => {
    b++;
    return '';
  });
  stripped = stripped.replace(/\[[^\]]*\]/g, () => {
    b++;
    return '';
  });
  stripped = stripped.replace(RE_ID, () => {
    a++;
    return '';
  });
  stripped = stripped.replace(RE_CLS, () => {
    b++;
    return '';
  });
  stripped = stripped.replace(/::[\w-]+(\([^)]*\))?/g, () => {
    c++;
    return '';
  });
  stripped = stripped.replace(/:(before|after|first-line|first-letter)\b/gi, () => {
    c++;
    return '';
  });
  stripped = stripped.replace(/:[\w-]+(\([^)]*\))?/g, () => {
    b++;
    return '';
  });
  c += (stripped.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [a, b, c];
}

const DYN = /:(hover|active|focus|focus-visible|focus-within|visited|target|checked)\b/i;

/** 元素 → { self, before, after }，每项 { spec, order, decls } */
export function matchRules(doc: Document, rules: CollectedRule[], notes: CascadeNotes) {
  const map = new Map<Element, MatchedSlots>();
  const bucket = (el: Element) => {
    let slots = map.get(el);
    if (!slots) map.set(el, (slots = { self: [], before: [], after: [] }));
    return slots;
  };
  for (const rule of rules) {
    let decls: Declaration[] | null = null;
    for (let part of splitTop(rule.sel)) {
      let slot: keyof MatchedSlots = 'self';
      const match = part.match(/::?(before|after)\s*$/i);
      if (match) {
        slot = match[1].toLowerCase() as 'before' | 'after';
        part = part.slice(0, match.index).trim() || '*';
        if (/[>+~]$/.test(part)) part += ' *';
      } else if (/::[\w-]+/.test(part)) {
        notes.otherPseudo++;
        continue;
      }
      if (DYN.test(part)) {
        notes.dynamic++;
        continue;
      }
      let els: NodeListOf<Element>;
      try {
        els = doc.querySelectorAll(part);
      } catch {
        notes.badSel++;
        continue;
      }
      if (!els.length) continue;
      const spec = specificity(slot === 'self' ? part : part + '::' + slot);
      decls = decls || parseDecls(rule.style.cssText);
      for (const el of els) bucket(el)[slot].push({ spec, order: rule.order, decls });
    }
  }
  return map;
}

/** 层叠排序：作者普通 < 内联普通 < 作者 important < 内联 important，同级比特异性再比顺序 */
export function cascadeOrder(entries: MatchedEntry[], inlineText?: string | null) {
  const all: RankedDeclaration[] = [];
  for (const e of entries)
    for (const decl of e.decls) all.push({ ...decl, rank: decl.important ? 2 : 0, spec: e.spec, order: e.order });
  if (inlineText)
    for (const decl of parseDecls(inlineText))
      all.push({ ...decl, rank: decl.important ? 3 : 1, spec: [0, 0, 0], order: 1e9 });
  return all.sort((x, y) => x.rank - y.rank || cmpSpec(x.spec, y.spec) || x.order - y.order);
}

function topComma(text: string) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) return i;
  }
  return -1;
}
/** var() 用该元素的计算值展开；无值且无回退则整条声明无效 */
function substVars(value: string, computed: CSSStyleDeclaration): string | null {
  // 每轮展开一个 var()：计算值里不会再有 var()，回退值是原串的子串，所以总轮数不超过原串里 var( 的个数
  for (let guard = 0; guard < 1000; guard++) {
    const i = value.search(/var\(/i);
    if (i < 0) return value;
    let depth = 0,
      j = i + 4;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')') {
        if (depth === 0) break;
        depth--;
      }
    }
    const inner = value.slice(i + 4, j);
    const comma = topComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    let resolved = computed.getPropertyValue(name).trim();
    if (!resolved) {
      if (comma < 0) return null;
      resolved = inner.slice(comma + 1).trim();
    }
    value = value.slice(0, i) + resolved + value.slice(j + 1);
  }
  return /var\(/i.test(value) ? null : value;
}

const PCT_PROPS =
  /^(width|min-width|max-width|margin(-left|-right|-top|-bottom)?|padding(-left|-right|-top|-bottom)?|gap|column-gap|flex-basis)$/;
const NUM = /(-?\d*\.?\d+)/.source;
const RE_CQ = new RegExp(NUM + /(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/.source, 'gi');
const RE_REM = new RegExp(NUM + /rem\b/.source, 'gi');
const RE_VW = new RegExp(NUM + /vw\b/.source, 'gi');
const RE_PCT = new RegExp(NUM + '%', 'g');

/** 把依赖容器/根字号/视口/包含块的长度固化成 px；env 提供惰性取值 */
function convertUnits(prop: string, value: string, env: UnitEnv) {
  value = value.replace(RE_CQ, (whole: string, num: string, unit: string) => {
    const container = env.cq();
    unit = unit.toLowerCase();
    const base =
      unit === 'cqw' || unit === 'cqi'
        ? container.w
        : unit === 'cqh' || unit === 'cqb'
          ? container.h
          : unit === 'cqmin'
            ? Math.min(container.w, container.h)
            : Math.max(container.w, container.h);
    env.hit.cq++;
    return round((+num * base) / 100) + 'px';
  });
  value = value.replace(RE_REM, (whole: string, num: string) => {
    env.hit.rem++;
    return round(+num * env.rem) + 'px';
  });
  value = value.replace(RE_VW, (whole: string, num: string) => {
    env.hit.vw++;
    return round((+num * env.vw) / 100) + 'px';
  });
  if (PCT_PROPS.test(prop) && value.includes('%') && !/url\(/i.test(value)) {
    const blockWidth = env.cbw();
    if (blockWidth != null)
      value = value.replace(RE_PCT, (whole: string, num: string) => {
        env.hit.pct++;
        return round((+num * blockWidth) / 100) + 'px';
      });
  }
  return value;
}

const DROP =
  /^(content|container-name|transition(-.*)?|animation(-.*)?|will-change|cursor|pointer-events|user-select|-webkit-user-select|scroll-.*|content-visibility|counter-.*)$/;

/** 排好序的声明 → 内联 style 文本；简写/长写覆盖交给浏览器 CSSOM 处理 */
export function toStyle(
  sorted: RankedDeclaration[],
  computed: CSSStyleDeclaration,
  env: StyleEnv,
  scratch: HTMLElement,
) {
  scratch.removeAttribute('style');
  for (const decl of sorted) {
    // SVG 里 pointer-events 决定点哪儿能触发动画，要留着
    if (decl.prop.startsWith('--') || (DROP.test(decl.prop) && !(env.svg && decl.prop === 'pointer-events'))) continue;
    let value = decl.pending ? computed.getPropertyValue(decl.prop) : substVars(decl.value, computed);
    if (value == null || value === '') {
      env.hit.badVar++;
      continue;
    }
    value = convertUnits(decl.prop, value, env);
    scratch.style.setProperty(decl.prop, value, decl.important ? 'important' : '');
  }
  const family = scratch.style.getPropertyValue('font-family');
  if (family) {
    const more = mobileFonts(family, env.fontRules);
    if (more !== family) {
      scratch.style.setProperty('font-family', more, scratch.style.getPropertyPriority('font-family'));
      env.hit.font++;
    }
  }
  return scratch.getAttribute('style') || '';
}
