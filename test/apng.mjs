// 测试用的 APNG：几张同尺寸、同像素格式的 PNG 按帧拼起来，每帧 0.5 秒，循环播放。sharp 不能写 APNG
import zlib from 'node:zlib';

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
};
/** 一张 PNG 里的 IHDR 与合起来的 IDAT 数据 */
function parts(png) {
  let ihdr = null;
  const idat = [];
  for (let at = 8; at + 8 <= png.length; at += 12 + png.readUInt32BE(at)) {
    const type = png.toString('latin1', at + 4, at + 8),
      data = png.subarray(at + 8, at + 8 + png.readUInt32BE(at));
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
  }
  return { ihdr, idat: Buffer.concat(idat) };
}
export function apngOf(pngs) {
  const frames = pngs.map(parts);
  const { ihdr } = frames[0];
  const acTL = Buffer.alloc(8);
  acTL.writeUInt32BE(frames.length, 0);
  let sequence = 0;
  const fcTL = () => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence++, 0);
    ihdr.copy(data, 4, 0, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(2, 22);
    return chunk('fcTL', data);
  };
  const body = frames.flatMap(({ idat }, i) => {
    if (i === 0) return [fcTL(), chunk('IDAT', idat)];
    const control = fcTL();
    const seq = Buffer.alloc(4);
    seq.writeUInt32BE(sequence++);
    return [control, chunk('fdAT', Buffer.concat([seq, idat]))];
  });
  return Buffer.concat([
    pngs[0].subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('acTL', acTL),
    ...body,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
