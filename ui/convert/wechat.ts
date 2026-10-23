// 公众号存草稿时的清洗（逐项实测，见 tools/wxprobe.mjs）。预览与校验都在清洗后的片段上做：看到的就是存下来的样子
import { SVG_NS, WX_ANIM_OK } from './svg/dom.ts';
import { splitTop } from './util.ts';

const GONE = 'button,input,select,textarea,template,marquee,canvas,picture,progress,meter,script,style';
/** 声明里有 calc() 或带运算的 min()/max()/clamp() 时整条被删 */
const MATH = /(?:-webkit-)?calc\(|\b(?:min|max|clamp)\(([^()]|\([^()]*\))*[*/]|\b(?:min|max|clamp)\([^)]*\s[+-]\s/i;

export function wechatClean(html) {
  const doc = document.implementation.createHTMLDocument('');
  const box = doc.body;
  box.innerHTML = html;
  box.querySelectorAll(GONE).forEach(e => e.remove());
  for (const el of [...box.getElementsByTagNameNS(SVG_NS, '*')]) {
    if (!box.contains(el)) continue;
    el.removeAttribute('id');
    el.removeAttribute('class');
    el.removeAttribute('xmlns:xlink');
    el.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const n = el.localName;
    if ((n === 'animate' || n === 'set') && !WX_ANIM_OK.has(el.getAttribute('attributeName'))) {
      el.remove();
      continue;
    }
    if (n === 'image') {
      const h = (el.getAttribute('href') || '').trim();
      if (/^data:/i.test(h)) el.removeAttribute('href');
      else if (!/^https?:\/\/mmbiz\./i.test(h)) el.remove();
    }
  }
  for (const el of box.querySelectorAll('[style]')) {
    const decls = splitTop(el.getAttribute('style'), ';');
    const keep = decls.filter(d => !MATH.test(d));
    if (keep.length !== decls.length) {
      if (keep.length) el.setAttribute('style', keep.join(';'));
      else el.removeAttribute('style');
    }
  }
  // 粘贴进编辑器、保存后，dir="rtl" 变成 dir="auto"（2026-10-23 在段落上实测）
  box.querySelectorAll('[dir="rtl" i]').forEach(e => e.setAttribute('dir', 'auto'));
  return box.innerHTML;
}

/**
 * style 里的 filter 存草稿时整条被删，-webkit-filter 能留下。浏览器把两者当成同一属性，经过 CSSOM 会被写回 filter，
 * 所以只在最后的文本上改（预览不用改：渲染效果一样）
 */
export const webkitFilter = html =>
  html.replace(/\sstyle="[^"]*"/g, s => s.replace(/(^|[;\s"])filter\s*:/g, '$1-webkit-filter:'));
