import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueI18n from '@intlify/unplugin-vue-i18n/vite';

const ui = fileURLToPath(new URL('./ui/', import.meta.url));

export default defineConfig({
  root: ui,
  base: './',
  plugins: [
    vue(),
    // 文案在构建时预编译：格式写错（如未转义的 @）构建就失败。文案里有 <use>、<animate> 这样的标签名，按纯文本处理
    VueI18n({ include: [ui + 'src/locales/**'], strictMessage: false, escapeHtml: false }),
  ],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023', chunkSizeWarningLimit: 2000 },
});
