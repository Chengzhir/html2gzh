<script setup lang="ts">
import { ref, computed } from 'vue';
import { NCard, NButton, NCheckbox, NInput, NInputNumber } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { DEFAULT_OPTS, parseRules } from '../../convert/fonts.ts';
import { state, saveOpts } from '../store.ts';
import FontTable from './FontTable.vue';
import HelpTip from './HelpTip.vue';
import Tip from './Tip.vue';

const { t } = useI18n();
// 规则文本框：停手 700ms 再转换；"恢复默认"立即转换
const rules = ref(state.opts.rules);
let timer = 0;
function editRules(text: string) {
  rules.value = text;
  clearTimeout(timer);
  timer = window.setTimeout(() => saveOpts({ rules: text }), 700);
}
function resetRules() {
  clearTimeout(timer);
  rules.value = DEFAULT_OPTS.rules;
  saveOpts({ rules: DEFAULT_OPTS.rules });
}
const rulesNote = computed(() => {
  const { rules: list, bad } = parseRules(state.opts.rules);
  return (
    t(state.opts.rules === DEFAULT_OPTS.rules ? 'font.rulesDefault' : 'font.rulesChanged', { n: list.length }) +
    (bad.length ? t('font.rulesBad', { lines: bad.join(t('common.sep')) }) : '')
  );
});
const fonts = computed(() => state.result?.fonts ?? []);
function pickBig() {
  const paths = new Set(state.opts.paths);
  for (const row of fonts.value) {
    if (row.size >= state.opts.svgMin - 0.01) paths.add(row.key);
    else paths.delete(row.key);
  }
  saveOpts({ paths: [...paths] });
}
const setMin = (size: number | null) => {
  if (size != null && size > 0 && size <= 400) saveOpts({ svgMin: size }, 'none');
};
</script>

<template>
  <NCard size="small" tag="section" aria-labelledby="fontTitle">
    <template #header
      ><span id="fontTitle">{{ t('font.title') }}</span></template
    >
    <dl class="legend">
      <dt>{{ t('font.on') }}</dt>
      <dd>{{ t('font.onText') }}</dd>
      <dt>{{ t('font.off') }}</dt>
      <dd>{{ t('font.offText') }}</dd>
    </dl>
    <p class="muted">{{ t('font.sizeNote') }}</p>
    <div class="row">
      <label for="svgMin">{{ t('font.minLabel') }}</label>
      <NInputNumber
        class="num-input"
        :value="state.opts.svgMin"
        :min="1"
        :max="400"
        :step="0.5"
        :input-props="{ id: 'svgMin', inputmode: 'decimal' }"
        @update:value="setMin"
      />
      <span>{{ t('font.minUnit') }}</span>
      <Tip :text="t('font.pickBigTip')">
        <NButton id="pickBig" :disabled="!fonts.length" :aria-description="t('font.pickBigTip')" @click="pickBig">{{
          t('font.pickBig')
        }}</NButton>
      </Tip>
    </div>
    <FontTable />
    <div class="row">
      <NCheckbox
        id="svgCopy"
        :checked="state.opts.svgCopy"
        @update:checked="(on: boolean) => saveOpts({ svgCopy: on })"
        >{{ t('font.svgCopy') }}</NCheckbox
      >
      <HelpTip :text="t('font.svgCopyTip')" />
    </div>
    <div class="row">
      <NCheckbox id="noWrap" :checked="state.opts.noWrap" @update:checked="(on: boolean) => saveOpts({ noWrap: on })">{{
        t('font.noWrap')
      }}</NCheckbox>
      <HelpTip :text="t('font.noWrapTip')" />
    </div>
    <details id="rulesBox" class="fold">
      <summary>{{ t('font.rules') }}</summary>
      <p class="muted">
        <i18n-t keypath="font.rulesFormat" scope="global"
          ><template #code
            ><code>{{ t('font.rulesSyntax') }}</code></template
          ></i18n-t
        >
      </p>
      <ul class="muted notes">
        <li>{{ t('font.rulesNote1') }}</li>
        <li>
          <i18n-t keypath="font.rulesNote2" scope="global"
            ><template #star><code>*</code></template
            ><template #hash><code>#</code></template></i18n-t
          >
        </li>
        <li>{{ t('font.rulesNote3') }}</li>
      </ul>
      <label for="rules" class="sr-only">{{ t('font.rules') }}</label>
      <NInput
        class="rules"
        type="textarea"
        :value="rules"
        :autosize="{ minRows: 6, maxRows: 14 }"
        :input-props="{ id: 'rules', spellcheck: false, autocomplete: 'off' }"
        @update:value="editRules"
      />
      <div class="row">
        <NButton id="rulesReset" size="small" @click="resetRules">{{ t('font.rulesReset') }}</NButton>
        <span id="rulesNote" class="muted" aria-live="polite">{{ rulesNote }}</span>
      </div>
    </details>
  </NCard>
</template>
