/** 页面上的几个 iframe：两栏预览，以及转换、比对、深色转换用的隐藏帧。Stage 挂载时填入 */
export const frames = {
  paneA: null as HTMLIFrameElement | null,
  paneB: null as HTMLIFrameElement | null,
  scratch: null as HTMLIFrameElement | null,
  verify: null as HTMLIFrameElement | null,
  dark: null as HTMLIFrameElement | null,
};
