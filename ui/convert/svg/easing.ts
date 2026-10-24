// CSS 关键帧（每段各自的 easing）→ SMIL 的 keyTimes/values（+ keySplines）。
// steps() 用相同的 keyTimes 做跳变；超出 [0,1] 的贝塞尔（回弹）按 16 点线性采样

const NAMED: Record<string, number[]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};
const SAMPLES = 16;

interface LinearEasing {
  kind: 'linear';
}
interface CubicEasing {
  kind: 'cubic';
  /** cubic-bezier 的 x1 y1 x2 y2 */
  p: number[];
}
/** steps() 的跳变位置（去掉 jump- 前缀） */
type StepPosition = 'start' | 'end' | 'none' | 'both';
interface StepsEasing {
  kind: 'steps';
  n: number;
  pos: StepPosition;
}
export type Easing = LinearEasing | CubicEasing | StepsEasing;

/** 一帧：off 从 0 到 1，e 是从这一帧到下一帧的 easing */
export interface Keyframe<V> {
  off: number;
  v: V;
  e: Easing;
}
/** compile 的结果；splines 为 null 表示不写 keySplines */
export interface CompiledSeries<V> {
  times: number[];
  values: V[];
  splines: string[] | null;
}

/** easing 字符串 → { kind: 'linear' } | { kind: 'cubic', p } | { kind: 'steps', n, pos }；不认识返回 null */
export function parseEasing(text: string | null | undefined): Easing | null {
  text = (text || 'linear').trim();
  if (text === 'linear') return { kind: 'linear' };
  if (NAMED[text]) return { kind: 'cubic', p: NAMED[text] };
  let match = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(text);
  if (match) {
    const p = match.slice(1).map(Number);
    return p.some(Number.isNaN) ? null : p[0] === p[1] && p[2] === p[3] ? { kind: 'linear' } : { kind: 'cubic', p };
  }
  if (text === 'step-start') return { kind: 'steps', n: 1, pos: 'start' };
  if (text === 'step-end') return { kind: 'steps', n: 1, pos: 'end' };
  match = /^steps\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/.exec(text);
  if (match) {
    const pos = (match[2] || 'end').replace('jump-', '') as StepPosition;
    const n = +match[1];
    return n < 1 || (pos === 'none' && n < 2) ? null : { kind: 'steps', n, pos };
  }
  return null;
}
/** 倒着播放时这一段的 easing：e'(q) = 1 − e(1 − q) */
export function reverseEasing(easing: Easing): Easing {
  if (easing.kind === 'cubic') {
    const [x1, y1, x2, y2] = easing.p;
    return { kind: 'cubic', p: [1 - x2, 1 - y2, 1 - x1, 1 - y1] };
  }
  if (easing.kind === 'steps')
    return { ...easing, pos: easing.pos === 'start' ? 'end' : easing.pos === 'end' ? 'start' : easing.pos };
  return easing;
}

function bezierY(p: number[], x: number): number {
  const [x1, y1, x2, y2] = p;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
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
function stepLevel(easing: StepsEasing, k: number): number {
  if (easing.pos === 'start') return (k + 1) / easing.n;
  if (easing.pos === 'end') return k / easing.n;
  if (easing.pos === 'both') return (k + 1) / (easing.n + 1);
  return k / (easing.n - 1);
}

/**
 * keyframes: [{ off, v, e }]（off 从 0 到 1，e 是从这一帧到下一帧的 easing），lerp(a, b, p) 给出插值后的值。
 * 三次贝塞尔写成 keySplines。返回 { times, values, splines|null }
 */
export function compile<V>(keyframes: Keyframe<V>[], lerp: (a: V, b: V, p: number) => V): CompiledSeries<V> {
  const times = [keyframes[0].off],
    values = [keyframes[0].v],
    splines: string[] = [];
  const push = (time: number, value: V, splineText = '0 0 1 1') => {
    times.push(time);
    values.push(value);
    splines.push(splineText);
  };
  for (let i = 0; i + 1 < keyframes.length; i++) {
    const a = keyframes[i],
      b = keyframes[i + 1],
      span = b.off - a.off,
      easing = a.e;
    if (span <= 0) {
      push(b.off, b.v);
      continue;
    }
    if (easing.kind === 'linear') push(b.off, b.v);
    else if (easing.kind === 'cubic' && easing.p.every(x => x >= 0 && x <= 1))
      push(b.off, b.v, easing.p.map(x => Math.round(x * 1e4) / 1e4).join(' '));
    else if (easing.kind === 'cubic')
      for (let j = 1; j <= SAMPLES; j++) {
        const fraction = j / SAMPLES;
        push(a.off + span * fraction, j === SAMPLES ? b.v : lerp(a.v, b.v, bezierY(easing.p, fraction)));
      }
    else {
      // 每个台阶：在台阶起点跳到该级，保持到下一个台阶起点
      for (let k = 0; k < easing.n; k++) {
        const time = a.off + (span * k) / easing.n,
          level = stepLevel(easing, k);
        if (k || level) push(time, lerp(a.v, b.v, level));
        push(a.off + (span * (k + 1)) / easing.n, lerp(a.v, b.v, level));
      }
      push(b.off, b.v);
    }
  }
  return { times, values, splines: splines.some(text => text !== '0 0 1 1') ? splines : null };
}

/**
 * 离散属性（visibility）：两帧之间取 CSS 的插值规则——有一端可见，中间就可见。
 * steps() 把一段分成几个台阶，按台阶的进度取值：进度为 0 是前一帧（step-end 整段都是），为 1 是后一帧
 */
export function compileDiscrete<V>(
  keyframes: Keyframe<V>[],
  interior: (from: V, to: V) => V,
): CompiledSeries<V> & { splines: null } {
  const times: number[] = [],
    values: V[] = [];
  for (let i = 0; i + 1 < keyframes.length; i++) {
    const a = keyframes[i],
      b = keyframes[i + 1],
      easing = a.e;
    if (easing.kind !== 'steps') {
      times.push(a.off);
      values.push(interior(a.v, b.v));
      continue;
    }
    for (let k = 0; k < easing.n; k++) {
      const level = stepLevel(easing, k);
      times.push(a.off + ((b.off - a.off) * k) / easing.n);
      values.push(level <= 0 ? a.v : level >= 1 ? b.v : interior(a.v, b.v));
    }
  }
  times.push(1);
  values.push(keyframes[keyframes.length - 1].v);
  return { times, values, splines: null };
}

const r4 = (value: number): number => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};
/** 路径值：skel 是数字换成 # 的骨架，nums 是依次的数字 */
export interface PathValue {
  skel: string;
  nums: number[];
}
/** 一种值的解析、插值与序列化；parse 读不出返回 null */
export interface ValueKind<V> {
  parse: (raw: unknown) => V | null;
  lerp: (a: V, b: V, p: number) => V;
  str: (value: V) => string | number;
}
/** 值的种类：数字、颜色、路径（结构相同才插值） */
export const KINDS: { number: ValueKind<number>; color: ValueKind<number[]>; path: ValueKind<PathValue> } = {
  number: {
    parse: raw => {
      const match = /^(-?[\d.]+(?:e-?\d+)?)(px)?$/.exec(String(raw).trim());
      return match ? +match[1] : null;
    },
    lerp: (a, b, p) => a + (b - a) * p,
    str: r4,
  },
  color: {
    parse: raw => {
      const match = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(String(raw).trim());
      return match ? [+match[1], +match[2], +match[3], match[4] == null ? 1 : +match[4]] : null;
    },
    lerp: (a, b, p) => a.map((x, i) => x + (b[i] - x) * p),
    str: rgba =>
      rgba[3] >= 1
        ? `rgb(${rgba.slice(0, 3).map(Math.round).join(',')})`
        : `rgba(${rgba.slice(0, 3).map(Math.round).join(',')},${r4(rgba[3])})`,
  },
  path: {
    parse: raw => {
      const match = /^path\(\s*["'](.*)["']\s*\)$/.exec(String(raw).trim());
      const d = match ? match[1] : String(raw);
      return {
        skel: d.replace(/-?[\d.]+(?:e-?\d+)?/g, '#'),
        nums: (d.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number),
      };
    },
    lerp: (a, b, p) =>
      a.skel === b.skel ? { skel: a.skel, nums: a.nums.map((x, i) => x + (b.nums[i] - x) * p) } : p < 0.5 ? a : b,
    str: value => {
      let i = 0;
      return value.skel.replace(/#/g, () => String(r4(value.nums[i++])));
    },
  },
};
