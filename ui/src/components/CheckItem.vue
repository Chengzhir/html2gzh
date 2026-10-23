<script setup lang="ts">
// 检查结果的一条：样子照 Naive UI 的提示框，但不用它（它固定带 role="alert"，二十来条一起出现会被读屏软件逐条打断朗读）
import { NButton } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { CheckItem } from '../checks.ts';
import { highlight } from '../store.ts';

defineProps<{ item: CheckItem }>();
const { t } = useI18n();
const ICON = {
  error:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 12.1-1.4 1.4L12 13.4l-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1z',
  warn: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  fixed: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
};
const CHEVRON = 'M16.6 8.6 12 13.2 7.4 8.6 6 10l6 6 6-6z';
</script>

<template>
  <li :class="['check', item.level]">
    <details v-if="item.blocks.length" class="check-more">
      <summary class="check-head">
        <svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="ICON[item.level]" fill="currentColor" />
        </svg>
        <span class="check-text">{{ item.text }}</span>
        <svg class="check-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="CHEVRON" fill="currentColor" />
        </svg>
      </summary>
      <div class="check-detail">
        <template v-for="(b, i) in item.blocks" :key="i">
          <p v-if="'p' in b" class="detail">{{ b.p }}</p>
          <ul v-else class="detail-list">
            <li v-for="(x, j) in b.ul" :key="j">{{ x }}</li>
          </ul>
        </template>
        <NButton v-if="item.ids.length" size="tiny" secondary @click="highlight(item.ids)">{{
          t('checks.mark')
        }}</NButton>
      </div>
    </details>
    <div v-else class="check-head">
      <svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path :d="ICON[item.level]" fill="currentColor" />
      </svg>
      <span class="check-text"
        >{{ item.text
        }}<NButton v-if="item.ids.length" class="mark" size="tiny" secondary @click="highlight(item.ids)">{{
          t('checks.mark')
        }}</NButton></span
      >
    </div>
  </li>
</template>
