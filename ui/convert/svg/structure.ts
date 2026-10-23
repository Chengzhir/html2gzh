// 结构改写：公众号删 id 和 xlink:href 之后，<use>、<mpath>、指向别处的动画都失效；SVG 里的 <a> 和本机图片也留不下
import {
  SVG_NS,
  XLINK_NS,
  RESOURCE,
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
import { attrOf } from '../util.ts';
import type { Report } from './dom.ts';
import type { CssAnims } from './css.ts';

export function normalizeHref(doc: Document): void {
  for (const el of doc.getElementsByTagNameNS(SVG_NS, '*')) {
    const xlinkHref = el.getAttributeNS(XLINK_NS, 'href');
    if (xlinkHref == null) continue;
    if (!el.hasAttribute('href')) el.setAttribute('href', xlinkHref);
    el.removeAttributeNS(XLINK_NS, 'href');
  }
}

/** href 指向别的元素的动画挪进目标元素里（公众号删 href 引用的 id 之后它就成了作用于父元素） */
export function retarget(doc: Document, ids: Map<string, Element>): number {
  let count = 0;
  for (const anim of [...doc.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (!isAnim(anim) || !anim.hasAttribute('href')) continue;
    const target = ids.get(refId(anim.getAttribute('href')) || '');
    anim.removeAttribute('href');
    if (!isSvg(target)) {
      anim.remove();
      continue;
    }
    if (anim.parentNode !== target) {
      target.appendChild(anim);
      count++;
    }
  }
  return count;
}

const USE_SKIP = new Set(['x', 'y', 'width', 'height', 'href', 'id', 'class', 'data-wxc']);
/**
 * <use> 展开成被引用内容的副本：use 自身的属性与 transform 放外层 g，x/y 放内层平移；symbol 变成嵌套 svg。
 * anims（captureCss 的结果）按副本挂到新元素上
 */
export function expandUse(doc: Document, ids: Map<string, Element>, anims: CssAnims): { n: number; bad: number } {
  const queue = [...doc.getElementsByTagNameNS(SVG_NS, 'use')].filter(use => !inResource(use)),
    depth = new Map<Element, number>(),
    hidden = new Set<SVGElement>();
  let count = 0,
    bad = 0;
  // 展开出来的嵌套 use 追加在队尾，for…of 会接着遍历到
  for (const use of queue) {
    const target = ids.get(refId(hrefOf(use)) || ''),
      useDepth = depth.get(use) || 0;
    if (!use.isConnected) continue;
    if (!isSvg(target) || useDepth > 8 || target.contains(use)) {
      use.remove();
      bad++;
      continue;
    }
    const outer = mk(doc, 'g');
    for (const attr of use.attributes) if (!USE_SKIP.has(attr.name)) outer.setAttribute(attr.name, attr.value);
    const unit = use.getAttribute('data-wxc');
    if (unit != null) outer.setAttribute('data-wxc', unit);
    const geom = geometryReader(use),
      x = geom('x') || 0,
      y = geom('y') || 0;
    const inner = x || y ? mk(doc, 'g', { transform: `translate(${x} ${y})` }) : outer;
    if (inner !== outer) outer.appendChild(inner);
    const copy = target.cloneNode(true) as SVGElement,
      sources = [target, ...target.querySelectorAll('*')] as SVGElement[],
      copies = [copy, ...copy.querySelectorAll('*')] as SVGElement[];
    // 被引用的原件本身不画出来（symbol、隐藏的雪碧图）时，它的动画只在副本上写
    const shown = !inResource(target) && target.localName !== 'symbol' && target.getClientRects().length > 0;
    sources.forEach((source, i) => {
      const records = anims.get(source);
      if (records) {
        anims.set(copies[i], records);
        if (!shown) hidden.add(source);
      }
      copies[i].removeAttribute('id');
      copies[i].removeAttribute('data-wxc');
    });
    let body = copy;
    if (target.localName === 'symbol' || target.localName === 'svg') {
      body = mk(doc, 'svg');
      for (const attr of copy.attributes) if (!/^(id|x|y)$/.test(attr.name)) body.setAttribute(attr.name, attr.value);
      while (copy.firstChild) body.appendChild(copy.firstChild);
      for (const k of ['width', 'height']) {
        const value = use.getAttribute(k);
        if (value != null && value !== 'auto') body.setAttribute(k, value);
        else if (!body.hasAttribute(k)) body.setAttribute(k, '100%');
      }
    }
    inner.appendChild(body);
    // use 自己身上的动画：x/y 换成内层平移（相对 use 的 x/y），width/height 给 symbol 变成的 svg，其余（transform、opacity……）跟着外层 g
    for (const anim of ownAnims(use)) {
      const attr = anim.getAttribute('attributeName');
      if (attr === 'x' || attr === 'y')
        (inner === outer ? wrapG(body) : inner).appendChild(xyToTranslate(anim, attr === 'x' ? x : y));
      else if ((attr === 'width' || attr === 'height') && body.localName === 'svg') body.appendChild(anim);
      else outer.appendChild(anim);
    }
    const useAnims = anims.get(use);
    if (useAnims) {
      anims.set(outer, useAnims);
      anims.delete(use);
    }
    use.replaceWith(outer);
    for (const nested of outer.getElementsByTagNameNS(SVG_NS, 'use')) {
      depth.set(nested, useDepth + 1);
      queue.push(nested);
    }
    count++;
  }
  for (const source of hidden) anims.delete(source);
  return { n: count, bad };
}

/** <mpath href> → animateMotion 的 path 属性（浏览器同样忽略被引用路径自己的 transform） */
export function inlineMpath(doc: Document, ids: Map<string, Element>): number {
  let count = 0;
  for (const mpath of [...doc.getElementsByTagNameNS(SVG_NS, 'mpath')]) {
    const motion = mpath.parentElement,
      target = ids.get(refId(hrefOf(mpath)) || '');
    const segs = isSvg(target) && shapeSegs(target, geometryReader(target));
    if (motion && motion.localName === 'animateMotion' && segs && segs.length) {
      motion.setAttribute('path', serializePath(segs));
      count++;
    }
    mpath.remove();
  }
  return count;
}

/** SVG 里的 <a> 换成 <g>（站外链接公众号留不下；mp.weixin.qq.com 的链接照留） */
export function linksToG(doc: Document): number {
  let count = 0;
  for (const link of [...doc.getElementsByTagNameNS(SVG_NS, 'a')]) {
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(hrefOf(link) || '')) continue;
    const g = mk(doc, 'g');
    for (const attr of link.attributes)
      if (
        !/^(href|target|download|rel|hreflang|type|referrerpolicy|ping)$/.test(attr.name) &&
        attr.namespaceURI !== XLINK_NS
      )
        g.setAttribute(attr.name, attr.value);
    while (link.firstChild) g.appendChild(link.firstChild);
    link.replaceWith(g);
    count++;
  }
  return count;
}
const ALIGN: Record<string, string> = { Min: '0%', Mid: '50%', Max: '100%' };
/**
 * 公众号只留 mmbiz 地址的 <image>，本机/外站地址整个删掉；改成 foreignObject 里带背景图的 section，
 * 粘贴时背景图会被转存。preserveAspectRatio 对应 background-size/position（实测逐像素一致）
 */
export function imagesToFo(doc: Document, rep: Report): number {
  let count = 0;
  for (const im of [...doc.getElementsByTagNameNS(SVG_NS, 'image')] as SVGImageElement[]) {
    if (inResource(im)) continue;
    const href = (hrefOf(im) || '').trim();
    if (/^https?:\/\/mmbiz\.(qpic|qlogo)\.cn\//i.test(href)) continue;
    if (!href) {
      im.remove();
      continue;
    }
    const geom = geometryReader(im);
    let w = geom('width') ?? 0,
      h = geom('height') ?? 0;
    if (!(w > 0 && h > 0)) {
      try {
        const box = im.getBBox();
        w = box.width;
        h = box.height;
      } catch {
        /* 没画出来 */
      }
    }
    if (!(w > 0 && h > 0)) {
      rep('image:size', im);
      continue;
    }
    const fo = mk(doc, 'foreignObject', { x: geom('x') || 0, y: geom('y') || 0, width: w, height: h });
    for (const attr of im.attributes)
      if (
        !/^(x|y|width|height|href|preserveAspectRatio|crossorigin|decoding|data-wxc)$/.test(attr.name) &&
        attr.namespaceURI !== XLINK_NS
      )
        fo.setAttribute(attr.name, attr.value);
    for (const k of ['x', 'y', 'width', 'height']) fo.style.removeProperty(k);
    const [align, meetOrSlice] = (im.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/);
    const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(align || '');
    const section = doc.createElementNS('http://www.w3.org/1999/xhtml', 'section');
    section.style.cssText =
      `width:100%;height:100%;margin:0;padding:0;background-image:url("${href}");background-repeat:no-repeat;` +
      `background-size:${align === 'none' ? '100% 100%' : meetOrSlice === 'slice' ? 'cover' : 'contain'};background-position:${match ? ALIGN[match[1]] + ' ' + ALIGN[match[2]] : '50% 50%'}`;
    fo.appendChild(section);
    // foreignObject 的子元素按 HTML 解析，动画放不进去：套 g，整体动画放外层，x/y 换成内层平移
    const anims = ownAnims(im);
    let top: SVGElement = fo;
    if (anims.length) {
      const outer = mk(doc, 'g', { transform: fo.getAttribute('transform') });
      fo.removeAttribute('transform');
      let host: SVGElement = fo;
      const xy = anims.filter(anim => /^(x|y)$/.test(attrOf(anim, 'attributeName')));
      if (xy.length) {
        host = mk(doc, 'g');
        host.appendChild(fo);
        for (const anim of xy)
          host.appendChild(
            xyToTranslate(anim, anim.getAttribute('attributeName') === 'x' ? geom('x') || 0 : geom('y') || 0),
          );
      }
      outer.appendChild(host);
      for (const anim of anims) {
        const attr = anim.getAttribute('attributeName') || '';
        if (/^(x|y)$/.test(attr)) anim.remove();
        else if (
          anim.localName === 'animateTransform' ||
          anim.localName === 'animateMotion' ||
          /^(transform|opacity|visibility)$/.test(attr)
        )
          outer.appendChild(anim);
        else {
          rep('anim:' + (attr === 'xlink:href' ? 'href' : attr), im);
          anim.remove();
        }
      }
      top = outer;
    }
    im.replaceWith(top);
    count++;
  }
  return count;
}

/** 收尾：删掉只被引用的资源与 defs（id 没了它们就没用了）、所有 id/class/xmlns:xlink、展开后空了的隐藏雪碧图 */
export function cleanup(doc: Document): void {
  for (const el of [...doc.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (!el.isConnected) continue;
    if (el.localName === 'defs' || RESOURCE.has(el.localName)) {
      el.remove();
      continue;
    }
    el.removeAttribute('id');
    el.removeAttribute('class');
    el.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'xlink');
    el.removeAttribute('xmlns:xlink');
  }
  for (const svg of [...doc.getElementsByTagNameNS(SVG_NS, 'svg')]) {
    if (svg.isConnected && !isSvg(svg.parentElement) && !svg.getClientRects().length && ![...svg.children].some(isSvg))
      svg.remove();
  }
  // 图形之间的空白文本节点（不在文字元素里）没有用，编辑器还可能把它们当成正文
  const walker = doc.createTreeWalker(doc.body, 4),
    blank: Text[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode as Text,
      parent = text.parentElement;
    if (isSvg(parent) && !/^(text|tspan|textPath|title|desc)$/.test(parent.localName) && !text.data.trim())
      blank.push(text);
  }
  for (const text of blank) text.remove();
}

/** 收尾检查：前面各步没处理到的 url(#…)/href="#…" 引用（公众号里不生效）。标记与 textPath 已单独报过 */
export function danglingRefs(doc: Document, rep: Report): void {
  for (const el of doc.getElementsByTagNameNS(SVG_NS, '*')) {
    if (inResource(el) || isAnim(el) || el.localName === 'textPath') continue;
    for (const attr of el.attributes) {
      if (/^marker/.test(attr.name)) continue;
      if (
        /url\(\s*["']?#/.test(attr.value.replace(/marker-(start|mid|end)\s*:[^;]*/g, '')) ||
        (attr.name === 'href' && attr.value.trim().startsWith('#'))
      ) {
        rep('ref:other', el);
        break;
      }
    }
  }
}
