// 网页字体测试稿（test/fixture-webfont）用的字体文件：从 Windows 自带字体截取子集生成，不随仓库分发字体文件。
// 另起一个允许跨域的本机服务，模拟字体网站（Google Fonts 一类）。e2e.mjs 跑这份测试稿时调用
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import subsetFont from 'subset-font';

export const REMOTE_PORT = 48970;
const WIN_FONTS = path.join(process.env.WINDIR || String.raw`C:\Windows`, 'Fonts');
const ASCII = String.fromCharCode(...Array.from({ length: 95 }, (_, i) => 32 + i));

/** 生成 fonts/ 下的字体与样式表；测试稿没改过就不重做 */
export async function buildWebfontFixture(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const out = path.join(dir, 'fonts'),
    marker = path.join(out, '.built');
  const sig = crypto
    .createHash('sha256')
    .update(html + fs.readFileSync(new URL(import.meta.url)))
    .digest('hex')
    .slice(0, 16);
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === sig) return;
  fs.mkdirSync(path.join(out, 'remote'), { recursive: true });
  const read = f => fs.readFileSync(path.join(WIN_FONTS, f));
  const cjk = [...new Set(html.match(/[\u3000-\u9fff\uff00-\uffef]/g) || [])].join('');
  const sub = (file, chars, targetFormat) => subsetFont(read(file), chars, { targetFormat });
  const jobs = [
    ['cjk.woff2', 'simhei.ttf', cjk + ASCII, 'woff2'],
    // 同一款字体按 unicode-range 切成两片（字体网站的常见做法），两片的 PostScript 名相同
    ['slice-latin.woff2', 'arial.ttf', ASCII.replace(/[0-9]/g, ''), 'woff2'],
    ['slice-digits.woff2', 'arial.ttf', '0123456789', 'woff2'],
    // 可变字体：wght 300–700、wdth 75–100
    ['var.woff2', 'bahnschrift.ttf', ASCII, 'woff2'],
    ['remote/remote.woff2', 'segoeui.ttf', ASCII, 'woff2'],
    ['remote/imported.woff', 'georgia.ttf', ASCII, 'woff'],
  ];
  for (const [name, file, chars, fmt] of jobs) fs.writeFileSync(path.join(out, name), await sub(file, chars, fmt));
  const inline = await sub('times.ttf', ASCII, 'sfnt');
  fs.writeFileSync(
    path.join(out, 'inline.css'),
    `@font-face{font-family:"Inline Serif";src:url(data:font/ttf;base64,${inline.toString('base64')}) format("truetype")}\n`,
  );
  // 站外样式表里的字体地址是相对样式表自己的
  fs.writeFileSync(
    path.join(out, 'remote', 'remote.css'),
    '@font-face{font-family:"Remote Sans";src:url(remote.woff2) format("woff2")}\n',
  );
  fs.writeFileSync(
    path.join(out, 'remote', 'imported.css'),
    '@font-face{font-family:"Imported Serif";src:url(imported.woff) format("woff")}\n',
  );
  fs.writeFileSync(marker, sig);
}

/** fonts/remote/ 下的文件，带 Access-Control-Allow-Origin: *；只回这一层目录里的文件 */
export function serveRemote(dir) {
  const root = path.join(dir, 'fonts', 'remote');
  const TYPES = { '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  const srv = http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = path.join(root, name);
    if (!name || !fs.existsSync(file)) {
      res.writeHead(404, { 'access-control-allow-origin': '*' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(name)] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(REMOTE_PORT, '127.0.0.1', () => resolve(srv));
  });
}
