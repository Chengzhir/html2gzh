// 测试里操作界面的几个动作（e2e、align、tools/shot-side 共用）

/** 等转换结果对上当前的勾选与预览宽度（连点几个勾选框会合并成一次转换，中间的结果不算） */
export async function settled(page, timeout = 180000) {
  await page.waitForFunction(
    () => {
      const s = window.__wxc;
      if (s.busy || !s.result || s.result.width !== s.width) return false;
      const want = (JSON.parse(localStorage.getItem('wxc.opts') || '{}').paths || []).slice().sort();
      return JSON.stringify(s.result.paths.slice().sort()) === JSON.stringify(want);
    },
    { timeout, polling: 200 },
  );
}

/** 勾选框（Naive UI 的 role="checkbox"）现在是否勾上 */
export const isChecked = (page, sel) => page.$eval(sel, e => e.getAttribute('aria-checked') === 'true');
/** 把勾选框设成 on：状态不同才点 */
export async function setChecked(page, sel, on) {
  if ((await isChecked(page, sel)) !== on) await page.click(sel);
}
/** 数字输入框：选中原值、输入新值、回车提交（和人操作一样，只在回车或离开时生效） */
export async function typeNumber(page, sel, value) {
  // count：连点三次，选中原值；clickCount 只把一次点击标成第三击，不会选中文字
  await page.click(sel, { count: 3 });
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
}

/** 字体列表默认折叠：点标题展开（已展开时不动） */
export async function openFontList(page) {
  if (!(await page.$eval('#faceBox', e => e.open))) await page.click('#faceBox > summary');
}

/** 测试用的勾选：字号 ≥ 18px 的行，加上 Bahnschrift 各款（含 Condensed）的所有行（手机上没有相近字体） */
export async function pickDefault(page) {
  await typeNumber(page, '#svgMin', 18);
  const min = await page.evaluate(() => window.__wxc.opts.svgMin);
  if (min !== 18) throw new Error(`字号输入框没有改成 18（现在是 ${min}）`);
  await page.click('#pickBig');
  await openFontList(page);
  const groups = await page.$$eval('#faceList [role="checkbox"][data-scope^="face:bahnschrift"]', cs =>
    cs.map(c => c.dataset.scope),
  );
  for (const g of groups) await setChecked(page, `#faceList [role="checkbox"][data-scope="${g}"]`, true);
  await settled(page);
}
