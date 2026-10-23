// 命令行参数与页面上改的设置（settings.json，重启后沿用）；命令行参数优先
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.dirname(import.meta.dirname);
/** 页面的构建结果（npm run build 生成） */
export const UI_DIR = path.join(ROOT, 'ui', 'dist');
const argv = process.argv.slice(2);
const opt = <T = undefined>(k: string, d?: T): string | T => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
export const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

const SETTINGS = path.resolve(opt('settings', path.join(ROOT, 'settings.json')));
function loadSettings(): Record<string, any> {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}
export const settings = loadSettings();
export function saveSettings(patch: Record<string, unknown>) {
  Object.assign(settings, patch);
  try {
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  } catch (e) {
    console.error(`${stamp()}  设置保存失败（${e.message}）`);
  }
}

export const validPort = (n: number) => Number.isInteger(n) && n >= 1024 && n <= 65535;
export const UI_PORT = +opt('ui', opt('port') ? +opt('port') + 1 : 38961);
export const DEFAULT_IMG = 38960;
/** 命令行给了 --port：取图端口以它为准，被占时不退回默认端口 */
export const PORT_ARG = !!opt('port');
export const savedImg = validPort(settings.imgPort) && settings.imgPort !== UI_PORT ? settings.imgPort : 0;
/** 取图口当前的端口，换绑成功后由 setImgPort 更新 */
export let IMG_PORT = PORT_ARG ? +opt('port') : savedImg || DEFAULT_IMG;
export const setImgPort = (p: number) => {
  IMG_PORT = p;
};
export const NO_OPEN = argv.includes('--no-open');
export const LAUNCH = process.platform === 'win32' ? 'serve.cmd' : 'node server.ts';
/** 启动时要打开的文章：第一个既不是选项、也不是选项值的参数 */
export const initialArg = argv.find(
  (a, i) => !a.startsWith('--') && !['--port', '--ui', '--settings'].includes(argv[i - 1]),
);
/** 取图口 /__ping 的应答：自测回连时确认连到的是自己 */
export const TOKEN = crypto.randomBytes(8).toString('hex');
