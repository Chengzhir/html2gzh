import { splitTop } from './util.ts';
import type { PhoneFonts } from './types.ts';

// 公众号正文加载不了网页字体，读者只能用手机自带的字体。电脑字体在手机上没有时，
// 按字形风格补上 iOS / 安卓自带的近似字体（备用字体），插在通用族名之前。规则是可编辑的文本，一行一条：
//   原稿字体1, 原稿字体2 => 备用字体1, 备用字体2
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
  rules: DEFAULT_RULES,
  noWrap: true, // nowrap 文字用不换行空格 + U+2060 禁止折行
  paths: [] as string[], // 转为 SVG 路径的字体表行（planFonts 的行键）；跨文章沿用
  svgMin: 18, // 字体表"按字号选择"的下限，px
  svgCopy: true, // 路径上叠一层透明文字，读者能选中复制
};
/** 字体表的字号按这个正文宽度（375 宽 iPhone）折算，和预览宽度无关 */
export const REF_W = 335;

const toRe = (names: string[]) =>
  new RegExp(
    '^(' +
      names
        .map(name =>
          name
            .trim()
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*'),
        )
        .join('|') +
      ')$',
    'i',
  );
const bare = (name: string) => name.trim().replace(/^["']|["']$/g, '');

export interface FontRule {
  re: RegExp;
  fonts: string[];
}
/** 规则文本 → { rules:[{ re, fonts }], bad:[行号] } */
export function parseRules(text: string) {
  const rules: FontRule[] = [],
    bad: number[] = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const sides = trimmed.split('=>');
      const left = sides.length === 2 ? splitTop(sides[0]).map(bare).filter(Boolean) : [];
      const right = sides.length === 2 ? splitTop(sides[1]).map(bare).filter(Boolean) : [];
      if (!left.length || !right.length) {
        bad.push(i + 1);
        return;
      }
      rules.push({ re: toRe(left), fonts: right });
    });
  return { rules, bad };
}

const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|emoji|math|fangsong)$/i;
export function mobileFonts(stack: string, rules: FontRule[] | null | undefined) {
  if (!rules || !rules.length) return stack;
  const names = splitTop(stack).map(name => name.trim());
  const have = new Set(names.map(name => bare(name).toLowerCase()));
  const add: string[] = [];
  for (const name of names)
    for (const { re, fonts } of rules)
      if (re.test(bare(name)))
        for (const font of fonts) {
          if (!have.has(font.toLowerCase())) {
            have.add(font.toLowerCase());
            add.push(GENERIC.test(font) ? font : `"${font}"`);
          }
        }
  if (!add.length) return stack;
  const generic = names.findIndex(name => GENERIC.test(bare(name)));
  const at = generic < 0 ? names.length : generic;
  return [...names.slice(0, at), ...add, ...names.slice(at)].join(', ');
}

/** 一套字的键：作者写的首选字体 + 字重 + 是否斜体 */
export function faceKey(computed: CSSStyleDeclaration) {
  const family = bare(splitTop(computed.fontFamily)[0] || '');
  const italic = computed.fontStyle !== 'normal';
  return {
    key: `${family.toLowerCase()}|${computed.fontWeight}|${italic ? 'i' : ''}`,
    family,
    weight: computed.fontWeight,
    italic,
  };
}

/**
 * 手机上的字体栈（原稿字体栈按规则补上备用字体）、栈里出自规则右边的字体名（手机字体），
 * 以及 iPhone 上会不会比原稿细：PingFang SC 最粗为 600（Semibold）
 */
export function phoneFonts(stack: string, weight: string, rules: FontRule[]): PhoneFonts {
  const out = mobileFonts(stack, rules);
  const known = new Set(rules.flatMap(rule => rule.fonts.map(font => font.toLowerCase())));
  const names = splitTop(out)
    .map(bare)
    .filter(name => known.has(name.toLowerCase()) && !GENERIC.test(name));
  return { stack: out, names, thin: names.some(name => /^pingfang sc$/i.test(name)) && parseInt(weight, 10) > 600 };
}
