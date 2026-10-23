/**
 * 逐像素比两张截图（base64 PNG），左上角对齐、取两者共有的部分。pixelmatch 判断每个像素是否不同（抗锯齿造成的不计）。
 * masks 里的区域（相对截图左上角）外扩 3px，容纳超出盒子的字形墨迹，不参与比较，在差异图里画成浅蓝。
 * 判据是 solid：不同的像素先做 3×3 腐蚀（四周八格也都不同才留下），再看任一 WINDOW×WINDOW 方块里最多剩几个。
 * 字形挪了零点几像素只在笔画边上留下一两像素宽的差异，腐蚀后基本不剩；缺块、错色、整块挪位会留下成片的。
 * side 为真时另给并排图（原稿 | 预览 | 差异）。
 * → { bad, solid, at: [x, y], area: 屏蔽的像素数, total, wa, wb, ha, hb, diff, side }，diff 与 side 是 base64 PNG
 */
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';

export const WINDOW = 16;
// 约等于任一通道差 48（满 255）的灰度差
const THRESHOLD = 0.18;
const MASK_COLOR = [200, 225, 245, 255];

const rgba = (png, width, height) =>
  sharp(png).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer();

/** 腐蚀后的差异像素最密的方块：[个数, 左上角] */
function densestSolid(diff, w, h) {
  const sum = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0, row = 0; x < w; x++) {
      let solid = y > 0 && y < h - 1 && x > 0 && x < w - 1 ? 1 : 0;
      for (let dy = -1; dy <= 1 && solid; dy++)
        for (let dx = -1; dx <= 1; dx++) if (!diff[(y + dy) * w + x + dx]) solid = 0;
      row += solid;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  const N = Math.min(WINDOW, w, h);
  let best = 0,
    at = [0, 0];
  for (let y = 0; y + N <= h; y++)
    for (let x = 0; x + N <= w; x++) {
      const n =
        sum[(y + N) * (w + 1) + x + N] - sum[y * (w + 1) + x + N] - sum[(y + N) * (w + 1) + x] + sum[y * (w + 1) + x];
      if (n > best) [best, at] = [n, [x, y]];
    }
  return [best, at];
}

export async function pixelDiff(a, b, masks = [], { side = false } = {}) {
  const pngA = Buffer.from(a, 'base64'),
    pngB = Buffer.from(b, 'base64');
  const [metaA, metaB] = await Promise.all([sharp(pngA).metadata(), sharp(pngB).metadata()]);
  const w = Math.min(metaA.width, metaB.width),
    h = Math.min(metaA.height, metaB.height);
  const [dataA, dataB] = await Promise.all([rgba(pngA, w, h), rgba(pngB, w, h)]);
  const ignore = new Uint8Array(w * h);
  for (const [mx, my, mw, mh] of masks) {
    const x0 = Math.max(0, Math.floor(mx - 3)),
      x1 = Math.min(w, Math.ceil(mx + mw + 3));
    for (let y = Math.max(0, Math.floor(my - 3)); y < Math.min(h, Math.ceil(my + mh + 3)); y++)
      if (x0 < x1) ignore.fill(1, y * w + x0, y * w + x1);
  }
  // 不同的像素画成纯红，其余是原稿的淡化灰度（抗锯齿的画成黄色），据此取出差异掩码
  const out = Buffer.alloc(w * h * 4);
  const bad = pixelmatch(dataA, dataB, out, w, h, { threshold: THRESHOLD, ignoreMask: ignore, alpha: 0.3 });
  const diff = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < w * h; i++) {
    if (ignore[i]) {
      area++;
      out.set(MASK_COLOR, i * 4);
    } else if (out[i * 4] === 255 && out[i * 4 + 1] === 0 && out[i * 4 + 2] === 0) diff[i] = 1;
  }
  const [solid, at] = bad ? densestSolid(diff, w, h) : [0, [0, 0]];
  const diffPng = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
  let sidePng = null;
  if (side) {
    const gap = 12;
    sidePng = await sharp({ create: { width: w * 3 + gap * 2, height: h, channels: 4, background: '#fff' } })
      .composite([
        { input: dataA, raw: { width: w, height: h, channels: 4 }, left: 0, top: 0 },
        { input: dataB, raw: { width: w, height: h, channels: 4 }, left: w + gap, top: 0 },
        { input: diffPng, left: (w + gap) * 2, top: 0 },
      ])
      .png()
      .toBuffer();
  }
  return {
    bad,
    solid,
    at,
    area,
    total: w * h,
    wa: metaA.width,
    wb: metaB.width,
    ha: metaA.height,
    hb: metaB.height,
    diff: diffPng.toString('base64'),
    side: sidePng ? sidePng.toString('base64') : '',
  };
}
