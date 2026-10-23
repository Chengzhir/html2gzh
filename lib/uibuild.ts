// 页面由 Vite 构建到 ui/dist。启动时检查：没有构建过，或页面、转换器的源码比构建结果新，就先构建一次
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, UI_DIR, stamp } from './config.ts';

const SOURCES = ['ui/src', 'ui/convert', 'ui/index.html', 'vite.config.ts', 'package.json'].map(entry =>
  path.join(ROOT, entry),
);
function newest(target: string): number {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(target);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) return stats.mtimeMs;
  return Math.max(stats.mtimeMs, ...fs.readdirSync(target).map(child => newest(path.join(target, child))));
}

/** 构建结果过期就重新构建；构建不了时保留旧的构建结果（没有的话，页面端口返回说明） */
export async function ensureUi() {
  const index = path.join(UI_DIR, 'index.html');
  const built = fs.existsSync(index) ? fs.statSync(index).mtimeMs : 0;
  if (built && built >= Math.max(...SOURCES.map(newest))) return;
  console.log(`${stamp()}  ${built ? '页面源码有改动，重新构建页面…' : '第一次运行，构建页面…'}`);
  try {
    const { build } = await import('vite');
    await build({ configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'warn' });
  } catch (error) {
    console.error(
      `${stamp()}  构建页面失败（${error.message}）${built ? '，使用上次构建的页面' : '：请在本工具的目录中运行 npm install，再运行 npm run build'}`,
    );
  }
}
