<script setup lang="ts">
// 字体表：每套字（字体 + 字重 + 斜体）一个框，框顶是这套字的标题栏（勾选整组、手机上的备用字体），
// 下面缩进列出各个字号（勾选、字号、原字体画的样例、字数）。转换结果只在和勾选不一致时写出来。
// 整张表默认折叠，标题里写行数、勾选的行数与没能全部转为路径的行数
import { computed } from 'vue';
import { NCheckbox } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { FontRow } from '../../convert/types.ts';
import { state, saveOpts } from '../store.ts';
import Tip from './Tip.vue';

interface RowNote {
  kind: 'none' | 'part' | 'along';
  text: string;
  tip: string;
}

const { t } = useI18n();
const fonts = computed(() => state.result?.fonts ?? []);
/** 按套字分组；组内字号从大到小，组按最大字号从大到小 */
const groups = computed(() =>
  [...Map.groupBy(fonts.value, row => row.face).values()]
    .map(rows => rows.toSorted((a, b) => b.size - a.size))
    .toSorted((a, b) => b[0].size - a[0].size),
);
const picked = computed(() => new Set(state.opts.paths));
/** 上一次转换时勾选的行：结果按那次转换写 */
const ranWith = computed(() => new Set(state.result?.paths));
/** 勾选改了还没转完：结果先变淡 */
const stale = computed(() => {
  const keys = new Set(fonts.value.map(row => row.key));
  const signature = (paths: Iterable<string>) => JSON.stringify([...paths].filter(key => keys.has(key)).toSorted());
  return state.busy || signature(ranWith.value) !== signature(picked.value);
});
function checkState(rows: FontRow[]) {
  const count = rows.filter(row => picked.value.has(row.key)).length;
  return { checked: rows.length > 0 && count === rows.length, indeterminate: count > 0 && count < rows.length };
}
function toggle(rows: FontRow[], on: boolean) {
  const paths = new Set(state.opts.paths);
  for (const row of rows) {
    if (on) paths.add(row.key);
    else paths.delete(row.key);
  }
  saveOpts({ paths: [...paths] }, 'soon');
}

const px = (n: number) => String(Math.round(n * 2) / 2);
const styleName = (row: FontRow) => t('font.weight', { w: row.weight }) + (row.italic ? ' · ' + t('font.italic') : '');
const faceName = (row: FontRow) => `${row.family} ${styleName(row)}`;
const sampleStyle = (row: FontRow) => ({
  fontFamily: row.stack,
  fontWeight: row.weight,
  fontStyle: row.italic ? 'italic' : 'normal',
  fontStretch: row.stretch,
});
function fallbackText(row: FontRow) {
  const names = row.phone.names;
  return names.length
    ? t('font.fallbackNames', {
        names: names.slice(0, 2).join(t('common.sep')) + (names.length > 2 ? t('common.etc') : ''),
      })
    : t('font.fallbackNone');
}
const fallbackTip = (row: FontRow) =>
  t(row.phone.names.length ? 'font.fallbackTip' : 'font.fallbackTipNoRule', { stack: row.phone.stack });

/** 和勾选不一致的转换结果：勾了没转成、只转了一部分，或者没勾但随所在段落一起转了。一致时为 null */
function noteOf(row: FontRow): RowNote | null {
  const wasPicked = ranWith.value.has(row.key),
    left = row.chars - row.done;
  const why = Object.entries(row.why)
    .filter(([, n]) => n > 0)
    .map(([code, n]) => t('font.note.whyLine', { n, why: t('why.' + code) }))
    .join('\n');
  if (wasPicked && !row.done) return { kind: 'none', text: t('font.note.none'), tip: t('font.note.noneTip', { why }) };
  if (wasPicked && left)
    return {
      kind: 'part',
      text: t('font.note.part', { done: row.done, all: row.chars }),
      tip: t('font.note.partTip', { done: row.done, left, why }),
    };
  if (!wasPicked && row.done)
    return {
      kind: 'along',
      text: left ? t('font.note.alongPart', { done: row.done, all: row.chars }) : t('font.note.along'),
      tip: t('font.note.alongTip'),
    };
  return null;
}
const view = computed(() =>
  groups.value.map(rows => ({ head: rows[0], rows: rows.map(row => ({ row, note: noteOf(row) })) })),
);
const failed = computed(() =>
  view.value.reduce((sum, group) => sum + group.rows.filter(({ note }) => note && note.kind !== 'along').length, 0),
);
const summary = computed(() =>
  fonts.value.length
    ? t('font.listCount', {
        n: fonts.value.length,
        picked: fonts.value.filter(row => picked.value.has(row.key)).length,
      })
    : t('font.listEmpty'),
);
</script>

<template>
  <details id="faceBox" class="fold faces-fold">
    <summary>
      <span>{{ t('font.list') }}{{ summary }}</span
      ><span v-if="failed" :class="['tag', 'no', { stale }]">{{ t('font.listFailed', { n: failed }) }}</span>
    </summary>
    <div id="faceList" :class="['faces', { stale }]">
      <template v-if="fonts.length">
        <div class="faces-all">
          <NCheckbox v-bind="checkState(fonts)" data-scope="all" @update:checked="(on: boolean) => toggle(fonts, on)">{{
            t('font.all')
          }}</NCheckbox>
        </div>
        <div v-for="group in view" :key="group.head.face" class="face" role="group" :aria-label="faceName(group.head)">
          <div class="face-head">
            <NCheckbox
              v-bind="checkState(group.rows.map(({ row }) => row))"
              :data-scope="'face:' + group.head.face"
              @update:checked="
                (on: boolean) =>
                  toggle(
                    group.rows.map(({ row }) => row),
                    on,
                  )
              "
            >
              <span class="face-name"
                ><b>{{ group.head.family }}</b> <span class="face-style">{{ styleName(group.head) }}</span></span
              >
            </NCheckbox>
            <div class="face-sub">
              <span class="fallback">
                <Tip :text="fallbackTip(group.head)">
                  <button type="button" class="tipbtn" :aria-description="fallbackTip(group.head)">
                    {{ t('font.fallback') }}
                  </button> </Tip
                >{{ fallbackText(group.head) }}
              </span>
              <Tip v-if="group.head.phone.thin" :text="t('font.thinTip', { w: group.head.weight })">
                <button type="button" class="chip" :aria-description="t('font.thinTip', { w: group.head.weight })">
                  {{ t('font.thin') }}
                </button>
              </Tip>
              <Tip v-if="group.head.web" :text="t('font.webTip', { name: group.head.web })">
                <button type="button" class="chip" :aria-description="t('font.webTip', { name: group.head.web })">
                  {{ t('font.web') }}
                </button>
              </Tip>
            </div>
          </div>
          <ul class="face-rows">
            <li v-for="{ row, note } in group.rows" :key="row.key" :data-key="row.key" class="face-row">
              <NCheckbox
                class="row-check"
                :checked="picked.has(row.key)"
                data-scope="row"
                @update:checked="(on: boolean) => toggle([row], on)"
              >
                <span class="row-label"
                  ><span class="size">{{ t('font.size', { n: px(row.size) }) }}</span
                  >{{ ' ' }}<span class="sample" :style="sampleStyle(row)">{{ row.sample }}</span></span
                >
              </NCheckbox>
              <span class="chars">{{ t('font.chars', { n: row.chars }) }}</span>
              <div v-if="note" :class="['row-note', note.kind]">
                <Tip :text="note.tip">
                  <button type="button" class="tipbtn" :aria-description="note.tip">{{ note.text }}</button>
                </Tip>
              </div>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </details>
</template>
