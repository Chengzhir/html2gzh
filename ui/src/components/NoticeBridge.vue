<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, watch } from 'vue';
import { useMessage, type MessageReactive } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { state, notice, previewNotice } from '../store.ts';

// 把预览区的提示同步成 Naive UI 的消息：进行中是不会自动消失的 loading，出错是可以关闭的 error
const message = useMessage();
const { t } = useI18n();
// 还没有预览时，提示写在空白区里（Stage.vue 的 #empty）
const visible = computed(() => previewNotice.value.shown && state.panesShown);
let handle: MessageReactive | null = null;
watch(
  () => [visible.value, previewNotice.value.text, previewNotice.value.kind, previewNotice.value.source] as const,
  ([shown, text, kind, source]) => {
    if (!shown) {
      handle?.destroy();
      handle = null;
      return;
    }
    const type = kind === 'err' ? 'error' : 'loading';
    const onClose = () => {
      handle = null;
      notice(source, '');
    };
    if (handle) Object.assign(handle, { content: text, type, closable: kind === 'err', onClose });
    else handle = message.create(text, { type, duration: 0, closable: kind === 'err', onClose });
    // Naive UI 关闭按钮的 aria-label 固定是英文的 "close"，换成界面语言
    if (kind === 'err')
      void nextTick(() =>
        document.querySelector('.notice .n-base-close')?.setAttribute('aria-label', t('common.closeNotice')),
      );
  },
  { immediate: true },
);
onBeforeUnmount(() => handle?.destroy());
</script>

<!-- 读屏软件不会朗读 Naive UI 的消息，因此另外放一个视觉上隐藏的 role="status" 元素，内容与消息相同 -->
<template>
  <span id="notice" class="sr-only" role="status" aria-live="polite">{{ visible ? previewNotice.text : '' }}</span>
</template>
