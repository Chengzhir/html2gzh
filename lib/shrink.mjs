// 大图压缩：只处理提供给微信服务器的副本，原文件不动。微信转存时保留上传的分辨率（原图地址 /0 是上传的尺寸），画质则重新编码
// （2026-10-22 实测：3506×2630、954 KB 的 JPEG 存为 545 KB）。读者会点开图片全屏查看、保存，所以先在原尺寸下降低画质；
// 仍超过上限才缩小尺寸，取上限内放得下的最大尺寸，且不小于正文显示所需的分辨率
import sharp from 'sharp';

const LIMIT_PIXELS = 2e8;
// 不知道显示尺寸时（border-image、随动画缩放的 SVG 等），最多缩小到长边 2560px
const LONG_CAP = 2560;
// 判断图片类型、预估体积用的缩略尺寸（长边）
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
// full：原尺寸下依次尝试的画质，最后一档仍放不下时用它缩小尺寸；better：full 第一档放得下时再试的更好的编码；
// floor：缩到显示所需的尺寸仍放不下时依次降低的画质。平面图形的 JPEG 先不降采样色度（4:4:4），文字、线条边缘不发虚
const PLANS = {
  photo: { full: [JPEG(85), JPEG(80), JPEG(75), JPEG(70)], better: [], floor: [JPEG(65), JPEG(60)] },
  graphic: { full: [JPEG(85, '4:4:4'), JPEG(85), JPEG(80), JPEG(70)], better: [], floor: [JPEG(65), JPEG(60)] },
  lossless: { full: [PNG('lossless')], better: [], floor: [PNG(95), PNG(85)] },
  palette: { full: [PNG(95)], better: [PNG('lossless')], floor: [PNG(85), PNG(75)] },
  // 有透明部分：只能用 PNG（微信把 WebP 转存为 JPEG，透明部分会丢）。抠图照片保留无损、先缩尺寸；平面图形用 256 色保留原尺寸
  alpha: { full: [PNG('lossless')], better: [], floor: [PNG(95), PNG(85), PNG(75)] },
  alphaFlat: { full: [PNG(95)], better: [PNG('lossless')], floor: [PNG(85), PNG(75)] },
};

/**
 * buf：原图。scale：正文显示所需的分辨率与原图之比（≥ 1 表示需要原图的全部分辨率），null 表示不知道显示尺寸。max：体积上限（字节）。
 * → { buf, ext, how, width, height, srcWidth, srcHeight, over } 或 { skip: 'vector' | 'animated' | 'unreadable' | 'noGain' }
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
  const long = Math.max(src.W, src.H);
  const floor = scale == null ? Math.min(1, LONG_CAP / long) : Math.min(1, scale);
  const cap = Math.min(max, buf.length - 1);
  const pf = Math.min(1, PROBE / long);
  src.opaque = !meta.hasAlpha || await opaqueAt(src, pf);
  const plan = PLANS[await classify(src, pf, GRAPHIC_SRC.has(meta.format))];
  const done = (c, over) => ({ buf: c.buf, ext: c.ext, how: c.how, width: c.width, height: c.height, srcWidth: src.W, srcHeight: src.H, over });

  let small = null;
  const keep = c => { if (!small || c.buf.length < small.buf.length) small = c; return c; };
  const fits = c => c.buf.length <= cap;

  // 一、原尺寸：画质从高到低。先试最高一档与最低一档，最低一档放得下时二分找放得下的最高一档
  const full = plan.full;
  const top = keep(await encode(src, 1, full[0]));
  if (fits(top)) {
    for (const step of plan.better) { const c = await encode(src, 1, step); if (fits(c)) return done(c, false); }
    return done(top, false);
  }
  const last = full.length > 1 ? keep(await encode(src, 1, full[full.length - 1])) : top;
  if (fits(last)) {
    let lo = 0, hi = full.length - 1, ok = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1, c = keep(await encode(src, 1, full[mid])); if (fits(c)) { hi = mid; ok = c; } else lo = mid; }
    return done(ok, false);
  }

  // 二、最低一档画质下缩小尺寸：找放得下的最大尺寸，在放得下（lo）与放不下（hi）的两次结果之间插值
  const searchStep = full[full.length - 1];
  let lo = null, hi = { f: 1, size: last.buf.length }, fit = null;
  const record = c => {
    keep(c);
    if (fits(c)) { if (!lo || c.f > lo.f) { lo = { f: c.f, size: c.buf.length }; fit = c; } }
    else if (c.f < hi.f) hi = { f: c.f, size: c.buf.length };
  };
  const target = cap * 0.97;
  for (let k = 0; k < 6 && floor < 1 - 1e-9; k++) {
    if (lo && (lo.size >= cap * GOOD || hi.f / lo.f < CLOSE)) break;
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
  if (lo) return Math.min(1, lo.f * (target / lo.size) ** (1 / SIZE_EXP));
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
    const l = await bytes(PNG('lossless')), j = await bytes({ ...JPEG(85, '4:4:4'), flatten: true });
    return l <= j * LOSSLESS_RATIO ? 'alphaFlat' : 'alpha';
  }
  if (!graphicSrc) return 'photo';
  const j = await bytes(JPEG(85, '4:4:4'));
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
