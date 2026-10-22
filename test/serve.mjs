// 测试与排查脚本共用：起一个本工具的服务（不开浏览器），等两个端口都能用了再返回
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.ts');

/** → { proc, log(): 服务的输出, stop() } */
export async function startServer({ article, img, ui, settings }) {
  const args = [SERVER, ...(article ? [article] : []), '--port', String(img), '--ui', String(ui), '--no-open', ...(settings ? ['--settings', settings] : [])];
  const proc = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
  const ok = async (u, init) => { try { return (await fetch(u, { signal: AbortSignal.timeout(1000), ...init })).ok; } catch { return false; } };
  // 页面源码有改动时服务先构建页面，最多等一分钟
  for (let i = 0; i < 600 && proc.exitCode == null; i++) {
    if (await ok(`http://127.0.0.1:${ui}/api/state`) && await ok(`http://127.0.0.1:${img}/__ping`)) return { proc, log: () => out, stop: () => proc.kill() };
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('服务没有启动：\n' + out);
}
