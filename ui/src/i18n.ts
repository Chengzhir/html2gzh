import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN.json';

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  // 缺文案按错误报出来（端到端测试把页面上的 console.error 算作失败），界面上照常显示键名
  missingWarn: false,
  fallbackWarn: false,
  missing: (locale, key) => { console.error(`缺少文案 ${locale}:${key}`); },
});

const { global: composer } = i18n;
export const t = (key: string, named: Record<string, unknown> = {}): string => composer.t(key, named);
export const te = (key: string): boolean => composer.te(key);
