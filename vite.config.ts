import { defineConfig } from 'vite';

// 页面源码在 ui/，构建到 ui/dist，由 server.ts 提供。只在本机打开，目标浏览器按较新的 Chrome / Edge
export default defineConfig({
  root: 'ui',
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023', chunkSizeWarningLimit: 2000 },
});
