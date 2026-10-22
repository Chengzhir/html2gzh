<script setup lang="ts">
import { computed } from 'vue';
import { NCard } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { checkItems, counts } from '../checks.ts';
import CheckItem from './CheckItem.vue';

const { t } = useI18n();
const LEVELS = ['error', 'warn', 'fixed', 'info'] as const;
const groups = computed(() => LEVELS.map(level => ({ level, items: checkItems.value.filter(i => i.level === level) })).filter(g => g.items.length));
const verdict = computed(() => counts.value.error ? t('checks.verdictErr', { n: counts.value.error })
  : counts.value.warn ? t('checks.verdictWarn', { n: counts.value.warn }) : t('checks.verdictOk'));
</script>

<template>
  <NCard size="small" tag="section" aria-labelledby="checkTitle">
    <template #header><span id="checkTitle">{{ t('checks.title') }}</span></template>
    <div id="checks" class="checks">
      <p v-if="!checkItems.length" class="muted">{{ t('checks.empty') }}</p>
      <template v-else>
        <p class="verdict">{{ verdict }}</p>
        <template v-for="g in groups" :key="g.level">
          <!-- 已自动处理的不用动手，默认收起 -->
          <details v-if="g.level === 'fixed'" class="fold fixed-group">
            <summary>{{ t('checks.fixedCount', { n: g.items.length }) }}</summary>
            <ul class="check-list"><CheckItem v-for="it in g.items" :key="it.key" :item="it" /></ul>
          </details>
          <template v-else>
            <h3>{{ t('checks.' + g.level) }}</h3>
            <ul class="check-list"><CheckItem v-for="it in g.items" :key="it.key" :item="it" /></ul>
          </template>
        </template>
      </template>
    </div>
  </NCard>
</template>
