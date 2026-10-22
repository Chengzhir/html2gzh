<script setup lang="ts">
import { computed } from 'vue';
import { useThemeVars } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import SourceCard from './SourceCard.vue';
import CopyCard from './CopyCard.vue';
import FontCard from './FontCard.vue';
import HostCard from './HostCard.vue';
import ChecksCard from './ChecksCard.vue';
import Stage from './Stage.vue';

const { t } = useI18n();
// Naive UI 默认主题的颜色、字号、圆角挂成 CSS 变量，给组件以外的元素（字体表、检查结果、预览外框）用
const theme = useThemeVars();
const cssVars = computed(() => {
  const vars = theme.value;
  return {
    '--ui-text1': vars.textColor1, '--ui-text2': vars.textColor2, '--ui-text3': vars.textColor3,
    '--ui-primary': vars.primaryColor, '--ui-primary-hover': vars.primaryColorHover,
    '--ui-ok': vars.successColor, '--ui-warn': vars.warningColor, '--ui-err': vars.errorColor, '--ui-info': vars.infoColor,
    '--ui-border': vars.borderColor, '--ui-divider': vars.dividerColor, '--ui-card': vars.cardColor, '--ui-body': vars.bodyColor,
    '--ui-hover': vars.hoverColor, '--ui-action': vars.actionColor, '--ui-code': vars.codeColor, '--ui-disabled': vars.opacityDisabled,
    '--ui-radius': vars.borderRadius, '--ui-radius-sm': vars.borderRadiusSmall,
    '--ui-fs': vars.fontSize, '--ui-fs-sm': vars.fontSizeSmall, '--ui-fs-mini': vars.fontSizeMini,
    '--ui-strong': vars.fontWeightStrong, '--ui-mono': vars.fontFamilyMono,
    '--ui-h-small': vars.heightSmall, '--ui-h-medium': vars.heightMedium,
  };
});
</script>

<template>
  <div class="shell" :style="cssVars">
    <aside class="side">
      <header class="brand">
        <h1>{{ t('app.name') }} <span class="sub">{{ t('app.sub') }}</span></h1>
      </header>
      <SourceCard />
      <CopyCard />
      <FontCard />
      <HostCard />
      <ChecksCard />
    </aside>
    <Stage />
  </div>
</template>
