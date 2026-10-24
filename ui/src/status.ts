// 复制按钮下方的两行：能不能复制、复制后怎么做；微信服务器取图的进度
import { computed } from 'vue';
import { assetIdsIn } from '../convert/assetid.ts';
import { t } from './i18n.ts';
import { kb } from './fmt.ts';
import { state, redoHint } from './store.ts';
import { counts } from './checks.ts';

// Windows 上用 serve.cmd 启动；别的系统在终端里跑 node server.ts
export const WIN = /Windows/.test(navigator.userAgent);
export const service = () => t(WIN ? 'app.serviceWin' : 'app.serviceTerm');

const localIds = computed(() => (state.result ? assetIdsIn(state.result.payload) : []));
const pick = () => state.server?.host.pick;
const saveTwice = () => (/<img\b/.test(state.result?.payload ?? '') ? t('copy.saveTwice') : '');

/** 复制按钮能不能点，以及按钮下的说明 */
export const copyState = computed(() => {
  const images = localIds.value.length;
  // 转换失败时留下的是上一次的成品，与现在的原网页或设置对不上，不能复制
  if (state.error && !state.busy) return { disabled: true, note: t('copy.failed', { redo: redoHint() }) };
  if (!state.result) return { disabled: true, note: t('copy.idle') };
  if (images && !pick()) {
    const checking = state.server && (state.server.host.checking || state.recheckPending);
    return { disabled: true, note: t(checking ? 'copy.needHostChecking' : 'copy.needHost', { n: images }) };
  }
  const disabled = state.busy || state.shrinking;
  if (state.copyDenied) return { disabled, note: t('copy.denied') };
  if (state.copiedAt) return { disabled, note: images ? t('copy.copiedImgs') : t('copy.copied') + saveTwice() };
  const errors = counts.value.error;
  return {
    disabled,
    note:
      (errors ? t('copy.mustFix', { n: errors }) : '') +
      (images ? t('copy.howImgs', { n: images, service: service() }) : t('copy.how')),
  };
});

/**
 * 复制之后这张图的下载情况。微信服务器下载超时会隔约 0.5 秒重试，三次都超时就放弃，
 * 所以只看最后一串（间隔不到 1.5 秒的）请求：三次及以上算失败，一两次且之后 2 秒没有再来算成功
 */
const BURST_GAP = 1500,
  SETTLE = 2000;
type FetchState = 'wait' | 'busy' | 'ok' | 'fail';
function fetchState(times: number[] | undefined, since: number, now: number): FetchState {
  const recent = (times || []).filter(time => time >= since);
  if (!recent.length) return 'wait';
  let burstStart = recent.length - 1;
  while (burstStart > 0 && recent[burstStart] - recent[burstStart - 1] < BURST_GAP) burstStart--;
  if (recent.length - burstStart >= 3) return 'fail';
  return now - recent[recent.length - 1] < SETTLE ? 'busy' : 'ok';
}
/** 复制后的下载进度：{ cls, text }；没复制、没有本地图片时为 null */
export const fetchLine = computed(() => {
  const ids = localIds.value,
    result = state.result,
    copied = state.copiedAt;
  if (!copied || !result || !ids.length || !state.server) return null;
  const fetches = state.server.fetches || {},
    now = state.now;
  const states = ids.map(id => fetchState(fetches[id], copied.t, now));
  const got = states.filter(s => s === 'ok').length,
    failed = ids.filter((_, i) => states[i] === 'fail');
  const total = ids.length;
  if (failed.length) {
    // 转换生成的位图没有文件名，同名的合并计数
    const times = new Map<string, number>();
    for (const id of failed) {
      const name = result.report.names.get(id) || t('img.generated');
      times.set(name, (times.get(name) || 0) + 1);
    }
    const listed = [...times].map(([name, n]) => (n > 1 ? t('fetch.nameTimes', { name, n }) : name));
    // 超时的图里最小的一张，在这条线路上都没能在时限内下完：上限要比它小。几十 KB 的图都下不完，问题在线路，不在图片大小
    const smallest = Math.min(...failed.map(id => result.report.sizes.get(id) || Infinity));
    const shrinkOn = state.shrink.on;
    const fix = !Number.isFinite(smallest)
      ? t(shrinkOn ? 'fetch.fixOn' : 'fetch.fixOff')
      : smallest < 50 << 10
        ? t('fetch.fixTinyNet', { size: kb(smallest) })
        : t(shrinkOn ? 'fetch.fixBelowOn' : 'fetch.fixBelowOff', { size: kb(smallest) });
    const list = listed.slice(0, 4).join(t('common.sep')) + (listed.length > 4 ? t('common.etc') : '');
    return { cls: 'err', text: t('fetch.failed', { got, total, n: failed.length, names: list, fix }) };
  }
  if (got === total)
    return { cls: 'ok', text: t('fetch.allDone', { n: got, service: service() }) + t('copy.saveTwice') };
  return { cls: got ? 'warn' : '', text: t('fetch.partial', { got, total, base: copied.base }) };
});
