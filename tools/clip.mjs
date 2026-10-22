// 把一段 HTML（默认 test/out/payload.html，即 e2e 跑完留下的成品）按 CF_HTML 放进剪贴板，供手工粘进公众号编辑器（只支持 Windows）
// 用法：node tools/clip.mjs [文件] [取图地址]   取图地址默认 http://127.0.0.1:38960
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:38960';
const src = args.find(a => !/^https?:/.test(a)) || 'test/out/payload.html';
const body = fs.readFileSync(src, 'utf8').replace(/http:\/\/127\.0\.0\.1:\d+\/a\//g, base + '/a/');
const pre = '<html><body><!--StartFragment-->',
  post = '<!--EndFragment--></body></html>';
const pad = n => String(n).padStart(10, '0');
const head = n =>
  `Version:0.9\r\nStartHTML:${n[0]}\r\nEndHTML:${n[1]}\r\nStartFragment:${n[2]}\r\nEndFragment:${n[3]}\r\n`;
const H = Buffer.byteLength(head([pad(0), pad(0), pad(0), pad(0)]));
const sh = H,
  sf = H + Buffer.byteLength(pre),
  ef = sf + Buffer.byteLength(body),
  eh = ef + Buffer.byteLength(post);
const file = path.join(os.tmpdir(), 'html2gzh-cf.html');
fs.writeFileSync(file, head([sh, eh, sf, ef].map(pad)) + pre + body + post);

const ps = path.join(os.tmpdir(), 'html2gzh-setclip.ps1');
fs.writeFileSync(
  ps,
  `Add-Type -AssemblyName System.Windows.Forms
$ms = New-Object System.IO.MemoryStream(,[System.IO.File]::ReadAllBytes(${JSON.stringify(file)}))
$d = New-Object System.Windows.Forms.DataObject
$d.SetData('HTML Format', $ms)
$d.SetData('UnicodeText', 'html2gzh payload')
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)
([System.Windows.Forms.Clipboard]::GetDataObject()).GetFormats() -join ','`,
);
console.log(
  execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ps], {
    encoding: 'utf8',
  }).trim(),
);
console.log(
  `${body.length} 字符，图片经 ${base}，data-ignore-width ${(body.match(/data-ignore-width/g) || []).length} 处`,
);
