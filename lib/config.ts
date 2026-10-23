// 命令行参数与页面上改的设置（settings.json，重启后沿用）；命令行参数优先
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { messageOf } from '../ui/convert/types.ts';

export const ROOT = path.dirname(import.meta.dirname);
/** 页面的构建结果（npm run build 生成） */
export const UI_DIR = path.join(ROOT, 'ui', 'dist');
const argv = process.argv.slice(2);
function option(key: string): string | undefined;
function option<T>(key: string, fallback: T): string | T;
function option<T>(key: string, fallback?: T) {
  const i = argv.indexOf('--' + key);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
export const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

const SETTINGS = path.resolve(option('settings', path.join(ROOT, 'settings.json')));
/** 设置文件里存的项；文件可能被手改，取用时逐项校验 */
interface Settings {
  imgPort?: unknown;
  host?: unknown;
  port?: unknown;
  proto?: unknown;
}
function loadSettings(): Settings {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
export const settings = loadSettings();
export function saveSettings(patch: Settings) {
  Object.assign(settings, patch);
  try {
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  } catch (error) {
    console.error(`${stamp()}  设置保存失败（${messageOf(error)}）`);
  }
}

export const validPort = (port: unknown): port is number =>
  typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535;
const portOption = option('port');
export const UI_PORT = +option('ui', portOption ? +portOption + 1 : 38961);
export const DEFAULT_IMG = 38960;
/** 命令行给了 --port：取图端口以它为准，被占时不退回默认端口 */
export const PORT_ARG = !!portOption;
export const savedImg = validPort(settings.imgPort) && settings.imgPort !== UI_PORT ? settings.imgPort : 0;
/** 取图口当前的端口，换绑成功后由 setImgPort 更新 */
export let IMG_PORT = portOption ? +portOption : savedImg || DEFAULT_IMG;
export const setImgPort = (port: number) => {
  IMG_PORT = port;
};
export const NO_OPEN = argv.includes('--no-open');
export const LAUNCH = process.platform === 'win32' ? 'serve.cmd' : 'node server.ts';
/** 启动时要打开的文章：第一个既不是选项、也不是选项值的参数 */
export const initialArg = argv.find(
  (arg, i) => !arg.startsWith('--') && !['--port', '--ui', '--settings'].includes(argv[i - 1]),
);
/** 取图口 /__ping 的应答：自测回连时确认连到的是自己 */
export const TOKEN = crypto.randomBytes(8).toString('hex');
