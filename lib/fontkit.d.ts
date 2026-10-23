// fontkit 没有自带类型：只声明 lib/glyphs.ts 用到的部分（读 PDF 里嵌的字体程序的字体单位、字重与斜体标记）
declare module 'fontkit' {
  export interface Font {
    unitsPerEm: number;
    'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean; oblique?: boolean } };
    head?: { macStyle?: { italic?: boolean } };
  }
  export interface FontCollection {
    fonts: Font[];
  }
  export function create(buffer: Buffer, postscriptName?: string): Font | FontCollection;
}
