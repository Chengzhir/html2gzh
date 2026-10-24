// 本机服务登记的文件 id：内容的 SHA-256 前 16 位十六进制 + 扩展名（lib/assets.ts 的 register 生成），地址是 /a/<id>
const ID = '[0-9a-f]{16}\\.[a-z0-9]+';
export const ASSET_ID = new RegExp(`^${ID}$`);
/** 文本里出现的所有 id，去重 */
export const assetIdsIn = (text: string) => [
  ...new Set([...String(text).matchAll(new RegExp(`/a/(${ID})`, 'g'))].map(match => match[1])),
];
