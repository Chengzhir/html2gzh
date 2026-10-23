// 大图处理：只处理提供给微信服务器的副本，原文件不动。读者拿到的图最宽 1080px（正文图片用 /640 档；iPhone、安卓保存下来的
// 与电脑上加载的都是 1080 宽），更宽的由微信自己缩小、重新压缩，失真明显（2026-10-22 实测 6 张 1100–1200px 宽的照片，
// 微信给的 1080 版比 Lanczos 缩小 + JPEG 质量 92 的 PSNR 低 6.3–6.8 dB；1080 宽的图微信只重新压缩、不缩小，PSNR 41.6 dB）。
// 所以比 1080 宽的图先自己缩到 1080 宽，画质从高往低试，直到不超过体积上限（原图在上限内时，不超过原图）；
// 不到 1080 宽、但超过体积上限的，在原尺寸下降画质
import sharp from 'sharp';
import type { ShrinkHow, ShrinkResult, ShrinkOutput } from '../ui/convert/types.ts';

const LIMIT_PIXELS = 2e8;
const SERVED_W = 1080;
// 判断图片类型用的缩略尺寸（长边上限）
const PROBE = 1600;
// 体积大致与边长的 1.8 次方成正比（像素数的 0.9 次方），用来预估放得下的最大尺寸
const SIZE_EXP = 1.8;
// 用到上限的 90% 以上，或者与放不下的尺寸只差 3%，就不再找更大的尺寸
const GOOD = 0.9,
  CLOSE = 1.03;
// 可能是平面图形的来源格式；JPEG、HEIF/AVIF 来源已是有损照片，转 PNG 只会更大
const GRAPHIC_SRC = new Set(['png', 'gif', 'tiff', 'webp']);
// 平面图形（文字、图标、截图）存为 PNG 比 JPEG 清楚，照片则相反。用体积比区分：PNG 不比 JPEG 大太多时选 PNG
const LOSSLESS_RATIO = 1.5,
  PALETTE_RATIO = 1.2;

interface Step {
  jpeg?: number;
  chroma?: string;
  png?: number | 'lossless';
  flatten?: boolean;
}
interface Source {
  buf: Buffer;
  width: number;
  height: number;
  opaque: boolean;
}
interface Encoded {
  buf: Buffer;
  ext: string;
  how: ShrinkHow;
  width: number;
  height: number;
  factor: number;
}
const jpegStep = (quality: number, chroma = '4:2:0'): Step => ({ jpeg: quality, chroma });
const pngStep = (quality: number | 'lossless'): Step => ({ png: quality });
// full：目标尺寸下依次尝试的画质，最后一档仍放不下时用它缩小尺寸；better：full 第一档放得下时再试的更好的编码；
// floor：缩到显示所需的尺寸仍放不下时依次降低的画质。平面图形的 JPEG 先不降采样色度（4:4:4），文字、线条边缘不发虚
const PLANS: Record<string, { full: Step[]; better: Step[]; floor: Step[] }> = {
  photo: {
    full: [jpegStep(92), jpegStep(90), jpegStep(88), jpegStep(85), jpegStep(80), jpegStep(75), jpegStep(70)],
    better: [],
    floor: [jpegStep(65), jpegStep(60)],
  },
  graphic: {
    full: [jpegStep(92, '4:4:4'), jpegStep(85, '4:4:4'), jpegStep(85), jpegStep(80), jpegStep(70)],
    better: [],
    floor: [jpegStep(65), jpegStep(60)],
  },
  lossless: { full: [pngStep('lossless')], better: [], floor: [pngStep(95), pngStep(85)] },
  palette: { full: [pngStep(95)], better: [pngStep('lossless')], floor: [pngStep(85), pngStep(75)] },
  // 有透明部分：只能用 PNG（微信把 WebP 转存为 JPEG，透明部分会丢）。抠图照片先试无损；平面图形用 256 色
  alpha: { full: [pngStep('lossless')], better: [], floor: [pngStep(95), pngStep(85), pngStep(75)] },
  alphaFlat: { full: [pngStep(95)], better: [pngStep('lossless')], floor: [pngStep(85), pngStep(75)] },
};

/**
 * buf：原图。scale：正文显示所需的分辨率与原图之比，null 表示不知道显示尺寸。max：体积上限（字节）。
 * 宽度不超过 1080px 且不超过上限时不处理（skip: 'fits'）。
 * → { buf, ext, how, width, height, srcWidth, srcHeight, over } 或 { skip: 'fits' | 'vector' | 'animated' | 'unreadable' | 'noGain' }
 */
export async function shrink(
  buf: Buffer,
  { scale, max }: { scale: number | null; max: number },
): Promise<ShrinkResult> {
  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: LIMIT_PIXELS }).metadata();
  } catch {
    return { skip: 'unreadable' };
  }
  if (meta.format === 'svg') return { skip: 'vector' };
  if ((meta.pages || 1) > 1) return { skip: 'animated' };
  if (!meta.width || !meta.height) return { skip: 'unreadable' };
  // EXIF 方向 5–8 是转了 90°：浏览器按转正后的宽高显示，scale 也是按转正后的尺寸算的
  const turned = (meta.orientation || 1) >= 5;
  const src: Source = {
    buf,
    width: turned ? meta.height : meta.width,
    height: turned ? meta.width : meta.height,
    opaque: true,
  };
  if (src.width <= SERVED_W && buf.length <= max) return { skip: 'fits' };
  // servedFactor：读者拿到的尺寸；floor：显示所需的尺寸（背景图可能比它小），不再往下缩
  const servedFactor = Math.min(1, SERVED_W / src.width);
  const floor = scale == null ? servedFactor : Math.min(servedFactor, scale);
  const probeFactor = Math.min(servedFactor, PROBE / Math.max(src.width, src.height));
  src.opaque = !meta.hasAlpha || (await opaqueAt(src, probeFactor));
  const plan = PLANS[await classify(src, probeFactor, GRAPHIC_SRC.has(meta.format))];
  const done = (candidate: Encoded, over: boolean): ShrinkOutput => ({
    buf: candidate.buf,
    ext: candidate.ext,
    how: candidate.how,
    width: candidate.width,
    height: candidate.height,
    srcWidth: src.width,
    srcHeight: src.height,
    over,
  });

  // 试过的编码都记下：哪一档都放不下时用其中最小的
  const tried: Encoded[] = [];
  const keep = (candidate: Encoded) => {
    tried.push(candidate);
    return candidate;
  };
  const fits = (candidate: Encoded) => candidate.buf.length <= max;

  // 一、读者拿到的尺寸：取放得下的最高一档画质（先试最高、最低两档，再二分）。原图在上限内、只是比 1080px 宽时，副本也不超过
  // 原图：原图没有的细节，副本存得再大也不会有。2026-10-24 实测 6 张质量约 86 的照片，这样取到质量 90–92、体积为原图的 92%–97%；
  // 照原图的质量 86 重压体积更小，但缩放挪动了 8×8 分块，等于再压一遍，PSNR 低 0.8–2.5 dB。最低一档也超过原图时，按体积上限取
  const full = plan.full;
  const encoded: Encoded[] = [];
  const atStep = async (i: number) => (encoded[i] ??= keep(await encode(src, servedFactor, full[i])));
  /** 不超过 limit 的最高一档的序号；最低一档也超过时为 -1 */
  const bestUnder = async (limit: number) => {
    if ((await atStep(0)).buf.length <= limit) return 0;
    let lo = 0,
      hi = full.length - 1;
    if ((await atStep(hi)).buf.length > limit) return -1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((await atStep(mid)).buf.length <= limit) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const budget = Math.min(max, buf.length);
  const withinBudget = await bestUnder(budget);
  if (withinBudget === 0)
    for (const step of plan.better) {
      const candidate = await encode(src, servedFactor, step);
      if (candidate.buf.length <= budget) return done(candidate, false);
    }
  if (withinBudget >= 0) return done(await atStep(withinBudget), false);
  const withinMax = budget < max ? await bestUnder(max) : -1;
  if (withinMax >= 0) return done(await atStep(withinMax), false);
  const last = await atStep(full.length - 1);

  // 二、最低一档画质下缩小尺寸（只有显示所需比读者拿到的尺寸小的背景图才有余地）：在放得下与放不下的两次结果之间插值
  const searchStep = full[full.length - 1];
  const probeOf = (candidate: Encoded): Probe => ({ factor: candidate.factor, size: candidate.buf.length });
  // fitted：放得下的最大尺寸；overProbe：放不下的最小尺寸
  let fitted: Encoded | null = null,
    overProbe = probeOf(last);
  const target = max * 0.97;
  for (let k = 0; k < 6 && floor < servedFactor - 1e-9; k++) {
    const fitProbe = fitted && probeOf(fitted);
    if (fitProbe && (fitProbe.size >= max * GOOD || overProbe.factor / fitProbe.factor < CLOSE)) break;
    if (!fitProbe && overProbe.factor <= floor + 1e-9) break;
    const candidate = keep(await encode(src, nextFactor(fitProbe, overProbe, target, floor), searchStep));
    if (!fits(candidate)) {
      if (candidate.factor < overProbe.factor) overProbe = probeOf(candidate);
    } else if (!fitted || candidate.factor > fitted.factor) fitted = candidate;
  }
  if (fitted) return done(fitted, false);
  for (const step of plan.floor) {
    const candidate = keep(await encode(src, floor, step));
    if (fits(candidate)) return done(candidate, false);
  }
  const smallest = tried.reduce((a, b) => (b.buf.length < a.buf.length ? b : a));
  if (smallest.buf.length >= buf.length) return { skip: 'noGain' };
  return done(smallest, true);
}

/** 一次尝试：尺寸（原图的 factor 倍）与编码后的字节数 */
interface Probe {
  factor: number;
  size: number;
}
/** 下一次尝试的尺寸（原图的倍数） */
function nextFactor(fitProbe: Probe | null, overProbe: Probe, target: number, floor: number) {
  if (fitProbe) {
    const fraction =
      (Math.log(target) - Math.log(fitProbe.size)) / (Math.log(overProbe.size) - Math.log(fitProbe.size));
    const factor = Math.exp(
      Math.log(fitProbe.factor) + fraction * (Math.log(overProbe.factor) - Math.log(fitProbe.factor)),
    );
    const gap = overProbe.factor - fitProbe.factor;
    return Math.min(overProbe.factor - gap * 0.1, Math.max(fitProbe.factor + gap * 0.1, factor));
  }
  return Math.max(floor, overProbe.factor * (target / overProbe.size) ** (1 / SIZE_EXP));
}

/** 缩略图的透明通道里是否全是 255 */
async function opaqueAt(src: Source, probeFactor: number) {
  let pipeline = sharp(src.buf, { limitInputPixels: LIMIT_PIXELS }).rotate();
  if (probeFactor < 1)
    pipeline = pipeline.resize(
      Math.max(1, Math.round(src.width * probeFactor)),
      Math.max(1, Math.round(src.height * probeFactor)),
      { fit: 'fill' },
    );
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] !== 255) return false;
  return true;
}

/** 用缩略图的编码体积判断按 PLANS 中的哪一类编码 */
async function classify(src: Source, probeFactor: number, graphicSrc: boolean) {
  const bytes = async (step: Step) => (await encode(src, probeFactor, step)).buf.length;
  if (!src.opaque) {
    // 与不透明的图同一判据：铺上灰底后的 JPEG 只用来比体积。无损 PNG 比它大得多，说明是照片一类（如抠图），256 色会出色带
    const losslessBytes = await bytes(pngStep('lossless')),
      jpegBytes = await bytes({ ...jpegStep(92, '4:4:4'), flatten: true });
    return losslessBytes <= jpegBytes * LOSSLESS_RATIO ? 'alphaFlat' : 'alpha';
  }
  if (!graphicSrc) return 'photo';
  const jpegBytes = await bytes(jpegStep(92, '4:4:4'));
  if ((await bytes(pngStep('lossless'))) <= jpegBytes * LOSSLESS_RATIO) return 'lossless';
  if ((await bytes(pngStep(95))) <= jpegBytes * PALETTE_RATIO) return 'palette';
  return 'graphic';
}

/** 缩放到原图的 factor 倍（转正、转为 sRGB）后按 step 编码 */
async function encode(src: Source, factor: number, step: Step): Promise<Encoded> {
  const w = Math.max(1, Math.round(src.width * factor)),
    h = Math.max(1, Math.round(src.height * factor));
  let pipeline = sharp(src.buf, { limitInputPixels: LIMIT_PIXELS }).rotate();
  if (w !== src.width || h !== src.height)
    pipeline = pipeline.resize(w, h, { fit: 'fill', kernel: 'lanczos3', fastShrinkOnLoad: false });
  if (src.opaque) pipeline = pipeline.removeAlpha();
  else if (step.flatten) pipeline = pipeline.flatten({ background: '#808080' });
  let output: Buffer, ext: string, how: ShrinkHow;
  if (step.jpeg) {
    output = await pipeline.jpeg({ quality: step.jpeg, mozjpeg: true, chromaSubsampling: step.chroma }).toBuffer();
    ext = '.jpg';
    how = { fmt: 'jpeg', q: step.jpeg };
  } else if (step.png === 'lossless') {
    output = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    ext = '.png';
    how = { fmt: 'png' };
  } else {
    output = await pipeline
      .png({ palette: true, quality: step.png, effort: 10, dither: 1, compressionLevel: 9 })
      .toBuffer();
    ext = '.png';
    how = { fmt: 'palette' };
  }
  return { buf: output, ext, how, width: w, height: h, factor };
}
