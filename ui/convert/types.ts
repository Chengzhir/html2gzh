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
/** catch 到的任意值的说明文字 */
export const messageOf = (error: unknown) => (Error.isError(error) && error.message) || String(error);
/** Node 系统错误的代码（EADDRINUSE 等），没有时为空串 */
export const errorCode = (error: unknown) =>
  Error.isError(error) && 'code' in error && typeof error.code === 'string' ? error.code : '';

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
/** 快照里的节点：字符串是文字节点；元素只带标签、与父元素不同的样式、lang 与子节点（约定见 glyphapi.ts） */
export type SnapNode = string | SnapElement;
export interface SnapElement {
  tag: string;
  style: Record<string, string>;
  lang?: string;
  kids: SnapNode[];
}
/** 一个字（字素簇）在页面上量到的框：[起点, 终点]（快照全部文字连起来的下标）与相对内容盒左上角的 x、y、宽、高 */
export type SnapChar = [from: number, to: number, x: number, y: number, w: number, h: number];
/** 一个要转为路径的单元：内容盒的宽高、块的计算样式、lang 与子节点，以及逐字的框（服务端照着核对排版） */
export interface GlyphUnit {
  w: number;
  h: number;
  style: Record<string, string>;
  lang: string;
  kids: SnapNode[];
  chars: SnapChar[];
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
  /** 页面的设备像素比：服务端按它排版，取整方式与页面相同 */
  dpr: number;
  fonts: GlyphFont[];
  units: GlyphUnit[];
}
/** 字形轮廓：字体单位，y 向上；首个 moveto 单独给出，其余为相对坐标 */
export interface GlyphPath {
  m: [number, number];
  d: string;
}
/** 一个字形：路径号、字体单位 → 内容盒 px 的矩阵、填充色、不透明度；w 是模拟加粗的描边宽（字体单位，0 为不描边） */
export type PlacedGlyph = [
  path: number,
  m: [number, number, number, number, number, number],
  fill: string,
  alpha: number,
  w: number,
];
/** 不是字形的填充（个别字体的粗体由 Skia 画成填充路径）：内容盒 px 的绝对坐标 */
export interface GlyphFill {
  d: string;
  fill: string;
  alpha: number;
  evenOdd: boolean;
}
/**
 * 单元的结果。fail：mismatch 服务端排出的逐字位置与页面不同，color 用到彩色字形（表情符号等），
 * effect 用到描边、图片之类画不成单色轮廓的东西，render 打印或读取出错
 */
export type GlyphUnitResult =
  | { fail?: undefined; detail?: undefined; glyphs: PlacedGlyph[]; fills: GlyphFill[] }
  | { fail: 'mismatch' | 'color' | 'effect' | 'render'; detail?: string; glyphs?: undefined; fills?: undefined };
export interface GlyphResponse {
  paths: GlyphPath[];
  units: GlyphUnitResult[];
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
/** 一个单元保不保留轮廓：保留时 scale 随屏宽缩放、fixed 固定像素；不保留时 why 是原因代码，side 为 B 表示另一个宽度没做成 */
export type OutlineVerdict =
  { keep: true; mode: 'scale' | 'fixed' } | { keep: false; why: string; detail?: string[]; side?: 'B'; dev?: number[] };
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
