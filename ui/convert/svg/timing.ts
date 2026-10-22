// SMIL begin/end：公众号删掉所有 id 后，"btn.click""a1.end+1s" 这类引用全部失效。能换成不带 id 的等价写法的就换
import { isAnim, targetOf } from './dom.ts';

const EVENTS =
  /^(click|dblclick|mousedown|mouseup|mouseover|mouseout|mousemove|mouseenter|mouseleave|touchstart|touchend|touchmove|touchcancel|focusin|focusout|activate|beginEvent|endEvent|repeatEvent|load)$/;

/** SMIL 时钟值 → 秒 */
export function clock(s) {
  s = (s || '').trim();
  let m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
  m = /^(\d+(?:\.\d+)?|\.\d+)(h|min|s|ms)?$/.exec(s);
  if (!m) return null;
  return +m[1] * { h: 3600, min: 60, s: 1, ms: 0.001 }[m[2] || 's'];
}

/** begin/end 列表里的一项：offset | event（可带 id）| sync（id.begin/end/repeat(n)）| other */
function parseItem(raw) {
  const s = raw.trim();
  if (/^(indefinite|wallclock\(|accessKey\()/.test(s)) return { kind: 'other', raw: s };
  const sign = /^[+-]/.test(s) ? s[0] : '';
  const off = clock(sign ? s.slice(1) : s);
  if (off != null) return { kind: 'offset', t: sign === '-' ? -off : off };
  // id 到第一个未转义的点为止（id 里的点要写成 \.），后面是事件名或 begin/end/repeat(n)，再跟可选偏移
  const m = /^(?:((?:\\.|[^.\\])+)\.)?([A-Za-z]\w*(?:\(\d+\))?)\s*(?:([+-])\s*(.+))?$/.exec(s);
  if (!m) return { kind: 'other', raw: s };
  const id = m[1] ? m[1].replace(/\\(.)/g, '$1') : null;
  const o = m[4] != null ? clock(m[4]) : 0;
  if (o == null) return { kind: 'other', raw: s };
  const t = m[3] === '-' ? -o : o;
  const rep = /^repeat\((\d+)\)$/.exec(m[2]);
  if (id && (m[2] === 'begin' || m[2] === 'end' || rep))
    return { kind: 'sync', id, base: rep ? 'repeat' : m[2], n: rep ? +rep[1] : 0, t, raw: s };
  if (!EVENTS.test(m[2])) return { kind: 'other', raw: s };
  return { kind: 'event', id, ev: m[2], t, raw: s };
}
export const parseList = v =>
  (v || '')
    .split(';')
    .filter(x => x.trim())
    .map(parseItem);

const sec = t => {
  const r = Math.round(t * 1000) / 1000;
  return (Object.is(r, -0) ? 0 : r) + 's';
};
function serialize(it) {
  if (it.id) return it.raw;
  if (it.kind === 'offset') return sec(it.t);
  if (it.kind === 'event') return it.ev + (it.t ? (it.t > 0 ? '+' : '-') + sec(Math.abs(it.t)) : '');
  return it.raw;
}

/** 一条动画的活动时长（秒）；带 end/min/max、无限或没写 dur 的返回 null */
export function activeDur(a) {
  if (a.hasAttribute('end') || a.hasAttribute('min') || a.hasAttribute('max')) return null;
  const d = clock(a.getAttribute('dur'));
  const rc = a.getAttribute('repeatCount'),
    rd = a.getAttribute('repeatDur');
  if (d == null || rc === 'indefinite' || rd === 'indefinite') return null;
  let ad = rc != null ? d * +rc : d;
  if (rd) ad = Math.min(ad, clock(rd));
  return Number.isFinite(ad) ? ad : null;
}

/** 同步基准 it（"a1.end+1s"）化成不带 id 的形式：{ abs: 秒 } 或 { ev, src, t }（某元素上的事件 + 偏移） */
function resolveSync(it, ids, depth = 0) {
  const b = ids.get(it.id);
  if (!isAnim(b) || depth > 8) return null;
  // 只认 begin 只有一项的基准动画；多项（接力循环）推不出固定时刻
  const items = parseList(b.getAttribute('begin') || '0s');
  if (items.length !== 1) return null;
  const bi = items[0];
  let base = null;
  if (bi.kind === 'offset') base = { abs: bi.t };
  else if (bi.kind === 'event') base = { ev: bi.ev, src: bi.id ? ids.get(bi.id) : targetOf(b, ids), t: bi.t };
  else if (bi.kind === 'sync') base = resolveSync(bi, ids, depth + 1);
  if (!base) return null;
  let add = it.t;
  if (it.base === 'end') {
    const d = activeDur(b);
    if (d == null) return null;
    add += d;
  }
  if (it.base === 'repeat') {
    const d = clock(b.getAttribute('dur'));
    if (d == null) return null;
    add += d * it.n;
  }
  return base.abs != null ? { abs: base.abs + add } : { ev: base.ev, src: base.src, t: base.t + add };
}

/**
 * 改写 begin/end 里的 id 引用，返回 { fixed, broken: [动画元素] }。
 * 事件源就是动画目标本身的 "id.click" 去掉 id；"a1.end+1s" 能推算成固定时刻或"本元素事件 + 偏移"的换成那个值；
 * 其余（点别的元素触发、接力循环）留原样并报出来——公众号里它们不会触发
 */
export function resolveTiming(root, ids) {
  let fixed = 0;
  const broken = [];
  for (const a of root.querySelectorAll('*')) {
    if (!isAnim(a)) continue;
    const tgt = targetOf(a, ids);
    let ok = true,
      touched = false;
    for (const attr of ['begin', 'end']) {
      const items = parseList(a.getAttribute(attr));
      if (!items.some(it => it.id)) continue;
      touched = true;
      const out = items.map(it => {
        if (!it.id) return it;
        if (it.kind === 'event' && ids.get(it.id) === tgt) return { ...it, id: null };
        const x = it.kind === 'sync' ? resolveSync(it, ids) : null;
        if (x && x.abs != null) return { kind: 'offset', t: x.abs };
        if (x && x.src === tgt) return { kind: 'event', ev: x.ev, t: x.t };
        ok = false;
        return it;
      });
      a.setAttribute(attr, out.map(serialize).join(';'));
    }
    if (touched) {
      if (ok) fixed++;
      else broken.push(a);
    }
  }
  return { fixed, broken };
}

/**
 * 只写 touchstart/touchend 的动画在电脑版微信里不触发（后台的内容结构检测也会提示）。
 * 补一个 click；restart="whenNotActive" 防止手机上 touchstart 之后紧跟的 click 把刚开始的动画重启
 */
export function touchToClick(root) {
  let n = 0;
  for (const a of root.querySelectorAll('*')) {
    if (!isAnim(a)) continue;
    let hit = false;
    for (const attr of ['begin', 'end']) {
      const items = parseList(a.getAttribute(attr));
      if (!items.length || items.some(it => it.kind === 'event' && it.ev === 'click' && !it.id)) continue;
      const touch = items.filter(it => it.kind === 'event' && !it.id && /^touch(start|end)$/.test(it.ev));
      if (!touch.length) continue;
      a.setAttribute(attr, [...items, ...touch.map(it => ({ ...it, ev: 'click' }))].map(serialize).join(';'));
      hit = true;
    }
    if (hit) {
      if (!a.hasAttribute('restart')) a.setAttribute('restart', 'whenNotActive');
      n++;
    }
  }
  return n;
}
