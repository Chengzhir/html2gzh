// 检查结果：转换器给的各条，加上页面自己发现的（图片缺失、过大、压缩、样式表、网络图片等）
import { computed } from 'vue';
import type { FindingLevel } from '../convert/types.ts';
import { t } from './i18n.ts';
import { showFinding, kb } from './fmt.ts';
import type { Block } from './fmt.ts';
import { state, redoHint } from './store.ts';
import type { Shrunk } from './store.ts';

export interface CheckItem { key: string; level: FindingLevel; title: string; text: string; blocks: Block[]; ids: string[] }

/** 只列前四个，其余说"等" */
const few = (names: string[]) => names.slice(0, 4).join(t('common.sep')) + (names.length > 4 ? t('common.etc') : '');
const howText = ({ how }: Shrunk) => how.fmt === 'jpeg' ? t('shrink.how.jpeg', { q: how.q }) : t('shrink.how.' + how.fmt);
const shrinkLine = (img: Shrunk) => img.width === img.srcWidth
  ? t('checks.shrinkLine', { name: img.name, from: kb(img.srcSize), to: kb(img.size), how: howText(img) })
  : t('checks.shrinkLineResized', { name: img.name, from: kb(img.srcSize), to: kb(img.size), w0: img.srcWidth, h0: img.srcHeight, w: img.width, h: img.height, how: howText(img) });
const para = (text: string): Block => ({ p: text });

export const checkItems = computed<CheckItem[]>(() => {
  const result = state.result;
  if (!result) return [];
  const { report, stats } = result;
  const redo = redoHint();
  const items: CheckItem[] = result.findings.map((finding, i) => ({ key: `f${i}:${finding.code}`, level: finding.level, ids: finding.ids, ...showFinding(finding) }));
  const item = (level: FindingLevel, code: string, params: Record<string, unknown>, blocks: Block[] = [], ids: string[] = []): CheckItem =>
    ({ key: 'a:' + code, level, title: t(`checks.${code}.title`), text: t(`checks.${code}.text`, params), blocks, ids });
  if (report.missing.length) items.unshift(item('error', 'missingImg', { n: report.missing.length, list: few(report.missing) }, [para(t('checks.missingImg.detail', { redo }))]));
  if (report.badData) items.push(item('warn', 'badData', { n: report.badData }, [para(t('checks.badData.detail', { redo }))]));
  const big = report.big, shrunk = report.shrunk.filter(img => !img.over);
  if (big.length) {
    const list = few(big.map(img => img.why ? t('checks.bigItemWhy', { name: img.name, size: kb(img.size), why: img.why }) : t('checks.bigItem', { name: img.name, size: kb(img.size) })));
    const fix = t(state.shrink.on ? 'checks.big.fixOn' : 'checks.big.fixOff', { redo });
    items.push(item('warn', 'big', { n: big.length, limit: t('common.kb', { n: state.shrink.kb }), list }, [para(t('checks.big.why') + fix + t('checks.big.tunnel'))]));
  }
  if (shrunk.length) {
    const lines = shrunk.slice(0, 8).map(shrinkLine);
    if (shrunk.length > 8) lines.push(t('checks.shrinkMore', { n: shrunk.length }));
    items.push(item('fixed', 'shrunk', { n: shrunk.length }, [{ ul: lines }, para(t('checks.shrunk.detail'))]));
  }
  if (report.sheets.length) items.push(item('warn', 'sheets', { n: report.sheets.length, list: few(report.sheets) }, [para(t('checks.sheets.detail'))]));
  if (report.refs.length) items.push(item('warn', 'refs', { n: report.refs.length, list: few(report.refs) }, [para(t('checks.refs.detail', { redo }))]));
  if (report.dataUri) items.push(item('fixed', 'dataUri', { n: report.dataUri }, [para(t('checks.dataUri.detail'))]));
  if (report.remote) items.push(item('info', 'remote', { n: report.remote }, [para(t('checks.remote.detail'))]));
  if (stats.visualBad.length) items.push(item('warn', 'visualBad', { n: stats.visualBad.length }, [], stats.visualBad));
  else {
    // 排在"其他宽度"那条前面：先说当前宽度一致，再说其他宽度也一致
    const firstInfo = items.findIndex(existing => existing.level === 'info');
    items.splice(firstInfo < 0 ? items.length : firstInfo, 0, item('info', 'verified', { n: stats.verified }, [para(t('checks.verified.detail'))]));
  }
  items.push(item('info', 'chars', { n: stats.chars.toLocaleString() }, [para(t('checks.chars.detail'))]));
  return items;
});

export const counts = computed(() => ({
  error: checkItems.value.filter(({ level }) => level === 'error').length,
  warn: checkItems.value.filter(({ level }) => level === 'warn').length,
}));

// 测试日志用：把一条检查结果排成标题与结论
Object.assign(window, { __wxcFinding: showFinding });
