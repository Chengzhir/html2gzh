// 模拟在手机微信中打开公众号文章时的页面：正文外面套上这个页面的框架（标题、作者行、阅读数、底栏），浅色或深色。
// 深色用 mp-darkmode：在只允许脚本、不同源的隐藏 iframe 里运行，结果拿回来放进不允许脚本的预览 iframe。
// 使用的版本与调用参数都与公众号文章页面相同；公众号更新后用 tools/wxdarkmode.mjs 查找对应的版本
import darkmodeUrl from 'mp-darkmode/dist/darkmode.min.js?url';
import { READER_CSS, NEUTRAL, readerImages } from '../convert/reader.ts';
import { CodedError } from '../convert/types.ts';
import { t } from './i18n.ts';
import type { ArticleMeta } from './prepare.ts';

/** 正文区左右各 20px，阅读页不让正文铺满屏宽 */
export const SIDE = 20;
/** 底栏（头像、赞、分享、推荐）的高度；左栏原网页预览的高度要扣掉它 */
export const BAR_H = 60;
const FONT = 'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.544px';
// 尺寸与颜色量自线上文章页（2026-10，412 宽，浅色与深色）
const FRAME_CSS = `body{background:#fff}
.wx_page{padding:20px ${SIDE}px 96px}
.rich_media_title{margin:0 0 14px;font-size:22px;font-weight:500;line-height:1.4;color:rgba(0,0,0,.9);${FONT}}
.rich_media_meta_list{margin:0 0 22px;font-size:15px;line-height:20px;${FONT}}
.rich_media_meta_list span{margin-right:10px}
.wx_name{color:#576b95}.wx_author,.wx_time,.wx_reads{color:rgba(0,0,0,.3)}
.wx_reads{margin:32px 0 0;font-size:15px;${FONT}}
.wx_bar{position:fixed;left:0;right:0;bottom:0;box-sizing:border-box;height:${BAR_H}px;display:flex;align-items:center;gap:8px;padding:0 ${SIDE - 6}px 0 ${SIDE}px;background:#fff;border-top:1px solid rgba(0,0,0,.06);${FONT}}
.wx_avatar{width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.05);flex:none;overflow:hidden}
.wx_avatar img{display:block;width:100%;height:100%;object-fit:cover}
.wx_bar_name{flex:1;min-width:0;font-size:15px;font-weight:500;color:rgba(0,0,0,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wx_act{display:flex;flex-direction:column;align-items:center;width:46px;font-size:12px;line-height:16px;color:rgba(0,0,0,.9)}
.wx_act svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}`;
const FRAME_DARK = `body{background:#191919}
.rich_media_title{color:rgba(255,255,255,.8)}
.wx_name{color:#7d90a9}.wx_author,.wx_time,.wx_reads{color:rgba(255,255,255,.3)}
.rich_media_content{color:rgba(255,255,255,.55)}
.rich_media_content a{color:#7d90a9}
.wx_bar{background:#191919;border-top-color:rgba(255,255,255,.06)}
.wx_avatar{background:#1e1e1e}
.wx_bar_name,.wx_act{color:rgba(255,255,255,.8)}`;
const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const ACTS: [string, string][] = [
  ['reader.like', 'M7 10v10H4V10h3zm0 0l4-7c1.2 0 2 .9 2 2v4h5.2c1.1 0 1.9 1 1.7 2l-1.4 7c-.2.8-.9 1.4-1.7 1.4H7'],
  ['reader.share', 'M14 5l7 7-7 7v-4c-5 0-8 1.5-10 5 .5-6 3.5-10 10-11V5z'],
  [
    'reader.recommend',
    'M12 20s-7-4.4-9-9c-1.2-2.8.6-6 3.8-6 2 0 3.4 1.2 4.2 2.6C11.8 6.2 13.2 5 15.2 5 18.4 5 20.2 8.2 19 11c-2 4.6-7 9-7 9z',
  ],
];
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const label = (key: string) => esc(t(key));
const pad2 = (n: number) => String(n).padStart(2, '0');
const timeText = (ms: number) => {
  const date = new Date(ms);
  return t('reader.timeFmt', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: pad2(date.getHours()),
    minute: pad2(date.getMinutes()),
  });
};

/** 页头与底栏：原稿里的信息与文件修改时间（time，毫秒）；没有的显示为占位文字 */
export interface ReaderFrame extends ArticleMeta {
  time: number;
}

/** 阅读页文档：标题、作者行与时间、正文、阅读数、底栏 */
export function readerDoc(fragment: string, frame: ReaderFrame, dark: boolean) {
  const account = esc(frame.account) || label('reader.name');
  // 作者与公众号名称不同时，和阅读页一样写在公众号名称前面
  const author =
    frame.author && frame.author !== frame.account ? `<span class="wx_author">${esc(frame.author)}</span>` : '';
  const avatar = frame.icon ? `<img src="${esc(frame.icon)}" alt="">` : '';
  const acts = ACTS.map(([key, path]) => `<span class="wx_act">${icon(path)}${label(key)}</span>`).join('');
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${NEUTRAL}${READER_CSS}${FRAME_CSS}${dark ? FRAME_DARK : ''}</style></head><body>` +
    `<div class="wx_page"><h1 class="rich_media_title">${esc(frame.title) || label('reader.title')}</h1>` +
    `<div class="rich_media_meta_list">${author}<span class="wx_name">${account}</span><span class="wx_time">${esc(timeText(frame.time))}</span></div>` +
    `<div class="rich_media_content" id="js_content">${fragment}</div>` +
    `<p class="wx_reads">${label('reader.reads')}</p></div>` +
    `<div class="wx_bar" aria-hidden="true"><span class="wx_avatar">${avatar}</span><span class="wx_bar_name">${account}</span>${acts}</div>` +
    '</body></html>'
  );
}

let darkmodeSource: string | null = null;
const loadDarkmode = async () => (darkmodeSource ??= await (await fetch(darkmodeUrl)).text());
// 公众号文章页面调用 mp-darkmode 时传入的参数；mode 在页面中为空（跟随系统设置），这里固定为深色
const DARK_OPTIONS = { mode: 'dark', defaultDarkTextColor: '#989898', whitelist: { attribute: ['data-no-dark'] } };
// 在隐藏 iframe 里执行：先按公众号文章页面的脚本调整图片尺寸，再运行深色转换（与这个页面一样，只处理正文区的子孙节点），删掉脚本后把整页交回来
const runner = (nonce: string) =>
  `<script>addEventListener('load',function(){var m={type:'wxc-dark',nonce:${JSON.stringify(nonce)}};` +
  `try{(${readerImages})(document);Darkmode.run(document.querySelectorAll('#js_content *'),${JSON.stringify(DARK_OPTIONS)});` +
  `var s=document.querySelectorAll('script');for(var i=0;i<s.length;i++)s[i].remove();m.html='<!DOCTYPE html>'+document.documentElement.outerHTML;}` +
  `catch(e){m.error=String(e&&e.message||e);}parent.postMessage(m,'*');});<\/script>`;

interface DarkReply {
  type: 'wxc-dark';
  nonce: string;
  html?: string;
  error?: string;
}
/** 正在等的那一次：新的调用开始时让它返回 null */
let cancelPending: (() => void) | null = null;
/**
 * 深色模式：doc 是 readerDoc(…, true) 的结果，frame 是 sandbox="allow-scripts" 的隐藏 iframe（与本页不同源，读不到本机接口）。
 * 宽高与显示用的 iframe 一致（算法按首屏判断背景）。返回转换后的整页 HTML；被新的调用顶掉时返回 null
 */
export async function darkHtml(
  frame: HTMLIFrameElement,
  doc: string,
  width: number,
  height: number,
): Promise<string | null> {
  const nonce = crypto.randomUUID();
  const bodyEnd = doc.lastIndexOf('</body>');
  const srcdoc =
    doc.slice(0, bodyEnd) + `<script>${await loadDarkmode()}<\/script>` + runner(nonce) + doc.slice(bodyEnd);
  cancelPending?.();
  const { promise, resolve, reject } = Promise.withResolvers<string | null>();
  const finish = () => {
    clearTimeout(timer);
    removeEventListener('message', onMessage);
    cancelPending = null;
  };
  const timer = setTimeout(() => {
    finish();
    reject(new CodedError('convert.darkTimeout'));
  }, 30000);
  const onMessage = (e: MessageEvent) => {
    const reply = e.data as Partial<DarkReply> | null;
    if (e.source !== frame.contentWindow || reply?.type !== 'wxc-dark' || reply.nonce !== nonce) return;
    finish();
    if (reply.error) reject(new CodedError('convert.darkError', { msg: reply.error }));
    else resolve(reply.html);
  };
  cancelPending = () => {
    finish();
    resolve(null);
  };
  addEventListener('message', onMessage);
  frame.style.width = width + 'px';
  frame.style.height = height + 'px';
  frame.srcdoc = srcdoc;
  return promise;
}
