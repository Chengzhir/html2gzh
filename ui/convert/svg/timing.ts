// SMIL begin/end：公众号删掉所有 id 后，"btn.click""a1.end+1s" 这类引用全部失效。能换成不带 id 的等价写法的就换
import { isAnim, targetOf } from './dom.ts';

const EVENTS =
  /^(click|dblclick|mousedown|mouseup|mouseover|mouseout|mousemove|mouseenter|mouseleave|touchstart|touchend|touchmove|touchcancel|focusin|focusout|activate|beginEvent|endEvent|repeatEvent|load)$/;

const UNIT_SECONDS: Record<string, number> = { h: 3600, min: 60, s: 1, ms: 0.001 };

/** SMIL 时钟值 → 秒 */
function clock(text: string | null | undefined): number | null {
  text = (text || '').trim();
  let match = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text);
  if (match) return +(match[1] || 0) * 3600 + +match[2] * 60 + +match[3];
  match = /^(\d+(?:\.\d+)?|\.\d+)(h|min|s|ms)?$/.exec(text);
  if (!match) return null;
  return +match[1] * UNIT_SECONDS[match[2] || 's'];
}

/** begin/end 列表里的一项；不带 id 的 event 作用于动画目标自己。带 id 的项序列化时原样写回 raw */
type TimingItem =
  | { kind: 'other'; raw: string; id?: undefined }
  | { kind: 'offset'; t: number; id?: undefined; raw?: undefined }
  | { kind: 'event'; id?: null; ev: string; t: number; raw?: string }
  | { kind: 'event'; id: string; ev: string; t: number; raw: string }
  | { kind: 'sync'; id: string; base: 'begin' | 'end' | 'repeat'; n: number; t: number; raw: string };
type SyncItem = Extract<TimingItem, { kind: 'sync' }>;
type OwnEventItem = Extract<TimingItem, { kind: 'event'; id?: null }>;
/** 同步基准化成的不带 id 的形式：固定时刻，或某元素上的事件 + 偏移 */
type ResolvedSync =
  | { abs: number; ev?: undefined; src?: undefined; t?: undefined }
  | { abs?: undefined; ev: string; src: Element; t: number };

/** begin/end 列表里的一项：offset | event（可带 id）| sync（id.begin/end/repeat(n)）| other */
function parseItem(raw: string): TimingItem {
  const text = raw.trim();
  if (/^(indefinite|wallclock\(|accessKey\()/.test(text)) return { kind: 'other', raw: text };
  const sign = /^[+-]/.test(text) ? text[0] : '';
  const off = clock(sign ? text.slice(1) : text);
  if (off != null) return { kind: 'offset', t: sign === '-' ? -off : off };
  // id 到第一个未转义的点为止（id 里的点要写成 \.），后面是事件名或 begin/end/repeat(n)，再跟可选偏移
  const match = /^(?:((?:\\.|[^.\\])+)\.)?([A-Za-z]\w*(?:\(\d+\))?)\s*(?:([+-])\s*(.+))?$/.exec(text);
  if (!match) return { kind: 'other', raw: text };
  const id = match[1] ? match[1].replace(/\\(.)/g, '$1') : null;
  const offset = match[4] != null ? clock(match[4]) : 0;
  if (offset == null) return { kind: 'other', raw: text };
  const t = match[3] === '-' ? -offset : offset;
  const repeat = /^repeat\((\d+)\)$/.exec(match[2]);
  if (id && (match[2] === 'begin' || match[2] === 'end' || repeat))
    return {
      kind: 'sync',
      id,
      base: repeat ? 'repeat' : (match[2] as 'begin' | 'end'),
      n: repeat ? +repeat[1] : 0,
      t,
      raw: text,
    };
  if (!EVENTS.test(match[2])) return { kind: 'other', raw: text };
  return { kind: 'event', id, ev: match[2], t, raw: text };
}
const parseList = (value: string | null | undefined): TimingItem[] =>
  (value || '')
    .split(';')
    .filter(part => part.trim())
    .map(parseItem);

const sec = (time: number): string => {
  const rounded = Math.round(time * 1000) / 1000;
  return (Object.is(rounded, -0) ? 0 : rounded) + 's';
};
function serialize(item: TimingItem): string {
  if (item.id) return item.raw;
  if (item.kind === 'offset') return sec(item.t);
  if (item.kind === 'event') return item.ev + (item.t ? (item.t > 0 ? '+' : '-') + sec(Math.abs(item.t)) : '');
  return item.raw;
}

/** dur：没写、写错或不为正的是 null（Chrome 里这样的动画一直不结束，也不重复） */
const simpleDur = (anim: Element): number | null => {
  const seconds = clock(anim.getAttribute('dur'));
  return seconds != null && seconds > 0 ? seconds : null;
};
/** repeatCount / repeatDur：indefinite 是 Infinity；写错或不为正的 Chrome 当作没写，是 null */
function repeatLimit(text: string | null, parse: (text: string) => number | null): number | null {
  if (text == null) return null;
  if (text.trim() === 'indefinite') return Infinity;
  const value = parse(text);
  return value != null && value > 0 ? value : null;
}

/** 一条动画的活动时长（秒）：repeatCount × dur 与 repeatDur 都写时取较短的。带 end/min/max 或不结束的返回 null */
function activeDur(anim: Element): number | null {
  if (anim.hasAttribute('end') || anim.hasAttribute('min') || anim.hasAttribute('max')) return null;
  const dur = simpleDur(anim);
  if (dur == null) return null;
  const count = repeatLimit(anim.getAttribute('repeatCount'), Number),
    limit = repeatLimit(anim.getAttribute('repeatDur'), clock);
  if (count == null && limit == null) return dur;
  const active = Math.min(count == null ? Infinity : dur * count, limit ?? Infinity);
  return Number.isFinite(active) ? active : null;
}

/** 同步基准 item（"a1.end+1s"）化成不带 id 的形式：{ abs: 秒 } 或 { ev, src, t }（某元素上的事件 + 偏移） */
function resolveSync(item: SyncItem, ids: Map<string, Element>, depth = 0): ResolvedSync | null {
  const baseAnim = ids.get(item.id);
  if (!isAnim(baseAnim) || depth > 8) return null;
  // 只认 begin 只有一项的基准动画；多项（接力循环）推不出固定时刻
  const items = parseList(baseAnim.getAttribute('begin') || '0s');
  if (items.length !== 1) return null;
  const baseItem = items[0];
  let base: ResolvedSync | null = null;
  if (baseItem.kind === 'offset') base = { abs: baseItem.t };
  else if (baseItem.kind === 'event') {
    // 事件源不存在：基准动画永远不开始
    const src = baseItem.id ? ids.get(baseItem.id) : targetOf(baseAnim, ids);
    if (src) base = { ev: baseItem.ev, src, t: baseItem.t };
  } else if (baseItem.kind === 'sync') base = resolveSync(baseItem, ids, depth + 1);
  if (!base) return null;
  let add = item.t;
  if (item.base === 'end') {
    const active = activeDur(baseAnim);
    if (active == null) return null;
    add += active;
  }
  if (item.base === 'repeat') {
    // 第 n 次重复开始时触发：n 为 0、或动画在第 n 次重复开始时已经结束的，永远不触发
    const dur = simpleDur(baseAnim),
      active = activeDur(baseAnim);
    if (dur == null || item.n < 1 || (active != null && dur * item.n >= active)) return null;
    add += dur * item.n;
  }
  return base.abs != null ? { abs: base.abs + add } : { ev: base.ev, src: base.src, t: base.t + add };
}

/**
 * 改写 begin/end 里的 id 引用，返回 { fixed, broken: [动画元素] }。
 * 事件源就是动画目标本身的 "id.click" 去掉 id；"a1.end+1s" 能推算成固定时刻或"本元素事件 + 偏移"的换成那个值；
 * 其余（点别的元素触发、接力循环）留原样并报出来——公众号里它们不会触发
 */
export function resolveTiming(
  root: Document | Element,
  ids: Map<string, Element>,
): { fixed: number; broken: SVGAnimationElement[] } {
  let fixed = 0;
  const broken: SVGAnimationElement[] = [];
  for (const a of root.querySelectorAll('*')) {
    if (!isAnim(a)) continue;
    const target = targetOf(a, ids);
    let ok = true,
      touched = false;
    for (const attr of ['begin', 'end']) {
      const items = parseList(a.getAttribute(attr));
      if (!items.some(item => item.id)) continue;
      touched = true;
      const out = items.map((item): TimingItem => {
        if (!item.id) return item;
        if (item.kind === 'event' && ids.get(item.id) === target) return { ...item, id: null };
        const resolved = item.kind === 'sync' ? resolveSync(item, ids) : null;
        if (resolved && resolved.abs != null) return { kind: 'offset', t: resolved.abs };
        if (resolved && resolved.src === target) return { kind: 'event', ev: resolved.ev, t: resolved.t };
        ok = false;
        return item;
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
export function touchToClick(root: Document | Element): number {
  let n = 0;
  for (const a of root.querySelectorAll('*')) {
    if (!isAnim(a)) continue;
    let hit = false;
    for (const attr of ['begin', 'end']) {
      const items = parseList(a.getAttribute(attr));
      if (!items.length || items.some(item => item.kind === 'event' && item.ev === 'click' && !item.id)) continue;
      const touch = items.filter(
        (item): item is OwnEventItem => item.kind === 'event' && !item.id && /^touch(start|end)$/.test(item.ev),
      );
      if (!touch.length) continue;
      a.setAttribute(attr, [...items, ...touch.map(item => ({ ...item, ev: 'click' }))].map(serialize).join(';'));
      hit = true;
    }
    if (hit) {
      if (!a.hasAttribute('restart')) a.setAttribute('restart', 'whenNotActive');
      n++;
    }
  }
  return n;
}
