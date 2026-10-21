import { round, NO_TRANSFORM } from './util.ts';

// 微信存储会删掉含 calc() 的声明，但 cqw 与 container-type 原样保留。
// 同一篇文章按两个版心宽度各转一遍，逐个 px 数值拟合 v = k·W + b（W 是该元素查询容器的内容宽度）：
// b≈0 写成 cqw，k≈0 保留 px；两者都有时 translate 可以拆成两段相加，其余属性取主宽度下精确的近似值。
const PX = /(-?\d*\.?\d+(?:e-?\d+)?)px\b/gi;
const TRANSLATE = /^translate\((-?\d*\.?\d+(?:e-?\d+)?)px, (-?\d*\.?\d+(?:e-?\d+)?)px\)/;
const EPS = 0.06;
const fmt = (n, u) => { const r = round(n); return (Object.is(r, -0) ? 0 : r) + u; };
const cq = (v, W) => {
  const r = Math.round(v / W * 100 * 1000) / 1000;
  return r ? fmt(r, 'cqw') : '0px';
};

function fitter(WA, WB, stat) {
  /** 一个长度在两个宽度下的值 → { css, exact } */
  const one = (a, b) => {
    if (Math.abs(a - b) <= EPS) return { css: fmt(a, 'px'), exact: true };
    if (Math.abs(WA - WB) < 0.5) { stat.approx++; return { css: fmt(a, 'px'), exact: false }; }
    const k = (a - b) / (WA - WB), c = a - k * WA;
    // 文字排版有亚像素舍入，两条线定出的截距不会正好是 0；1.2px 以内的当作纯比例，
    // 它在任意宽度下的偏差都不超过这么多，而逐宽度比对（容差 1.5px）会兜住真出错的情况
    if (Math.abs(c) <= 1.2) { stat.cq++; return { css: cq(a, WA), exact: true }; }
    // 边框宽度会被浏览器向下取整到整像素：找一个比例 k 使 floor(k·WA)=a 且 floor(k·WB)=b
    if (Number.isInteger(a) && Number.isInteger(b)) {
      const lo = Math.max(a / WA, b / WB), hi = Math.min((a + 1) / WA, (b + 1) / WB);
      if (lo < hi) { stat.cq++; return { css: fmt((lo + hi) / 2 * 100, 'cqw'), exact: true }; }
    }
    stat.approx++;
    stat.maxErr = Math.max(stat.maxErr, Math.abs(c));
    stat.where.push(`${stat.at} ${a}@${WA}/${b}@${WB}`);
    return { css: cq(a, WA), exact: false };
  };
  const split = (a, b) => {
    if (Math.abs(a - b) <= EPS || Math.abs(WA - WB) < 0.5) return null;
    const k = (a - b) / (WA - WB), c = a - k * WA;
    if (Math.abs(c) <= 0.25) return null;
    stat.split++;
    return [c, k * 100];
  };
  return { one, split };
}

/** 同一属性两个值的 px 换成拟合结果；形状不同（比如只有一边多了位移）时退回按比例换算 */
function fitValue(prop, va, vb, F) {
  if (prop === 'transform') {
    const ma = va.match(TRANSLATE), mb = vb.match(TRANSLATE);
    if (ma && mb) {
      const rest = fitTokens(va.slice(ma[0].length), vb.slice(mb[0].length), F);
      if (rest != null) {
        const sx = F.split(+ma[1], +mb[1]), sy = F.split(+ma[2], +mb[2]);
        if (sx || sy) {
          // 固定部分 + 比例部分写成两段 translate，等价于 translate(calc(...))
          const px = `translate(${fmt(sx ? sx[0] : 0, 'px')}, ${fmt(sy ? sy[0] : 0, 'px')})`;
          const x = sx ? fmt(sx[1], 'cqw') : F.one(+ma[1], +mb[1]).css;
          const y = sy ? fmt(sy[1], 'cqw') : F.one(+ma[2], +mb[2]).css;
          return `${px} translate(${x}, ${y})` + rest;
        }
        return `translate(${F.one(+ma[1], +mb[1]).css}, ${F.one(+ma[2], +mb[2]).css})` + rest;
      }
    }
  }
  return fitTokens(va, vb, F);
}

function fitTokens(va, vb, F) {
  const sa = va.replace(PX, '#'), sb = vb.replace(PX, '#');
  if (sa !== sb) return null;
  const na = [...va.matchAll(PX)].map(m => +m[1]), nb = [...vb.matchAll(PX)].map(m => +m[1]);
  let i = 0;
  return sa.replace(/#/g, () => { const r = F.one(na[i], nb[i]).css; i++; return r; });
}

const parse = (st, text) => {
  st.setAttribute('style', text || '');
  const m = new Map();
  for (const p of st.style) m.set(p, [st.style.getPropertyValue(p), st.style.getPropertyPriority(p)]);
  return m;
};

/**
 * A、B 是同一篇文章分别按 WA、WB 宽度转换出的预览片段（带 data-wxc 与 data-wxc-cw）。
 * 返回合并后的片段与统计；结构对不上的子树按 A 的值等比换算。
 */
export function mergeWidths(A, B) {
  const parser = document.implementation.createHTMLDocument('');
  const ra = parser.createElement('div'), rb = parser.createElement('div');
  ra.innerHTML = A; rb.innerHTML = B;
  const st = parser.createElement('span');
  const stat = { cq: 0, split: 0, approx: 0, maxErr: 0, diverged: 0, where: [], at: '' };
  const scale = (v, W) => v.replace(PX, (m, n) => Math.abs(+n) <= EPS ? m : cq(+n, W));

  const walk = (a, b) => {
    const same = b && a.localName === b.localName && a.children.length === b.children.length;
    if (!same && b) stat.diverged++;
    const wa = +a.getAttribute('data-wxc-cw'), wb = b ? +b.getAttribute('data-wxc-cw') : 0;
    if (a.hasAttribute('style')) {
      const ma = parse(st, a.getAttribute('style'));
      const mb = same ? parse(st, b.getAttribute('style')) : new Map();
      const F = fitter(wa, wb, stat);
      st.removeAttribute('style');
      for (const [p, [v, pri]] of ma) {
        const o = mb.get(p);
        stat.at = `${a.getAttribute('data-wxc')} ${p}`;
        let out = null;
        if (o && o[0] === v) out = v;
        else if (o && wa && wb) out = fitValue(p, v, o[0], F);
        if (out == null) {
          // 只有一边有，或者形状不同：没有第二个点可拟合，按比例换算并记为近似
          if (PX.test(v) && wa) { stat.approx++; out = /^(border|outline).*width$|^border-.*-width$/.test(p) ? v : scale(v, wa); } else out = v;
          PX.lastIndex = 0;
        }
        st.style.setProperty(p, out, pri);
      }
      const s = st.getAttribute('style');
      if (s) a.setAttribute('style', s); else a.removeAttribute('style');
    }
    a.removeAttribute('data-wxc-cw');
    const ka = [...a.children], kb = same ? [...b.children] : [];
    ka.forEach((k, i) => walk(k, kb[i]));
  };
  for (let i = 0; i < ra.children.length; i++) walk(ra.children[i], rb.children[i]);
  return { html: ra.innerHTML, stat };
}

/** 每个元素记下自己的 cqw 基准：最近的查询容器（不含自身）的内容宽度，没有就用根容器 */
export function annotateContainerWidths(doc, root) {
  const win = doc.defaultView;
  const noTf = doc.createElement('style');
  noTf.textContent = NO_TRANSFORM;
  doc.head.appendChild(noTf);
  const cache = new Map();
  const cw = el => {
    let w = cache.get(el);
    if (w == null) {
      const c = win.getComputedStyle(el), r = el.getBoundingClientRect();
      w = r.width - parseFloat(c.borderLeftWidth) - parseFloat(c.borderRightWidth) - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight);
      cache.set(el, w);
    }
    return w;
  };
  for (const el of [root, ...root.querySelectorAll('[style]')]) {
    let a = el.parentElement;
    while (a && a !== root && win.getComputedStyle(a).containerType === 'normal') a = a.parentElement;
    if (!a || !root.contains(a)) a = root;
    if (el === root) a = root.parentElement;
    el.setAttribute('data-wxc-cw', String(round(cw(a))));
  }
  noTf.remove();
}

export const stripTool = html => html.replace(/\sdata-wxc(?:-[a-z]+)?="[^"]*"/g, '');

/**
 * 给超出版心的节点及其各级祖先打 data-ignore-width。
 * 内容结构检测的"段落级溢出"只认段落节点自己身上的这个属性（祖先不算，见 ru()），
 * 而编辑器按哪一层算"段"并不确定，所以整条祖先链都打上。
 */
export function markIgnoreWidth(html, ids) {
  if (!ids.length) return { html, n: 0 };
  const parser = document.implementation.createHTMLDocument('');
  const div = parser.createElement('div');
  div.innerHTML = html;
  let n = 0;
  for (const id of ids) {
    let el = div.querySelector(`[data-wxc="${id}"]`);
    for (; el && el !== div; el = el.parentElement) {
      if (el.hasAttribute('data-ignore-width')) continue;
      el.setAttribute('data-ignore-width', '');
      n++;
    }
  }
  return { html: div.innerHTML, n };
}
