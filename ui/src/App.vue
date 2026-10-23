<script setup lang="ts">
import { NConfigProvider, NGlobalStyle, zhCN, dateZhCN, type GlobalThemeOverrides } from 'naive-ui';
import Shell from './components/Shell.vue';

// 微软雅黑没有 500 字重，Naive UI 默认的 500 在 Windows 上显示为常规体。
// 默认的三级灰字 rgb(118,124,130) 在检查结果的浅色底上对比度不到 4.5:1，加深到 4.79:1 以上
const overrides: GlobalThemeOverrides = { common: { fontWeightStrong: '600', textColor3: 'rgb(102, 108, 114)' } };
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="overrides" abstract>
    <NGlobalStyle />
    <Shell />
  </NConfigProvider>
</template>
