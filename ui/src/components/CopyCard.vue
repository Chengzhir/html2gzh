<script setup lang="ts">
import { NCard, NButton, NCheckbox, NInputNumber } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { state, copy, saveShrink, setWidth, WIDTHS } from '../store.ts';
import { copyState, fetchLine } from '../status.ts';
import { SIDE } from '../phone.ts';
import HelpTip from './HelpTip.vue';

const { t } = useI18n();
const widthOptions = WIDTHS.map(([os, screen]) => ({ value: screen - 2 * SIDE, label: t('width.option', { device: t('width.' + os, { w: screen }), w: screen - 2 * SIDE }) }));
// 上限只在回车或离开输入框时生效：改一个数字重新压缩一遍图片，不要每按一个键都压一遍
const setKb = (v: number | null) => { if (Number.isInteger(v) && v >= 1 && v <= 20000) saveShrink({ kb: v }); };
</script>

<template>
  <NCard size="small" tag="section" class="copy" aria-labelledby="copyTitle">
    <h2 id="copyTitle" class="sr-only">{{ t('copy.title') }}</h2>
    <NButton id="copy" type="primary" size="large" block :disabled="copyState.disabled" @click="copy">{{ t('copy.button') }}</NButton>
    <p id="copyNote" class="muted" aria-live="polite">{{ copyState.note }}</p>
    <p id="fetchLine" :class="['status', fetchLine && fetchLine.cls]" aria-live="polite" :hidden="!fetchLine">{{ fetchLine ? fetchLine.text : '' }}</p>
    <div class="row wrap">
      <NCheckbox id="shrinkOn" :checked="state.shrink.on" @update:checked="(on: boolean) => saveShrink({ on })">{{ t('shrink.on') }}</NCheckbox>
      <span class="nowrap">
        <label for="shrinkKb">{{ t('shrink.kb') }}</label>
        <NInputNumber class="num-input" :value="state.shrink.kb" :min="1" :max="20000" :step="50" :update-value-on-input="false"
          :input-props="{ id: 'shrinkKb', inputmode: 'numeric' }" @update:value="setKb" />
        <span>{{ t('shrink.unit') }}</span>
      </span>
      <HelpTip :text="t('shrink.tip')" />
    </div>
    <div class="row">
      <label for="width">{{ t('width.label') }}</label>
      <select id="width" class="select grow" :value="state.width" @change="(e: Event) => setWidth(+(e.target as HTMLSelectElement).value)">
        <option v-for="option in widthOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <HelpTip :text="t('width.tip')" />
    </div>
  </NCard>
</template>
