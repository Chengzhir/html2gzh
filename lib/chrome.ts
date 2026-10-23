// 找本机的 Chrome 或 Edge：字形接口、测试与开发工具都用它。装在别处时设环境变量 CHROME_PATH
import fs from 'node:fs';

const CANDIDATES =
  process.platform === 'win32'
    ? ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].flatMap(suffix =>
        [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
          .filter(Boolean)
          .map(base => `${base}/${suffix}`),
      )
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
          '/snap/bin/chromium',
        ];

/** → 可执行文件路径；找不到返回 null */
export function findChrome() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  return CANDIDATES.find(candidate => fs.existsSync(candidate)) || null;
}
