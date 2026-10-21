// 大图处理：只处理提供给微信服务器的副本，原文件不动。读者拿到的图最宽 1080px（正文图片用 /640 档；iPhone、安卓保存下来的
// 与电脑上加载的都是 1080 宽），更宽的由微信自己缩小、重新压缩，失真明显（2026-10-22 实测 6 张 1100–1200px 宽的照片，
// 微信给的 1080 版比 Lanczos 缩小 + JPEG 质量 92 的 PSNR 低 6.3–6.8 dB；1080 宽的图微信只重新压缩、不缩小，PSNR 41.6 dB）。
// 所以比 1080 宽的图先自己缩到 1080 宽，画质从高往低试；不到 1080 宽、但超过体积上限的，在原尺寸下降画质
import sharp from 'sharp';

const LIMIT_PIXELS = 2e8;
const SERVED_W = 1080;
// 判断图片类型用的缩略尺寸（长边上限）
const PROBE = 1600;
// 体积大致与边长的 1.8 次方成正比（像素数的 0.9 次方），用来预估放得下的最大尺寸
const SIZE_EXP = 1.8;
// 用到上限的 90% 以上，或者与放不下的尺寸只差 3%，就不再找更大的尺寸
const GOOD = 0.9, CLOSE = 1.03;
// 可能是平面图形的来源格式；JPEG、HEIF/AVIF 来源已是有损照片，转 PNG 只会更大
const GRAPHIC_SRC = new Set(['png', 'gif', 'tiff', 'webp']);
// 平面图形（文字、图标、截图）存为 PNG 比 JPEG 清楚，照片则相反。用体积比区分：PNG 不比 JPEG 大太多时选 PNG
const LOSSLESS_RATIO = 1.5, PALETTE_RATIO = 1.2;

const JPEG = (q, cs = '4:2:0') => ({ jpeg: q, cs });
const PNG = q => ({ png: q });
// full：目标尺寸下依次尝试的画质，最后一档仍放不下时用它缩小尺寸；better：full 第一档放得下时再试的更好的编码；
// floor：缩到显示所需的尺寸仍放不下时依次降低的画质。平面图形的 JPEG 先不降采样色度（4:4:4），文字、线条边缘不发虚
const PLANS = {
  photo: { full: [JPEG(92), JPEG(85), JPEG(80), JPEG(75), JPEG(70)], better: [], floor: [JPEG(65), JPEG(60)] },
  graphic: { full: [JPEG(92, '4:4:4'), JPEG(85, '4:4:4'), JPEG(85), JPEG(80), JPEG(70)], better: [], floor: [JPEG(65), JPEG(60)] },
  lossless: { full: [PNG('lossless')], better: [], floor: [PNG(95), PNG(85)] },
  palette: { full: [PNG(95)], better: [PNG('lossless')], floor: [PNG(85), PNG(75)] },
  // 有透明部分：只能用 PNG（微信把 WebP 转存为 JPEG，透明部分会丢）。抠图照片先试无损；平面图形用 256 色
  alpha: { full: [PNG('lossless')], better: [], floor: [PNG(95), PNG(85), PNG(75)] },
  alphaFlat: { full: [PNG(95)], better: [PNG('lossless')], floor: [PNG(85), PNG(75)] },
};

/**
 * buf：原图。scale：正文显示所需的分辨率与原图之比，null 表示不知道显示尺寸。max：体积上限（字节）。
 * 宽度不超过 1080px 且不超过上限时不处理（skip: 'fits'）。
 * → { buf, ext, how, width, height, srcWidth, srcHeight, over } 或 { skip: 'fits' | 'vector' | 'animated' | 'unreadable' | 'noGain' }
 */
export async function shrink(buf, { scale, max }) {
  let meta;
  try { meta = await sharp(buf, { limitInputPixels: LIMIT_PIXELS }).metadata(); } catch { return { skip: 'unreadable' }; }
  if (meta.format === 'svg') return { skip: 'vector' };
  if ((meta.pages || 1) > 1) return { skip: 'animated' };
  if (!meta.width || !meta.height) return { skip: 'unreadable' };
  // EXIF 方向 5–8 是转了 90°：浏览器按转正后的宽高显示，scale 也是按转正后的尺寸算的
  const turned = (meta.orientation || 1) >= 5;
  const src = { buf, W: turned ? meta.height : meta.width, H: turned ? meta.width : meta.height, opaque: true };
  if (src.W <= SERVED_W && buf.length <= max) return { skip: 'fits' };
  // f0：读者拿到的尺寸；floor：显示所需的尺寸（背景图可能比 f0 小），不再往下缩
  const f0 = Math.min(1, SERVED_W / src.W);
  const floor = scale == null ? f0 : Math.min(f0, scale);
  const pf = Math.min(f0, PROBE / Math.max(src.W, src.H));
  src.opaque = !meta.hasAlpha || await opaqueAt(src, pf);
  const plan = PLANS[await classify(src, pf, GRAPHIC_SRC.has(meta.format))];
  const done = (c, over) => ({ buf: c.buf, ext: c.ext, how: c.how, width: c.width, height: c.height, srcWidth: src.W, srcHeight: src.H, over });

  let small = null;
  const keep = c => { if (!small || c.buf.length < small.buf.length) small = c; return c; };
  const fits = c => c.buf.length <= max;

  // 一、读者拿到的尺寸：画质从高到低。先试最高一档与最低一档，最低一档放得下时二分找放得下的最高一档
  const full = plan.full;
  const top = keep(await encode(src, f0, full[0]));
  if (fits(top)) {
    for (const step of plan.better) { const c = await encode(src, f0, step); if (fits(c)) return done(c, false); }
    return done(top, false);
  }
  const last = full.length > 1 ? keep(await encode(src, f0, full[full.length - 1])) : top;
  if (fits(last)) {
    let lo = 0, hi = full.length - 1, ok = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1, c = keep(await encode(src, f0, full[mid])); if (fits(c)) { hi = mid; ok = c; } else lo = mid; }
    return done(ok, false);
  }

  // 二、最低一档画质下缩小尺寸（只有显示所需比 f0 小的背景图才有余地）：在放得下（lo）与放不下（hi）的两次结果之间插值
  const searchStep = full[full.length - 1];
  let lo = null, hi = { f: f0, size: last.buf.length }, fit = null;
  const record = c => {
    keep(c);
    if (fits(c)) { if (!lo || c.f > lo.f) { lo = { f: c.f, size: c.buf.length }; fit = c; } }
    else if (c.f < hi.f) hi = { f: c.f, size: c.buf.length };
  };
  const target = max * 0.97;
  for (let k = 0; k < 6 && floor < f0 - 1e-9; k++) {
    if (lo && (lo.size >= max * GOOD || hi.f / lo.f < CLOSE)) break;
    if (!lo && hi.f <= floor + 1e-9) break;
    record(await encode(src, nextF(lo, hi, target, floor), searchStep));
  }
  if (fit) return done(fit, false);
  for (const step of plan.floor) {
    const c = keep(await encode(src, floor, step));
    if (fits(c)) return done(c, false);
  }
  if (small.buf.length >= buf.length) return { skip: 'noGain' };
  return done(small, true);
}

/** 下一次尝试的尺寸（原图的 f 倍） */
function nextF(lo, hi, target, floor) {
  if (lo && hi) {
    const t = (Math.log(target) - Math.log(lo.size)) / (Math.log(hi.size) - Math.log(lo.size));
    const f = Math.exp(Math.log(lo.f) + t * (Math.log(hi.f) - Math.log(lo.f)));
    const gap = hi.f - lo.f;
    return Math.min(hi.f - gap * 0.1, Math.max(lo.f + gap * 0.1, f));
  }
  if (lo) return Math.min(hi.f, lo.f * (target / lo.size) ** (1 / SIZE_EXP));
  return Math.max(floor, hi.f * (target / hi.size) ** (1 / SIZE_EXP));
}

/** 缩略图的透明通道里是否全是 255 */
async function opaqueAt(src, pf) {
  let p = sharp(src.buf, { limitInputPixels: LIMIT_PIXELS }).rotate();
  if (pf < 1) p = p.resize(Math.max(1, Math.round(src.W * pf)), Math.max(1, Math.round(src.H * pf)), { fit: 'fill' });
  const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] !== 255) return false;
  return true;
}

/** 用缩略图的编码体积判断按 PLANS 中的哪一类编码 */
async function classify(src, pf, graphicSrc) {
  const bytes = async step => (await encode(src, pf, step)).buf.length;
  if (!src.opaque) {
    // 与不透明的图同一判据：铺上灰底后的 JPEG 只用来比体积。无损 PNG 比它大得多，说明是照片一类（如抠图），256 色会出色带
    const l = await bytes(PNG('lossless')), j = await bytes({ ...JPEG(92, '4:4:4'), flatten: true });
    return l <= j * LOSSLESS_RATIO ? 'alphaFlat' : 'alpha';
  }
  if (!graphicSrc) return 'photo';
  const j = await bytes(JPEG(92, '4:4:4'));
  if (await bytes(PNG('lossless')) <= j * LOSSLESS_RATIO) return 'lossless';
  if (await bytes(PNG(95)) <= j * PALETTE_RATIO) return 'palette';
  return 'graphic';
}

/** 缩放到原图的 f 倍（转正、转为 sRGB）后按 step 编码 */
async function encode(src, f, step) {
  const w = Math.max(1, Math.round(src.W * f)), h = Math.max(1, Math.round(src.H * f));
  let p = sharp(src.buf, { limitInputPixels: LIMIT_PIXELS }).rotate();
  if (w !== src.W || h !== src.H) p = p.resize(w, h, { fit: 'fill', kernel: 'lanczos3', fastShrinkOnLoad: false });
  if (src.opaque) p = p.removeAlpha();
  else if (step.flatten) p = p.flatten({ background: '#808080' });
  let b, ext, how;
  if (step.jpeg) { b = await p.jpeg({ quality: step.jpeg, mozjpeg: true, chromaSubsampling: step.cs }).toBuffer(); ext = '.jpg'; how = `JPEG（质量 ${step.jpeg}）`; }
  else if (step.png === 'lossless') { b = await p.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(); ext = '.png'; how = 'PNG'; }
  else { b = await p.png({ palette: true, quality: step.png, effort: 10, dither: 1, compressionLevel: 9 }).toBuffer(); ext = '.png'; how = 'PNG（256 色）'; }
  return { buf: b, ext, how, width: w, height: h, f };
}
