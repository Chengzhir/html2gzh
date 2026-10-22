// 结构改写：公众号删 id 和 xlink:href 之后，<use>、<mpath>、指向别处的动画都失效；SVG 里的 <a> 和本机图片也留不下
import {
  SVG_NS,
  XLINK_NS,
  isSvg,
  isAnim,
  hrefOf,
  refId,
  inResource,
  mk,
  wrapG,
  ownAnims,
  xyToTranslate,
} from './dom.ts';
import { shapeSegs, geometryReader, serializePath } from './path.ts';

export function normalizeHref(doc) {
  for (const el of doc.getElementsByTagNameNS(SVG_NS, '*')) {
    const x = el.getAttributeNS(XLINK_NS, 'href');
    if (x == null) continue;
    if (!el.hasAttribute('href')) el.setAttribute('href', x);
    el.removeAttributeNS(XLINK_NS, 'href');
  }
}

/** href 指向别的元素的动画挪进目标元素里（公众号删 href 引用的 id 之后它就成了作用于父元素） */
export function retarget(doc, ids) {
  let n = 0;
  for (const a of [...doc.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (!isAnim(a) || !a.hasAttribute('href')) continue;
    const t = ids.get(refId(a.getAttribute('href')) || '');
    a.removeAttribute('href');
    if (!isSvg(t)) {
      a.remove();
      continue;
    }
    if (a.parentElement !== t) {
      t.appendChild(a);
      n++;
    }
  }
  return n;
}

const USE_SKIP = new Set(['x', 'y', 'width', 'height', 'href', 'id', 'class', 'data-wxc']);
/**
 * <use> 展开成被引用内容的副本：use 自身的属性与 transform 放外层 g，x/y 放内层平移；symbol 变成嵌套 svg。
 * anims（captureCss 的结果）按副本挂到新元素上
 */
export function expandUse(doc, ids, anims) {
  const queue = [...doc.getElementsByTagNameNS(SVG_NS, 'use')].filter(u => !inResource(u)),
    depth = new Map(),
    hidden = new Set();
  let n = 0,
    bad = 0;
  while (queue.length) {
    const u = queue.shift(),
      t = ids.get(refId(hrefOf(u)) || ''),
      d = depth.get(u) || 0;
    if (!u.isConnected) continue;
    if (!isSvg(t) || d > 8 || t.contains(u)) {
      u.remove();
      bad++;
      continue;
    }
    const outer = mk(doc, 'g');
    for (const a of u.attributes) if (!USE_SKIP.has(a.name)) outer.setAttribute(a.name, a.value);
    if (u.hasAttribute('data-wxc')) outer.setAttribute('data-wxc', u.getAttribute('data-wxc'));
    const g = geometryReader(u),
      x = g('x') || 0,
      y = g('y') || 0;
    const inner = x || y ? mk(doc, 'g', { transform: `translate(${x} ${y})` }) : outer;
    if (inner !== outer) outer.appendChild(inner);
    const c = t.cloneNode(true),
      src = [t, ...t.querySelectorAll('*')],
      cl = [c, ...c.querySelectorAll('*')];
    // 被引用的原件本身不画出来（symbol、隐藏的雪碧图）时，它的动画只在副本上写
    const shown = !inResource(t) && t.localName !== 'symbol' && t.getClientRects().length > 0;
    src.forEach((s, i) => {
      const r = anims.get(s);
      if (r) {
        anims.set(cl[i], r);
        if (!shown) hidden.add(s);
      }
      cl[i].removeAttribute('id');
      cl[i].removeAttribute('data-wxc');
    });
    let body = c;
    if (t.localName === 'symbol' || t.localName === 'svg') {
      body = mk(doc, 'svg');
      for (const a of c.attributes) if (!/^(id|x|y)$/.test(a.name)) body.setAttribute(a.name, a.value);
      while (c.firstChild) body.appendChild(c.firstChild);
      for (const k of ['width', 'height']) {
        const v = u.getAttribute(k);
        if (v != null && v !== 'auto') body.setAttribute(k, v);
        else if (!body.hasAttribute(k)) body.setAttribute(k, '100%');
      }
    }
    inner.appendChild(body);
    // use 自己身上的动画：x/y 换成内层平移（相对 use 的 x/y），width/height 给 symbol 变成的 svg，其余（transform、opacity……）跟着外层 g
    for (const a of ownAnims(u)) {
      const p = a.getAttribute('attributeName');
      if (p === 'x' || p === 'y')
        (inner === outer ? wrapG(body) : inner).appendChild(xyToTranslate(a, p === 'x' ? x : y));
      else if ((p === 'width' || p === 'height') && body.localName === 'svg') body.appendChild(a);
      else outer.appendChild(a);
    }
    const ua = anims.get(u);
    if (ua) {
      anims.set(outer, ua);
      anims.delete(u);
    }
    u.replaceWith(outer);
    for (const k of outer.getElementsByTagNameNS(SVG_NS, 'use')) {
      depth.set(k, d + 1);
      queue.push(k);
    }
    n++;
  }
  for (const s of hidden) anims.delete(s);
  return { n, bad };
}

/** <mpath href> → animateMotion 的 path 属性（浏览器同样忽略被引用路径自己的 transform） */
export function inlineMpath(doc, ids) {
  let n = 0;
  for (const m of [...doc.getElementsByTagNameNS(SVG_NS, 'mpath')]) {
    const am = m.parentElement,
      t = ids.get(refId(hrefOf(m)) || '');
    const segs = isSvg(t) && shapeSegs(t, geometryReader(t));
    if (am && am.localName === 'animateMotion' && segs && segs.length) {
      am.setAttribute('path', serializePath(segs));
      n++;
    }
    m.remove();
  }
  return n;
}

/** SVG 里的 <a> 换成 <g>（站外链接公众号留不下；mp.weixin.qq.com 的链接照留） */
export function linksToG(doc) {
  let n = 0;
  for (const a of [...doc.getElementsByTagNameNS(SVG_NS, 'a')]) {
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(hrefOf(a) || '')) continue;
    const g = mk(doc, 'g');
    for (const at of a.attributes)
      if (
        !/^(href|target|download|rel|hreflang|type|referrerpolicy|ping)$/.test(at.name) &&
        at.namespaceURI !== XLINK_NS
      )
        g.setAttribute(at.name, at.value);
    while (a.firstChild) g.appendChild(a.firstChild);
    a.replaceWith(g);
    n++;
  }
  return n;
}
const ALIGN = { Min: '0%', Mid: '50%', Max: '100%' };
/**
 * 公众号只留 mmbiz 地址的 <image>，本机/外站地址整个删掉；改成 foreignObject 里带背景图的 section，
 * 粘贴时背景图会被转存。preserveAspectRatio 对应 background-size/position（实测逐像素一致）
 */
export function imagesToFo(doc, rep) {
  let n = 0;
  for (const im of [...doc.getElementsByTagNameNS(SVG_NS, 'image')]) {
    if (inResource(im)) continue;
    const href = (hrefOf(im) || '').trim();
    if (/^https?:\/\/mmbiz\.(qpic|qlogo)\.cn\//i.test(href)) continue;
    if (!href) {
      im.remove();
      continue;
    }
    const g = geometryReader(im);
    let w = g('width'),
      h = g('height');
    if (!(w > 0 && h > 0)) {
      try {
        const b = im.getBBox();
        w = b.width;
        h = b.height;
      } catch {
        /* 没画出来 */
      }
    }
    if (!(w > 0 && h > 0)) {
      rep('image:size', im);
      continue;
    }
    const fo = mk(doc, 'foreignObject', { x: g('x') || 0, y: g('y') || 0, width: w, height: h });
    for (const a of im.attributes)
      if (
        !/^(x|y|width|height|href|preserveAspectRatio|crossorigin|decoding|data-wxc)$/.test(a.name) &&
        a.namespaceURI !== XLINK_NS
      )
        fo.setAttribute(a.name, a.value);
    for (const k of ['x', 'y', 'width', 'height']) fo.style.removeProperty(k);
    const [al, ms] = (im.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/);
    const m = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(al || '');
    const sec = doc.createElementNS('http://www.w3.org/1999/xhtml', 'section');
    sec.style.cssText =
      `width:100%;height:100%;margin:0;padding:0;background-image:url("${href}");background-repeat:no-repeat;` +
      `background-size:${al === 'none' ? '100% 100%' : ms === 'slice' ? 'cover' : 'contain'};background-position:${m ? ALIGN[m[1]] + ' ' + ALIGN[m[2]] : '50% 50%'}`;
    fo.appendChild(sec);
    // foreignObject 的子元素按 HTML 解析，动画放不进去：套 g，整体动画放外层，x/y 换成内层平移
    const anims = ownAnims(im);
    let top = fo;
    if (anims.length) {
      const outer = mk(doc, 'g', { transform: fo.getAttribute('transform') });
      fo.removeAttribute('transform');
      let host = fo;
      const xy = anims.filter(a => /^(x|y)$/.test(a.getAttribute('attributeName')));
      if (xy.length) {
        host = mk(doc, 'g');
        host.appendChild(fo);
        for (const a of xy)
          host.appendChild(xyToTranslate(a, a.getAttribute('attributeName') === 'x' ? g('x') || 0 : g('y') || 0));
      }
      outer.appendChild(host);
      for (const a of anims) {
        const p = a.getAttribute('attributeName') || '';
        if (/^(x|y)$/.test(p)) a.remove();
        else if (
          a.localName === 'animateTransform' ||
          a.localName === 'animateMotion' ||
          /^(transform|opacity|visibility)$/.test(p)
        )
          outer.appendChild(a);
        else {
          rep('anim:' + (p === 'xlink:href' ? 'href' : p), im);
          a.remove();
        }
      }
      top = outer;
    }
    im.replaceWith(top);
    n++;
  }
  return n;
}

/** 收尾：删掉只被引用的资源与 defs（id 没了它们就没用了）、所有 id/class/xmlns:xlink、展开后空了的隐藏雪碧图 */
export function cleanup(doc) {
  for (const el of [...doc.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (!el.isConnected) continue;
    if (
      el.localName === 'defs' ||
      ['linearGradient', 'radialGradient', 'pattern', 'filter', 'mask', 'clipPath', 'marker', 'symbol'].includes(
        el.localName,
      )
    ) {
      el.remove();
      continue;
    }
    el.removeAttribute('id');
    el.removeAttribute('class');
    el.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'xlink');
    el.removeAttribute('xmlns:xlink');
  }
  for (const s of [...doc.getElementsByTagNameNS(SVG_NS, 'svg')]) {
    if (s.isConnected && !isSvg(s.parentElement) && !s.getClientRects().length && ![...s.children].some(isSvg))
      s.remove();
  }
  // 图形之间的空白文本节点（不在文字元素里）没有用，编辑器还可能把它们当成正文
  const w = doc.createTreeWalker(doc.body, 4),
    blank = [];
  while (w.nextNode()) {
    const t = w.currentNode,
      p = t.parentElement;
    if (isSvg(p) && !/^(text|tspan|textPath|title|desc)$/.test(p.localName) && !t.data.trim()) blank.push(t);
  }
  for (const t of blank) t.remove();
}

/** 收尾检查：前面各步没处理到的 url(#…)/href="#…" 引用（公众号里不生效）。标记与 textPath 已单独报过 */
export function danglingRefs(doc, rep) {
  for (const el of doc.getElementsByTagNameNS(SVG_NS, '*')) {
    if (inResource(el) || isAnim(el) || el.localName === 'textPath') continue;
    for (const a of el.attributes) {
      if (/^marker/.test(a.name)) continue;
      if (
        /url\(\s*["']?#/.test(a.value.replace(/marker-(start|mid|end)\s*:[^;]*/g, '')) ||
        (a.name === 'href' && a.value.trim().startsWith('#'))
      ) {
        rep('ref:other', el);
        break;
      }
    }
  }
}
