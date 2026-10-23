import { createApp } from 'vue';
import App from './App.vue';
import { i18n, t } from './i18n.ts';
import { pollNow } from './store.ts';
import './app.css';

document.title = t('app.title');
createApp(App).use(i18n).mount('#app');
// 挂载之后才有转换用的隐藏 iframe；第一次轮询拿到文章就开始转换
void pollNow();
