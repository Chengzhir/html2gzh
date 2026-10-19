import { splitTop } from './util.js';

// 公众号正文加载不了网络字体，读者只能用手机自带的字体。电脑字体在手机上没有时，
// 按字形风格补上 iOS / 安卓自带的近似字体，插在通用族名之前。规则是可编辑的文本，一行一条：
//   原稿字体1, 原稿字体2 => 补上的字体1, 补上的字体2
// 名字不分大小写、整名匹配，* 匹配任意字符。# 开头是注释。
export const DEFAULT_RULES = `# 窄体英文数字：iPhone 用 DIN Condensed，安卓用 Roboto Condensed
Bahnschrift*, DIN, DIN *, DINPro*, Arial Narrow, Roboto Condensed, Oswald, Barlow*Condensed => DIN Condensed, Roboto Condensed, sans-serif-condensed
# 黑体：iPhone 用苹方，安卓用思源黑体（系统名 Noto Sans CJK SC）
Microsoft YaHei, Microsoft YaHei UI, 微软雅黑, Noto Sans CJK SC, Noto Sans SC, Source Han Sans, Source Han Sans SC, Source Han Sans CN, 思源黑体, SimHei, 黑体, DengXian, 等线, Hiragino Sans GB => PingFang SC, Noto Sans CJK SC
# 宋体
SimSun, 宋体, NSimSun, 新宋体, Noto Serif CJK SC, Noto Serif SC, Source Han Serif, Source Han Serif SC, Source Han Serif CN, 思源宋体, STSong, 华文宋体 => Songti SC, Noto Serif CJK SC, serif
# 楷体
KaiTi, 楷体, STKaiti, 华文楷体, Kaiti SC => Kaiti SC, STKaiti`;

export const DEFAULT_OPTS = {
  fontMode: 'fallback',          // 'fallback' 只补备用字体 | 'svg' 按每套字的选择转 SVG 轮廓
  rules: DEFAULT_RULES,
  noWrap: true,                  // nowrap 文字用不换行空格 + U+2060 禁止折行
  svgMin: 18,                    // "大字"：375 宽 iPhone（正文 335px）上不小于这个字号
  svgCopy: true,                 // 轮廓上叠一层透明文字，读者能选中复制
  faces: {},                     // 每套字（字体+字重+斜体）怎么处理：'all' 全部转轮廓 | 'big' 只转大字 | 'text' 保留文字
};

const toRe = names => new RegExp('^(' + names.map(n => n.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).join('|') + ')$', 'i');
const bare = n => n.trim().replace(/^["']|["']$/g, '');

/** 规则文本 → { rules:[{ re, fonts }], bad:[行号] } */
export function parseRules(text) {
  const rules = [], bad = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const m = s.split('=>');
    const left = m.length === 2 ? splitTop(m[0]).map(bare).filter(Boolean) : [];
    const right = m.length === 2 ? splitTop(m[1]).map(bare).filter(Boolean) : [];
    if (!left.length || !right.length) { bad.push(i + 1); return; }
    rules.push({ re: toRe(left), fonts: right });
  });
  return { rules, bad };
}

/** "A, B C" → 匹配这些字体名（整名、不分大小写、* 通配）的函数 */
export function fontMatcher(text) {
  const names = splitTop(String(text || '')).map(bare).filter(Boolean);
  if (!names.length) return () => false;
  const re = toRe(names);
  return name => re.test(bare(name));
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|emoji|math|fangsong)$/i;
export function mobileFonts(stack, rules) {
  if (!rules || !rules.length) return stack;
  const names = splitTop(stack).map(s => s.trim());
  const have = new Set(names.map(n => bare(n).toLowerCase()));
  const add = [];
  for (const n of names) for (const { re, fonts } of rules) if (re.test(bare(n))) for (const f of fonts) {
    if (!have.has(f.toLowerCase())) { have.add(f.toLowerCase()); add.push(GENERIC.test(f) ? f : `"${f}"`); }
  }
  if (!add.length) return stack;
  const g = names.findIndex(n => GENERIC.test(bare(n)));
  const at = g < 0 ? names.length : g;
  return [...names.slice(0, at), ...add, ...names.slice(at)].join(', ');
}

/** 一套字的键：作者写的首选字体 + 字重 + 是否斜体。字号不进键（cqw 下有几十种），按"大字"阈值另分 */
export function faceKey(cs) {
  const family = bare(splitTop(cs.fontFamily)[0] || '');
  const italic = cs.fontStyle !== 'normal';
  return { key: `${family.toLowerCase()}|${cs.fontWeight}|${italic ? 'i' : ''}`, family, weight: cs.fontWeight, italic };
}
// 手机上没有、也没有相近替代的展示字体：默认不论大小都转
const ALWAYS = fontMatcher('Bahnschrift, Bahnschrift *, DIN, DIN *, DINPro*');
export const faceDefault = family => ALWAYS(family) ? 'all' : 'big';

/** 补上的备用字体里有苹方、而字重超过 600：iPhone 上会偏细（苹方最粗只有中粗） */
export function mobileNote(family, weight, rules) {
  if (GENERIC.test(family)) return '手机上用系统默认字体';
  const added = mobileFonts(`"${family}"`, rules).split(',').slice(1).map(bare).filter(f => !GENERIC.test(f));
  if (!added.length) return '手机上没有这款字体时，用手机自带字体';
  const thin = added.includes('PingFang SC') && parseInt(weight, 10) > 600 ? '；iPhone 的苹方最粗只到 600，会偏细' : '';
  return `手机上换成 ${added.slice(0, 2).join('、')}${added.length > 2 ? ' 等' : ''}${thin}`;
}
