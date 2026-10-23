import { round, NO_TRANSFORM, viewOf } from './util.ts';

// 微信存储会删掉含 calc() 的声明，但 cqw 与 container-type 原样保留。
// 同一篇文章按两个版心宽度各转一遍，逐个 px 数值拟合 v = k·W + b（W 是该元素查询容器的内容宽度）：
// b≈0 写成 cqw，k≈0 保留 px；两者都有时 translate 可以拆成两段相加，其余属性取主宽度下精确的近似值。
const PX = /(-?\d*\.?\d+(?:e-?\d+)?)px\b/gi;
const TRANSLATE = /^translate\((-?\d*\.?\d+(?:e-?\d+)?)px, (-?\d*\.?\d+(?:e-?\d+)?)px\)/;
const EPS = 0.06;
const fmt = (n: number, unit: string) => {
  const rounded = round(n);
  return (Object.is(rounded, -0) ? 0 : rounded) + unit;
};
const cq = (value: number, W: number) => {
  const percent = Math.round((value / W) * 100 * 1000) / 1000;
  return percent ? fmt(percent, 'cqw') : '0px';
};

interface MergeStat {
  cq: number;
  split: number;
  approx: number;
  maxErr: number;
  diverged: number;
  where: string[];
  /** 正在拟合的"data-wxc 属性名"，记进 where */
  at: string;
}
interface Fitter {
  one: (a: number, b: number) => { css: string; exact: boolean };
  /** [固定 px, cqw]；不必拆时为 null */
  split: (a: number, b: number) => [number, number] | null;
}

function fitter(WA: number, WB: number, stat: MergeStat): Fitter {
  /** 一个长度在两个宽度下的值 → { css, exact } */
  const one = (a: number, b: number) => {
    if (Math.abs(a - b) <= EPS) return { css: fmt(a, 'px'), exact: true };
    if (Math.abs(WA - WB) < 0.5) {
      stat.approx++;
      return { css: fmt(a, 'px'), exact: false };
    }
    const k = (a - b) / (WA - WB),
      intercept = a - k * WA;
    // 文字排版有亚像素舍入，两条线定出的截距不会正好是 0；1.2px 以内的当作纯比例，
    // 它在任意宽度下的偏差都不超过这么多，而逐宽度比对（容差 1.5px）会兜住真出错的情况
    if (Math.abs(intercept) <= 1.2) {
      stat.cq++;
      return { css: cq(a, WA), exact: true };
    }
    // 边框宽度会被浏览器向下取整到整像素：找一个比例 k 使 floor(k·WA)=a 且 floor(k·WB)=b
    if (Number.isInteger(a) && Number.isInteger(b)) {
      const lo = Math.max(a / WA, b / WB),
        hi = Math.min((a + 1) / WA, (b + 1) / WB);
      if (lo < hi) {
        stat.cq++;
        return { css: fmt(((lo + hi) / 2) * 100, 'cqw'), exact: true };
      }
    }
    stat.approx++;
    stat.maxErr = Math.max(stat.maxErr, Math.abs(intercept));
    stat.where.push(`${stat.at} ${a}@${WA}/${b}@${WB}`);
    return { css: cq(a, WA), exact: false };
  };
  const split = (a: number, b: number): [number, number] | null => {
    if (Math.abs(a - b) <= EPS || Math.abs(WA - WB) < 0.5) return null;
    const k = (a - b) / (WA - WB),
      intercept = a - k * WA;
    if (Math.abs(intercept) <= 0.25) return null;
    stat.split++;
    return [intercept, k * 100];
  };
  return { one, split };
}

/** 同一属性两个值的 px 换成拟合结果；形状不同（比如只有一边多了位移）时退回按比例换算 */
function fitValue(prop: string, va: string, vb: string, fit: Fitter) {
  if (prop === 'transform') {
    const ma = va.match(TRANSLATE),
      mb = vb.match(TRANSLATE);
    if (ma && mb) {
      const rest = fitTokens(va.slice(ma[0].length), vb.slice(mb[0].length), fit);
      if (rest != null) {
        const sx = fit.split(+ma[1], +mb[1]),
          sy = fit.split(+ma[2], +mb[2]);
        if (sx || sy) {
          // 固定部分 + 比例部分写成两段 translate，等价于 translate(calc(...))
          const px = `translate(${fmt(sx ? sx[0] : 0, 'px')}, ${fmt(sy ? sy[0] : 0, 'px')})`;
          const x = sx ? fmt(sx[1], 'cqw') : fit.one(+ma[1], +mb[1]).css;
          const y = sy ? fmt(sy[1], 'cqw') : fit.one(+ma[2], +mb[2]).css;
          return `${px} translate(${x}, ${y})` + rest;
        }
        return `translate(${fit.one(+ma[1], +mb[1]).css}, ${fit.one(+ma[2], +mb[2]).css})` + rest;
      }
    }
  }
  return fitTokens(va, vb, fit);
}

function fitTokens(va: string, vb: string, fit: Fitter) {
  const sa = va.replace(PX, '#'),
    sb = vb.replace(PX, '#');
  if (sa !== sb) return null;
  const na = [...va.matchAll(PX)].map(match => +match[1]),
    nb = [...vb.matchAll(PX)].map(match => +match[1]);
  let i = 0;
  return sa.replace(/#/g, () => {
    const css = fit.one(na[i], nb[i]).css;
    i++;
    return css;
  });
}

/** 属性 → [值, 优先级] */
type StyleMap = Map<string, [string, string]>;
const parse = (styleEl: HTMLElement, text: string | null): StyleMap => {
  styleEl.setAttribute('style', text || '');
  const props: StyleMap = new Map();
  for (const prop of styleEl.style)
    props.set(prop, [styleEl.style.getPropertyValue(prop), styleEl.style.getPropertyPriority(prop)]);
  return props;
};

/**
 * A、B 是同一篇文章分别按 WA、WB 宽度转换出的预览片段（带 data-wxc 与 data-wxc-cw）。
 * 返回合并后的片段与统计；结构对不上的子树按 A 的值等比换算。
 */
export function mergeWidths(A: string, B: string) {
  const parser = document.implementation.createHTMLDocument('');
  const ra = parser.createElement('div'),
    rb = parser.createElement('div');
  ra.innerHTML = A;
  rb.innerHTML = B;
  const styleEl = parser.createElement('span');
  const stat: MergeStat = { cq: 0, split: 0, approx: 0, maxErr: 0, diverged: 0, where: [], at: '' };
  const scale = (value: string, W: number) =>
    value.replace(PX, (whole: string, num: string) => (Math.abs(+num) <= EPS ? whole : cq(+num, W)));

  const walk = (a: Element, b: Element | undefined) => {
    const same = b && a.localName === b.localName && a.children.length === b.children.length;
    if (!same && b) stat.diverged++;
    const wa = Number(a.getAttribute('data-wxc-cw')),
      wb = b ? Number(b.getAttribute('data-wxc-cw')) : 0;
    if (a.hasAttribute('style')) {
      const ma = parse(styleEl, a.getAttribute('style'));
      const mb: StyleMap = same ? parse(styleEl, b.getAttribute('style')) : new Map();
      const fit = fitter(wa, wb, stat);
      styleEl.removeAttribute('style');
      for (const [prop, [value, pri]] of ma) {
        const other = mb.get(prop);
        stat.at = `${a.getAttribute('data-wxc')} ${prop}`;
        let out: string | null = null;
        if (other && other[0] === value) out = value;
        else if (other && wa && wb) out = fitValue(prop, value, other[0], fit);
        if (out == null) {
          // 只有一边有，或者形状不同：没有第二个点可拟合，按比例换算并记为近似
          if (PX.test(value) && wa) {
            stat.approx++;
            out = /^(border|outline).*width$|^border-.*-width$/.test(prop) ? value : scale(value, wa);
          } else out = value;
          PX.lastIndex = 0;
        }
        styleEl.style.setProperty(prop, out, pri);
      }
      const merged = styleEl.getAttribute('style');
      if (merged) a.setAttribute('style', merged);
      else a.removeAttribute('style');
    }
    a.removeAttribute('data-wxc-cw');
    const ka = [...a.children],
      kb = same ? [...b.children] : [];
    ka.forEach((kid, i) => walk(kid, kb[i]));
  };
  for (let i = 0; i < ra.children.length; i++) walk(ra.children[i], rb.children[i]);
  return { html: ra.innerHTML, stat };
}

/** 每个元素记下自己的 cqw 基准：最近的查询容器（不含自身）的内容宽度，没有就用根容器 */
export function annotateContainerWidths(doc: Document, root: Element) {
  const win = viewOf(doc);
  const noTf = doc.createElement('style');
  noTf.textContent = NO_TRANSFORM;
  doc.head.appendChild(noTf);
  const cache = new Map<Element, number>();
  const cw = (el: Element) => {
    let w = cache.get(el);
    if (w == null) {
      const computed = win.getComputedStyle(el),
        rect = el.getBoundingClientRect();
      w =
        rect.width -
        parseFloat(computed.borderLeftWidth) -
        parseFloat(computed.borderRightWidth) -
        parseFloat(computed.paddingLeft) -
        parseFloat(computed.paddingRight);
      cache.set(el, w);
    }
    return w;
  };
  for (const el of [root, ...root.querySelectorAll('[style]')]) {
    let container: Element | null = el.parentElement;
    while (container && container !== root && win.getComputedStyle(container).containerType === 'normal')
      container = container.parentElement;
    if (!container || !root.contains(container)) container = root;
    if (el === root) container = root.parentElement ?? root;
    el.setAttribute('data-wxc-cw', String(round(cw(container))));
  }
  noTf.remove();
}

export const stripTool = (html: string) => html.replace(/\sdata-wxc(?:-[a-z]+)?="[^"]*"/g, '');

/**
 * 给超出版心的节点及其各级祖先打 data-ignore-width。
 * 内容结构检测的"段落级溢出"只认段落节点自己身上的这个属性（祖先不算，见 ru()），
 * 而编辑器按哪一层算"段"并不确定，所以整条祖先链都打上。
 */
export function markIgnoreWidth(html: string, ids: string[]) {
  if (!ids.length) return { html, n: 0 };
  const parser = document.implementation.createHTMLDocument('');
  const div = parser.createElement('div');
  div.innerHTML = html;
  let n = 0;
  for (const id of ids) {
    let el: Element | null = div.querySelector(`[data-wxc="${id}"]`);
    for (; el && el !== div; el = el.parentElement) {
      if (el.hasAttribute('data-ignore-width')) continue;
      el.setAttribute('data-ignore-width', '');
      n++;
    }
  }
  return { html: div.innerHTML, n };
}
