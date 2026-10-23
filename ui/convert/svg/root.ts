// 写在最外层 svg 上的 CSS 动画：最外层 svg 是 HTML 里的元素，公众号删掉样式表后它上面的动画就没了。
// 能改写的是透明度、显隐、填充等和整体的变换：把 svg 的内容包进一个 g，动画写在这个 g 上（SMIL）
import { mk, isAnim } from './dom.ts';
import { fromDom, inv } from './path.ts';

/** 把最外层 svg 的全部内容移进一个新的 g，返回这个 g */
export function wrapRoot(root: SVGSVGElement): SVGGElement {
  const g = mk(root.ownerDocument, 'g') as SVGGElement;
  while (root.firstChild) g.appendChild(root.firstChild);
  root.appendChild(g);
  return g;
}

/** 写在 g 上的动画，效果与写在 svg 上不同的情况：svg 自身的背景、边框、阴影、滤镜等会随 svg 一起变透明或移动，g 带不动它们 */
export function rootDecorated(computed: CSSStyleDeclaration): boolean {
  const none = (value: string) => !value || value === 'none';
  return (
    !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(computed.backgroundColor) ||
    !none(computed.backgroundImage) ||
    ['top', 'right', 'bottom', 'left'].some(
      side => parseFloat(computed.getPropertyValue(`border-${side}-width`)) > 0,
    ) ||
    !none(computed.boxShadow) ||
    (computed.outlineStyle !== 'none' && parseFloat(computed.outlineWidth) > 0) ||
    !none(computed.filter) ||
    !none(computed.getPropertyValue('backdrop-filter')) ||
    !none(computed.clipPath) ||
    !none(computed.getPropertyValue('mask-image')) ||
    computed.mixBlendMode !== 'normal'
  );
}

/** svg 自身有静态变换：CSS 动画在播放时会取代它，挪到 g 上的动画却会叠加在它上面 */
export const rootTransformed = (computed: CSSStyleDeclaration) =>
  ['transform', 'translate', 'rotate', 'scale'].some(prop => {
    const value = computed.getPropertyValue(prop);
    return value && value !== 'none';
  });

export interface RootBox {
  /** 变换原点（user units） */
  ox: number;
  oy: number;
  /** 百分比参照框：CSS 盒子的 border box（user units） */
  bw: number;
  bh: number;
  /** 1 CSS px 合多少 user units */
  unit: number;
  /** user units → content box 左上角的 CSS px */
  ctm: number[];
}

/**
 * 最外层 svg 的 CSS 盒子换算到 user units。getCTM 给出 user units 到 content box 的映射，不含 svg 自身的 CSS 变换。
 * viewBox 横纵缩放不同（preserveAspectRatio="none"）时，旋转换算不成 user units 里的旋转，返回 null
 */
export function rootBox(root: SVGSVGElement, computed: CSSStyleDeclaration): RootBox | null {
  const ctm = fromDom(root.getCTM());
  if (!ctm || ctm[1] || ctm[2] || !(ctm[0] > 0) || Math.abs(ctm[0] - ctm[3]) > 1e-6 * ctm[0]) return null;
  const px = (prop: string) => parseFloat(computed.getPropertyValue(prop)) || 0;
  const left = px('border-left-width') + px('padding-left'),
    top = px('border-top-width') + px('padding-top');
  const [ox, oy] = computed.transformOrigin.split(' ').map(parseFloat);
  const P = inv(ctm),
    k = ctm[0];
  return {
    ox: P[0] * (ox - left) + P[4],
    oy: P[3] * (oy - top) + P[5],
    bw: (root.clientWidth + px('border-left-width') + px('border-right-width')) / k,
    bh: (root.clientHeight + px('border-top-width') + px('border-bottom-width')) / k,
    unit: 1 / k,
    ctm,
  };
}

/**
 * 变换动画挪到 g 上之后，svg 自己按 content box 的裁切留在原处、不随内容移动。
 * 原来会裁切的：g 里再套一层与 content box 重合的嵌套 svg 来裁切（它随 g 移动），svg 本身改为不裁切
 */
export function moveClip(root: SVGSVGElement, target: SVGGElement, computed: CSSStyleDeclaration, box: RootBox) {
  if (computed.overflowX === 'visible' && computed.overflowY === 'visible') return;
  const px = (prop: string) => parseFloat(computed.getPropertyValue(prop)) || 0;
  const w = root.clientWidth - px('padding-left') - px('padding-right'),
    h = root.clientHeight - px('padding-top') - px('padding-bottom');
  const P = inv(box.ctm);
  // 没有 viewBox 时 user units 就是 CSS px，屏宽变了 svg 的尺寸也变：用百分比跟着 svg 走
  const plain = root.viewBox.baseVal == null || !root.viewBox.baseVal.width;
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const rect = plain
    ? { x: '0', y: '0', width: '100%', height: '100%' }
    : { x: r4(P[4]), y: r4(P[5]), width: r4(w * P[0]), height: r4(h * P[3]) };
  const clip = mk(root.ownerDocument, 'svg', {
    ...rect,
    viewBox: plain ? null : `${rect.x} ${rect.y} ${rect.width} ${rect.height}`,
    preserveAspectRatio: plain ? null : 'none',
    overflow: 'hidden',
  });
  // 已经写在 g 上的动画（透明度等）留在 g 上
  for (const node of [...target.childNodes]) if (!isAnim(node)) clip.appendChild(node);
  target.prepend(clip);
  root.style.setProperty('overflow', 'visible');
}

/** svg 自身的静态透明度挪到 g 上：透明度动画播放时取代它，不与它相乘 */
export function moveOpacity(root: SVGSVGElement, target: SVGGElement, computed: CSSStyleDeclaration) {
  const opacity = parseFloat(computed.opacity);
  root.style.removeProperty('opacity');
  root.removeAttribute('opacity');
  if (opacity < 1) target.setAttribute('opacity', String(opacity));
}
