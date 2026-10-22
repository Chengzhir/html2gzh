// CSS 关键帧（每段各自的 easing）→ SMIL 的 keyTimes/values（+ keySplines）。
// steps() 用相同的 keyTimes 做跳变；超出 [0,1] 的贝塞尔（回弹）和不用 spline 的场合按 16 点线性采样

const NAMED = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};
const SAMPLES = 16;

/** easing 字符串 → { kind: 'linear' } | { kind: 'cubic', p } | { kind: 'steps', n, pos }；不认识返回 null */
export function parseEasing(s) {
  s = (s || 'linear').trim();
  if (s === 'linear') return { kind: 'linear' };
  if (NAMED[s]) return { kind: 'cubic', p: NAMED[s] };
  let m = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(s);
  if (m) {
    const p = m.slice(1).map(Number);
    return p.some(Number.isNaN) ? null : p[0] === p[1] && p[2] === p[3] ? { kind: 'linear' } : { kind: 'cubic', p };
  }
  if (s === 'step-start') return { kind: 'steps', n: 1, pos: 'start' };
  if (s === 'step-end') return { kind: 'steps', n: 1, pos: 'end' };
  m = /^steps\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/.exec(s);
  if (m) {
    const pos = (m[2] || 'end').replace('jump-', '');
    const n = +m[1];
    return n < 1 || (pos === 'none' && n < 2) ? null : { kind: 'steps', n, pos };
  }
  return null;
}
/** 倒着播放时这一段的 easing：e'(q) = 1 − e(1 − q) */
export function reverseEasing(e) {
  if (e.kind === 'cubic') {
    const [a, b, c, d] = e.p;
    return { kind: 'cubic', p: [1 - c, 1 - d, 1 - a, 1 - b] };
  }
  if (e.kind === 'steps') return { ...e, pos: e.pos === 'start' ? 'end' : e.pos === 'end' ? 'start' : e.pos };
  return e;
}

function bezierY(p, x) {
  const [x1, y1, x2, y2] = p;
  const bx = t => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}
/** steps 在区间 [k/n, (k+1)/n) 上的输出进度 */
function stepLevel(e, k) {
  if (e.pos === 'start') return (k + 1) / e.n;
  if (e.pos === 'end') return k / e.n;
  if (e.pos === 'both') return (k + 1) / (e.n + 1);
  return k / (e.n - 1);
}

/**
 * kf: [{ off, v, e }]（off 从 0 到 1，e 是从这一帧到下一帧的 easing），lerp(a, b, p) 给出插值后的值。
 * spline=true 时三次贝塞尔写成 keySplines，否则采样。返回 { times, values, splines|null }
 */
export function compile(kf, lerp, spline) {
  const times = [kf[0].off],
    values = [kf[0].v],
    splines = [];
  const push = (t, v, sp = '0 0 1 1') => {
    times.push(t);
    values.push(v);
    splines.push(sp);
  };
  for (let i = 0; i + 1 < kf.length; i++) {
    const a = kf[i],
      b = kf[i + 1],
      span = b.off - a.off,
      e = a.e;
    if (span <= 0) {
      push(b.off, b.v);
      continue;
    }
    if (e.kind === 'linear') push(b.off, b.v);
    else if (e.kind === 'cubic' && spline && e.p.every(x => x >= 0 && x <= 1))
      push(b.off, b.v, e.p.map(x => Math.round(x * 1e4) / 1e4).join(' '));
    else if (e.kind === 'cubic')
      for (let j = 1; j <= SAMPLES; j++) {
        const f = j / SAMPLES;
        push(a.off + span * f, j === SAMPLES ? b.v : lerp(a.v, b.v, bezierY(e.p, f)));
      }
    else {
      // 每个台阶：在台阶起点跳到该级，保持到下一个台阶起点
      for (let k = 0; k < e.n; k++) {
        const t = a.off + (span * k) / e.n,
          lv = stepLevel(e, k);
        if (k || lv) push(t, lerp(a.v, b.v, lv));
        push(a.off + (span * (k + 1)) / e.n, lerp(a.v, b.v, lv));
      }
      push(b.off, b.v);
    }
  }
  return { times, values, splines: spline && splines.some(s => s !== '0 0 1 1') ? splines : null };
}

/** 离散属性（visibility）：两帧之间取 CSS 的插值规则——有一端可见，中间就可见 */
export function compileDiscrete(kf, interior) {
  const times = [],
    values = [];
  for (let i = 0; i + 1 < kf.length; i++) {
    times.push(kf[i].off);
    values.push(interior(kf[i].v, kf[i + 1].v));
  }
  times.push(1);
  values.push(kf[kf.length - 1].v);
  return { times, values, splines: null };
}

const r4 = n => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
};
/** 值的种类：数字、颜色、路径（结构相同才插值） */
export const KINDS = {
  number: {
    parse: s => {
      const m = /^(-?[\d.]+(?:e-?\d+)?)(px)?$/.exec(String(s).trim());
      return m ? +m[1] : null;
    },
    lerp: (a, b, p) => a + (b - a) * p,
    str: r4,
  },
  color: {
    parse: s => {
      const m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(String(s).trim());
      return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null;
    },
    lerp: (a, b, p) => a.map((x, i) => x + (b[i] - x) * p),
    str: c =>
      c[3] >= 1
        ? `rgb(${c.slice(0, 3).map(Math.round).join(',')})`
        : `rgba(${c.slice(0, 3).map(Math.round).join(',')},${r4(c[3])})`,
  },
  path: {
    parse: s => {
      const m = /^path\(\s*["'](.*)["']\s*\)$/.exec(String(s).trim());
      const d = m ? m[1] : String(s);
      return {
        skel: d.replace(/-?[\d.]+(?:e-?\d+)?/g, '#'),
        nums: (d.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number),
      };
    },
    lerp: (a, b, p) =>
      a.skel === b.skel ? { skel: a.skel, nums: a.nums.map((x, i) => x + (b.nums[i] - x) * p) } : p < 0.5 ? a : b,
    str: v => {
      let i = 0;
      return v.skel.replace(/#/g, () => r4(v.nums[i++]));
    },
  },
};
