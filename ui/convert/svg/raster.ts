// 依赖 id 的静态部分（渐变、图案、滤镜、蒙版、裁切、标记、textPath）画成位图：公众号删 id 之后这些引用全部失效
import { SVG_NS, isSvg, isAnim, hasAnim, inResource, ownAnims, URL_REF, fixUrls, mk, wrapG, RESOURCE } from './dom.ts';
import { inv, fromDom } from './path.ts';
import { bakeStyleTransform } from './transform.ts';

const DPR = 3,
  PHONE = 390,
  MAX_PX = 6e6;
const INHERIT = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'dominant-baseline',
  'direction',
  'writing-mode',
  'paint-order',
  'marker-start',
  'marker-mid',
  'marker-end',
  'clip-rule',
  'color-interpolation',
  'color-interpolation-filters',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
];
const OWN = ['filter', 'mask', 'clip-path', 'marker-start', 'marker-mid', 'marker-end'];
const PAINT = ['fill', 'stroke'];
// 动画改了这些可继承属性时，子孙画成位图就不对了
const INHERITED_ANIM = /^(fill|stroke|color|font-size|stroke-width|stroke-dasharray|stroke-dashoffset)/;

const usesOwn = (el, cs) => OWN.some(p => URL_REF.test(cs.getPropertyValue(p))) || el.localName === 'textPath';
const usesPaint = cs => PAINT.some(p => URL_REF.test(cs.getPropertyValue(p)));
const inheritedAnim = el => {
  for (let a = el.parentElement; a && isSvg(a); a = a.parentElement)
    if (ownAnims(a).some(x => INHERITED_ANIM.test(x.getAttribute('attributeName') || ''))) return true;
  return false;
};
const usesIds = (el, win) => {
  for (const d of [el, ...el.querySelectorAll('*')])
    if (isSvg(d)) {
      const cs = win.getComputedStyle(d);
      if (usesOwn(d, cs) || usesPaint(cs)) return true;
    }
  return false;
};
const REF_PROPS = [...OWN, ...PAINT];
/** 子树引用的资源（渐变、裁切……）里有动画：画成位图会把动画冻住 */
function refsAnimated(el, win, ids) {
  for (const d of [el, ...el.querySelectorAll('*')]) {
    if (!isSvg(d)) continue;
    const cs = win.getComputedStyle(d);
    for (const p of REF_PROPS) {
      const m = URL_REF.exec(cs.getPropertyValue(p));
      const r = m && ids.get(decodeURIComponent(m[1]));
      if (r && hasAnim(r)) return true;
    }
  }
  return false;
}
const RIGID = new Set(['transform', 'opacity', 'visibility']);
const rigidAnim = a =>
  a.localName === 'animateMotion' || a.localName === 'animateTransform' || RIGID.has(a.getAttribute('attributeName'));

/**
 * 自身只有整体动画（transform、位移路径、opacity、visibility）而内容静态、又依赖 id 的元素：
 * 这些动画连同静态的 transform/opacity/visibility 挪到外面套的 g 上，元素本身就成了静态的，可以画成位图
 */
export function liftRigid(root, win, ids) {
  let n = 0;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!isSvg(el) || inResource(el) || el.localName === 'svg' || el.closest('foreignObject')) continue;
    const own = ownAnims(el);
    if (
      !own.length ||
      !own.every(rigidAnim) ||
      [...el.querySelectorAll('*')].some(d => isAnim(d) && d.parentElement !== el)
    )
      continue;
    if (!usesIds(el, win) || refsAnimated(el, win, ids) || !bakeStyleTransform(el)) continue;
    const g = wrapG(el);
    for (const k of ['transform', 'opacity', 'visibility']) {
      const v = el.style.getPropertyValue(k) || el.getAttribute(k);
      if (v) g.setAttribute(k, v);
      el.style.removeProperty(k);
      el.removeAttribute(k);
    }
    for (const a of own) g.appendChild(a);
    n++;
  }
  return n;
}

interface SubtreeFlags {
  own: boolean;
  paint: boolean;
  anim: boolean;
  refAnim: boolean;
  fo: boolean;
  uses?: boolean;
}
const SHAPE_KID = k => isSvg(k) && !isAnim(k) && !/^(title|desc|metadata)$/.test(k.localName);
/** 要画成位图的连续兄弟元素（静态、依赖 id）：[[el, el…], …] */
export function findUnits(root, win, ids) {
  // 自下而上算一遍每个元素子树的标志，免得逐层重复遍历（大插画有上千个元素）
  const info = new Map(),
    resAnim = new Map();
  const animRes = r => {
    if (!resAnim.has(r)) resAnim.set(r, hasAnim(r));
    return resAnim.get(r);
  };
  const visit = el => {
    const cs = win.getComputedStyle(el);
    const f: SubtreeFlags = {
      own: usesOwn(el, cs),
      paint: usesPaint(cs),
      anim: isAnim(el),
      refAnim: false,
      fo: el.localName === 'foreignObject',
    };
    f.uses = f.own || f.paint;
    for (const p of REF_PROPS) {
      const m = URL_REF.exec(cs.getPropertyValue(p));
      const r = m && ids.get(decodeURIComponent(m[1]));
      if (r && animRes(r)) f.refAnim = true;
    }
    for (const k of el.children)
      if (isSvg(k)) {
        const g = visit(k);
        f.anim ||= g.anim;
        f.uses ||= g.uses;
        f.refAnim ||= g.refAnim;
        f.fo ||= g.fo;
      }
    info.set(el, f);
    return f;
  };
  visit(root);
  const runs = [];
  const walk = parent => {
    let run = null;
    for (const el of [...parent.children]) {
      const f = info.get(el);
      if (!f || RESOURCE.has(el.localName) || el.localName === 'defs' || isAnim(el) || !el.getClientRects().length) {
        run = null;
        continue;
      }
      const stat = !f.anim && !f.fo && !f.refAnim && !inheritedAnim(el);
      // 自己有滤镜/蒙版/裁切这类整体效果，或者是叶子元素（含文字）：整个画；否则往下找
      const whole =
        stat &&
        (f.own || (f.paint && ![...el.children].some(SHAPE_KID)) || (/^(text|image)$/.test(el.localName) && f.uses));
      if (whole) {
        if (!run) runs.push((run = []));
        run.push(el);
        continue;
      }
      run = null;
      if (el.localName !== 'text' && el.localName !== 'foreignObject' && f.uses) walk(el);
    }
  };
  walk(root);
  return runs;
}

function region(run, win) {
  const parent = run[0].parentElement,
    doc = parent.ownerDocument;
  const g = mk(doc, 'g');
  run[0].before(g);
  for (const el of run) g.appendChild(el);
  let bb = null;
  try {
    bb = (g as SVGGraphicsElement).getBBox();
  } catch {
    /* 没画出来 */
  } finally {
    for (const el of [...g.childNodes]) g.before(el);
    g.remove();
  }
  const sc = fromDom(parent.getScreenCTM());
  if (!bb || !sc) return null;
  const unit = Math.max(Math.hypot(sc[0], sc[1]), Math.hypot(sc[2], sc[3]));
  // getBBox 不含描边、标记、滤镜：四周放宽，最后按不透明像素裁掉。放宽量只用 user units，两个宽度下区域相同、位图能复用
  const pad = Math.max(bb.width, bb.height) * 0.5 + 8;
  let r = { x: bb.x - pad, y: bb.y - pad, w: bb.width + 2 * pad, h: bb.height + 2 * pad };
  const rootSvg = (() => {
    let s = parent;
    while (isSvg(s.parentElement)) s = s.parentElement;
    return s;
  })();
  // 祖先有动画（会把画面外的部分挪进来）时不按视口裁
  let still = true;
  for (let a = parent; a && isSvg(a); a = a.parentElement) if (ownAnims(a).length) still = false;
  if (still && win.getComputedStyle(rootSvg).overflow !== 'visible') {
    const vb = rootSvg.getBoundingClientRect(),
      P = inv(sc);
    const pts = [
      [vb.left, vb.top],
      [vb.right, vb.top],
      [vb.left, vb.bottom],
      [vb.right, vb.bottom],
    ].map(([x, y]) => [P[0] * x + P[2] * y + P[4], P[1] * x + P[3] * y + P[5]]);
    const xs = pts.map(p => p[0]),
      ys = pts.map(p => p[1]);
    const x0 = Math.max(r.x, Math.min(...xs)),
      y0 = Math.max(r.y, Math.min(...ys)),
      x1 = Math.min(r.x + r.w, Math.max(...xs)),
      y1 = Math.min(r.y + r.h, Math.max(...ys));
    r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (!(r.w > 0 && r.h > 0)) return null;
  const boost = Math.max(1, PHONE / (doc.documentElement.clientWidth || PHONE));
  let k = unit * DPR * boost;
  if (r.w * r.h * k * k > MAX_PX) k = Math.sqrt(MAX_PX / (r.w * r.h));
  return { ...r, k, parent };
}
async function dataUri(win, url) {
  if (!url || /^data:/i.test(url)) return url;
  try {
    const b = await (await win.fetch(url)).blob();
    return await new Promise((ok, bad) => {
      const r = new win.FileReader();
      r.onload = () => ok(r.result);
      r.onerror = bad;
      r.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

/**
 * 一组连续兄弟元素画成位图，换成同一位置的 foreignObject + 背景图。
 * 在父元素的坐标系里画（祖先的 transform、opacity、裁切照旧作用在它上面），只带可继承的样式与全部资源定义
 */
async function rasterize(run, ctx, win, rep) {
  const doc = run[0].ownerDocument,
    R = region(run, win);
  if (!R) {
    rep('raster:fail', run[0]);
    return false;
  }
  const { parent, k } = R;
  const pw = Math.max(1, Math.round(R.w * k)),
    ph = Math.max(1, Math.round(R.h * k));
  const svg = mk(doc, 'svg', {
    xmlns: SVG_NS,
    width: pw,
    height: ph,
    viewBox: `${R.x} ${R.y} ${R.w} ${R.h}`,
    preserveAspectRatio: 'none',
  });
  const defs = mk(doc, 'defs');
  for (const r of doc.querySelectorAll('linearGradient,radialGradient,pattern,filter,mask,clipPath,marker,symbol'))
    if (isSvg(r)) defs.appendChild(r.cloneNode(true));
  svg.appendChild(defs);
  const pcs = win.getComputedStyle(parent),
    wrap = mk(doc, 'g');
  for (const p of INHERIT) {
    const v = pcs.getPropertyValue(p);
    if (v) wrap.style.setProperty(p, fixUrls(v));
  }
  for (const el of run) wrap.appendChild(el.cloneNode(true));
  svg.appendChild(wrap);
  for (const n of svg.querySelectorAll('*')) {
    if (isAnim(n)) {
      n.remove();
      continue;
    }
    for (const a of [...n.attributes]) if (/url\(/.test(a.value)) n.setAttribute(a.name, fixUrls(a.value));
  }
  for (const im of svg.getElementsByTagNameNS(SVG_NS, 'image')) {
    const u = await dataUri(win, im.getAttribute('href'));
    if (u) im.setAttribute('href', u);
    else rep('raster:image', run[0]);
  }
  const key = `${R.x.toFixed(2)},${R.y.toFixed(2)},${R.w.toFixed(2)},${R.h.toFixed(2)}|${new win.XMLSerializer().serializeToString(wrap)}`;
  let hit = ctx.rasterCache.get(key);
  if (!hit) {
    const url = win.URL.createObjectURL(
      new win.Blob([new win.XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
    );
    try {
      const img = new win.Image();
      img.src = url;
      await img.decode();
      const c = doc.createElement('canvas');
      c.width = pw;
      c.height = ph;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, pw, ph);
      const px = x.getImageData(0, 0, pw, ph).data;
      let x0 = pw,
        y0 = ph,
        x1 = -1,
        y1 = -1,
        opaque = true;
      for (let y = 0; y < ph; y++)
        for (let i = 0; i < pw; i++) {
          const al = px[(y * pw + i) * 4 + 3];
          if (!al) continue;
          if (al < 255) opaque = false;
          if (i < x0) x0 = i;
          if (i > x1) x1 = i;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      if (x1 < 0) hit = { empty: true };
      else {
        x0 = Math.max(0, x0 - 1);
        y0 = Math.max(0, y0 - 1);
        x1 = Math.min(pw - 1, x1 + 1);
        y1 = Math.min(ph - 1, y1 + 1);
        const cw = x1 - x0 + 1,
          ch = y1 - y0 + 1,
          out = doc.createElement('canvas');
        out.width = cw;
        out.height = ch;
        out.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
        // 每边都画满（整块铺底）用 JPEG，体积小得多
        const full = opaque && x0 === 0 && y0 === 0 && x1 === pw - 1 && y1 === ph - 1;
        const src = await ctx.raster(full ? out.toDataURL('image/jpeg', 0.92) : out.toDataURL('image/png'));
        hit = { src, x: R.x + (x0 / pw) * R.w, y: R.y + (y0 / ph) * R.h, w: (cw / pw) * R.w, h: (ch / ph) * R.h };
      }
      ctx.rasterCache.set(key, hit);
    } catch {
      rep('raster:fail', run[0]);
      return false;
    } finally {
      win.URL.revokeObjectURL(url);
    }
  }
  const text = run.some(el => el.localName === 'text' || el.querySelector('text'));
  // 画出来是空的：多半是位图里没渲染成功（原元素本来就看不见的情况很少），保留原样并报出来
  if (hit.empty) {
    rep('raster:fail', run[0]);
    return false;
  }
  const r3 = n => Math.round(n * 1000) / 1000;
  const fo = mk(doc, 'foreignObject', { x: r3(hit.x), y: r3(hit.y), width: r3(hit.w), height: r3(hit.h) });
  const sec = doc.createElementNS('http://www.w3.org/1999/xhtml', 'section');
  sec.style.cssText = `width:100%;height:100%;margin:0;padding:0;background-image:url("${hit.src}");background-size:100% 100%;background-repeat:no-repeat`;
  fo.appendChild(sec);
  run[0].before(fo);
  for (const el of run) el.remove();
  if (text) rep('raster:text', fo);
  return true;
}

/** 依赖 id 的静态部分逐组画成位图；ctx.raster 不可用时跳过（改由 paint 近似） */
export async function rasterAll(root, ctx, win, ids, rep) {
  if (!ctx.raster) return 0;
  let n = 0;
  for (const run of findUnits(root, win, ids)) if (await rasterize(run, ctx, win, rep)) n++;
  return n;
}
