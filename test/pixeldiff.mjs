/**
 * 在 page 里逐像素比两张截图（base64 PNG）：任一通道差超过 48 算不同；masks 里的区域（相对截图左上角）外扩 3px，
 * 容纳超出盒子的字形墨迹，不参与比较，在差异图里画成浅蓝。side 为真时另给并排图（原稿 | 预览 | 差异）。
 * → { bad, area: 屏蔽的像素数, total, wa, wb, ha, hb, diff, side }，diff 与 side 是 base64 PNG
 */
export function pixelDiff(page, a, b, masks = [], { side = false } = {}) {
  return page.evaluate(
    async (a, b, masks, withSide) => {
      const load = s =>
        new Promise(r => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = 'data:image/png;base64,' + s;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width),
        h = Math.min(ia.height, ib.height);
      const px = img => {
        const c = new OffscreenCanvas(w, h);
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const da = px(ia),
        db = px(ib);
      const masked = new Uint8Array(w * h);
      for (const [mx, my, mw, mh] of masks) {
        for (let y = Math.max(0, Math.floor(my - 3)); y < Math.min(h, Math.ceil(my + mh + 3)); y++)
          for (let X = Math.max(0, Math.floor(mx - 3)); X < Math.min(w, Math.ceil(mx + mw + 3)); X++)
            masked[y * w + X] = 1;
      }
      const dc = new OffscreenCanvas(w, h),
        dx = dc.getContext('2d'),
        out = dx.createImageData(w, h);
      let bad = 0,
        area = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (masked[i / 4]) {
          area++;
          out.data[i] = 200;
          out.data[i + 1] = 225;
          out.data[i + 2] = 245;
          out.data[i + 3] = 255;
          continue;
        }
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        const hit = d > 48;
        if (hit) bad++;
        out.data[i] = hit ? 255 : da[i] * 0.3 + 178;
        out.data[i + 1] = hit ? 0 : da[i + 1] * 0.3 + 178;
        out.data[i + 2] = hit ? 0 : da[i + 2] * 0.3 + 178;
        out.data[i + 3] = 255;
      }
      dx.putImageData(out, 0, 0);
      const b64 = async c => {
        const bl = await c.convertToBlob();
        const u = new Uint8Array(await bl.arrayBuffer());
        let s = '';
        for (const v of u) s += String.fromCharCode(v);
        return btoa(s);
      };
      let sideImg = '';
      if (withSide) {
        const gap = 12,
          H = Math.max(ia.height, ib.height);
        const sc = new OffscreenCanvas(w * 3 + gap * 2, H),
          sx = sc.getContext('2d');
        sx.fillStyle = '#fff';
        sx.fillRect(0, 0, sc.width, H);
        sx.drawImage(ia, 0, 0);
        sx.drawImage(ib, w + gap, 0);
        sx.drawImage(dc, (w + gap) * 2, 0);
        sideImg = await b64(sc);
      }
      return {
        bad,
        area,
        total: w * h,
        wa: ia.width,
        wb: ib.width,
        ha: ia.height,
        hb: ib.height,
        diff: await b64(dc),
        side: sideImg,
      };
    },
    a,
    b,
    masks,
    side,
  );
}
