<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue';
import { NCheckbox } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { readerImages } from '../../convert/reader.ts';
import { BAR_H } from '../phone.ts';
import { state, setDark } from '../store.ts';
import { frames } from '../frames.ts';
import { WIN } from '../status.ts';
import Toast from './Toast.vue';
import HelpTip from './HelpTip.vue';
import { viewOf } from '../../convert/util.ts';

const { t } = useI18n();
const paneA = useTemplateRef('pane-a'),
  paneB = useTemplateRef('pane-b');
const scratch = useTemplateRef('scratch-frame'),
  verify = useTemplateRef('verify-frame'),
  darkFrame = useTemplateRef('dark-frame');
onMounted(() =>
  Object.assign(frames, {
    paneA: paneA.value,
    paneB: paneB.value,
    scratch: scratch.value,
    verify: verify.value,
    dark: darkFrame.value,
  }),
);
// 原网页是正文宽，阅读页是屏宽；大屏幕上的放大比例也按这两个宽度算
const paneWidths = computed(() => ({
  '--a-w': state.result ? state.result.width + 'px' : undefined,
  '--b-w': state.reader.width ? state.reader.width + 'px' : undefined,
}));
const dimAll = computed(() => state.notices.all.shown && state.notices.all.kind === 'busy');
const dimReader = computed(() => state.notices.reader.shown && state.notices.reader.kind === 'busy');
const emptyMsg = computed(() => (state.notices.all.shown ? state.notices.all : null));

// 原网页顶上留出与阅读页标题区等高的空白，两栏同步滚动就是一比一。用定位的 html 的上外边距（边框宽度会被取整）：
// 相对页面定位的元素一起下移，vh 不变；NEUTRAL 用 !important 清掉了 html 的外边距，这里也要 !important
let originalTop = 0;
let spacer: HTMLStyleElement | null = null;
const contentTop = (doc: Document) => {
  const body = doc.body.getBoundingClientRect(),
    style = viewOf(doc).getComputedStyle(doc.body);
  return body.top + viewOf(doc).scrollY + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
};
async function alignPanes() {
  const original = paneA.value?.contentDocument,
    reader = paneB.value?.contentDocument;
  const content = reader?.getElementById('js_content');
  if (!original?.body || !reader || !content) return;
  await reader.fonts.ready;
  const header = content.getBoundingClientRect().top + viewOf(reader).scrollY;
  if (!spacer || spacer.ownerDocument !== original) {
    originalTop = contentTop(original);
    spacer = original.createElement('style');
    original.head.appendChild(spacer);
  }
  spacer.textContent = `html{position:relative!important;margin-top:${Math.max(0, header - originalTop)}px!important}`;
}
let syncing = false;
function onLoad(which: 'A' | 'B') {
  const frame = which === 'A' ? paneA.value : paneB.value,
    other = which === 'A' ? paneB.value : paneA.value;
  const win = frame?.contentWindow,
    doc = frame?.contentDocument;
  if (!frame || !win || !doc) return;
  // 深色的在隐藏 iframe 里已经照阅读页脚本改过图片尺寸
  if (which === 'B' && !frame.dataset.dark) readerImages(doc);
  alignPanes();
  win.addEventListener(
    'scroll',
    () => {
      const otherWin = other?.contentWindow;
      if (syncing || !otherWin) return;
      syncing = true;
      otherWin.scrollTo(0, win.scrollY);
      requestAnimationFrame(() => {
        syncing = false;
      });
    },
    { passive: true },
  );
}
</script>

<template>
  <main class="stage" :style="{ '--wxbar-h': BAR_H + 'px' }">
    <div id="panes" :class="['panes', { dim: dimAll }]" :style="paneWidths" :hidden="!state.panesShown">
      <Toast scope="all" />
      <figure class="pane">
        <figcaption>{{ t('stage.original') }}</figcaption>
        <div class="sheet">
          <iframe
            id="paneA"
            ref="pane-a"
            :title="t('stage.originalFrame')"
            sandbox="allow-same-origin"
            :srcdoc="state.originalDoc"
            @load="onLoad('A')"
          />
        </div>
      </figure>
      <figure class="pane">
        <figcaption>
          <span>{{ t('stage.reader') }}</span>
          <HelpTip :text="t('stage.readerTip')" />
          <NCheckbox id="dark" class="dark-toggle" :checked="state.dark" @update:checked="setDark">{{
            t('stage.dark')
          }}</NCheckbox>
        </figcaption>
        <div id="device" :class="['device', { dark: state.reader.dark }]">
          <div id="screen" :class="['screen', { dim: dimReader }]">
            <Toast scope="reader" />
            <div class="sbar" aria-hidden="true">
              <span>9:41</span
              ><svg viewBox="0 0 26 12">
                <rect x=".5" y=".5" width="21" height="11" rx="3" fill="none" stroke="currentColor" />
                <rect x="2" y="2" width="14" height="8" rx="1.5" fill="currentColor" />
                <rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" />
              </svg>
            </div>
            <div class="nbar" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M15 4l-8 8 8 8" fill="none" stroke="currentColor" stroke-width="1.8" /></svg
              ><svg viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                <circle cx="19" cy="12" r="1.8" fill="currentColor" />
              </svg>
            </div>
            <iframe
              id="paneB"
              ref="pane-b"
              :title="t('stage.readerFrame')"
              sandbox="allow-same-origin"
              :srcdoc="state.reader.html"
              :data-dark="state.reader.darkDoc ? '1' : ''"
              @load="onLoad('B')"
            />
          </div>
        </div>
      </figure>
    </div>
    <div v-if="!state.panesShown" id="empty" class="empty">
      <div id="emptyIdle" :hidden="!!emptyMsg">
        <p>{{ t('stage.emptyTitle') }}</p>
        <p class="muted">{{ t(WIN ? 'stage.emptyHintWin' : 'stage.emptyHint') }}</p>
      </div>
      <p
        id="emptyMsg"
        :class="{ err: emptyMsg && emptyMsg.kind === 'err' }"
        role="status"
        aria-live="polite"
        :hidden="!emptyMsg"
      >
        {{ emptyMsg ? emptyMsg.text : '' }}
      </p>
    </div>
    <iframe
      id="scratch"
      ref="scratch-frame"
      class="scratch"
      :title="t('stage.scratchFrame')"
      aria-hidden="true"
      tabindex="-1"
      sandbox="allow-same-origin"
    />
    <iframe
      id="verify"
      ref="verify-frame"
      class="scratch"
      :title="t('stage.verifyFrame')"
      aria-hidden="true"
      tabindex="-1"
      sandbox="allow-same-origin"
    />
    <iframe
      id="darkFrame"
      ref="dark-frame"
      class="scratch"
      :title="t('stage.darkFrame')"
      aria-hidden="true"
      tabindex="-1"
      sandbox="allow-scripts"
    />
  </main>
</template>
