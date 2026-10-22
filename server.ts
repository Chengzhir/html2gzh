#!/usr/bin/env node
// 两个端口：UI 口只绑 127.0.0.1（lib/uiroute.ts）；取图口绑 0.0.0.0，只出已登记的图片（lib/imgserver.ts），供微信服务器抓取。
// 这里只管启动：绑端口、端口被占时把文章交给已在运行的本工具、打开浏览器
import http from 'node:http';
import { spawn } from 'node:child_process';
import { UI_PORT, IMG_PORT, DEFAULT_IMG, PORT_ARG, savedImg, NO_OPEN, LAUNCH, initialArg } from './lib/config.ts';
import { openArticle } from './lib/article.ts';
import { checkHosts } from './lib/host.ts';
import { imgServer, listenImg } from './lib/imgserver.ts';
import { uiRoute } from './lib/uiroute.ts';
import { wrap } from './lib/http.ts';
import { ensureUi } from './lib/uibuild.ts';

function openBrowser(u: string) {
  if (NO_OPEN) return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', u]]
      : process.platform === 'darwin'
        ? ['open', [u]]
        : ['xdg-open', [u]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

/** UI 口被占：若占用者是本工具，就把文章交给它，自己退出 */
async function handOver() {
  const base = `http://127.0.0.1:${UI_PORT}`;
  try {
    const s = await (await fetch(base + '/api/state', { signal: AbortSignal.timeout(2000) })).json();
    if (s.app !== 'html2gzh') throw new Error();
  } catch {
    console.error(
      `页面端口 ${UI_PORT} 已被其他程序占用。请改用其他端口启动，例如 ${LAUNCH} --port 40000（本机端口为 40000，页面端口为 40001）`,
    );
    process.exit(1);
  }
  if (initialArg) {
    const r = await fetch(base + '/api/open', {
      method: 'POST',
      headers: { origin: base },
      body: JSON.stringify({ path: initialArg }),
    });
    const j = await r.json();
    console.log(r.ok ? '已在运行中的 html2gzh 里打开：' + j.file : '打开失败：' + j.error);
  } else console.log('html2gzh 已在运行。');
  openBrowser(base + '/');
  process.exit(0);
}

await ensureUi();
const uiServer = http.createServer(wrap(uiRoute));
uiServer.once('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') handOver();
  else throw e;
});
uiServer.listen(UI_PORT, '127.0.0.1', async () => {
  if (initialArg) {
    try {
      openArticle(initialArg);
    } catch (e) {
      console.error(e.message);
    }
  }
  const want = IMG_PORT;
  try {
    await listenImg(want);
  } catch (e) {
    // 上次在页面里存的端口被占了：退回默认端口，页面里可以再改
    const fallback = !PORT_ARG && savedImg && want !== DEFAULT_IMG && e.code === 'EADDRINUSE';
    if (fallback) {
      console.error(`本机端口 ${want}（上次在页面中设置）已被其他程序占用，改用 ${DEFAULT_IMG}`);
      try {
        await listenImg(DEFAULT_IMG);
      } catch {
        /* 下面统一报错 */
      }
    }
    if (!imgServer.listening) {
      console.error(
        e.code === 'EADDRINUSE'
          ? `本机端口 ${want} 已被其他程序占用。请改用其他端口启动，例如 ${LAUNCH} --port 40000（本机端口为 40000，页面端口为 40001）`
          : e.message,
      );
      process.exit(1);
    }
  }
  console.log(`\n  页面    http://127.0.0.1:${UI_PORT}/`);
  console.log(`  取图    0.0.0.0:${IMG_PORT}（对外网开放，只提供已载入文章中的图片；端口可在页面中修改）`);
  console.log('  退出    Ctrl+C\n');
  checkHosts();
  openBrowser(`http://127.0.0.1:${UI_PORT}/`);
});
