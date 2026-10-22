<script setup lang="ts">
// 取图地址：和端口映射软件一样分三项——本机端口（取图服务监听的端口），公网地址与公网端口（微信连接的地址）。
// 公网地址留空时自动检测公网 IP；公网端口留空时与本机端口相同（路由器端口转发通常两边一致）
import { reactive, ref, computed, watch } from 'vue';
import { NCard, NButton, NInput, NRadioGroup, NRadioButton } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { HostConfig } from '../../convert/types.ts';
import { state, saveHost, recheck } from '../store.ts';
import { errText } from '../fmt.ts';
import { service } from '../status.ts';

const { t, locale } = useI18n();
const form = reactive({ imgPort: '', host: '', port: '', proto: 'http' });
const dirty = ref(false),
  saving = ref(false);
const note = reactive({ text: '', cls: '' });
/** 表单里正显示着的服务端设置：设置变了（别处改的）且表单没在编辑时才重新填 */
let shownConfig = '';
function fill(config: HostConfig) {
  Object.assign(form, {
    imgPort: String(config.imgPort),
    host: config.host,
    port: config.port ? String(config.port) : '',
    proto: config.proto,
  });
  dirty.value = false;
}
const serverConfig = computed(() => state.server?.host.config);
watch(
  serverConfig,
  config => {
    if (!config) return;
    const text = JSON.stringify(config);
    if (!dirty.value && text !== shownConfig) {
      shownConfig = text;
      fill(config);
    }
  },
  { immediate: true },
);

/** 自动检测时只能是 http：裸 IP 没有证书。公网端口留空时 http 同本机端口、https 用 443，和服务端 baseOf 一致 */
const auto = computed(() => !form.host.trim());
watch(
  auto,
  isAuto => {
    if (isAuto) form.proto = 'http';
  },
  { immediate: true },
);
const portPlaceholder = computed(() =>
  form.proto === 'https'
    ? t('host.pubPortHttps')
    : form.imgPort.trim()
      ? t('host.pubPortHttp', { port: form.imgPort.trim() })
      : t('host.pubPortHttpUnset'),
);
/** 粘贴的完整地址（https://abc.example.com:8443）拆进协议、地址、端口三格 */
function split() {
  const value = form.host.trim();
  if (!/^https?:\/\//i.test(value)) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  form.proto = url.protocol.slice(0, -1);
  form.host = url.hostname;
  form.port = url.port || (url.protocol === 'https:' ? '443' : '80');
}
function onInput(e: Event) {
  dirty.value = true;
  note.text = '';
  if ((e.target as HTMLElement).id === 'hfHost' && (e as InputEvent).inputType === 'insertFromPaste') split();
}
async function save() {
  split();
  saving.value = true;
  note.cls = '';
  note.text = t('host.saving');
  try {
    const saved = await saveHost({
      imgPort: form.imgPort.trim(),
      host: form.host.trim(),
      port: form.port.trim(),
      proto: form.proto,
    });
    fill(saved.config);
    shownConfig = JSON.stringify(saved.config);
    note.cls = 'ok';
    note.text = t('host.saved');
  } catch (e) {
    note.cls = 'err';
    note.text = errText(e);
  } finally {
    saving.value = false;
  }
}

const host = computed(() => state.server?.host);
const checking = computed(() => !!host.value && (host.value.checking || state.recheckPending));
type Reach = 'ok' | 'no' | 'wait';
const TAG: Record<Reach, string> = { ok: 'host.tagOk', no: 'host.tagNo', wait: 'host.tagWait' };
const line = computed((): { cls: string; text?: string; reach?: Reach; base?: string } => {
  const current = host.value;
  if (!current) return { cls: 'err', text: t('host.noService', { service: service() }) };
  const { pick } = current;
  if (!pick) return checking.value ? { cls: '', text: t('host.checkingIp') } : { cls: 'err', text: t('host.noIp') };
  const reach: Reach = pick.ok == null || (checking.value && !pick.ok) ? 'wait' : pick.ok ? 'ok' : 'no';
  return { cls: reach === 'ok' ? 'ok' : reach === 'no' ? 'warn' : '', reach, base: pick.base };
});
/** 无法访问、没有检测到公网 IP 时的说明：开头一句、可能的原因、结尾一句 */
const help = computed((): { lead: string; items: string[]; tail: string } | null => {
  const current = host.value;
  if (!current) return null;
  const port = current.config.imgPort;
  if (!current.pick) return checking.value ? null : { lead: t('host.offline'), items: [], tail: '' };
  if (current.pick.ok !== false || checking.value) return null;
  // 从本机访问自己的公网地址要靠路由器回环，有的路由器不支持，所以本机检测不通不等于外网不通
  if (current.config.host)
    return {
      lead: t('host.causes'),
      items: [t('host.causeTunnel', { port }), t('host.causeForward', { port })],
      tail: t('host.notSure'),
    };
  return {
    lead: t('host.causes'),
    items: [t('host.causeNoIp'), t('host.causeNoForward', { port })],
    tail: t('host.notSure'),
  };
});
const when = computed(() => {
  const current = host.value;
  return current && !checking.value && current.checkedAt
    ? t('host.when', { time: new Date(current.checkedAt).toLocaleTimeString(locale.value, { hour12: false }) })
    : '';
});
// 自动检测到多个公网 IP（多条宽带按连接分流）时列出来
const exits = computed(() => {
  const current = host.value;
  return current && !current.config.host && current.list.length > 1 ? current.list : null;
});
const guidePort = computed(() => host.value?.config.imgPort ?? 38960);
</script>

<template>
  <NCard size="small" tag="section" aria-labelledby="hostTitle">
    <template #header
      ><span id="hostTitle">{{ t('host.title') }}</span></template
    >
    <p class="muted host-intro">{{ t('host.intro') }}</p>
    <form id="hostForm" class="host-form" novalidate @submit.prevent="save" @input="onInput">
      <label for="hfPort">{{ t('host.imgPort') }}</label>
      <NInput
        v-model:value="form.imgPort"
        :input-props="{ id: 'hfPort', inputmode: 'numeric', autocomplete: 'off', spellcheck: false }"
      />
      <label for="hfHost">{{ t('host.host') }}</label>
      <NInput
        v-model:value="form.host"
        :placeholder="t('host.hostPlaceholder')"
        :input-props="{ id: 'hfHost', autocomplete: 'off', spellcheck: false }"
        @change="split"
      />
      <label for="hfPubPort">{{ t('host.pubPort') }}</label>
      <NInput
        v-model:value="form.port"
        :placeholder="portPlaceholder"
        :input-props="{ id: 'hfPubPort', inputmode: 'numeric', autocomplete: 'off', spellcheck: false }"
      />
      <span id="hfProtoLabel" class="form-label">{{ t('host.proto') }}</span>
      <NRadioGroup
        id="hfProto"
        v-model:value="form.proto"
        :disabled="auto"
        aria-labelledby="hfProtoLabel"
        role="radiogroup"
      >
        <NRadioButton value="http">http</NRadioButton>
        <NRadioButton value="https">https</NRadioButton>
      </NRadioGroup>
      <div class="host-actions">
        <NButton attr-type="submit" :disabled="saving">{{ t('host.save') }}</NButton>
        <span id="hostNote" :class="['note', note.cls]" role="status" aria-live="polite">{{ note.text }}</span>
      </div>
    </form>
    <div class="host-result">
      <p id="hostLine" :class="['status', line.cls]">
        <template v-if="line.base"
          >{{ t('host.current') }}<span :class="['tag', line.reach]">{{ t(TAG[line.reach]) }}</span
          ><span class="url">{{ line.base }}</span></template
        >
        <template v-else>{{ line.text }}</template>
      </p>
      <div id="hostHelp" class="host-help muted" :hidden="!help">
        <template v-if="help">
          <p>{{ help.lead }}</p>
          <ul v-if="help.items.length">
            <li v-for="(item, index) in help.items" :key="index">{{ item }}</li>
          </ul>
          <p v-if="help.tail" class="help-tail">{{ help.tail }}</p>
        </template>
      </div>
      <div class="row">
        <NButton id="recheck" :disabled="checking" @click="recheck">{{ t('host.recheck') }}</NButton>
        <span id="hostWhen" class="muted">{{ when }}</span>
      </div>
      <details v-if="exits" id="exitBox" class="fold">
        <summary id="exitSum">{{ t('host.exits', { n: exits.length }) }}</summary>
        <ul id="exitList" class="exits">
          <li v-for="exit in exits" :key="exit.ip">
            <span class="ip">{{ exit.ip }}</span>
            <span v-if="exit.stale" class="tag wait">{{ t('host.exitStale') }}</span>
            <span v-else :class="['tag', exit.ok ? 'ok' : 'no']">{{ t(exit.ok ? 'host.tagOk' : 'host.tagNo') }}</span>
            <span v-if="host.pick?.base === exit.base" class="in-use">{{ t('host.inUse') }}</span>
          </li>
        </ul>
      </details>
    </div>
    <details class="fold host-guide">
      <summary>{{ t('host.guide') }}</summary>
      <dl class="guide">
        <dt>{{ t('host.guideIpTitle') }}</dt>
        <dd>{{ t('host.guideIp', { port: guidePort }) }}</dd>
        <dt>{{ t('host.guideTunnelTitle') }}</dt>
        <dd>{{ t('host.guideTunnel', { port: guidePort }) }}</dd>
        <dt>{{ t('host.guidePortTitle') }}</dt>
        <dd>{{ t('host.guidePort') }}</dd>
        <dt>{{ t('host.guideCheckTitle') }}</dt>
        <dd>{{ t('host.guideCheck') }}</dd>
        <dt>{{ t('host.guideSafeTitle') }}</dt>
        <dd>{{ t('host.guideSafe') }}</dd>
      </dl>
    </details>
  </NCard>
</template>
