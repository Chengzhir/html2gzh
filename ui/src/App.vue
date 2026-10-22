<script setup lang="ts">
import { NConfigProvider, NGlobalStyle, zhCN, dateZhCN } from 'naive-ui';
import Shell from './components/Shell.vue';
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" abstract>
    <NGlobalStyle />
    <Shell />
  </NConfigProvider>
</template>
