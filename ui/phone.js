// 公众号阅读页模拟：正文外面套上阅读页的框架（标题、作者行、阅读数、底栏），浅色或深色。
// 深色用微信公开的转换算法 mp-darkmode（ui/vendor）：在只允许脚本、不同源的隐藏 iframe 里跑，结果拿回来放进不允许脚本的预览 iframe
import { READER_CSS, NEUTRAL, readerImages } from './convert/reader.js';

/** 正文区左右各 20px，阅读页不让正文铺满屏宽 */
export const SIDE = 20;
const FONT = 'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.544px';
// 尺寸与颜色量自线上文章页（2026-10，412 宽，浅色与深色）
const FRAME_CSS = `body{background:#fff}
.wx_page{padding:20px ${SIDE}px 96px}
.rich_media_title{margin:0 0 14px;font-size:22px;font-weight:500;line-height:1.4;color:rgba(0,0,0,.9);${FONT}}
.rich_media_meta_list{margin:0 0 22px;font-size:15px;line-height:20px;${FONT}}
.rich_media_meta_list span{margin-right:10px}
.wx_name{color:#576b95}.wx_time,.wx_reads{color:rgba(0,0,0,.3)}
.wx_reads{margin:32px 0 0;font-size:15px;${FONT}}
.wx_bar{position:fixed;left:0;right:0;bottom:0;height:60px;display:flex;align-items:center;gap:8px;padding:0 ${SIDE - 6}px 0 ${SIDE}px;background:#fff;border-top:1px solid rgba(0,0,0,.06);${FONT}}
.wx_avatar{width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.05);flex:none}
.wx_bar_name{flex:1;min-width:0;font-size:15px;font-weight:500;color:rgba(0,0,0,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wx_act{display:flex;flex-direction:column;align-items:center;width:46px;font-size:12px;line-height:16px;color:rgba(0,0,0,.9)}
.wx_act svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}`;
const FRAME_DARK = `body{background:#191919}
.rich_media_title{color:rgba(255,255,255,.8)}
.wx_name{color:#7d90a9}.wx_time,.wx_reads{color:rgba(255,255,255,.3)}
.rich_media_content{color:rgba(255,255,255,.55)}
.rich_media_content a{color:#7d90a9}
.wx_bar{background:#191919;border-top-color:rgba(255,255,255,.06)}
.wx_avatar{background:#1e1e1e}
.wx_bar_name,.wx_act{color:rgba(255,255,255,.8)}`;
const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ACTS = [
  ['赞', 'M7 10v10H4V10h3zm0 0l4-7c1.2 0 2 .9 2 2v4h5.2c1.1 0 1.9 1 1.7 2l-1.4 7c-.2.8-.9 1.4-1.7 1.4H7'],
  ['分享', 'M14 5l7 7-7 7v-4c-5 0-8 1.5-10 5 .5-6 3.5-10 10-11V5z'],
  ['推荐', 'M12 20s-7-4.4-9-9c-1.2-2.8.6-6 3.8-6 2 0 3.4 1.2 4.2 2.6C11.8 6.2 13.2 5 15.2 5 18.4 5 20.2 8.2 19 11c-2 4.6-7 9-7 9z'],
].map(([t, d]) => `<span class="wx_act">${icon(d)}${t}</span>`).join('');

/** 阅读页文档：标题、作者行与时间（占位）、正文、阅读数、底栏 */
export function readerDoc(fragment, dark) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${NEUTRAL}${READER_CSS}${FRAME_CSS}${dark ? FRAME_DARK : ''}</style></head><body>`
    + '<div class="wx_page"><h1 class="rich_media_title">文章标题</h1>'
    + '<div class="rich_media_meta_list"><span class="wx_name">公众号名称</span><span class="wx_time">2026年1月1日 08:00</span></div>'
    + `<div class="rich_media_content" id="js_content">${fragment}</div>`
    + '<p class="wx_reads">阅读 1000</p></div>'
    + `<div class="wx_bar" aria-hidden="true"><span class="wx_avatar"></span><span class="wx_bar_name">公众号名称</span>${ACTS}</div>`
    + '</body></html>';
}

let lib = null;
const libText = async () => lib ??= await (await fetch(new URL('vendor/mp-darkmode/darkmode.min.js', import.meta.url))).text();
// 隐藏 iframe 里执行：先照阅读页脚本改图片尺寸，再跑深色转换（处理正文区里的节点，和阅读页一样），删掉脚本后把整页交回来
const runner = nonce => `<script>addEventListener('load',function(){var m={type:'wxc-dark',nonce:${JSON.stringify(nonce)}};`
  + `try{(${readerImages})(document);Darkmode.run(document.querySelectorAll('#js_content,#js_content *'),{mode:'dark'});`
  + `var s=document.querySelectorAll('script');for(var i=0;i<s.length;i++)s[i].remove();m.html='<!DOCTYPE html>'+document.documentElement.outerHTML;}`
  + `catch(e){m.error=String(e&&e.message||e);}parent.postMessage(m,'*');});<\/script>`;

let pending = null;
/**
 * 深色模式：doc 是 readerDoc(…, true) 的结果，frame 是 sandbox="allow-scripts" 的隐藏 iframe（与本页不同源，读不到本机接口）。
 * 宽高与显示用的 iframe 一致（算法按首屏判断背景）。返回转换后的整页 HTML；被新的调用顶掉时返回 null
 */
export async function darkHtml(frame, doc, width, height) {
  const nonce = crypto.randomUUID();
  const at = doc.lastIndexOf('</body>');
  const src = doc.slice(0, at) + `<script>${await libText()}<\/script>` + runner(nonce) + doc.slice(at);
  if (pending) pending(null);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { finish(); reject(new Error('深色模式转换在 30 秒内没有完成')); }, 30000);
    const finish = () => { clearTimeout(t); removeEventListener('message', on); pending = null; };
    const on = e => {
      if (e.source !== frame.contentWindow || !e.data || e.data.type !== 'wxc-dark' || e.data.nonce !== nonce) return;
      finish();
      if (e.data.error) reject(new Error('深色模式转换出错：' + e.data.error)); else resolve(e.data.html);
    };
    pending = v => { finish(); resolve(v); };
    addEventListener('message', on);
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.srcdoc = src;
  });
}
