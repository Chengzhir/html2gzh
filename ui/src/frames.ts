/** 页面上的几个 iframe：两栏预览，以及转换、比对、深色转换用的隐藏帧。Stage 挂载时填入 */
export const frames = {
  paneA: null as HTMLIFrameElement | null,
  paneB: null as HTMLIFrameElement | null,
  scratch: null as HTMLIFrameElement | null,
  verify: null as HTMLIFrameElement | null,
  dark: null as HTMLIFrameElement | null,
};
type FrameName = keyof typeof frames;
/** 转换、复制这类只在 Stage 挂载之后才会发生的操作用它取 iframe */
export function frame(name: FrameName): HTMLIFrameElement {
  const el = frames[name];
  if (!el) throw new Error(`frame ${name} is not mounted`);
  return el;
}
export function frameDoc(name: FrameName): Document {
  const doc = frame(name).contentDocument;
  if (!doc) throw new Error(`frame ${name} has no document`);
  return doc;
}
