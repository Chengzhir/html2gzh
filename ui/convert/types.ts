// 跨模块（转换器 ↔ 页面、页面 ↔ 本机服务）传递的数据形状

// ---------- 检查结果 ----------
export type FindingLevel = 'error' | 'warn' | 'fixed' | 'info';
/** 要在预览里标出的元素：元素本身或它的 data-wxc */
export type FindingEls = (Element | string)[];
export interface Finding {
  level: FindingLevel;
  title: string;
  /** 一句结论 */
  text: string;
  /** 详细说明，界面上点开才显示；没有为空串 */
  detail: string;
  /** 要在预览里标出的元素的 data-wxc */
  ids: string[];
}
/** 没有说明时第三个参数直接给元素 */
export type AddFinding = (title: string, text: string, detail?: string | FindingEls, els?: FindingEls) => void;
export interface FindingSink {
  list: Finding[];
  fixed: AddFinding;
  warn: AddFinding;
  info: AddFinding;
  error: AddFinding;
}
/** SVG 转换的检查结果：[等级, 标题, 结论, 详细说明, 要标出的最外层 svg] */
export type SvgFinding = [level: FindingLevel, title: string, text: string, detail: string, els: Element[]];

// ---------- 字体表 ----------
export interface FontPlanRow {
  /** 行键：字体键|字号 */
  key: string;
  /** 字体键：首选字体|字重|是否斜体 */
  face: string;
  family: string;
  weight: string;
  italic: boolean;
  /** 折算到 335px 正文宽的字号（px，取到 0.5） */
  size: number;
  stack: string;
  stretch: string;
  /** 原稿用上的网页字体名，没有为空串 */
  web: string;
  chars: number;
  sample: string;
}
export interface PhoneFonts {
  stack: string;
  /** 栈里出自备用字体规则的手机字体 */
  names: string[];
  /** iPhone 上会比原稿细 */
  thin: boolean;
}
export interface FontRow extends FontPlanRow {
  /** 转为路径的字数 */
  done: number;
  /** 没转的原因代码 → 字数 */
  why: Record<string, number>;
  phone: PhoneFonts;
}

// ---------- 字形接口 /api/glyphs ----------
export interface GlyphItem {
  family: string;
  weight: string;
  style: string;
  stretch: string;
  features: string;
  variations: string;
  ligatures: string;
  lang: string;
  /** 字距不为 0 */
  spaced: boolean;
  /** 网页字体的字号（opsz 轴），0 为不设 */
  opsz: number;
  chars: string[];
  runs: string[];
}
export type GlyphFontSrc =
  | { local: string; id?: never; format?: never }
  | { local?: never; id: string; format: string };
/** 原稿的一条 @font-face；src 为空表示原稿里加载失败 */
export interface GlyphFont {
  family: string;
  weight: string;
  style: string;
  stretch: string;
  range: string;
  sizeAdjust: string;
  src: GlyphFontSrc[];
}
export interface GlyphRequest {
  items: GlyphItem[];
  fonts: GlyphFont[];
}

export interface GlyphFace {
  upem: number;
  weight: number;
  italic: boolean;
  web?: boolean;
  /** size-adjust 折成的倍数 */
  scale?: number;
  name: string;
}
export interface GlyphPath {
  /** 首个 moveto 的绝对坐标 */
  m: [number, number];
  d: string;
}
/** [路径号, x, y]，字体单位 */
export type GlyphRef = [path: number, x: number, y: number];
export interface GlyphShape {
  adv: number;
  g: GlyphRef[];
}
export type GlyphMissKind = 'nofont' | 'webfont' | 'notindexed' | 'color' | 'shape' | 'notdef';
export interface GlyphOutline extends GlyphShape {
  /** faces 的下标 */
  f: number;
  /** 标点挤压用的半宽字形 */
  halt?: GlyphShape;
  miss?: undefined;
  ps?: undefined;
  space?: undefined;
}
export interface GlyphMiss {
  miss: GlyphMissKind;
  ps?: string;
  f?: undefined;
  adv?: undefined;
  g?: undefined;
  halt?: undefined;
  space?: undefined;
}
export interface GlyphSpace {
  space: true;
  f?: undefined;
  adv?: undefined;
  g?: undefined;
  halt?: undefined;
  miss?: undefined;
  ps?: undefined;
}
export type GlyphChar = GlyphOutline | GlyphMiss | GlyphSpace;
/** null：逐字排版就对；数组：按字素给出替换（null 为不变）；'bad'：对不上 Chrome 的排版 */
export type GlyphRun = null | 'bad' | (GlyphShape | null)[];
export interface GlyphResponse {
  faces: GlyphFace[];
  paths: GlyphPath[];
  items: { chars: GlyphChar[]; runs: GlyphRun[] }[];
}

// ---------- 状态接口 /api/state ----------
export interface HostExit {
  base: string;
  ip: string;
  /** 本轮多少次查询落在这个出口 */
  seen: number;
  ok: boolean;
  passes: number;
  /** 本轮没查到、沿用上一轮的 */
  stale: boolean;
}
export interface HostState {
  checking: boolean;
  list: HostExit[];
  checkedAt: number;
  probes: number;
  /** ok 为 null 表示还没测过 */
  pick: { base: string; ok: boolean | null } | null;
  config: HostConfig;
}
/** 取图地址设置；host 为空表示自动检测，port 为 0 表示按协议取默认 */
export interface HostConfig { imgPort: number; host: string; port: number; proto: 'http' | 'https' }
export interface ApiState {
  app: 'html2gzh';
  article: { file: string; rev: number; mtime: number };
  host: HostState;
  /** 图片 id → 最近几次外部取图的时刻 */
  fetches: Record<string, number[]>;
  imgPort: number;
}

// ---------- 大图处理 /api/shrink ----------
export type ShrinkSkip = 'fits' | 'vector' | 'animated' | 'unreadable' | 'noGain';
export interface ShrinkOutput {
  buf: Buffer;
  ext: string;
  how: string;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  /** 仍超过上限 */
  over: boolean;
  skip?: never;
}
export type ShrinkResult = ShrinkOutput | { skip: ShrinkSkip };
export type ShrinkResponse =
  | { skip: ShrinkSkip; size: number }
  | { id: string; size: number; srcSize: number; how: string; width: number; height: number; srcWidth: number; srcHeight: number; over: boolean }
  | { error: string };

// ---------- convert() ----------
export interface BoxRect { x: number; y: number; w: number; h: number }
export interface OutlineVerdict {
  keep: boolean;
  /** scale：随屏宽缩放；fixed：固定像素 */
  mode?: 'scale' | 'fixed';
  why?: string;
  detail?: string[];
  side?: 'B';
  dev?: number[];
}
export interface ConvertResult {
  /** 去掉工具属性、供复制的成品 */
  payload: string;
  preview: string;
  /** 原稿在转换帧里的完整文档 */
  original: string;
  findings: Finding[];
  fonts: FontRow[];
  stats: {
    chars: number;
    elements: number;
    moved: number;
    visualBad: string[];
    verified: number;
    others: [width: number, ids: string[]][];
    outline: { units: number; kept: number; chars: number; bytes: number } | null;
  };
  debug: {
    tv: [string, BoxRect][];
    v: [string, BoxRect][];
    approx: string[];
    verdicts: (OutlineVerdict & { id: string; run: boolean; text: string })[] | null;
  };
}
