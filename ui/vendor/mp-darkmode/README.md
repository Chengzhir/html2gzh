# mp-darkmode

微信公众平台的深色模式转换算法，npm 包 [mp-darkmode](https://www.npmjs.com/package/mp-darkmode) 1.2.2 的 `dist/darkmode.min.js`，未改动。许可证见同目录 LICENSE（MIT）。

sha256 `3c562121f33ff7f56f5a6c1dcce1de7b63af01582ddc96377458d8f0652d2ce4`

用途：预览区的“深色”模式。转换在一个只允许脚本、不同源的隐藏 iframe 里进行（`ui/phone.js`），结果再放进不允许脚本的预览 iframe。

和手机对照过：同一篇文章在微信里切到深色模式，浅色底与深色底的转换结果都与本算法算出的相同。线上阅读页内联的是更新的版本（支持 oklch 等颜色写法），没有单独发布。
