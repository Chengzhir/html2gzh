// SVG 几何：路径解析与变换、基本形状转路径。只用 M/L/C/Z 绝对命令输出，变换后形状不走样（圆弧先转三次贝塞尔）

/** 矩阵 [a,b,c,d,e,f] */
export type Matrix = number[];
/** 路径段：[命令, ...参数] */
export type PathSeg = [cmd: string, ...args: number[]];

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const fmt = (n: number) => {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** 路径字符串 → [[命令, ...参数]]，原样保留相对/绝对与简写；格式错误时截断在出错处（与浏览器一致） */
function parsePath(d: string | null): PathSeg[] {
  const out: PathSeg[] = [];
  const re = /([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let cmd: string | null = null,
    args: number[] = [],
    match: RegExpExecArray | null;
  const push = (command: string) => {
    const n = ARGS[command.toUpperCase()];
    if (n === 0) {
      out.push([command]);
      return;
    }
    if (!args.length || args.length % n) return;
    for (let i = 0; i < args.length; i += n) {
      // M 后面多余的坐标对按 L 处理
      const segCmd = i && (command === 'M' || command === 'm') ? (command === 'M' ? 'L' : 'l') : command;
      out.push([segCmd, ...args.slice(i, i + n)]);
    }
  };
  // 圆弧的两个标志位只有一位，可以与后面的数紧挨着写（"a1 1 0 01 10 10"、"a1 1 0 0 110 10"），在标志位上逐位拆开
  const src = d || '';
  while ((match = re.exec(src))) {
    if (match[1]) {
      if (cmd) push(cmd);
      cmd = match[1];
      args = [];
      continue;
    }
    if (!cmd) break;
    let token = match[2];
    if (cmd === 'A' || cmd === 'a')
      while ([3, 4].includes(args.length % 7) && /^[01]./.test(token)) {
        args.push(+token[0]);
        token = token.slice(1);
      }
    args.push(+token);
  }
  if (cmd) push(cmd);
  return out;
}

/** 转成只含 M/L/C/Z 的绝对坐标段 */
function toAbsolute(segs: PathSeg[]): PathSeg[] {
  const out: PathSeg[] = [];
  // 上一段是 C/S（或 Q/T）时它的第二个控制点；S（或 T）按它反射出第一个控制点，否则用当前点
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    lastCubic: number[] | null = null,
    lastQuad: number[] | null = null;
  for (const seg of segs) {
    const cmd = seg[0],
      rel = cmd !== cmd.toUpperCase(),
      C = cmd.toUpperCase(),
      args = seg.slice(1) as number[];
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    const prevCubic = lastCubic,
      prevQuad = lastQuad;
    lastCubic = lastQuad = null;
    if (C === 'M') {
      x = args[0] + ox;
      y = args[1] + oy;
      sx = x;
      sy = y;
      out.push(['M', x, y]);
    } else if (C === 'Z') {
      out.push(['Z']);
      x = sx;
      y = sy;
    } else if (C === 'L') {
      x = args[0] + ox;
      y = args[1] + oy;
      out.push(['L', x, y]);
    } else if (C === 'H') {
      x = args[0] + ox;
      out.push(['L', x, y]);
    } else if (C === 'V') {
      y = args[0] + oy;
      out.push(['L', x, y]);
    } else if (C === 'C') {
      const points: number[] = [args[0] + ox, args[1] + oy, args[2] + ox, args[3] + oy, args[4] + ox, args[5] + oy];
      out.push(['C', ...points]);
      lastCubic = [points[2], points[3]];
      x = points[4];
      y = points[5];
    } else if (C === 'S') {
      const reflected = prevCubic ? [2 * x - prevCubic[0], 2 * y - prevCubic[1]] : [x, y];
      const points: number[] = [reflected[0], reflected[1], args[0] + ox, args[1] + oy, args[2] + ox, args[3] + oy];
      out.push(['C', ...points]);
      lastCubic = [points[2], points[3]];
      x = points[4];
      y = points[5];
    } else if (C === 'Q' || C === 'T') {
      const control: number[] =
        C === 'Q' ? [args[0] + ox, args[1] + oy] : prevQuad ? [2 * x - prevQuad[0], 2 * y - prevQuad[1]] : [x, y];
      const end = C === 'Q' ? [args[2] + ox, args[3] + oy] : [args[0] + ox, args[1] + oy];
      out.push([
        'C',
        x + (2 / 3) * (control[0] - x),
        y + (2 / 3) * (control[1] - y),
        end[0] + (2 / 3) * (control[0] - end[0]),
        end[1] + (2 / 3) * (control[1] - end[1]),
        end[0],
        end[1],
      ]);
      lastQuad = control;
      x = end[0];
      y = end[1];
    } else if (C === 'A') {
      const ex = args[5] + ox,
        ey = args[6] + oy;
      for (const cubic of arcToCubic(x, y, args[0], args[1], args[2], args[3], args[4], ex, ey))
        out.push(['C', ...cubic]);
      x = ex;
      y = ey;
    }
  }
  return out;
}

/** SVG 圆弧（端点参数）→ 若干段三次贝塞尔，每段不超过 90° */
function arcToCubic(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phi: number,
  fa: number,
  fs: number,
  x2: number,
  y2: number,
): number[][] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const radians = (phi * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy,
    yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp,
    den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry,
    cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2,
    cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const out: number[][] = [],
    step = dt / n,
    kk = (4 / 3) * Math.tan(step / 4);
  const pointAt = (t: number) => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const derivativeAt = (t: number) => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step,
      b = a + step,
      p0 = pointAt(a),
      p3 = pointAt(b),
      d0 = derivativeAt(a),
      d3 = derivativeAt(b);
    out.push([p0[0] + kk * d0[0], p0[1] + kk * d0[1], p3[0] - kk * d3[0], p3[1] - kk * d3[1], p3[0], p3[1]]);
  }
  const last = out[out.length - 1];
  last[4] = x2;
  last[5] = y2;
  return out;
}

/** 绝对段乘矩阵 m = [a,b,c,d,e,f] */
export function transformPath(segs: PathSeg[], m: Matrix): PathSeg[] {
  const apply = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return segs.map(seg => {
    if (seg[0] === 'Z') return seg;
    const out: PathSeg = [seg[0]];
    for (let i = 1; i < seg.length; i += 2) out.push(...apply(seg[i] as number, seg[i + 1] as number));
    return out;
  });
}

export const serializePath = (segs: PathSeg[]) =>
  segs.map(seg => seg[0] + (seg.slice(1) as number[]).map(fmt).join(' ')).join('');

/** 每个子路径的有向面积（控制点折线近似），用来判断绕向 */
export function subpaths(segs: PathSeg[]): PathSeg[][] {
  const out: PathSeg[][] = [];
  let cur: PathSeg[] | null = null;
  for (const seg of segs) {
    if (seg[0] === 'M') out.push((cur = [seg]));
    else if (cur) cur.push(seg);
  }
  return out;
}
export function signedArea(subpath: PathSeg[]): number {
  const points: number[][] = [];
  for (const seg of subpath)
    for (let i = 1; i < seg.length; i += 2) points.push([seg[i] as number, seg[i + 1] as number]);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i],
      [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
/** 反转一个子路径的走向（M/L/C/Z 段） */
export function reverseSubpath(subpath: PathSeg[]): PathSeg[] {
  const closed = subpath[subpath.length - 1][0] === 'Z';
  const body = closed ? subpath.slice(0, -1) : subpath;
  const ends = body.map(seg => [seg[seg.length - 2] as number, seg[seg.length - 1] as number]);
  const out: PathSeg[] = [['M', ...ends[ends.length - 1]]];
  for (let i = body.length - 1; i > 0; i--) {
    const seg = body[i],
      to = ends[i - 1];
    out.push(seg[0] === 'C' ? ['C', seg[3], seg[4], seg[1], seg[2], ...to] : ['L', ...to]);
  }
  if (closed) out.push(['Z']);
  return out;
}

/** 基本形状 → 绝对段。g(name) 读几何量（user units），读不到返回 null */
export function shapeSegs(el: Element, g: GeometryRead): PathSeg[] | null {
  const tag = el.localName;
  if (tag === 'path') return toAbsolute(parsePath(g('d')));
  if (tag === 'rect') {
    const x = g('x') || 0,
      y = g('y') || 0,
      w = g('width'),
      h = g('height');
    if (w == null || h == null || !(w > 0 && h > 0)) return [];
    // rx、ry 只写一个时另一个取同值，都没写时为 0
    const rxRead = g('rx'),
      ryRead = g('ry');
    const rx = Math.min(Math.max(rxRead ?? ryRead ?? 0, 0), w / 2),
      ry = Math.min(Math.max(ryRead ?? rxRead ?? 0, 0), h / 2);
    return roundRect(x, y, w, h, rx, ry);
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = g('cx') || 0,
      cy = g('cy') || 0;
    const rxRead = tag === 'circle' ? g('r') : g('rx'),
      ryRead = tag === 'circle' ? rxRead : g('ry');
    const rx = rxRead ?? ryRead,
      ry = ryRead ?? rxRead;
    if (rx == null || ry == null || !(rx > 0 && ry > 0)) return [];
    return toAbsolute([
      ['M', cx + rx, cy],
      ['A', rx, ry, 0, 0, 1, cx, cy + ry],
      ['A', rx, ry, 0, 0, 1, cx - rx, cy],
      ['A', rx, ry, 0, 0, 1, cx, cy - ry],
      ['A', rx, ry, 0, 0, 1, cx + rx, cy],
      ['Z'],
    ]);
  }
  if (tag === 'line')
    return [
      ['M', g('x1') || 0, g('y1') || 0],
      ['L', g('x2') || 0, g('y2') || 0],
    ];
  if (tag === 'polyline' || tag === 'polygon') {
    const points = (el.getAttribute('points') || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (points.length < 4 || points.some(Number.isNaN)) return [];
    const out: PathSeg[] = [['M', points[0], points[1]]];
    for (let i = 2; i + 1 < points.length; i += 2) out.push(['L', points[i], points[i + 1]]);
    if (tag === 'polygon') out.push(['Z']);
    return out;
  }
  return null;
}
/** 圆角矩形：圆角为 0 时也写出圆弧段，保证不同圆角的帧之间路径结构一致、可以插值 */
function roundRect(x: number, y: number, w: number, h: number, rx: number, ry: number): PathSeg[] {
  return toAbsolute([
    ['M', x + rx, y],
    ['L', x + w - rx, y],
    ['A', rx, ry, 0, 0, 1, x + w, y + ry],
    ['L', x + w, y + h - ry],
    ['A', rx, ry, 0, 0, 1, x + w - rx, y + h],
    ['L', x + rx, y + h],
    ['A', rx, ry, 0, 0, 1, x, y + h - ry],
    ['L', x, y + ry],
    ['A', rx, ry, 0, 0, 1, x + rx, y],
    ['Z'],
  ]);
}

/** g(name)：几何量（user units），读不到为 null；只有 'd' 返回路径字符串 */
// 名字是字面量 'd' 时才是字符串；宽泛的 string（含 any）一律按数值
export type GeometryRead = <Name extends string>(
  name: Name,
) => string extends Name ? number | null : Name extends 'd' ? string | null : number | null;
/** 读元素的几何量：内联 style 优先（层叠已内联进来），否则读属性的 baseVal（百分比已按视口换算） */
export function geometryReader(el: SVGElement): GeometryRead {
  // 按属性名取 SVGAnimatedLength 之类的动画值（el.x、el.width……）
  const animatedProps = el as unknown as Record<string, { baseVal?: { value?: unknown } } | undefined>;
  return ((name: string): string | number | null => {
    const css = el.style && el.style.getPropertyValue(name);
    if (css && name === 'd') {
      const match = css.match(/^path\(\s*["'](.*)["']\s*\)$/);
      if (match) return match[1];
    }
    if (name === 'd') return el.getAttribute('d');
    if (css && /^-?[\d.]+(px)?$/.test(css.trim())) return parseFloat(css);
    const animated = animatedProps[name] && animatedProps[name].baseVal;
    if (animated && typeof animated.value === 'number') return el.hasAttribute(name) ? animated.value : null;
    const value = el.getAttribute(name);
    return value == null ? null : parseFloat(value);
  }) as GeometryRead;
}

/** 矩阵运算 [a,b,c,d,e,f] */
export const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export const inv = (m: Matrix): Matrix => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
};
export const ID_M: Matrix = [1, 0, 0, 1, 0, 0];
export const isId = (m: Matrix): boolean => m.every((value, i) => Math.abs(value - ID_M[i]) < 1e-9);
export function fromDom(m: DOMMatrixReadOnly): Matrix;
export function fromDom(m: DOMMatrixReadOnly | null): Matrix | null;
export function fromDom(m: DOMMatrixReadOnly | null): Matrix | null {
  return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null;
}
export const matrixAttr = (m: Matrix): string => `matrix(${m.map(fmt).join(' ')})`;
