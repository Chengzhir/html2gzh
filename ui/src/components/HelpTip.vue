<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Tip from './Tip.vue';

defineProps<{ text: string; placement?: 'top' | 'right-start' }>();
const { t } = useI18n();
</script>

<template>
  <Tip :text="text" :placement="placement">
    <button type="button" class="help" :aria-label="t('common.help')" :aria-description="text">?</button>
  </Tip>
</template>
