// SVG 几何：路径解析与变换、基本形状转路径。只用 M/L/C/Z 绝对命令输出，变换后形状不走样（圆弧先转三次贝塞尔）

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const fmt = n => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** 路径字符串 → [[命令, ...参数]]，原样保留相对/绝对与简写；格式错误时截断在出错处（与浏览器一致） */
export function parsePath(d) {
  const out = [];
  const re = /([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let cmd = null,
    args = [],
    m;
  const push = () => {
    const n = ARGS[cmd.toUpperCase()];
    if (n === 0) {
      out.push([cmd]);
      return;
    }
    if (!args.length || args.length % n) return;
    for (let i = 0; i < args.length; i += n) {
      // M 后面多余的坐标对按 L 处理
      const c = i && (cmd === 'M' || cmd === 'm') ? (cmd === 'M' ? 'L' : 'l') : cmd;
      out.push([c, ...args.slice(i, i + n)]);
    }
  };
  // 圆弧的两个标志位可以不带分隔符紧挨着写（"a1 1 0 01 10 10"），按位拆开
  const src = d || '';
  while ((m = re.exec(src))) {
    if (m[1]) {
      if (cmd) push();
      cmd = m[1];
      args = [];
      continue;
    }
    if (!cmd) break;
    if ((cmd === 'A' || cmd === 'a') && [3, 4].includes(args.length % 7) && /^[01]{2,}/.test(m[2])) {
      for (const ch of m[2].slice(0, 2)) args.push(+ch);
      const rest = m[2].slice(2);
      if (rest) args.push(+rest);
      continue;
    }
    args.push(+m[2]);
  }
  if (cmd) push();
  return out;
}

/** 转成只含 M/L/C/Z 的绝对坐标段 */
export function toAbsolute(segs) {
  const out = [];
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    lc = null,
    lq = null,
    prev = '';
  for (const s of segs) {
    const c = s[0],
      rel = c !== c.toUpperCase(),
      C = c.toUpperCase(),
      a = s.slice(1);
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    if (C === 'M') {
      x = a[0] + ox;
      y = a[1] + oy;
      sx = x;
      sy = y;
      out.push(['M', x, y]);
    } else if (C === 'Z') {
      out.push(['Z']);
      x = sx;
      y = sy;
    } else if (C === 'L') {
      x = a[0] + ox;
      y = a[1] + oy;
      out.push(['L', x, y]);
    } else if (C === 'H') {
      x = a[0] + ox;
      out.push(['L', x, y]);
    } else if (C === 'V') {
      y = a[0] + oy;
      out.push(['L', x, y]);
    } else if (C === 'C') {
      const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
      out.push(['C', ...p]);
      lc = [p[2], p[3]];
      x = p[4];
      y = p[5];
    } else if (C === 'S') {
      const r = /^[CS]$/.test(prev) ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
      const p = [r[0], r[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
      out.push(['C', ...p]);
      lc = [p[2], p[3]];
      x = p[4];
      y = p[5];
    } else if (C === 'Q' || C === 'T') {
      const q = C === 'Q' ? [a[0] + ox, a[1] + oy] : /^[QT]$/.test(prev) ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y];
      const e = C === 'Q' ? [a[2] + ox, a[3] + oy] : [a[0] + ox, a[1] + oy];
      out.push([
        'C',
        x + (2 / 3) * (q[0] - x),
        y + (2 / 3) * (q[1] - y),
        e[0] + (2 / 3) * (q[0] - e[0]),
        e[1] + (2 / 3) * (q[1] - e[1]),
        e[0],
        e[1],
      ]);
      lq = q;
      x = e[0];
      y = e[1];
    } else if (C === 'A') {
      const ex = a[5] + ox,
        ey = a[6] + oy;
      for (const c3 of arcToCubic(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey)) out.push(['C', ...c3]);
      x = ex;
      y = ey;
    }
    prev = C;
  }
  return out;
}

/** SVG 圆弧（端点参数）→ 若干段三次贝塞尔，每段不超过 90° */
function arcToCubic(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const r = (phi * Math.PI) / 180,
    cos = Math.cos(r),
    sin = Math.sin(r);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy,
    yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp,
    den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry,
    cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2,
    cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const out = [],
    step = dt / n,
    kk = (4 / 3) * Math.tan(step / 4);
  const pt = t => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const dv = t => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step,
      b = a + step,
      p0 = pt(a),
      p3 = pt(b),
      d0 = dv(a),
      d3 = dv(b);
    out.push([p0[0] + kk * d0[0], p0[1] + kk * d0[1], p3[0] - kk * d3[0], p3[1] - kk * d3[1], p3[0], p3[1]]);
  }
  const last = out[out.length - 1];
  last[4] = x2;
  last[5] = y2;
  return out;
}

/** 绝对段乘矩阵 m = [a,b,c,d,e,f] */
export function transformPath(segs, m) {
  const P = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return segs.map(s => {
    if (s[0] === 'Z') return s;
    const out = [s[0]];
    for (let i = 1; i < s.length; i += 2) out.push(...P(s[i], s[i + 1]));
    return out;
  });
}

export const serializePath = segs => segs.map(s => s[0] + s.slice(1).map(fmt).join(' ')).join('');

/** 每个子路径的有向面积（控制点折线近似），用来判断绕向 */
export function subpaths(segs) {
  const out = [];
  let cur = null;
  for (const s of segs) {
    if (s[0] === 'M') out.push((cur = [s]));
    else if (cur) cur.push(s);
  }
  return out;
}
export function signedArea(sp) {
  const pts = [];
  for (const s of sp) for (let i = 1; i < s.length; i += 2) pts.push([s[i], s[i + 1]]);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i],
      [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
/** 反转一个子路径的走向（M/L/C/Z 段） */
export function reverseSubpath(sp) {
  const closed = sp[sp.length - 1][0] === 'Z';
  const body = closed ? sp.slice(0, -1) : sp;
  const ends = body.map(s => [s[s.length - 2], s[s.length - 1]]);
  const out = [['M', ...ends[ends.length - 1]]];
  for (let i = body.length - 1; i > 0; i--) {
    const s = body[i],
      to = ends[i - 1];
    out.push(s[0] === 'C' ? ['C', s[3], s[4], s[1], s[2], ...to] : ['L', ...to]);
  }
  if (closed) out.push(['Z']);
  return out;
}

/** 基本形状 → 绝对段。g(name) 读几何量（user units），读不到返回 null */
export function shapeSegs(el, g) {
  const t = el.localName;
  if (t === 'path') return toAbsolute(parsePath(g('d')));
  if (t === 'rect') {
    const x = g('x') || 0,
      y = g('y') || 0,
      w = g('width'),
      h = g('height');
    if (!(w > 0 && h > 0)) return [];
    let rx = g('rx'),
      ry = g('ry');
    if (rx == null && ry == null) rx = ry = 0;
    else if (rx == null) rx = ry;
    else if (ry == null) ry = rx;
    rx = Math.min(Math.max(rx, 0), w / 2);
    ry = Math.min(Math.max(ry, 0), h / 2);
    return roundRect(x, y, w, h, rx, ry);
  }
  if (t === 'circle' || t === 'ellipse') {
    const cx = g('cx') || 0,
      cy = g('cy') || 0;
    let rx = t === 'circle' ? g('r') : g('rx'),
      ry = t === 'circle' ? rx : g('ry');
    if (t === 'ellipse') {
      if (rx == null) rx = ry;
      if (ry == null) ry = rx;
    }
    if (!(rx > 0 && ry > 0)) return [];
    return toAbsolute([
      ['M', cx + rx, cy],
      ['A', rx, ry, 0, 0, 1, cx, cy + ry],
      ['A', rx, ry, 0, 0, 1, cx - rx, cy],
      ['A', rx, ry, 0, 0, 1, cx, cy - ry],
      ['A', rx, ry, 0, 0, 1, cx + rx, cy],
      ['Z'],
    ]);
  }
  if (t === 'line')
    return [
      ['M', g('x1') || 0, g('y1') || 0],
      ['L', g('x2') || 0, g('y2') || 0],
    ];
  if (t === 'polyline' || t === 'polygon') {
    const pts = (el.getAttribute('points') || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (pts.length < 4 || pts.some(Number.isNaN)) return [];
    const out = [['M', pts[0], pts[1]]];
    for (let i = 2; i + 1 < pts.length; i += 2) out.push(['L', pts[i], pts[i + 1]]);
    if (t === 'polygon') out.push(['Z']);
    return out;
  }
  return null;
}
/** 圆角矩形：圆角为 0 时也写出圆弧段，保证不同圆角的帧之间路径结构一致、可以插值 */
export function roundRect(x, y, w, h, rx, ry) {
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

/** 读元素的几何量：内联 style 优先（层叠已内联进来），否则读属性的 baseVal（百分比已按视口换算） */
export function geometryReader(el) {
  return name => {
    const css = el.style && el.style.getPropertyValue(name);
    if (css && name === 'd') {
      const m = css.match(/^path\(\s*["'](.*)["']\s*\)$/);
      if (m) return m[1];
    }
    if (name === 'd') return el.getAttribute('d');
    if (css && /^-?[\d.]+(px)?$/.test(css.trim())) return parseFloat(css);
    const a = el[name] && el[name].baseVal;
    if (a && typeof a.value === 'number') return el.hasAttribute(name) ? a.value : null;
    const v = el.getAttribute(name);
    return v == null ? null : parseFloat(v);
  };
}

/** 矩阵运算 [a,b,c,d,e,f] */
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export const inv = m => {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
export const ID_M = [1, 0, 0, 1, 0, 0];
export const isId = m => m.every((v, i) => Math.abs(v - ID_M[i]) < 1e-9);
export const fromDom = m => (m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null);
export const matrixAttr = m => `matrix(${m.map(fmt).join(' ')})`;
export const num = fmt;
