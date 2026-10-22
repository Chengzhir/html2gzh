<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
import { NCard, NButton, NInput, NInputGroup } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { state, useFiles, openPath, rerun, srcNote } from '../store.ts';
import { droppedFiles, pickedFiles } from '../files.ts';

const { t } = useI18n();
const dirInput = useTemplateRef('dir-input');
const pathText = ref('');
const dragging = ref(false);
const pickDir = () => dirInput.value?.click();
function onPicked(e: Event) {
  const input = e.target as HTMLInputElement, picked = pickedFiles(input.files);
  if (picked) useFiles(picked.files, picked.name);
  input.value = '';
}
function submitPath() {
  const input = pathText.value.trim();
  if (input) openPath(input);
}
// 拖到整页任何位置都接收；拖动中高亮放置区
const onDragOver = (e: DragEvent) => { e.preventDefault(); dragging.value = true; };
const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) dragging.value = false; };
async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  const dropped = await droppedFiles(e.dataTransfer);
  if (!dropped) return;
  if (dropped.single) srcNote(t('src.singleHtml'), 'err');
  else useFiles(dropped.files, dropped.name);
}
const DRAG_EVENTS = { dragover: onDragOver, dragleave: onDragLeave, drop: onDrop } as const;
onMounted(() => { for (const [type, handler] of Object.entries(DRAG_EVENTS)) document.body.addEventListener(type, handler as EventListener); });
onBeforeUnmount(() => { for (const [type, handler] of Object.entries(DRAG_EVENTS)) document.body.removeEventListener(type, handler as EventListener); });
</script>

<template>
  <NCard size="small" tag="section" aria-labelledby="srcTitle">
    <template #header><span id="srcTitle">{{ t('src.title') }}</span></template>
    <div id="drop" :class="['drop', { on: dragging }]" tabindex="0" role="button" aria-describedby="dropHint"
      @click="pickDir" @keydown.enter.prevent="pickDir" @keydown.space.prevent="pickDir">
      <strong>{{ t('src.dropTitle') }}</strong>
      <span id="dropHint">{{ t('src.dropHint') }}</span>
    </div>
    <div class="row">
      <NButton id="pickDir" @click="pickDir">{{ t('src.pickDir') }}</NButton>
      <input ref="dir-input" id="dirInput" type="file" webkitdirectory multiple hidden @change="onPicked">
    </div>
    <form id="pathForm" class="row" @submit.prevent="submitPath">
      <label for="pathInput" class="sr-only">{{ t('src.pathLabel') }}</label>
      <NInputGroup>
        <NInput v-model:value="pathText" :placeholder="t('src.pathPlaceholder')" :input-props="{ id: 'pathInput', autocomplete: 'off' }" />
        <NButton attr-type="submit">{{ t('src.open') }}</NButton>
      </NInputGroup>
    </form>
    <p id="srcNote" :class="['note', state.srcNote.kind]" role="status" aria-live="polite">{{ state.srcNote.text }}</p>
    <div v-if="state.current" id="current" class="current">
      <div class="file" id="curName">{{ state.current.name }}</div>
      <div class="muted" id="curWhere">{{ state.current.where }}</div>
      <NButton id="reload" text type="primary" @click="rerun">{{ t('src.reload') }}</NButton>
    </div>
  </NCard>
</template>
