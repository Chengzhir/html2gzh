// 跨模块（转换器 ↔ 页面、页面 ↔ 本机服务）传递的数据形状，以及带文案键的错误

// ---------- 文案 ----------
// 转换器与本机服务不写给用户看的句子，只给文案键（ui/src/locales 里的键）与参数，由页面排成句子
export type Param = string | number | Msg | Param[] | { list: Param[]; sep: string };
export interface Msg {
  key: string;
  params?: Record<string, Param>;
}
export const msg = (key: string, params?: Record<string, Param>): Msg => ({ key, params });
/** 带文案键的错误：页面按 key 显示；message 只给日志看 */
export class CodedError extends Error {
  key: string;
  params: Record<string, Param>;
  constructor(key: string, params: Record<string, Param> = {}) {
    super(`${key} ${JSON.stringify(params)}`);
    this.key = key;
    this.params = params;
  }
}

// ---------- 检查结果 ----------
export type FindingLevel = 'error' | 'warn' | 'fixed' | 'info';
/** 要在预览里标出的元素：元素本身或它的 data-wxc */
export type FindingEls = (Element | string)[];
/** 详细说明里接在 finding.<code>.detail 之后的部分：一句话，或者一个列表 */
export type FindingPart = Msg | { items: Msg[] };
/**
 * 一条检查结果。标题、结论、详细说明分别是文案 finding.<code>.title / .text / .detail（说明可以没有），
 * 都用 params 填空；parts 是说明后面按情况追加的句子与列表
 */
export interface Finding {
  level: FindingLevel;
  code: string;
  params: Record<string, Param>;
  parts: FindingPart[];
  /** 要在预览里标出的元素的 data-wxc */
  ids: string[];
}
export type AddFinding = (
  code: string,
  params?: Record<string, Param>,
  more?: { parts?: (FindingPart | false | null | undefined)[]; els?: FindingEls },
) => void;
export interface FindingSink {
  list: Finding[];
  fixed: AddFinding;
  warn: AddFinding;
  info: AddFinding;
  error: AddFinding;
}

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
  { local: string; id?: never; format?: never } | { local?: never; id: string; format: string };
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
export interface HostConfig {
  imgPort: number;
  host: string;
  port: number;
  proto: 'http' | 'https';
}
export interface ApiState {
  app: 'html2gzh';
  article: { file: string; rev: number; mtime: number };
  host: HostState;
  /** 图片 id → 最近几次外部取图的时刻 */
  fetches: Record<string, number[]>;
  imgPort: number;
}
/** /api/article：当前文章的路径、HTML 与最后修改时间（毫秒） */
export interface ArticleResponse {
  file: string;
  rev: number;
  mtime: number;
  html: string;
}

// ---------- 大图处理 /api/shrink ----------
export type ShrinkSkip = 'fits' | 'vector' | 'animated' | 'unreadable' | 'noGain';
/** 存成什么格式：JPEG 带质量；PNG 为无损或 256 色 */
export interface ShrinkHow {
  fmt: 'jpeg' | 'png' | 'palette';
  q?: number;
}
export interface ShrinkOutput {
  buf: Buffer;
  ext: string;
  how: ShrinkHow;
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
  | {
      id: string;
      size: number;
      srcSize: number;
      how: ShrinkHow;
      width: number;
      height: number;
      srcWidth: number;
      srcHeight: number;
      over: boolean;
    };
/** 接口出错时的响应：code 是 ui/src/locales 里 api.<code> 的文案；error 是给日志看的原文 */
export interface ApiErrorBody {
  code: string;
  params?: Record<string, Param>;
  error: string;
}

// ---------- convert() ----------
export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
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
