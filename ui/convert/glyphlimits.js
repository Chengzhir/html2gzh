// 字形接口（/api/glyphs）每次请求的上限：服务端（lib/glyphs.mjs）按 GLYPH_LIMITS 拒收，页面（outline.js）按略紧的 GLYPH_BATCH 分批
export const GLYPH_LIMITS = { items: 300, chars: 6000, str: 400, char: 16, runs: 1500, run: 400, runChars: 20000, fonts: 600, range: 20000, srcs: 8 };
export const GLYPH_BATCH = { items: 250, chars: 4000, char: 16, runs: 1200, run: 200, runChars: 16000 };
