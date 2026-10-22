<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { state, notice } from '../store.ts';

const props = defineProps<{ scope: 'all' | 'reader' }>();
const { t } = useI18n();
const current = computed(() => state.notices[props.scope]);
</script>

<template>
  <div :id="scope === 'all' ? 'toastAll' : 'toastReader'" :class="['toast', 'toast-' + scope, current.shown && ['on', current.kind]]" role="status" aria-live="polite">
    <span class="toast-text">{{ current.shown ? current.text : '' }}</span>
    <button v-if="current.shown && current.kind === 'err'" type="button" class="toast-x" :aria-label="t('common.closeNotice')" @click="notice(scope, '')">×</button>
  </div>
</template>
