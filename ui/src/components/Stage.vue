<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue';
import { NCheckbox } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { readerImages } from '../../convert/reader.ts';
import { state, setDark } from '../store.ts';
import { frames } from '../frames.ts';
import { WIN } from '../status.ts';
import Toast from './Toast.vue';
import HelpTip from './HelpTip.vue';

const { t } = useI18n();
const paneA = useTemplateRef('pane-a'), paneB = useTemplateRef('pane-b');
const scratch = useTemplateRef('scratch-frame'), verify = useTemplateRef('verify-frame'), darkFrame = useTemplateRef('dark-frame');
onMounted(() => Object.assign(frames, { paneA: paneA.value, paneB: paneB.value, scratch: scratch.value, verify: verify.value, dark: darkFrame.value }));
const dimAll = computed(() => state.notices.all.shown && state.notices.all.kind === 'busy');
const dimReader = computed(() => state.notices.reader.shown && state.notices.reader.kind === 'busy');
const emptyMsg = computed(() => state.notices.all.shown ? state.notices.all : null);

// 两栏同步滚动。阅读页的正文在标题和作者行下面（高 header）：开头一屏（高 screen）内阅读页滚得快些，
// 追平 header，之后两边差一个固定的 header
function readerHeader() {
  const doc = paneB.value.contentDocument, content = doc?.getElementById('js_content');
  return content ? content.getBoundingClientRect().top + doc.defaultView.scrollY : 0;
}
const toReader = (y: number, header: number, screen: number) => y >= screen ? y + header : y * (1 + header / screen);
const toOriginal = (y: number, header: number, screen: number) => y >= screen + header ? y - header : y / (1 + header / screen);
let syncing = false;
function onLoad(which: 'A' | 'B') {
  const frame = which === 'A' ? paneA.value : paneB.value, other = which === 'A' ? paneB.value : paneA.value;
  // 深色的在隐藏 iframe 里已经照阅读页脚本改过图片尺寸
  if (which === 'B' && !frame.dataset.dark) readerImages(frame.contentDocument);
  frame.contentWindow.addEventListener('scroll', () => {
    if (syncing || !other.contentWindow) return;
    syncing = true;
    const header = readerHeader(), screen = Math.max(1, paneA.value.clientHeight), y = frame.contentWindow.scrollY;
    other.contentWindow.scrollTo(0, which === 'A' ? toReader(y, header, screen) : toOriginal(y, header, screen));
    requestAnimationFrame(() => { syncing = false; });
  });
}
</script>

<template>
  <main class="stage">
    <div id="panes" :class="['panes', { dim: dimAll }]" :hidden="!state.panesShown">
      <Toast scope="all" />
      <figure class="pane">
        <figcaption>{{ t('stage.original') }}</figcaption>
        <div class="sheet">
          <iframe id="paneA" ref="pane-a" :title="t('stage.originalFrame')" sandbox="allow-same-origin" :srcdoc="state.originalDoc"
            :style="{ width: state.result ? state.result.width + 'px' : undefined }" @load="onLoad('A')" />
        </div>
      </figure>
      <figure class="pane">
        <figcaption>
          <span>{{ t('stage.reader') }}</span>
          <HelpTip :text="t('stage.readerTip')" />
          <NCheckbox id="dark" class="dark-toggle" :checked="state.dark" @update:checked="setDark">{{ t('stage.dark') }}</NCheckbox>
        </figcaption>
        <div id="device" :class="['device', { dark: state.reader.dark }]">
          <div id="screen" :class="['screen', { dim: dimReader }]">
            <Toast scope="reader" />
            <div class="sbar" aria-hidden="true"><span>9:41</span><svg viewBox="0 0 26 12"><rect x=".5" y=".5" width="21" height="11" rx="3" fill="none" stroke="currentColor" /><rect x="2" y="2" width="14" height="8" rx="1.5" fill="currentColor" /><rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" /></svg></div>
            <div class="nbar" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 4l-8 8 8 8" fill="none" stroke="currentColor" stroke-width="1.8" /></svg><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg></div>
            <iframe id="paneB" ref="pane-b" :title="t('stage.readerFrame')" sandbox="allow-same-origin" :srcdoc="state.reader.html"
              :data-dark="state.reader.darkDoc ? '1' : ''" :style="{ width: state.reader.width ? state.reader.width + 'px' : undefined }" @load="onLoad('B')" />
          </div>
        </div>
      </figure>
    </div>
    <div v-if="!state.panesShown" id="empty" class="empty">
      <div id="emptyIdle" :hidden="!!emptyMsg">
        <p>{{ t('stage.emptyTitle') }}</p>
        <p class="muted">{{ t(WIN ? 'stage.emptyHintWin' : 'stage.emptyHint') }}</p>
      </div>
      <p id="emptyMsg" :class="{ err: emptyMsg && emptyMsg.kind === 'err' }" role="status" aria-live="polite" :hidden="!emptyMsg">{{ emptyMsg ? emptyMsg.text : '' }}</p>
    </div>
    <iframe id="scratch" ref="scratch-frame" class="scratch" :title="t('stage.scratchFrame')" aria-hidden="true" tabindex="-1" sandbox="allow-same-origin" />
    <iframe id="verify" ref="verify-frame" class="scratch" :title="t('stage.verifyFrame')" aria-hidden="true" tabindex="-1" sandbox="allow-same-origin" />
    <iframe id="darkFrame" ref="dark-frame" class="scratch" :title="t('stage.darkFrame')" aria-hidden="true" tabindex="-1" sandbox="allow-scripts" />
  </main>
</template>
