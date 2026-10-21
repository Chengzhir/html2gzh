// 测试里操作界面的几个动作（e2e、align、tools/shot-side 共用）

/** 等转换结果对上当前的勾选与预览宽度（连点几个勾选框会合并成一次转换，中间的结果不算） */
export async function settled(page, timeout = 180000) {
  await page.waitForFunction(() => {
    const s = window.__wxc;
    if (s.busy || !s.result || s.result.width !== +document.getElementById('width').value) return false;
    const want = (JSON.parse(localStorage.getItem('wxc.opts') || '{}').paths || []).slice().sort();
    return JSON.stringify(s.result.paths.slice().sort()) === JSON.stringify(want);
  }, { timeout, polling: 200 });
}

/** 测试用的勾选：字号 ≥ 18px 的行，加上 Bahnschrift 各款（含 Condensed）的所有行（手机上没有相近字体） */
export async function pickDefault(page) {
  await page.$eval('#svgMin', e => { e.value = '18'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#pickBig');
  const groups = await page.$$eval('#faceList input[data-scope^="face:bahnschrift"]', cs => cs.map(c => c.dataset.scope));
  for (const g of groups) {
    const c = await page.$(`#faceList input[data-scope="${g}"]`);
    if (!await c.evaluate(e => e.checked)) await c.click();
  }
  await settled(page);
}
