<script setup lang="ts">
// 悬浮说明：鼠标悬停或键盘聚焦时显示，Esc 关闭，鼠标可以移进说明框（WCAG 1.4.13）。
// 读屏软件从触发元素的 aria-description 读到同样的文字（触发元素由使用方加上）
import { useTemplateRef, onBeforeUnmount } from 'vue';
import { NTooltip } from 'naive-ui';

const props = withDefaults(defineProps<{ text: string; placement?: 'top' | 'bottom' | 'right' | 'left' | 'top-start' | 'right-start' }>(), { placement: 'top' });
const tooltip = useTemplateRef('tooltip-ref');
const closeOnEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(false); };
function onShowChange(shown: boolean) {
  if (shown) document.addEventListener('keydown', closeOnEsc, true); else document.removeEventListener('keydown', closeOnEsc, true);
}
function setShown(shown: boolean) {
  if (!tooltip.value) return;
  tooltip.value.setShow(shown);
  onShowChange(shown);
}
onBeforeUnmount(() => document.removeEventListener('keydown', closeOnEsc, true));
</script>

<template>
  <NTooltip ref="tooltip-ref" trigger="hover" :placement="placement" :disabled="!props.text" :delay="80" :duration="150" keep-alive-on-hover
    :style="{ maxWidth: '300px' }" @update:show="onShowChange">
    <template #trigger>
      <span class="tip-anchor" @focusin="setShown(true)" @focusout="setShown(false)"><slot /></span>
    </template>
    <div class="tip-body" role="tooltip">{{ props.text }}</div>
  </NTooltip>
</template>
