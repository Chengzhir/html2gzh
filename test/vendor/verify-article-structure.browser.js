// 公众号编辑器"内容结构检测"的引擎（微信公众平台开源，MIT，许可证见同目录 LICENSES.txt）。
// 来源 https://github.com/wechatjs/verify-article-structure-spec 提交 0fa8ad266466001c9a651f99a79ff623ccb89d68 的 cli/：
// 按其 pnpm-lock.yaml 装 esbuild 0.21.5、mp-darkmode 1.2.3-alpha.1，在 cli/ 下运行 node build-browser.mjs 生成，未作改动。
// 页面注入后由 window.VerifyArticleStructure.verifyArticleStructure(容器元素) 调用。
"use strict";
var VerifyArticleStructure = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // node_modules/mp-darkmode/dist/darkmode.min.js
  var require_darkmode_min = __commonJS({
    "node_modules/mp-darkmode/dist/darkmode.min.js"(exports, module) {
      !function(e, t) {
        "object" == typeof exports && "object" == typeof module ? module.exports = t() : "function" == typeof define && define.amd ? define("Darkmode", [], t) : "object" == typeof exports ? exports.Darkmode = t() : e.Darkmode = t();
      }(self, () => (() => {
        var e = { 31(e2) {
          "use strict";
          e2.exports = { aliceblue: [240, 248, 255], antiquewhite: [250, 235, 215], aqua: [0, 255, 255], aquamarine: [127, 255, 212], azure: [240, 255, 255], beige: [245, 245, 220], bisque: [255, 228, 196], black: [0, 0, 0], blanchedalmond: [255, 235, 205], blue: [0, 0, 255], blueviolet: [138, 43, 226], brown: [165, 42, 42], burlywood: [222, 184, 135], cadetblue: [95, 158, 160], chartreuse: [127, 255, 0], chocolate: [210, 105, 30], coral: [255, 127, 80], cornflowerblue: [100, 149, 237], cornsilk: [255, 248, 220], crimson: [220, 20, 60], cyan: [0, 255, 255], darkblue: [0, 0, 139], darkcyan: [0, 139, 139], darkgoldenrod: [184, 134, 11], darkgray: [169, 169, 169], darkgreen: [0, 100, 0], darkgrey: [169, 169, 169], darkkhaki: [189, 183, 107], darkmagenta: [139, 0, 139], darkolivegreen: [85, 107, 47], darkorange: [255, 140, 0], darkorchid: [153, 50, 204], darkred: [139, 0, 0], darksalmon: [233, 150, 122], darkseagreen: [143, 188, 143], darkslateblue: [72, 61, 139], darkslategray: [47, 79, 79], darkslategrey: [47, 79, 79], darkturquoise: [0, 206, 209], darkviolet: [148, 0, 211], deeppink: [255, 20, 147], deepskyblue: [0, 191, 255], dimgray: [105, 105, 105], dimgrey: [105, 105, 105], dodgerblue: [30, 144, 255], firebrick: [178, 34, 34], floralwhite: [255, 250, 240], forestgreen: [34, 139, 34], fuchsia: [255, 0, 255], gainsboro: [220, 220, 220], ghostwhite: [248, 248, 255], gold: [255, 215, 0], goldenrod: [218, 165, 32], gray: [128, 128, 128], green: [0, 128, 0], greenyellow: [173, 255, 47], grey: [128, 128, 128], honeydew: [240, 255, 240], hotpink: [255, 105, 180], indianred: [205, 92, 92], indigo: [75, 0, 130], ivory: [255, 255, 240], khaki: [240, 230, 140], lavender: [230, 230, 250], lavenderblush: [255, 240, 245], lawngreen: [124, 252, 0], lemonchiffon: [255, 250, 205], lightblue: [173, 216, 230], lightcoral: [240, 128, 128], lightcyan: [224, 255, 255], lightgoldenrodyellow: [250, 250, 210], lightgray: [211, 211, 211], lightgreen: [144, 238, 144], lightgrey: [211, 211, 211], lightpink: [255, 182, 193], lightsalmon: [255, 160, 122], lightseagreen: [32, 178, 170], lightskyblue: [135, 206, 250], lightslategray: [119, 136, 153], lightslategrey: [119, 136, 153], lightsteelblue: [176, 196, 222], lightyellow: [255, 255, 224], lime: [0, 255, 0], limegreen: [50, 205, 50], linen: [250, 240, 230], magenta: [255, 0, 255], maroon: [128, 0, 0], mediumaquamarine: [102, 205, 170], mediumblue: [0, 0, 205], mediumorchid: [186, 85, 211], mediumpurple: [147, 112, 219], mediumseagreen: [60, 179, 113], mediumslateblue: [123, 104, 238], mediumspringgreen: [0, 250, 154], mediumturquoise: [72, 209, 204], mediumvioletred: [199, 21, 133], midnightblue: [25, 25, 112], mintcream: [245, 255, 250], mistyrose: [255, 228, 225], moccasin: [255, 228, 181], navajowhite: [255, 222, 173], navy: [0, 0, 128], oldlace: [253, 245, 230], olive: [128, 128, 0], olivedrab: [107, 142, 35], orange: [255, 165, 0], orangered: [255, 69, 0], orchid: [218, 112, 214], palegoldenrod: [238, 232, 170], palegreen: [152, 251, 152], paleturquoise: [175, 238, 238], palevioletred: [219, 112, 147], papayawhip: [255, 239, 213], peachpuff: [255, 218, 185], peru: [205, 133, 63], pink: [255, 192, 203], plum: [221, 160, 221], powderblue: [176, 224, 230], purple: [128, 0, 128], rebeccapurple: [102, 51, 153], red: [255, 0, 0], rosybrown: [188, 143, 143], royalblue: [65, 105, 225], saddlebrown: [139, 69, 19], salmon: [250, 128, 114], sandybrown: [244, 164, 96], seagreen: [46, 139, 87], seashell: [255, 245, 238], sienna: [160, 82, 45], silver: [192, 192, 192], skyblue: [135, 206, 235], slateblue: [106, 90, 205], slategray: [112, 128, 144], slategrey: [112, 128, 144], snow: [255, 250, 250], springgreen: [0, 255, 127], steelblue: [70, 130, 180], tan: [210, 180, 140], teal: [0, 128, 128], thistle: [216, 191, 216], tomato: [255, 99, 71], turquoise: [64, 224, 208], violet: [238, 130, 238], wheat: [245, 222, 179], white: [255, 255, 255], whitesmoke: [245, 245, 245], yellow: [255, 255, 0], yellowgreen: [154, 205, 50] };
        }, 156(e2) {
          "use strict";
          e2.exports = { aliceblue: [240, 248, 255], antiquewhite: [250, 235, 215], aqua: [0, 255, 255], aquamarine: [127, 255, 212], azure: [240, 255, 255], beige: [245, 245, 220], bisque: [255, 228, 196], black: [0, 0, 0], blanchedalmond: [255, 235, 205], blue: [0, 0, 255], blueviolet: [138, 43, 226], brown: [165, 42, 42], burlywood: [222, 184, 135], cadetblue: [95, 158, 160], chartreuse: [127, 255, 0], chocolate: [210, 105, 30], coral: [255, 127, 80], cornflowerblue: [100, 149, 237], cornsilk: [255, 248, 220], crimson: [220, 20, 60], cyan: [0, 255, 255], darkblue: [0, 0, 139], darkcyan: [0, 139, 139], darkgoldenrod: [184, 134, 11], darkgray: [169, 169, 169], darkgreen: [0, 100, 0], darkgrey: [169, 169, 169], darkkhaki: [189, 183, 107], darkmagenta: [139, 0, 139], darkolivegreen: [85, 107, 47], darkorange: [255, 140, 0], darkorchid: [153, 50, 204], darkred: [139, 0, 0], darksalmon: [233, 150, 122], darkseagreen: [143, 188, 143], darkslateblue: [72, 61, 139], darkslategray: [47, 79, 79], darkslategrey: [47, 79, 79], darkturquoise: [0, 206, 209], darkviolet: [148, 0, 211], deeppink: [255, 20, 147], deepskyblue: [0, 191, 255], dimgray: [105, 105, 105], dimgrey: [105, 105, 105], dodgerblue: [30, 144, 255], firebrick: [178, 34, 34], floralwhite: [255, 250, 240], forestgreen: [34, 139, 34], fuchsia: [255, 0, 255], gainsboro: [220, 220, 220], ghostwhite: [248, 248, 255], gold: [255, 215, 0], goldenrod: [218, 165, 32], gray: [128, 128, 128], green: [0, 128, 0], greenyellow: [173, 255, 47], grey: [128, 128, 128], honeydew: [240, 255, 240], hotpink: [255, 105, 180], indianred: [205, 92, 92], indigo: [75, 0, 130], ivory: [255, 255, 240], khaki: [240, 230, 140], lavender: [230, 230, 250], lavenderblush: [255, 240, 245], lawngreen: [124, 252, 0], lemonchiffon: [255, 250, 205], lightblue: [173, 216, 230], lightcoral: [240, 128, 128], lightcyan: [224, 255, 255], lightgoldenrodyellow: [250, 250, 210], lightgray: [211, 211, 211], lightgreen: [144, 238, 144], lightgrey: [211, 211, 211], lightpink: [255, 182, 193], lightsalmon: [255, 160, 122], lightseagreen: [32, 178, 170], lightskyblue: [135, 206, 250], lightslategray: [119, 136, 153], lightslategrey: [119, 136, 153], lightsteelblue: [176, 196, 222], lightyellow: [255, 255, 224], lime: [0, 255, 0], limegreen: [50, 205, 50], linen: [250, 240, 230], magenta: [255, 0, 255], maroon: [128, 0, 0], mediumaquamarine: [102, 205, 170], mediumblue: [0, 0, 205], mediumorchid: [186, 85, 211], mediumpurple: [147, 112, 219], mediumseagreen: [60, 179, 113], mediumslateblue: [123, 104, 238], mediumspringgreen: [0, 250, 154], mediumturquoise: [72, 209, 204], mediumvioletred: [199, 21, 133], midnightblue: [25, 25, 112], mintcream: [245, 255, 250], mistyrose: [255, 228, 225], moccasin: [255, 228, 181], navajowhite: [255, 222, 173], navy: [0, 0, 128], oldlace: [253, 245, 230], olive: [128, 128, 0], olivedrab: [107, 142, 35], orange: [255, 165, 0], orangered: [255, 69, 0], orchid: [218, 112, 214], palegoldenrod: [238, 232, 170], palegreen: [152, 251, 152], paleturquoise: [175, 238, 238], palevioletred: [219, 112, 147], papayawhip: [255, 239, 213], peachpuff: [255, 218, 185], peru: [205, 133, 63], pink: [255, 192, 203], plum: [221, 160, 221], powderblue: [176, 224, 230], purple: [128, 0, 128], rebeccapurple: [102, 51, 153], red: [255, 0, 0], rosybrown: [188, 143, 143], royalblue: [65, 105, 225], saddlebrown: [139, 69, 19], salmon: [250, 128, 114], sandybrown: [244, 164, 96], seagreen: [46, 139, 87], seashell: [255, 245, 238], sienna: [160, 82, 45], silver: [192, 192, 192], skyblue: [135, 206, 235], slateblue: [106, 90, 205], slategray: [112, 128, 144], slategrey: [112, 128, 144], snow: [255, 250, 250], springgreen: [0, 255, 127], steelblue: [70, 130, 180], tan: [210, 180, 140], teal: [0, 128, 128], thistle: [216, 191, 216], tomato: [255, 99, 71], turquoise: [64, 224, 208], violet: [238, 130, 238], wheat: [245, 222, 179], white: [255, 255, 255], whitesmoke: [245, 245, 245], yellow: [255, 255, 0], yellowgreen: [154, 205, 50] };
        }, 195(e2) {
          e2.exports = function(e3) {
            return !(!e3 || "string" == typeof e3) && (e3 instanceof Array || Array.isArray(e3) || e3.length >= 0 && (e3.splice instanceof Function || Object.getOwnPropertyDescriptor(e3, e3.length - 1) && "String" !== e3.constructor.name));
          };
        }, 507(e2, t2, r2) {
          var n2 = r2(659);
          function o(e3, t3) {
            return function(r3) {
              return t3(e3(r3));
            };
          }
          function a(e3, t3) {
            for (var r3 = [t3[e3].parent, e3], a2 = n2[t3[e3].parent][e3], i = t3[e3].parent; t3[i].parent; ) r3.unshift(t3[i].parent), a2 = o(n2[t3[i].parent][i], a2), i = t3[i].parent;
            return a2.conversion = r3, a2;
          }
          e2.exports = function(e3) {
            for (var t3 = function(e4) {
              var t4 = function() {
                for (var e5 = {}, t5 = Object.keys(n2), r5 = t5.length, o4 = 0; o4 < r5; o4++) e5[t5[o4]] = { distance: -1, parent: null };
                return e5;
              }(), r4 = [e4];
              for (t4[e4].distance = 0; r4.length; ) for (var o3 = r4.pop(), a2 = Object.keys(n2[o3]), i2 = a2.length, s2 = 0; s2 < i2; s2++) {
                var l2 = a2[s2], u = t4[l2];
                -1 === u.distance && (u.distance = t4[o3].distance + 1, u.parent = o3, r4.unshift(l2));
              }
              return t4;
            }(e3), r3 = {}, o2 = Object.keys(t3), i = o2.length, s = 0; s < i; s++) {
              var l = o2[s];
              null !== t3[l].parent && (r3[l] = a(l, t3));
            }
            return r3;
          };
        }, 520(e2, t2, r2) {
          "use strict";
          var n2 = r2(854), o = r2(734), a = [].slice, i = ["keyword", "gray", "hex"], s = {};
          Object.keys(o).forEach(function(e3) {
            s[a.call(o[e3].labels).sort().join("")] = e3;
          });
          var l = {};
          function u(e3, t3) {
            if (!(this instanceof u)) return new u(e3, t3);
            if (t3 && t3 in i && (t3 = null), t3 && !(t3 in o)) throw new Error("Unknown model: " + t3);
            var r3, h2;
            if (null == e3) this.model = "rgb", this.color = [0, 0, 0], this.valpha = 1;
            else if (e3 instanceof u) this.model = e3.model, this.color = e3.color.slice(), this.valpha = e3.valpha;
            else if ("string" == typeof e3) {
              var c2 = n2.get(e3);
              if (null === c2) throw new Error("Unable to parse color from string: " + e3);
              this.model = c2.model, h2 = o[this.model].channels, this.color = c2.value.slice(0, h2), this.valpha = "number" == typeof c2.value[h2] ? c2.value[h2] : 1;
            } else if (e3.length) {
              this.model = t3 || "rgb", h2 = o[this.model].channels;
              var g = a.call(e3, 0, h2);
              this.color = d(g, h2), this.valpha = "number" == typeof e3[h2] ? e3[h2] : 1;
            } else if ("number" == typeof e3) e3 &= 16777215, this.model = "rgb", this.color = [e3 >> 16 & 255, e3 >> 8 & 255, 255 & e3], this.valpha = 1;
            else {
              this.valpha = 1;
              var f = Object.keys(e3);
              "alpha" in e3 && (f.splice(f.indexOf("alpha"), 1), this.valpha = "number" == typeof e3.alpha ? e3.alpha : 0);
              var b = f.sort().join("");
              if (!(b in s)) throw new Error("Unable to parse color from object: " + JSON.stringify(e3));
              this.model = s[b];
              var m = o[this.model].labels, p = [];
              for (r3 = 0; r3 < m.length; r3++) p.push(e3[m[r3]]);
              this.color = d(p);
            }
            if (l[this.model]) for (h2 = o[this.model].channels, r3 = 0; r3 < h2; r3++) {
              var y = l[this.model][r3];
              y && (this.color[r3] = y(this.color[r3]));
            }
            this.valpha = Math.max(0, Math.min(1, this.valpha)), Object.freeze && Object.freeze(this);
          }
          function h(e3, t3, r3) {
            return (e3 = Array.isArray(e3) ? e3 : [e3]).forEach(function(e4) {
              (l[e4] || (l[e4] = []))[t3] = r3;
            }), e3 = e3[0], function(n3) {
              var o2;
              return arguments.length ? (r3 && (n3 = r3(n3)), (o2 = this[e3]()).color[t3] = n3, o2) : (o2 = this[e3]().color[t3], r3 && (o2 = r3(o2)), o2);
            };
          }
          function c(e3) {
            return function(t3) {
              return Math.max(0, Math.min(e3, t3));
            };
          }
          function d(e3, t3) {
            for (var r3 = 0; r3 < t3; r3++) "number" != typeof e3[r3] && (e3[r3] = 0);
            return e3;
          }
          u.prototype = { toString: function() {
            return this.string();
          }, toJSON: function() {
            return this[this.model]();
          }, string: function(e3) {
            var t3 = this.model in n2.to ? this : this.rgb(), r3 = 1 === (t3 = t3.round("number" == typeof e3 ? e3 : 1)).valpha ? t3.color : t3.color.concat(this.valpha);
            return n2.to[t3.model](r3);
          }, percentString: function(e3) {
            var t3 = this.rgb().round("number" == typeof e3 ? e3 : 1), r3 = 1 === t3.valpha ? t3.color : t3.color.concat(this.valpha);
            return n2.to.rgb.percent(r3);
          }, array: function() {
            return 1 === this.valpha ? this.color.slice() : this.color.concat(this.valpha);
          }, object: function() {
            for (var e3 = {}, t3 = o[this.model].channels, r3 = o[this.model].labels, n3 = 0; n3 < t3; n3++) e3[r3[n3]] = this.color[n3];
            return 1 !== this.valpha && (e3.alpha = this.valpha), e3;
          }, unitArray: function() {
            var e3 = this.rgb().color;
            return e3[0] /= 255, e3[1] /= 255, e3[2] /= 255, 1 !== this.valpha && e3.push(this.valpha), e3;
          }, unitObject: function() {
            var e3 = this.rgb().object();
            return e3.r /= 255, e3.g /= 255, e3.b /= 255, 1 !== this.valpha && (e3.alpha = this.valpha), e3;
          }, round: function(e3) {
            return e3 = Math.max(e3 || 0, 0), new u(this.color.map(/* @__PURE__ */ function(e4) {
              return function(t3) {
                return function(e5, t4) {
                  return Number(e5.toFixed(t4));
                }(t3, e4);
              };
            }(e3)).concat(this.valpha), this.model);
          }, alpha: function(e3) {
            return arguments.length ? new u(this.color.concat(Math.max(0, Math.min(1, e3))), this.model) : this.valpha;
          }, red: h("rgb", 0, c(255)), green: h("rgb", 1, c(255)), blue: h("rgb", 2, c(255)), hue: h(["hsl", "hsv", "hsl", "hwb", "hcg"], 0, function(e3) {
            return (e3 % 360 + 360) % 360;
          }), saturationl: h("hsl", 1, c(100)), lightness: h("hsl", 2, c(100)), saturationv: h("hsv", 1, c(100)), value: h("hsv", 2, c(100)), chroma: h("hcg", 1, c(100)), gray: h("hcg", 2, c(100)), white: h("hwb", 1, c(100)), wblack: h("hwb", 2, c(100)), cyan: h("cmyk", 0, c(100)), magenta: h("cmyk", 1, c(100)), yellow: h("cmyk", 2, c(100)), black: h("cmyk", 3, c(100)), x: h("xyz", 0, c(100)), y: h("xyz", 1, c(100)), z: h("xyz", 2, c(100)), l: h("lab", 0, c(100)), a: h("lab", 1), b: h("lab", 2), keyword: function(e3) {
            return arguments.length ? new u(e3) : o[this.model].keyword(this.color);
          }, hex: function(e3) {
            return arguments.length ? new u(e3) : n2.to.hex(this.rgb().round().color);
          }, rgbNumber: function() {
            var e3 = this.rgb().color;
            return (255 & e3[0]) << 16 | (255 & e3[1]) << 8 | 255 & e3[2];
          }, luminosity: function() {
            for (var e3 = this.rgb().color, t3 = [], r3 = 0; r3 < e3.length; r3++) {
              var n3 = e3[r3] / 255;
              t3[r3] = n3 <= 0.03928 ? n3 / 12.92 : Math.pow((n3 + 0.055) / 1.055, 2.4);
            }
            return 0.2126 * t3[0] + 0.7152 * t3[1] + 0.0722 * t3[2];
          }, contrast: function(e3) {
            var t3 = this.luminosity(), r3 = e3.luminosity();
            return t3 > r3 ? (t3 + 0.05) / (r3 + 0.05) : (r3 + 0.05) / (t3 + 0.05);
          }, level: function(e3) {
            var t3 = this.contrast(e3);
            return t3 >= 7.1 ? "AAA" : t3 >= 4.5 ? "AA" : "";
          }, isDark: function() {
            var e3 = this.rgb().color;
            return (299 * e3[0] + 587 * e3[1] + 114 * e3[2]) / 1e3 < 128;
          }, isLight: function() {
            return !this.isDark();
          }, negate: function() {
            for (var e3 = this.rgb(), t3 = 0; t3 < 3; t3++) e3.color[t3] = 255 - e3.color[t3];
            return e3;
          }, lighten: function(e3) {
            var t3 = this.hsl();
            return t3.color[2] += t3.color[2] * e3, t3;
          }, darken: function(e3) {
            var t3 = this.hsl();
            return t3.color[2] -= t3.color[2] * e3, t3;
          }, saturate: function(e3) {
            var t3 = this.hsl();
            return t3.color[1] += t3.color[1] * e3, t3;
          }, desaturate: function(e3) {
            var t3 = this.hsl();
            return t3.color[1] -= t3.color[1] * e3, t3;
          }, whiten: function(e3) {
            var t3 = this.hwb();
            return t3.color[1] += t3.color[1] * e3, t3;
          }, blacken: function(e3) {
            var t3 = this.hwb();
            return t3.color[2] += t3.color[2] * e3, t3;
          }, grayscale: function() {
            var e3 = this.rgb().color, t3 = 0.3 * e3[0] + 0.59 * e3[1] + 0.11 * e3[2];
            return u.rgb(t3, t3, t3);
          }, fade: function(e3) {
            return this.alpha(this.valpha - this.valpha * e3);
          }, opaquer: function(e3) {
            return this.alpha(this.valpha + this.valpha * e3);
          }, rotate: function(e3) {
            var t3 = this.hsl(), r3 = t3.color[0];
            return r3 = (r3 = (r3 + e3) % 360) < 0 ? 360 + r3 : r3, t3.color[0] = r3, t3;
          }, mix: function(e3, t3) {
            if (!e3 || !e3.rgb) throw new Error('Argument to "mix" was not a Color instance, but rather an instance of ' + typeof e3);
            var r3 = e3.rgb(), n3 = this.rgb(), o2 = void 0 === t3 ? 0.5 : t3, a2 = 2 * o2 - 1, i2 = r3.alpha() - n3.alpha(), s2 = ((a2 * i2 === -1 ? a2 : (a2 + i2) / (1 + a2 * i2)) + 1) / 2, l2 = 1 - s2;
            return u.rgb(s2 * r3.red() + l2 * n3.red(), s2 * r3.green() + l2 * n3.green(), s2 * r3.blue() + l2 * n3.blue(), r3.alpha() * o2 + n3.alpha() * (1 - o2));
          } }, Object.keys(o).forEach(function(e3) {
            if (-1 === i.indexOf(e3)) {
              var t3 = o[e3].channels;
              u.prototype[e3] = function() {
                if (this.model === e3) return new u(this);
                if (arguments.length) return new u(arguments, e3);
                var r3, n3 = "number" == typeof arguments[t3] ? t3 : this.valpha;
                return new u((r3 = o[this.model][e3].raw(this.color), Array.isArray(r3) ? r3 : [r3]).concat(n3), e3);
              }, u[e3] = function(r3) {
                return "number" == typeof r3 && (r3 = d(a.call(arguments), t3)), new u(r3, e3);
              };
            }
          }), e2.exports = u;
        }, 659(e2, t2, r2) {
          var n2 = r2(31), o = {};
          for (var a in n2) n2.hasOwnProperty(a) && (o[n2[a]] = a);
          var i = e2.exports = { rgb: { channels: 3, labels: "rgb" }, hsl: { channels: 3, labels: "hsl" }, hsv: { channels: 3, labels: "hsv" }, hwb: { channels: 3, labels: "hwb" }, cmyk: { channels: 4, labels: "cmyk" }, xyz: { channels: 3, labels: "xyz" }, lab: { channels: 3, labels: "lab" }, lch: { channels: 3, labels: "lch" }, hex: { channels: 1, labels: ["hex"] }, keyword: { channels: 1, labels: ["keyword"] }, ansi16: { channels: 1, labels: ["ansi16"] }, ansi256: { channels: 1, labels: ["ansi256"] }, hcg: { channels: 3, labels: ["h", "c", "g"] }, apple: { channels: 3, labels: ["r16", "g16", "b16"] }, gray: { channels: 1, labels: ["gray"] } };
          for (var s in i) if (i.hasOwnProperty(s)) {
            if (!("channels" in i[s])) throw new Error("missing channels property: " + s);
            if (!("labels" in i[s])) throw new Error("missing channel labels property: " + s);
            if (i[s].labels.length !== i[s].channels) throw new Error("channel and label counts mismatch: " + s);
            var l = i[s].channels, u = i[s].labels;
            delete i[s].channels, delete i[s].labels, Object.defineProperty(i[s], "channels", { value: l }), Object.defineProperty(i[s], "labels", { value: u });
          }
          function h(e3, t3) {
            return Math.pow(e3[0] - t3[0], 2) + Math.pow(e3[1] - t3[1], 2) + Math.pow(e3[2] - t3[2], 2);
          }
          i.rgb.hsl = function(e3) {
            var t3, r3, n3 = e3[0] / 255, o2 = e3[1] / 255, a2 = e3[2] / 255, i2 = Math.min(n3, o2, a2), s2 = Math.max(n3, o2, a2), l2 = s2 - i2;
            return s2 === i2 ? t3 = 0 : n3 === s2 ? t3 = (o2 - a2) / l2 : o2 === s2 ? t3 = 2 + (a2 - n3) / l2 : a2 === s2 && (t3 = 4 + (n3 - o2) / l2), (t3 = Math.min(60 * t3, 360)) < 0 && (t3 += 360), r3 = (i2 + s2) / 2, [t3, 100 * (s2 === i2 ? 0 : r3 <= 0.5 ? l2 / (s2 + i2) : l2 / (2 - s2 - i2)), 100 * r3];
          }, i.rgb.hsv = function(e3) {
            var t3, r3, n3, o2, a2, i2 = e3[0] / 255, s2 = e3[1] / 255, l2 = e3[2] / 255, u2 = Math.max(i2, s2, l2), h2 = u2 - Math.min(i2, s2, l2), c = function(e4) {
              return (u2 - e4) / 6 / h2 + 0.5;
            };
            return 0 === h2 ? o2 = a2 = 0 : (a2 = h2 / u2, t3 = c(i2), r3 = c(s2), n3 = c(l2), i2 === u2 ? o2 = n3 - r3 : s2 === u2 ? o2 = 1 / 3 + t3 - n3 : l2 === u2 && (o2 = 2 / 3 + r3 - t3), o2 < 0 ? o2 += 1 : o2 > 1 && (o2 -= 1)), [360 * o2, 100 * a2, 100 * u2];
          }, i.rgb.hwb = function(e3) {
            var t3 = e3[0], r3 = e3[1], n3 = e3[2];
            return [i.rgb.hsl(e3)[0], 1 / 255 * Math.min(t3, Math.min(r3, n3)) * 100, 100 * (n3 = 1 - 1 / 255 * Math.max(t3, Math.max(r3, n3)))];
          }, i.rgb.cmyk = function(e3) {
            var t3, r3 = e3[0] / 255, n3 = e3[1] / 255, o2 = e3[2] / 255;
            return [100 * ((1 - r3 - (t3 = Math.min(1 - r3, 1 - n3, 1 - o2))) / (1 - t3) || 0), 100 * ((1 - n3 - t3) / (1 - t3) || 0), 100 * ((1 - o2 - t3) / (1 - t3) || 0), 100 * t3];
          }, i.rgb.keyword = function(e3) {
            var t3 = o[e3];
            if (t3) return t3;
            var r3, a2 = 1 / 0;
            for (var i2 in n2) if (n2.hasOwnProperty(i2)) {
              var s2 = h(e3, n2[i2]);
              s2 < a2 && (a2 = s2, r3 = i2);
            }
            return r3;
          }, i.keyword.rgb = function(e3) {
            return n2[e3];
          }, i.rgb.xyz = function(e3) {
            var t3 = e3[0] / 255, r3 = e3[1] / 255, n3 = e3[2] / 255;
            return [100 * (0.4124 * (t3 = t3 > 0.04045 ? Math.pow((t3 + 0.055) / 1.055, 2.4) : t3 / 12.92) + 0.3576 * (r3 = r3 > 0.04045 ? Math.pow((r3 + 0.055) / 1.055, 2.4) : r3 / 12.92) + 0.1805 * (n3 = n3 > 0.04045 ? Math.pow((n3 + 0.055) / 1.055, 2.4) : n3 / 12.92)), 100 * (0.2126 * t3 + 0.7152 * r3 + 0.0722 * n3), 100 * (0.0193 * t3 + 0.1192 * r3 + 0.9505 * n3)];
          }, i.rgb.lab = function(e3) {
            var t3 = i.rgb.xyz(e3), r3 = t3[0], n3 = t3[1], o2 = t3[2];
            return n3 /= 100, o2 /= 108.883, r3 = (r3 /= 95.047) > 8856e-6 ? Math.pow(r3, 1 / 3) : 7.787 * r3 + 16 / 116, [116 * (n3 = n3 > 8856e-6 ? Math.pow(n3, 1 / 3) : 7.787 * n3 + 16 / 116) - 16, 500 * (r3 - n3), 200 * (n3 - (o2 = o2 > 8856e-6 ? Math.pow(o2, 1 / 3) : 7.787 * o2 + 16 / 116))];
          }, i.hsl.rgb = function(e3) {
            var t3, r3, n3, o2, a2, i2 = e3[0] / 360, s2 = e3[1] / 100, l2 = e3[2] / 100;
            if (0 === s2) return [a2 = 255 * l2, a2, a2];
            t3 = 2 * l2 - (r3 = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2), o2 = [0, 0, 0];
            for (var u2 = 0; u2 < 3; u2++) (n3 = i2 + 1 / 3 * -(u2 - 1)) < 0 && n3++, n3 > 1 && n3--, a2 = 6 * n3 < 1 ? t3 + 6 * (r3 - t3) * n3 : 2 * n3 < 1 ? r3 : 3 * n3 < 2 ? t3 + (r3 - t3) * (2 / 3 - n3) * 6 : t3, o2[u2] = 255 * a2;
            return o2;
          }, i.hsl.hsv = function(e3) {
            var t3 = e3[0], r3 = e3[1] / 100, n3 = e3[2] / 100, o2 = r3, a2 = Math.max(n3, 0.01);
            return r3 *= (n3 *= 2) <= 1 ? n3 : 2 - n3, o2 *= a2 <= 1 ? a2 : 2 - a2, [t3, 100 * (0 === n3 ? 2 * o2 / (a2 + o2) : 2 * r3 / (n3 + r3)), (n3 + r3) / 2 * 100];
          }, i.hsv.rgb = function(e3) {
            var t3 = e3[0] / 60, r3 = e3[1] / 100, n3 = e3[2] / 100, o2 = Math.floor(t3) % 6, a2 = t3 - Math.floor(t3), i2 = 255 * n3 * (1 - r3), s2 = 255 * n3 * (1 - r3 * a2), l2 = 255 * n3 * (1 - r3 * (1 - a2));
            switch (n3 *= 255, o2) {
              case 0:
                return [n3, l2, i2];
              case 1:
                return [s2, n3, i2];
              case 2:
                return [i2, n3, l2];
              case 3:
                return [i2, s2, n3];
              case 4:
                return [l2, i2, n3];
              case 5:
                return [n3, i2, s2];
            }
          }, i.hsv.hsl = function(e3) {
            var t3, r3, n3, o2 = e3[0], a2 = e3[1] / 100, i2 = e3[2] / 100, s2 = Math.max(i2, 0.01);
            return n3 = (2 - a2) * i2, r3 = a2 * s2, [o2, 100 * (r3 = (r3 /= (t3 = (2 - a2) * s2) <= 1 ? t3 : 2 - t3) || 0), 100 * (n3 /= 2)];
          }, i.hwb.rgb = function(e3) {
            var t3, r3, n3, o2, a2, i2, s2, l2 = e3[0] / 360, u2 = e3[1] / 100, h2 = e3[2] / 100, c = u2 + h2;
            switch (c > 1 && (u2 /= c, h2 /= c), n3 = 6 * l2 - (t3 = Math.floor(6 * l2)), 1 & t3 && (n3 = 1 - n3), o2 = u2 + n3 * ((r3 = 1 - h2) - u2), t3) {
              default:
              case 6:
              case 0:
                a2 = r3, i2 = o2, s2 = u2;
                break;
              case 1:
                a2 = o2, i2 = r3, s2 = u2;
                break;
              case 2:
                a2 = u2, i2 = r3, s2 = o2;
                break;
              case 3:
                a2 = u2, i2 = o2, s2 = r3;
                break;
              case 4:
                a2 = o2, i2 = u2, s2 = r3;
                break;
              case 5:
                a2 = r3, i2 = u2, s2 = o2;
            }
            return [255 * a2, 255 * i2, 255 * s2];
          }, i.cmyk.rgb = function(e3) {
            var t3 = e3[0] / 100, r3 = e3[1] / 100, n3 = e3[2] / 100, o2 = e3[3] / 100;
            return [255 * (1 - Math.min(1, t3 * (1 - o2) + o2)), 255 * (1 - Math.min(1, r3 * (1 - o2) + o2)), 255 * (1 - Math.min(1, n3 * (1 - o2) + o2))];
          }, i.xyz.rgb = function(e3) {
            var t3, r3, n3, o2 = e3[0] / 100, a2 = e3[1] / 100, i2 = e3[2] / 100;
            return r3 = -0.9689 * o2 + 1.8758 * a2 + 0.0415 * i2, n3 = 0.0557 * o2 + -0.204 * a2 + 1.057 * i2, t3 = (t3 = 3.2406 * o2 + -1.5372 * a2 + -0.4986 * i2) > 31308e-7 ? 1.055 * Math.pow(t3, 1 / 2.4) - 0.055 : 12.92 * t3, r3 = r3 > 31308e-7 ? 1.055 * Math.pow(r3, 1 / 2.4) - 0.055 : 12.92 * r3, n3 = n3 > 31308e-7 ? 1.055 * Math.pow(n3, 1 / 2.4) - 0.055 : 12.92 * n3, [255 * (t3 = Math.min(Math.max(0, t3), 1)), 255 * (r3 = Math.min(Math.max(0, r3), 1)), 255 * (n3 = Math.min(Math.max(0, n3), 1))];
          }, i.xyz.lab = function(e3) {
            var t3 = e3[0], r3 = e3[1], n3 = e3[2];
            return r3 /= 100, n3 /= 108.883, t3 = (t3 /= 95.047) > 8856e-6 ? Math.pow(t3, 1 / 3) : 7.787 * t3 + 16 / 116, [116 * (r3 = r3 > 8856e-6 ? Math.pow(r3, 1 / 3) : 7.787 * r3 + 16 / 116) - 16, 500 * (t3 - r3), 200 * (r3 - (n3 = n3 > 8856e-6 ? Math.pow(n3, 1 / 3) : 7.787 * n3 + 16 / 116))];
          }, i.lab.xyz = function(e3) {
            var t3, r3, n3, o2 = e3[0];
            t3 = e3[1] / 500 + (r3 = (o2 + 16) / 116), n3 = r3 - e3[2] / 200;
            var a2 = Math.pow(r3, 3), i2 = Math.pow(t3, 3), s2 = Math.pow(n3, 3);
            return r3 = a2 > 8856e-6 ? a2 : (r3 - 16 / 116) / 7.787, t3 = i2 > 8856e-6 ? i2 : (t3 - 16 / 116) / 7.787, n3 = s2 > 8856e-6 ? s2 : (n3 - 16 / 116) / 7.787, [t3 *= 95.047, r3 *= 100, n3 *= 108.883];
          }, i.lab.lch = function(e3) {
            var t3, r3 = e3[0], n3 = e3[1], o2 = e3[2];
            return (t3 = 360 * Math.atan2(o2, n3) / 2 / Math.PI) < 0 && (t3 += 360), [r3, Math.sqrt(n3 * n3 + o2 * o2), t3];
          }, i.lch.lab = function(e3) {
            var t3, r3 = e3[0], n3 = e3[1];
            return t3 = e3[2] / 360 * 2 * Math.PI, [r3, n3 * Math.cos(t3), n3 * Math.sin(t3)];
          }, i.rgb.ansi16 = function(e3) {
            var t3 = e3[0], r3 = e3[1], n3 = e3[2], o2 = 1 in arguments ? arguments[1] : i.rgb.hsv(e3)[2];
            if (0 === (o2 = Math.round(o2 / 50))) return 30;
            var a2 = 30 + (Math.round(n3 / 255) << 2 | Math.round(r3 / 255) << 1 | Math.round(t3 / 255));
            return 2 === o2 && (a2 += 60), a2;
          }, i.hsv.ansi16 = function(e3) {
            return i.rgb.ansi16(i.hsv.rgb(e3), e3[2]);
          }, i.rgb.ansi256 = function(e3) {
            var t3 = e3[0], r3 = e3[1], n3 = e3[2];
            return t3 === r3 && r3 === n3 ? t3 < 8 ? 16 : t3 > 248 ? 231 : Math.round((t3 - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(t3 / 255 * 5) + 6 * Math.round(r3 / 255 * 5) + Math.round(n3 / 255 * 5);
          }, i.ansi16.rgb = function(e3) {
            var t3 = e3 % 10;
            if (0 === t3 || 7 === t3) return e3 > 50 && (t3 += 3.5), [t3 = t3 / 10.5 * 255, t3, t3];
            var r3 = 0.5 * (1 + ~~(e3 > 50));
            return [(1 & t3) * r3 * 255, (t3 >> 1 & 1) * r3 * 255, (t3 >> 2 & 1) * r3 * 255];
          }, i.ansi256.rgb = function(e3) {
            if (e3 >= 232) {
              var t3 = 10 * (e3 - 232) + 8;
              return [t3, t3, t3];
            }
            var r3;
            return e3 -= 16, [Math.floor(e3 / 36) / 5 * 255, Math.floor((r3 = e3 % 36) / 6) / 5 * 255, r3 % 6 / 5 * 255];
          }, i.rgb.hex = function(e3) {
            var t3 = (((255 & Math.round(e3[0])) << 16) + ((255 & Math.round(e3[1])) << 8) + (255 & Math.round(e3[2]))).toString(16).toUpperCase();
            return "000000".substring(t3.length) + t3;
          }, i.hex.rgb = function(e3) {
            var t3 = e3.toString(16).match(/[a-f0-9]{6}|[a-f0-9]{3}/i);
            if (!t3) return [0, 0, 0];
            var r3 = t3[0];
            3 === t3[0].length && (r3 = r3.split("").map(function(e4) {
              return e4 + e4;
            }).join(""));
            var n3 = parseInt(r3, 16);
            return [n3 >> 16 & 255, n3 >> 8 & 255, 255 & n3];
          }, i.rgb.hcg = function(e3) {
            var t3, r3 = e3[0] / 255, n3 = e3[1] / 255, o2 = e3[2] / 255, a2 = Math.max(Math.max(r3, n3), o2), i2 = Math.min(Math.min(r3, n3), o2), s2 = a2 - i2;
            return t3 = s2 <= 0 ? 0 : a2 === r3 ? (n3 - o2) / s2 % 6 : a2 === n3 ? 2 + (o2 - r3) / s2 : 4 + (r3 - n3) / s2 + 4, t3 /= 6, [360 * (t3 %= 1), 100 * s2, 100 * (s2 < 1 ? i2 / (1 - s2) : 0)];
          }, i.hsl.hcg = function(e3) {
            var t3, r3 = e3[1] / 100, n3 = e3[2] / 100, o2 = 0;
            return (t3 = n3 < 0.5 ? 2 * r3 * n3 : 2 * r3 * (1 - n3)) < 1 && (o2 = (n3 - 0.5 * t3) / (1 - t3)), [e3[0], 100 * t3, 100 * o2];
          }, i.hsv.hcg = function(e3) {
            var t3 = e3[1] / 100, r3 = e3[2] / 100, n3 = t3 * r3, o2 = 0;
            return n3 < 1 && (o2 = (r3 - n3) / (1 - n3)), [e3[0], 100 * n3, 100 * o2];
          }, i.hcg.rgb = function(e3) {
            var t3 = e3[0] / 360, r3 = e3[1] / 100, n3 = e3[2] / 100;
            if (0 === r3) return [255 * n3, 255 * n3, 255 * n3];
            var o2, a2 = [0, 0, 0], i2 = t3 % 1 * 6, s2 = i2 % 1, l2 = 1 - s2;
            switch (Math.floor(i2)) {
              case 0:
                a2[0] = 1, a2[1] = s2, a2[2] = 0;
                break;
              case 1:
                a2[0] = l2, a2[1] = 1, a2[2] = 0;
                break;
              case 2:
                a2[0] = 0, a2[1] = 1, a2[2] = s2;
                break;
              case 3:
                a2[0] = 0, a2[1] = l2, a2[2] = 1;
                break;
              case 4:
                a2[0] = s2, a2[1] = 0, a2[2] = 1;
                break;
              default:
                a2[0] = 1, a2[1] = 0, a2[2] = l2;
            }
            return o2 = (1 - r3) * n3, [255 * (r3 * a2[0] + o2), 255 * (r3 * a2[1] + o2), 255 * (r3 * a2[2] + o2)];
          }, i.hcg.hsv = function(e3) {
            var t3 = e3[1] / 100, r3 = t3 + e3[2] / 100 * (1 - t3), n3 = 0;
            return r3 > 0 && (n3 = t3 / r3), [e3[0], 100 * n3, 100 * r3];
          }, i.hcg.hsl = function(e3) {
            var t3 = e3[1] / 100, r3 = e3[2] / 100 * (1 - t3) + 0.5 * t3, n3 = 0;
            return r3 > 0 && r3 < 0.5 ? n3 = t3 / (2 * r3) : r3 >= 0.5 && r3 < 1 && (n3 = t3 / (2 * (1 - r3))), [e3[0], 100 * n3, 100 * r3];
          }, i.hcg.hwb = function(e3) {
            var t3 = e3[1] / 100, r3 = t3 + e3[2] / 100 * (1 - t3);
            return [e3[0], 100 * (r3 - t3), 100 * (1 - r3)];
          }, i.hwb.hcg = function(e3) {
            var t3 = e3[1] / 100, r3 = 1 - e3[2] / 100, n3 = r3 - t3, o2 = 0;
            return n3 < 1 && (o2 = (r3 - n3) / (1 - n3)), [e3[0], 100 * n3, 100 * o2];
          }, i.apple.rgb = function(e3) {
            return [e3[0] / 65535 * 255, e3[1] / 65535 * 255, e3[2] / 65535 * 255];
          }, i.rgb.apple = function(e3) {
            return [e3[0] / 255 * 65535, e3[1] / 255 * 65535, e3[2] / 255 * 65535];
          }, i.gray.rgb = function(e3) {
            return [e3[0] / 100 * 255, e3[0] / 100 * 255, e3[0] / 100 * 255];
          }, i.gray.hsl = i.gray.hsv = function(e3) {
            return [0, 0, e3[0]];
          }, i.gray.hwb = function(e3) {
            return [0, 100, e3[0]];
          }, i.gray.cmyk = function(e3) {
            return [0, 0, 0, e3[0]];
          }, i.gray.lab = function(e3) {
            return [e3[0], 0, 0];
          }, i.gray.hex = function(e3) {
            var t3 = 255 & Math.round(e3[0] / 100 * 255), r3 = ((t3 << 16) + (t3 << 8) + t3).toString(16).toUpperCase();
            return "000000".substring(r3.length) + r3;
          }, i.rgb.gray = function(e3) {
            return [(e3[0] + e3[1] + e3[2]) / 3 / 255 * 100];
          };
        }, 734(e2, t2, r2) {
          var n2 = r2(659), o = r2(507), a = {};
          Object.keys(n2).forEach(function(e3) {
            a[e3] = {}, Object.defineProperty(a[e3], "channels", { value: n2[e3].channels }), Object.defineProperty(a[e3], "labels", { value: n2[e3].labels });
            var t3 = o(e3);
            Object.keys(t3).forEach(function(r3) {
              var n3 = t3[r3];
              a[e3][r3] = function(e4) {
                var t4 = function(t5) {
                  if (null == t5) return t5;
                  arguments.length > 1 && (t5 = Array.prototype.slice.call(arguments));
                  var r4 = e4(t5);
                  if ("object" == typeof r4) for (var n4 = r4.length, o2 = 0; o2 < n4; o2++) r4[o2] = Math.round(r4[o2]);
                  return r4;
                };
                return "conversion" in e4 && (t4.conversion = e4.conversion), t4;
              }(n3), a[e3][r3].raw = function(e4) {
                var t4 = function(t5) {
                  return null == t5 ? t5 : (arguments.length > 1 && (t5 = Array.prototype.slice.call(arguments)), e4(t5));
                };
                return "conversion" in e4 && (t4.conversion = e4.conversion), t4;
              }(n3);
            });
          }), e2.exports = a;
        }, 854(e2, t2, r2) {
          var n2 = r2(156), o = r2(872), a = Object.hasOwnProperty, i = /* @__PURE__ */ Object.create(null);
          for (var s in n2) a.call(n2, s) && (i[n2[s]] = s);
          var l = e2.exports = { to: {}, get: {} };
          function u(e3, t3, r3) {
            return Math.min(Math.max(t3, e3), r3);
          }
          function h(e3) {
            var t3 = Math.round(e3).toString(16).toUpperCase();
            return t3.length < 2 ? "0" + t3 : t3;
          }
          l.get = function(e3) {
            var t3, r3;
            switch (e3.substring(0, 3).toLowerCase()) {
              case "hsl":
                t3 = l.get.hsl(e3), r3 = "hsl";
                break;
              case "hwb":
                t3 = l.get.hwb(e3), r3 = "hwb";
                break;
              default:
                t3 = l.get.rgb(e3), r3 = "rgb";
            }
            return t3 ? { model: r3, value: t3 } : null;
          }, l.get.rgb = function(e3) {
            if (!e3) return null;
            var t3, r3, o2, i2 = [0, 0, 0, 1];
            if (t3 = e3.match(/^#([a-f0-9]{6})([a-f0-9]{2})?$/i)) {
              for (o2 = t3[2], t3 = t3[1], r3 = 0; r3 < 3; r3++) {
                var s2 = 2 * r3;
                i2[r3] = parseInt(t3.slice(s2, s2 + 2), 16);
              }
              o2 && (i2[3] = parseInt(o2, 16) / 255);
            } else if (t3 = e3.match(/^#([a-f0-9]{3,4})$/i)) {
              for (o2 = (t3 = t3[1])[3], r3 = 0; r3 < 3; r3++) i2[r3] = parseInt(t3[r3] + t3[r3], 16);
              o2 && (i2[3] = parseInt(o2 + o2, 16) / 255);
            } else if (t3 = e3.match(/^rgba?\(\s*([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)\s*(?:[,|\/]\s*([+-]?[\d\.]+)(%?)\s*)?\)$/)) {
              for (r3 = 0; r3 < 3; r3++) i2[r3] = parseInt(t3[r3 + 1], 0);
              t3[4] && (t3[5] ? i2[3] = 0.01 * parseFloat(t3[4]) : i2[3] = parseFloat(t3[4]));
            } else {
              if (!(t3 = e3.match(/^rgba?\(\s*([+-]?[\d\.]+)\%\s*,?\s*([+-]?[\d\.]+)\%\s*,?\s*([+-]?[\d\.]+)\%\s*(?:[,|\/]\s*([+-]?[\d\.]+)(%?)\s*)?\)$/))) return (t3 = e3.match(/^(\w+)$/)) ? "transparent" === t3[1] ? [0, 0, 0, 0] : a.call(n2, t3[1]) ? ((i2 = n2[t3[1]])[3] = 1, i2) : null : null;
              for (r3 = 0; r3 < 3; r3++) i2[r3] = Math.round(2.55 * parseFloat(t3[r3 + 1]));
              t3[4] && (t3[5] ? i2[3] = 0.01 * parseFloat(t3[4]) : i2[3] = parseFloat(t3[4]));
            }
            for (r3 = 0; r3 < 3; r3++) i2[r3] = u(i2[r3], 0, 255);
            return i2[3] = u(i2[3], 0, 1), i2;
          }, l.get.hsl = function(e3) {
            if (!e3) return null;
            var t3 = e3.match(/^hsla?\(\s*([+-]?(?:\d{0,3}\.)?\d+)(?:deg)?\s*,?\s*([+-]?[\d\.]+)%\s*,?\s*([+-]?[\d\.]+)%\s*(?:[,|\/]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*)?\)$/);
            if (t3) {
              var r3 = parseFloat(t3[4]);
              return [(parseFloat(t3[1]) % 360 + 360) % 360, u(parseFloat(t3[2]), 0, 100), u(parseFloat(t3[3]), 0, 100), u(isNaN(r3) ? 1 : r3, 0, 1)];
            }
            return null;
          }, l.get.hwb = function(e3) {
            if (!e3) return null;
            var t3 = e3.match(/^hwb\(\s*([+-]?\d{0,3}(?:\.\d+)?)(?:deg)?\s*,\s*([+-]?[\d\.]+)%\s*,\s*([+-]?[\d\.]+)%\s*(?:,\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*)?\)$/);
            if (t3) {
              var r3 = parseFloat(t3[4]);
              return [(parseFloat(t3[1]) % 360 + 360) % 360, u(parseFloat(t3[2]), 0, 100), u(parseFloat(t3[3]), 0, 100), u(isNaN(r3) ? 1 : r3, 0, 1)];
            }
            return null;
          }, l.to.hex = function() {
            var e3 = o(arguments);
            return "#" + h(e3[0]) + h(e3[1]) + h(e3[2]) + (e3[3] < 1 ? h(Math.round(255 * e3[3])) : "");
          }, l.to.rgb = function() {
            var e3 = o(arguments);
            return e3.length < 4 || 1 === e3[3] ? "rgb(" + Math.round(e3[0]) + ", " + Math.round(e3[1]) + ", " + Math.round(e3[2]) + ")" : "rgba(" + Math.round(e3[0]) + ", " + Math.round(e3[1]) + ", " + Math.round(e3[2]) + ", " + e3[3] + ")";
          }, l.to.rgb.percent = function() {
            var e3 = o(arguments), t3 = Math.round(e3[0] / 255 * 100), r3 = Math.round(e3[1] / 255 * 100), n3 = Math.round(e3[2] / 255 * 100);
            return e3.length < 4 || 1 === e3[3] ? "rgb(" + t3 + "%, " + r3 + "%, " + n3 + "%)" : "rgba(" + t3 + "%, " + r3 + "%, " + n3 + "%, " + e3[3] + ")";
          }, l.to.hsl = function() {
            var e3 = o(arguments);
            return e3.length < 4 || 1 === e3[3] ? "hsl(" + e3[0] + ", " + e3[1] + "%, " + e3[2] + "%)" : "hsla(" + e3[0] + ", " + e3[1] + "%, " + e3[2] + "%, " + e3[3] + ")";
          }, l.to.hwb = function() {
            var e3 = o(arguments), t3 = "";
            return e3.length >= 4 && 1 !== e3[3] && (t3 = ", " + e3[3]), "hwb(" + e3[0] + ", " + e3[1] + "%, " + e3[2] + "%" + t3 + ")";
          }, l.to.keyword = function(e3) {
            return i[e3.slice(0, 3)];
          };
        }, 872(e2, t2, r2) {
          "use strict";
          var n2 = r2(195), o = Array.prototype.concat, a = Array.prototype.slice, i = e2.exports = function(e3) {
            for (var t3 = [], r3 = 0, i2 = e3.length; r3 < i2; r3++) {
              var s = e3[r3];
              n2(s) ? t3 = o.call(t3, a.call(s)) : t3.push(s);
            }
            return t3;
          };
          i.wrap = function(e3) {
            return function() {
              return e3(i(arguments));
            };
          };
        } }, t = {};
        function r(n2) {
          var o = t[n2];
          if (void 0 !== o) return o.exports;
          var a = t[n2] = { exports: {} };
          return e[n2](a, a.exports, r), a.exports;
        }
        r.d = (e2, t2) => {
          for (var n2 in t2) r.o(t2, n2) && !r.o(e2, n2) && Object.defineProperty(e2, n2, { enumerable: true, get: t2[n2] });
        }, r.o = (e2, t2) => Object.prototype.hasOwnProperty.call(e2, t2), r.r = (e2) => {
          "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e2, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e2, "__esModule", { value: true });
        };
        var n = {};
        return (() => {
          "use strict";
          var _a;
          r.r(n), r.d(n, { convertBg: () => ct, extend: () => ft, getContrast: () => gt, init: () => ht, reset: () => bt, run: () => ut, updateStyle: () => dt, validate: () => mt });
          var e2 = {};
          r.r(e2), r.d(e2, { color: () => ye, colorBurn: () => ce, colorDodge: () => he, darken: () => le, difference: () => fe, exclusion: () => be, hardLight: () => de, hue: () => me, lighten: () => ue, luminosity: () => ve, multiply: () => ae, normal: () => oe, overlay: () => se, saturation: () => pe, screen: () => ie, softLight: () => ge });
          const t2 = `${(/* @__PURE__ */ new Date()).getTime()}${Math.floor(1e4 * Math.random())}`, o = "(prefers-color-scheme: dark)", a = "js_darkmode__", i = new RegExp(`${a}\\d+`), s = `js_darkmode_style__${t2}`, l = "data_color_scheme_dark", u = `data-darkmode-color-${t2}`, h = `data-darkmode-bgcolor-${t2}`, c = `data-darkmode-original-color-${t2}`, d = `data-darkmode-original-bgcolor-${t2}`, g = `data-darkmode-bgimage-${t2}`, f = `data-darkmode-bggradient-mix-color-${t2}`, b = `data-darkmode-complementary-bgimagecolor-${t2}`, m = ((_a = window.getInnerHeight) == null ? void 0 : _a.call(window)) || window.innerHeight || document.documentElement.clientHeight, p = { BG_COLOR: ["background-color", "background-image", "background"], TEXT_SHADOW: ["text-shadow"], TEXT_COLOR: ["-webkit-text-stroke", "-webkit-text-stroke-color", "text-decoration", "text-decoration-color", "text-emphasis-color", "color", "-webkit-text-fill-color"], BORDER_COLOR: ["border-image", "-webkit-border-image", "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-block-color", "border-block-start-color", "border-block-end-color", "border-inline-color", "border-inline-start-color", "border-inline-end-color", "outline", "outline-color", "box-shadow", "column-rule", "column-rule-color"] }, y = Object.keys(p).map((e3) => p[e3].join("|")).join("|").split("|"), v = ["TABLE", "TR", "TD", "TH"], _ = / !important$/, k = /<\$#_SEMICOLON_#\$>/g, w = /\brgba?\([^)]+\)/i, E = /\brgba?\([^)]+\)/gi, C = /url\([^)]*\)/i;
          let x = function(e3) {
            return e3.FIRST_PAGE_STYLE = "firstPageStyle", e3.OTHER_PAGE_STYLE = "otherPageStyle", e3.FIRST_PAGE_STYLE_NO_MQ = "firstPageStyleNoMQ", e3.OTHER_PAGE_STYLE_NO_MQ = "otherPageStyleNoMQ", e3;
          }({}), T = function(e3) {
            return e3.LOW_CONTRAST = "low-contrast", e3.TEXT_BG_GRADIENT = "text-bg-gradient", e3;
          }({});
          var O = r(156), M = r(520);
          function S(e3, t3, r2) {
            return { r: 255 * r2(e3.r / 255, t3.r / 255), g: 255 * r2(e3.g / 255, t3.g / 255), b: 255 * r2(e3.b / 255, t3.b / 255) };
          }
          function B(e3, t3) {
            return t3;
          }
          function P(e3, t3) {
            return e3 * t3;
          }
          function L(e3, t3) {
            return e3 + t3 - e3 * t3;
          }
          function R(e3, t3) {
            return j(t3, e3);
          }
          function D(e3, t3) {
            return Math.min(e3, t3);
          }
          function N(e3, t3) {
            return Math.min(Math.max(e3, t3), 1);
          }
          function A(e3, t3) {
            return 0 === e3 ? 0 : 1 === t3 ? 1 : Math.min(1, e3 / (1 - t3));
          }
          function F(e3, t3) {
            return 1 === e3 ? 1 : 0 === t3 ? 0 : 1 - Math.min(1, (1 - e3) / t3);
          }
          function j(e3, t3) {
            return t3 <= 0.5 ? P(e3, 2 * t3) : L(e3, 2 * t3 - 1);
          }
          function $(e3, t3) {
            return t3 <= 0.5 ? e3 - (1 - 2 * t3) * e3 * (1 - e3) : e3 + (2 * t3 - 1) * ((e3 <= 0.25 ? ((16 * e3 - 12) * e3 + 4) * e3 : Math.sqrt(e3)) - e3);
          }
          function I(e3, t3) {
            return Math.abs(e3 - t3);
          }
          function Y(e3, t3) {
            return e3 + t3 - 2 * e3 * t3;
          }
          function G(e3, t3, r2) {
            return Math.min(Math.max(e3 || 0, t3), r2);
          }
          function H(e3) {
            return { r: G(e3.r, 0, 255), g: G(e3.g, 0, 255), b: G(e3.b, 0, 255), a: G(e3.a, 0, 1) };
          }
          function V(e3) {
            return { r: 255 * e3.r, g: 255 * e3.g, b: 255 * e3.b, a: e3.a };
          }
          function q(e3) {
            return { r: e3.r / 255, g: e3.g / 255, b: e3.b / 255, a: e3.a };
          }
          function z(e3, t3) {
            void 0 === t3 && (t3 = 0);
            var r2 = Math.pow(10, t3);
            return { r: Math.round(e3.r * r2) / r2, g: Math.round(e3.g * r2) / r2, b: Math.round(e3.b * r2) / r2, a: e3.a };
          }
          function K(e3, t3, r2, n2, o2, a2) {
            return (1 - t3 / r2) * n2 + t3 / r2 * Math.round((1 - e3) * o2 + e3 * a2);
          }
          function J(e3, t3, r2, n2, o2) {
            void 0 === o2 && (o2 = { unitInput: false, unitOutput: false, roundOutput: true }), o2.unitInput && (e3 = V(e3), t3 = V(t3)), e3 = H(e3);
            var a2 = (t3 = H(t3)).a + e3.a - t3.a * e3.a, i2 = r2(e3, t3, n2), s2 = H({ r: K(e3.a, t3.a, a2, e3.r, t3.r, i2.r), g: K(e3.a, t3.a, a2, e3.g, t3.g, i2.g), b: K(e3.a, t3.a, a2, e3.b, t3.b, i2.b), a: a2 });
            return s2 = o2.unitOutput ? q(s2) : o2.roundOutput ? z(s2) : function(e4) {
              return z(e4, 9);
            }(s2), s2;
          }
          function W(e3, t3, r2) {
            return V(r2(q(e3), q(t3)));
          }
          function Q(e3) {
            return 0.3 * e3.r + 0.59 * e3.g + 0.11 * e3.b;
          }
          function U(e3, t3) {
            var r2 = t3 - Q(e3);
            return function(e4) {
              var t4 = Q(e4), r3 = e4.r, n2 = e4.g, o2 = e4.b, a2 = Math.min(r3, n2, o2), i2 = Math.max(r3, n2, o2);
              function s2(e5) {
                return t4 + (e5 - t4) * t4 / (t4 - a2);
              }
              function l2(e5) {
                return t4 + (e5 - t4) * (1 - t4) / (i2 - t4);
              }
              return a2 < 0 && (r3 = s2(r3), n2 = s2(n2), o2 = s2(o2)), i2 > 1 && (r3 = l2(r3), n2 = l2(n2), o2 = l2(o2)), { r: r3, g: n2, b: o2 };
            }({ r: e3.r + r2, g: e3.g + r2, b: e3.b + r2 });
          }
          function X(e3) {
            return Math.max(e3.r, e3.g, e3.b) - Math.min(e3.r, e3.g, e3.b);
          }
          function Z(e3, t3) {
            var r2 = ["r", "g", "b"].sort(function(t4, r3) {
              return e3[t4] - e3[r3];
            }), n2 = r2[0], o2 = r2[1], a2 = r2[2], i2 = { r: e3.r, g: e3.g, b: e3.b };
            return i2[a2] > i2[n2] ? (i2[o2] = (i2[o2] - i2[n2]) * t3 / (i2[a2] - i2[n2]), i2[a2] = t3) : i2[o2] = i2[a2] = 0, i2[n2] = 0, i2;
          }
          function ee(e3, t3) {
            return U(Z(t3, X(e3)), Q(e3));
          }
          function te(e3, t3) {
            return U(Z(e3, X(t3)), Q(e3));
          }
          function re(e3, t3) {
            return U(t3, Q(e3));
          }
          function ne(e3, t3) {
            return U(e3, Q(t3));
          }
          function oe(e3, t3) {
            return J(e3, t3, S, B);
          }
          function ae(e3, t3) {
            return J(e3, t3, S, P);
          }
          function ie(e3, t3) {
            return J(e3, t3, S, L);
          }
          function se(e3, t3) {
            return J(e3, t3, S, R);
          }
          function le(e3, t3) {
            return J(e3, t3, S, D);
          }
          function ue(e3, t3) {
            return J(e3, t3, S, N);
          }
          function he(e3, t3) {
            return J(e3, t3, S, A);
          }
          function ce(e3, t3) {
            return J(e3, t3, S, F);
          }
          function de(e3, t3) {
            return J(e3, t3, S, j);
          }
          function ge(e3, t3) {
            return J(e3, t3, S, $);
          }
          function fe(e3, t3) {
            return J(e3, t3, S, I);
          }
          function be(e3, t3) {
            return J(e3, t3, S, Y);
          }
          function me(e3, t3) {
            return J(e3, t3, W, ee);
          }
          function pe(e3, t3) {
            return J(e3, t3, W, te);
          }
          function ye(e3, t3) {
            return J(e3, t3, W, re);
          }
          function ve(e3, t3) {
            return J(e3, t3, W, ne);
          }
          const _e = __spreadProps(__spreadValues({}, O), { windowtext: [0, 0, 0], transparent: [255, 255, 255, 0] }), ke = new RegExp(Object.keys(_e).map((e3) => `\\b${e3}\\b`).join("|"), "ig"), we = (e3) => {
            const t3 = e3.object();
            return t3.a = t3.alpha || 1, delete t3.alpha, t3;
          }, Ee = (e3) => (e3.alpha = e3.a, delete e3.a, Ce(e3)), Ce = (e3) => {
            if (!e3) return null;
            let t3 = null;
            try {
              t3 = e3 instanceof M ? e3 : M(e3);
            } catch (t4) {
              console.log(`ignore the invalid color: \`${e3}\`, error: ${t4}`);
            }
            return t3;
          }, xe = (e3, t3 = false) => e3.replace(_, "").replace(ke, (e4) => {
            if (!t3 && "transparent" === e4) return e4;
            const r2 = _e[e4.toLowerCase()];
            return `${r2.length > 3 ? "rgba" : "rgb"}(${r2.toString()})`;
          }), Te = (e3) => {
            const t3 = xe(e3);
            return w.test(t3) ? t3 : "";
          }, Oe = (t3, r2 = "normal") => {
            if ("[object Array]" !== Object.prototype.toString.call(t3)) return null;
            const n2 = t3.filter((e3) => !!e3);
            if (n2.length < 1) return null;
            if (1 === n2.length) return Ce(n2[0]);
            let o2 = Ce(n2.shift() || null), a2 = Ce(n2.shift() || null);
            for (; a2; ) {
              if (!o2 && a2) o2 = a2;
              else if (o2 || a2) o2 && a2 && (o2 = "mix" === r2 ? o2.mix(a2, a2.alpha()) : Ee(e2[r2](we(o2), we(a2))));
              else {
                if (0 === n2.length) break;
                o2 = Ce(n2.shift() || null);
              }
              if (0 === n2.length) break;
              a2 = Ce(n2.shift() || null);
            }
            return o2 || null;
          }, Me = (e3, t3, r2) => {
            const n2 = Ce(e3);
            if (!n2) return null;
            const o2 = n2.rgb().array().slice(0, 3), a2 = "[object Array]" === Object.prototype.toString.call(t3) ? Oe(t3) : Ce(t3);
            if (!a2) return null;
            const i2 = a2.rgb().array().slice(0, 3), s2 = a2.alpha();
            return Ce(`rgba(${o2.map((e4, t4) => Math.round(e4 + s2 * (1 - r2) * (e4 - i2[t4]) / r2)).join(", ")}, ${r2})`);
          }, Se = (e3) => (299 * e3[0] + 587 * e3[1] + 114 * e3[2]) / 1e3, Be = (e3, t3) => {
            const r2 = e3 / (Se(t3) || 1);
            let n2 = Math.min(255, t3[0] * r2), o2 = Math.min(255, t3[1] * r2), a2 = Math.min(255, t3[2] * r2);
            return 0 === o2 || 255 === n2 || 255 === a2 ? o2 = (1e3 * e3 - 299 * n2 - 114 * a2) / 587 : 0 === n2 ? n2 = (1e3 * e3 - 587 * o2 - 114 * a2) / 299 : 0 !== a2 && 255 !== o2 || (a2 = (1e3 * e3 - 299 * n2 - 587 * o2) / 114), M.rgb(n2, o2, a2, t3[3] || 1);
          }, Pe = { begin: null, showFirstPage: null, error: null, mode: "", whitelist: { tagName: ["MPCPS", "IFRAME"], attribute: [] }, needJudgeFirstPage: true, delayBgJudge: false, noEmit: false, container: null, cssSelectorsPrefix: "", defaultLightWebviewColor: "#fff", defaultLightBgColor: "#fff", defaultLightTextColor: "#191919", defaultDarkWebviewColor: "#191919", defaultDarkBgColor: "#191919", defaultDarkTextColor: "rgba(255,255,255,0.6)" }, Le = __spreadProps(__spreadValues({ hasInit: false }, Pe), { set(e3, t3, r2) {
            const n2 = t3[r2];
            switch (e3) {
              case "boolean":
                "boolean" == typeof n2 && (this[r2] = n2);
                break;
              case "string":
                "string" == typeof n2 && "" !== n2 && (this[r2] = n2);
                break;
              case "function":
                "function" == typeof n2 && (this[r2] = n2);
                break;
              case "dom":
                n2 instanceof HTMLElement && (this[r2] = n2);
            }
          }, setDefaultColor(e3) {
            this.set("string", e3, "defaultLightWebviewColor"), this.set("string", e3, "defaultDarkWebviewColor");
            const t3 = Oe([this.defaultLightWebviewColor, e3.defaultLightBgColor || this.defaultLightBgColor]);
            t3 && (this.defaultLightBgColor = t3.hex());
            const r2 = Oe([this.defaultDarkWebviewColor, e3.defaultDarkBgColor || this.defaultDarkBgColor]);
            r2 && (this.defaultDarkBgColor = r2.hex());
            const n2 = Oe([this.defaultLightWebviewColor, this.defaultLightBgColor, e3.defaultLightTextColor || this.defaultLightTextColor]);
            n2 && (this.defaultLightTextColor = n2.hex());
            const o2 = Oe([this.defaultDarkWebviewColor, this.defaultDarkBgColor, e3.defaultDarkTextColor || this.defaultDarkTextColor]);
            o2 && (this.defaultDarkTextColor = o2.hex());
          }, reset() {
            this.hasInit = false, Object.assign(this, Pe);
          } });
          class Re {
          }
          let De, Ne, Ae, Fe, je = function(e3) {
            return e3.BEFORE_CONVERT_NODE = "beforeConvertNode", e3.AFTER_CONVERT_TEXT_COLOR = "afterConvertTextColor", e3.AFTER_CONVERT_NODE = "afterConvertNode", e3.BEFORE_CONVERT_NODE_BY_UPDATE_STYLE = "beforeConvertNodeByUpdateStyle", e3.AFTER_CONVERT_TEXT_COLOR_BY_UPDATE_STYLE = "afterConvertTextColorByUpdateStyle", e3.AFTER_CONVERT_NODE_BY_UPDATE_STYLE = "afterConvertNodeByUpdateStyle", e3;
          }({});
          function $e(e3, t3, r2) {
            return (t3 = function(e4) {
              var t4 = function(e5) {
                if ("object" != typeof e5 || !e5) return e5;
                var t5 = e5[Symbol.toPrimitive];
                if (void 0 !== t5) {
                  var r3 = t5.call(e5, "string");
                  if ("object" != typeof r3) return r3;
                  throw new TypeError("@@toPrimitive must return a primitive value.");
                }
                return String(e5);
              }(e4);
              return "symbol" == typeof t4 ? t4 : t4 + "";
            }(t3)) in e3 ? Object.defineProperty(e3, t3, { value: r2, enumerable: true, configurable: true, writable: true }) : e3[t3] = r2, e3;
          }
          let Ie, Ye, Ge = [], He = [];
          class Ve extends Re {
            constructor() {
              super();
            }
            get loopTimes() {
              return et.loopTimes;
            }
            get isDarkmode() {
              return at.isDarkmode;
            }
            addCss(e3, t3, r2 = true) {
              (r2 ? Ge : He).push(nt.genCss(e3, t3.map(({ key: e4, value: t4 }) => nt.genCssKV(e4, t4)).join("")));
            }
          }
          function qe(e3, t3, r2) {
            return (t3 = function(e4) {
              var t4 = function(e5) {
                if ("object" != typeof e5 || !e5) return e5;
                var t5 = e5[Symbol.toPrimitive];
                if (void 0 !== t5) {
                  var r3 = t5.call(e5, "string");
                  if ("object" != typeof r3) return r3;
                  throw new TypeError("@@toPrimitive must return a primitive value.");
                }
                return String(e5);
              }(e4);
              return "symbol" == typeof t4 ? t4 : t4 + "";
            }(t3)) in e3 ? Object.defineProperty(e3, t3, { value: r2, enumerable: true, configurable: true, writable: true }) : e3[t3] = r2, e3;
          }
          function ze(e3, t3, r2) {
            return (t3 = function(e4) {
              var t4 = function(e5) {
                if ("object" != typeof e5 || !e5) return e5;
                var t5 = e5[Symbol.toPrimitive];
                if (void 0 !== t5) {
                  var r3 = t5.call(e5, "string");
                  if ("object" != typeof r3) return r3;
                  throw new TypeError("@@toPrimitive must return a primitive value.");
                }
                return String(e5);
              }(e4);
              return "symbol" == typeof t4 ? t4 : t4 + "";
            }(t3)) in e3 ? Object.defineProperty(e3, t3, { value: r2, enumerable: true, configurable: true, writable: true }) : e3[t3] = r2, e3;
          }
          function Ke(e3, t3, r2) {
            return (t3 = function(e4) {
              var t4 = function(e5) {
                if ("object" != typeof e5 || !e5) return e5;
                var t5 = e5[Symbol.toPrimitive];
                if (void 0 !== t5) {
                  var r3 = t5.call(e5, "string");
                  if ("object" != typeof r3) return r3;
                  throw new TypeError("@@toPrimitive must return a primitive value.");
                }
                return String(e5);
              }(e4);
              return "symbol" == typeof t4 ? t4 : t4 + "";
            }(t3)) in e3 ? Object.defineProperty(e3, t3, { value: r2, enumerable: true, configurable: true, writable: true }) : e3[t3] = r2, e3;
          }
          De = x.FIRST_PAGE_STYLE, Ne = x.OTHER_PAGE_STYLE, Ae = x.FIRST_PAGE_STYLE_NO_MQ, Fe = x.OTHER_PAGE_STYLE_NO_MQ;
          var Je = function(e3) {
            return e3.FIRST_PAGE_STYLE = "_firstPageStyle", e3.OTHER_PAGE_STYLE = "_otherPageStyle", e3;
          }(Je || {});
          Ie = Je.FIRST_PAGE_STYLE, Ye = Je.OTHER_PAGE_STYLE;
          function We(e3, t3, r2) {
            return (t3 = function(e4) {
              var t4 = function(e5) {
                if ("object" != typeof e5 || !e5) return e5;
                var t5 = e5[Symbol.toPrimitive];
                if (void 0 !== t5) {
                  var r3 = t5.call(e5, "string");
                  if ("object" != typeof r3) return r3;
                  throw new TypeError("@@toPrimitive must return a primitive value.");
                }
                return String(e5);
              }(e4);
              return "symbol" == typeof t4 ? t4 : t4 + "";
            }(t3)) in e3 ? Object.defineProperty(e3, t3, { value: r2, enumerable: true, configurable: true, writable: true }) : e3[t3] = r2, e3;
          }
          function Qe(e3) {
            return [e3].concat(Array.from(e3.querySelectorAll("*")));
          }
          const Ue = { "ue-table-interlace-color-single": "#fcfcfc", "ue-table-interlace-color-double": "#f7faff" };
          function Xe(e3, t3, r2) {
            return (t3 = function(e4) {
              var t4 = function(e5) {
                if ("object" != typeof e5 || !e5) return e5;
                var t5 = e5[Symbol.toPrimitive];
                if (void 0 !== t5) {
                  var r3 = t5.call(e5, "string");
                  if ("object" != typeof r3) return r3;
                  throw new TypeError("@@toPrimitive must return a primitive value.");
                }
                return String(e5);
              }(e4);
              return "symbol" == typeof t4 ? t4 : t4 + "";
            }(t3)) in e3 ? Object.defineProperty(e3, t3, { value: r2, enumerable: true, configurable: true, writable: true }) : e3[t3] = r2, e3;
          }
          const Ze = (e3) => e3.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, ""), et = new class {
            constructor() {
              $e(this, "_plugins", []), $e(this, "length", 0), $e(this, "loopTimes", 0), $e(this, De, ""), $e(this, Ne, ""), $e(this, Ae, ""), $e(this, Fe, "");
            }
            extend(e3) {
              this._plugins.push(new (e3(Ve))()), this.length++;
            }
            emit(e3, ...t3) {
              this._plugins.forEach((r2) => {
                var _a2;
                (_a2 = r2[e3]) == null ? void 0 : _a2.call(r2, ...t3);
              });
            }
            addCss(e3 = false) {
              e3 ? (this[x.FIRST_PAGE_STYLE] += Ge.join(""), this[x.FIRST_PAGE_STYLE_NO_MQ] += He.join("")) : (this[x.OTHER_PAGE_STYLE] += Ge.join(""), this[x.OTHER_PAGE_STYLE_NO_MQ] += He.join(""));
            }
            resetCss() {
              Ge = [], He = [];
            }
            reset() {
              this._plugins = [], this.length = 0, this.loopTimes = 0, this[x.FIRST_PAGE_STYLE] = "", this[x.OTHER_PAGE_STYLE] = "", this[x.FIRST_PAGE_STYLE_NO_MQ] = "", this[x.OTHER_PAGE_STYLE_NO_MQ] = "", this.resetCss();
            }
          }(), tt = new class {
            constructor(e3) {
              qe(this, "_prefix", void 0), qe(this, "_queue", []), qe(this, "_idx", 0), this._prefix = e3;
            }
            push(e3) {
              const t3 = `${this._prefix}${this._idx++}`;
              e3.classList.add(t3), this._queue.push({ el: e3, className: t3, updated: !Le.delayBgJudge });
            }
            forEach(e3) {
              const t3 = [];
              for (this._queue.forEach((r2, n2) => {
                r2.updated && (t3.unshift(n2), e3(r2.el));
              }); t3.length; ) {
                const e4 = t3.shift();
                void 0 !== e4 && this._queue.splice(e4, 1);
              }
            }
            update(e3) {
              this._queue.forEach((t3) => {
                t3.updated || Array.prototype.some.call(e3, (e4) => !(1 !== e4.nodeType || !e4.classList.contains(t3.className) || (t3.el = e4, t3.updated = true, 0)));
              });
            }
            reset() {
              this._queue = [], this._idx = 0;
            }
          }(`${a}text__`), rt = new class {
            constructor(e3) {
              ze(this, "classNameReg", void 0), ze(this, "_prefix", void 0), ze(this, "_stack", []), ze(this, "_idx", 0), this._prefix = e3, this.classNameReg = new RegExp(`${this._prefix}\\d+`);
            }
            push(e3, t3, r2) {
              const n2 = `${this._prefix}${this._idx++}`;
              e3.classList.add(n2), this._stack.unshift({ el: e3, className: n2, cssKV: t3, updated: !Le.delayBgJudge, cb: r2 });
            }
            contains(e3, t3) {
              const r2 = e3.getBoundingClientRect(), n2 = [];
              for (this._stack.forEach((e4, t4) => {
                if (e4.updated) {
                  e4.rect || (e4.rect = e4.el.getBoundingClientRect());
                  const o2 = e4.rect;
                  r2.top >= o2.bottom || r2.bottom <= o2.top || r2.left >= o2.right || r2.right <= o2.left || n2.unshift(t4);
                }
              }); n2.length; ) {
                const e4 = n2.shift();
                void 0 !== e4 && t3(this._stack.splice(e4, 1)[0]);
              }
            }
            update(e3) {
              this._stack.forEach((t3) => {
                t3.updated || Array.prototype.some.call(e3, (e4) => !(1 !== e4.nodeType || !e4.classList.contains(t3.className) || (t3.el = e4, t3.updated = true, 0)));
              });
            }
            reset() {
              this._stack = [], this._idx = 0;
            }
          }(`${a}bg__`), nt = new class {
            constructor() {
              Ke(this, Ie, ""), Ke(this, Ye, ""), Ke(this, "isFinish", false), Ke(this, "_styleIdx", 0);
            }
            genCssKV(e3, t3) {
              return `${e3}: ${t3} !important;`;
            }
            genCss(e3, t3) {
              return `${"dark" === Le.mode ? `html.${l} ` : ""}${Le.cssSelectorsPrefix && `${Le.cssSelectorsPrefix} `}.${e3}{${t3}}`;
            }
            addCss(e3, t3 = false) {
              this[t3 ? Je.FIRST_PAGE_STYLE : Je.OTHER_PAGE_STYLE] += e3, et.addCss(t3);
            }
            writeStyle(e3 = false) {
              !e3 && at.isDarkmode && (this.isFinish = true);
              const t3 = [...at.isDarkmode ? [{ target: this, key: [Je.FIRST_PAGE_STYLE, Je.OTHER_PAGE_STYLE], needMediaQuery: true }] : [], { target: et, key: [x.FIRST_PAGE_STYLE, x.OTHER_PAGE_STYLE], needMediaQuery: true }, { target: et, key: [x.FIRST_PAGE_STYLE_NO_MQ, x.OTHER_PAGE_STYLE_NO_MQ], needMediaQuery: false }].map(({ target: t4, key: [r2, n2], needMediaQuery: a2 }) => {
                let i2 = "";
                return e3 ? (i2 = t4[r2], t4[r2] = "") : (i2 = t4[n2] = t4[r2] + t4[n2], t4[r2] = "", t4[n2] = ""), i2 ? "dark" !== Le.mode && a2 ? `@media ${o} {${i2}}` : i2 : "";
              }).join("");
              t3 && !Le.noEmit && document.head.insertAdjacentHTML("beforeend", `<style id="${s}_${this._styleIdx++}" type="text/css">${t3}</style>`);
            }
            reset() {
              var _a2;
              for (let e3 = 0; e3 < this._styleIdx; e3++) {
                const t3 = document.getElementById(`${s}_${e3}`);
                (_a2 = t3 == null ? void 0 : t3.parentNode) == null ? void 0 : _a2.removeChild(t3);
              }
              this.isFinish = false, this._styleIdx = 0;
            }
          }(), ot = new class {
            constructor() {
              We(this, "_els", []), We(this, "_firstPageEls", []), We(this, "_delayEls", []), We(this, "showFirstPage", false);
            }
            get length() {
              return this._els.length;
            }
            set(e3 = []) {
              this._els = e3;
            }
            get() {
              let e3 = [];
              return this._els.length ? (e3 = this._els, at.isDarkmode && (this._els = [])) : this._delayEls.length ? (e3 = this._delayEls, this._delayEls = []) : Le.container && (e3 = Array.from(Le.container.querySelectorAll("*"))), e3;
            }
            delay() {
              Array.prototype.forEach.call(this._els, (e3) => this._delayEls.push(e3)), this._els = [];
            }
            hasDelay() {
              return !this._els.length && (this._delayEls.length > 0 || null !== Le.container);
            }
            addFirstPageNode(e3) {
              this._firstPageEls.push(e3);
            }
            showFirstPageNodes() {
              this._firstPageEls.forEach((e3) => !e3.style.visibility && (e3.style.visibility = "visible")), this.showFirstPage = true;
            }
            emptyFirstPageNodes() {
              this._firstPageEls = [];
            }
            reset() {
              this._els = [], this._firstPageEls = [], this._delayEls = [], this.showFirstPage = false;
            }
          }(), at = new class {
            constructor() {
              Xe(this, "_idx", 0), Xe(this, "_defaultDarkTextColorRgb", [0, 0, 0, 0]), Xe(this, "_defaultDarkBgColorRgb", [0, 0, 0, 0]), Xe(this, "_defaultDarkBgColorHSL", []), Xe(this, "_defaultDarkTextColorBrightness", 0), Xe(this, "_defaultDarkBgColorBrightness", 0), Xe(this, "_defaultDarkBgColorHslBrightness", 0), Xe(this, "_maxLimitOffsetBrightness", 0), Xe(this, "isDarkmode", false);
            }
            _adjustBrightness(e3, t3, r2, n2 = false) {
              let o2 = null, a2 = "";
              if (r2.isBgColor) {
                if (e3.alpha() >= 0.05 && t3[g] && Qe(t3).forEach((e4) => {
                  delete e4[g];
                }), t3[b]) {
                  if (t3[b] === e3.toString() || this.getContrast(t3[b], e3.toString()) < 1.1) return { newColor: null, extStyle: a2 };
                  Qe(t3).forEach((e4) => {
                    delete e4[b];
                  });
                }
                const i2 = t3[h] || Le.defaultDarkBgColor;
                if (o2 = this._adjustBackgroundBrightness(e3, i2), !r2.hasInlineColor) {
                  const r3 = Oe([i2, o2 || e3]), s2 = Ce(t3[c] || Le.defaultLightTextColor);
                  if (s2) {
                    const e4 = this._adjustBrightness(s2, t3, { isBgColor: false, isTextShadow: false, isTextColor: true, isBorderColor: false, hasInlineColor: true, parentElementBgColor: r3 }, n2);
                    e4.newColor ? a2 += nt.genCssKV("color", e4.newColor.toString()) : a2 += nt.genCssKV("color", s2.toString()), Qe(t3).forEach((t4) => {
                      t4[u] = Oe([r3, e4.newColor || s2]), t4[c] = s2;
                    });
                  }
                }
              } else if (r2.isTextColor || r2.isBorderColor) {
                const a3 = Ce(r2.parentElementBgColor || r2.isTextColor && t3[h] || Le.defaultDarkBgColor);
                a3 && !t3[g] && (o2 = this._adjustTextBrightness(e3, a3), et.emit(n2 ? je.AFTER_CONVERT_TEXT_COLOR_BY_UPDATE_STYLE : je.AFTER_CONVERT_TEXT_COLOR, t3, { fontColor: o2, bgColor: a3 }));
              } else r2.isTextShadow && (t3[g] || (o2 = this._adjustBackgroundBrightness(e3, t3[h] || Le.defaultDarkBgColor)));
              return { newColor: o2 && e3.toString() !== o2.toString() ? o2.rgb() : null, extStyle: a2 };
            }
            _adjustTextBrightness(e3, t3, r2) {
              const n2 = (r2 == null ? void 0 : r2.alpha) || e3.alpha(), o2 = r2 ? e3 : Oe([t3, e3]);
              if (null === o2) return null;
              const a2 = o2.rgb().array(), i2 = o2.hsl().array(), s2 = Se(a2), l2 = (r2 == null ? void 0 : r2.bgColorPerceivedBrightness) || Se(t3.rgb().array()), u2 = Math.abs(l2 - s2);
              return s2 >= 250 ? r2 ? Me(e3, t3, n2) : e3 : u2 > this._maxLimitOffsetBrightness && l2 <= this._defaultDarkBgColorBrightness + 2 ? Me(Be(this._maxLimitOffsetBrightness + l2, a2), t3, n2) : u2 >= 65 ? r2 ? Me(e3, t3, n2) : e3 : l2 >= 100 ? i2[2] > 50 ? (i2[2] = 90 - i2[2], this._adjustTextBrightness(M.hsl(...i2), t3, { alpha: n2, bgColorPerceivedBrightness: l2 })) : Me(Be(Math.min(this._maxLimitOffsetBrightness, l2 - 65), a2), t3, n2) : i2[2] <= 40 ? (i2[2] = 90 - i2[2], this._adjustTextBrightness(M.hsl(...i2), t3, { alpha: n2, bgColorPerceivedBrightness: l2 })) : Me(Be(Math.min(this._maxLimitOffsetBrightness, l2 + 65), a2), t3, n2);
            }
            _adjustBackgroundBrightness(e3, t3) {
              const r2 = Oe([t3, e3]);
              if (null === r2) return null;
              const n2 = r2.rgb().array(), o2 = r2.hsl().array(), a2 = Se(n2);
              let i2 = r2;
              return 0 === o2[1] && o2[2] > 40 || a2 > 250 ? i2 = M.hsl(0, 0, Math.min(100, 100 + this._defaultDarkBgColorHslBrightness - o2[2]), o2[3] || 1) : a2 > 190 ? i2 = Be(190, n2) : o2[2] < 22 && (o2[2] = 22, i2 = M.hsl(...o2)), Me(i2, t3, e3.alpha());
            }
            _updateBgWithGradient(e3, t3, r2, n2, o2 = false) {
              const a2 = Oe([t3[h] || Le.defaultDarkBgColor, e3]), i2 = Oe([t3[d] || Le.defaultLightBgColor, e3]);
              Qe(t3).forEach((e4) => {
                e4[h] = a2, e4[d] = i2;
              });
              const s2 = n2.slice(-1)[0];
              let l2 = null, g2 = p.TEXT_COLOR.indexOf(s2[0]) >= 5;
              if (g2 ? l2 = Ce(xe(s2[1])) : "FONT" === t3.nodeName ? this._try(() => {
                const e4 = t3.getAttribute("color");
                if (e4) {
                  const t4 = Ce(e4);
                  t4 && (l2 = t4, g2 = true);
                }
              }) : l2 = Ce(t3[c] || Le.defaultLightTextColor), null === l2) return "";
              const f2 = this._adjustBrightness(l2, t3, { isBgColor: false, isTextShadow: false, isTextColor: true, isBorderColor: false, hasInlineColor: g2 }, o2), b2 = Oe([a2, f2.newColor || l2]), m2 = l2;
              return Qe(t3).forEach((e4) => {
                e4[u] = b2, e4[c] = m2;
              }), f2.newColor ? nt.genCss(r2, nt.genCssKV(s2[0], f2.newColor.toString())) : "";
            }
            _try(e3) {
              var _a2;
              try {
                return e3();
              } catch (e4) {
                console.log("An error occurred when running the dark mode conversion algorithm\n", e4), (_a2 = Le.error) == null ? void 0 : _a2.call(Le, e4);
              }
            }
            init() {
              const e3 = Ce(Le.defaultDarkTextColor);
              e3 && (this._defaultDarkTextColorRgb = e3.rgb().array());
              const t3 = Ce(Le.defaultDarkBgColor);
              t3 && (this._defaultDarkBgColorRgb = t3.rgb().array(), this._defaultDarkBgColorHSL = t3.hsl().array()), this._defaultDarkTextColorBrightness = Se(this._defaultDarkTextColorRgb), this._defaultDarkBgColorBrightness = Se(this._defaultDarkBgColorRgb), this._defaultDarkBgColorHslBrightness = this._defaultDarkBgColorHSL[2], this._maxLimitOffsetBrightness = Math.max(this._defaultDarkTextColorBrightness - this._defaultDarkBgColorBrightness, 0);
            }
            convert(e3, t3 = [], r2 = false) {
              et.resetCss(), et.emit(r2 ? je.BEFORE_CONVERT_NODE_BY_UPDATE_STYLE : je.BEFORE_CONVERT_NODE, e3);
              let n2 = "", o2 = "";
              if (this.isDarkmode || r2) {
                const s2 = e3.nodeName;
                if (Le.whitelist.tagName.indexOf(s2) > -1) return "";
                if (Le.whitelist.attribute.some((t4) => e3.hasAttribute(t4))) return "";
                const l2 = e3.style;
                0 === t3.length && (t3 = (l2.cssText && l2.cssText.replace(/("[^;]*);([^;]*")|('[^;]*);([^;]*')/g, "$1$3<$#_SEMICOLON_#$>$2$4").split(";") || []).map((e4) => {
                  const t4 = e4.indexOf(":");
                  return [Ze(e4.slice(0, t4).toLowerCase() || ""), Ze(e4.slice(t4 + 1).replace(k, ";") || "")];
                }));
                let m2 = false, x2 = false, T2 = false, O2 = "", M2 = "";
                t3 = t3.filter(([e4, t4]) => ("color" === e4 ? m2 = true : /background/i.test(e4) && (x2 = true, "background-position" === e4 ? O2 = t4 : "background-size" === e4 && (M2 = t4)), (/background/i.test(e4) || /^(-webkit-)?border-image/.test(e4)) && C.test(t4) && (T2 = true), y.indexOf(e4) > -1)).sort(([e4], [t4]) => "color" === e4 || "background-image" === e4 && "background-color" === t4 || 0 === t4.indexOf("-webkit-text") ? 1 : -1), v.indexOf(s2) > -1 && !x2 && this._try(() => {
                  let r3 = function(e4) {
                    let t4 = null;
                    return Array.prototype.some.call(e4.classList, (e5) => !!Ue.hasOwnProperty(e5) && (t4 = Ue[e5], true)), t4;
                  }(e3);
                  if (r3 || (r3 = e3.getAttribute("bgcolor")), r3) {
                    const e4 = Ce(r3);
                    e4 && (t3.unshift(["background-color", e4.toString()]), x2 = true);
                  }
                }), "FONT" !== s2 || m2 || this._try(() => {
                  const r3 = e3.getAttribute("color");
                  if (r3) {
                    const e4 = Ce(r3);
                    e4 && (t3.push(["color", e4.toString()]), m2 = true);
                  }
                });
                let S2 = "", B2 = "", P2 = 0;
                t3.some(([e4, t4], r3) => this._try(() => {
                  if (0 !== e4.indexOf("-webkit-text")) return P2 = r3, true;
                  switch (e4) {
                    case "-webkit-text-fill-color":
                      S2 = Te(t4);
                      break;
                    case "-webkit-text-stroke": {
                      const e5 = t4.split(" ");
                      2 === e5.length && (B2 = Te(e5[1]));
                      break;
                    }
                    case "-webkit-text-stroke-color":
                      B2 = Te(t4);
                  }
                  return false;
                })), S2 && (m2 ? t3[t3.length - 1] = ["-webkit-text-fill-color", S2] : (t3.push(["-webkit-text-fill-color", S2]), m2 = true)), P2 && (t3.splice(0, P2), B2 && t3.unshift(["-webkit-text-stroke-color", B2]));
                let L2 = "", R2 = "";
                if (r2 && e3.className && "string" == typeof e3.className) {
                  let t4 = e3.className.match(i);
                  t4 && (L2 = t4[0]), t4 = e3.className.match(rt.classNameReg), t4 && (R2 = t4[0]);
                }
                let D2 = "";
                t3.forEach(([a2, i2]) => this._try(() => {
                  const s3 = i2;
                  let y2 = false;
                  const v2 = p.BG_COLOR.indexOf(a2) > -1, k2 = p.TEXT_SHADOW.indexOf(a2) > -1, S3 = p.TEXT_COLOR.indexOf(a2), B3 = p.BORDER_COLOR.indexOf(a2) > -1, P3 = /gradient/.test(i2), L3 = [];
                  let N2 = "", A2 = null;
                  if (i2 = xe(i2, P3), w.test(i2)) {
                    if (P3) {
                      let e4 = E.exec(i2);
                      for (; e4; ) L3.push(e4[0]), e4 = E.exec(i2);
                      A2 = Oe(L3, "mix");
                    }
                    let t4 = 0;
                    i2 = i2.replace(E, (n3) => {
                      let o3 = null;
                      if (P3 ? (o3 = A2, y2 = true) : o3 = Ce(n3), o3 && o3.alpha() >= 0.05) {
                        const n4 = this._adjustBrightness(o3, e3, { isBgColor: v2, isTextShadow: k2, isTextColor: S3 > -1, isBorderColor: B3, hasInlineColor: m2 }, r2), a3 = !T2 && n4.newColor;
                        if (N2 += n4.extStyle, (v2 || S3 >= 5) && 0 === t4) {
                          const t5 = Oe([e3[h] || Le.defaultDarkBgColor, a3 || o3]), r3 = v2 ? Oe([e3[d] || Le.defaultLightBgColor, o3]) : o3;
                          Qe(e3).forEach((e4) => {
                            v2 ? (e4[h] = t5, e4[d] = r3) : (e4[u] = t5, e4[c] = r3);
                          });
                        }
                        return a3 && (y2 = true), t4++, (a3 || o3).toString();
                      }
                      return P3 ? null === A2 ? n3 : A2.toString() : n3;
                    }).replace(/\s?!\s?important/gi, "");
                  }
                  if (N2 && (D2 += N2), !(e3 instanceof SVGElement)) {
                    const t4 = /^background/.test(a2), r3 = /^(-webkit-)?border-image/.test(a2);
                    if ((t4 || r3) && C.test(i2)) {
                      y2 = true;
                      const r4 = e3[d] || Le.defaultLightBgColor;
                      if (/^(.*?)url\(([^)]*)\)(.*)$/i.test(i2)) {
                        let n3 = "";
                        !e3[g] && Qe(e3).forEach((e4) => {
                          e4[g] = true;
                        }), t4 ? (n3 = nt.genCssKV(a2, `${i2},linear-gradient(${r4}, ${r4})`), O2 && (D2 += nt.genCssKV("background-position", O2), n3 += nt.genCssKV("background-position", `${O2},top left`)), M2 && (D2 += nt.genCssKV("background-size", M2), n3 += nt.genCssKV("background-size", `${M2},100%`)), R2 ? (o2 += nt.genCss(R2, n3), Qe(e3).forEach((e4) => {
                          e4[b] = r4;
                        })) : rt.push(e3, n3, () => {
                          Qe(e3).forEach((e4) => {
                            e4[b] = r4;
                          });
                        })) : r4 && !x2 && (n3 = nt.genCssKV("background-image", `linear-gradient(${r4}, ${r4})`), R2 ? o2 += nt.genCss(R2, n3) : rt.push(e3, n3));
                      }
                      if (!m2) {
                        const t5 = e3[c] || Le.defaultLightTextColor;
                        D2 += nt.genCssKV("color", t5), Qe(e3).forEach((e4) => {
                          e4[u] = t5;
                        });
                      }
                    }
                  }
                  y2 && (!r2 && _.test(s3) && (l2[a2] = s3.replace(_, "")), P3 ? R2 ? (o2 += nt.genCss(R2, nt.genCssKV(a2, i2)), A2 && /^background/.test(a2) && !C.test(i2) && (n2 += this._updateBgWithGradient(A2, e3, R2, t3, r2))) : rt.push(e3, nt.genCssKV(a2, i2), (o3) => {
                    A2 && /^background/.test(a2) && !C.test(i2) && (n2 += this._updateBgWithGradient(A2, e3, o3.className, t3, r2), e3[f] = A2);
                  }) : D2 += nt.genCssKV(a2, i2));
                })), D2 && (L2 || (L2 = `${a}${this._idx++}`, e3.classList.add(L2)), n2 += D2 ? nt.genCss(L2, D2) : ""), n2 += o2, !r2 && function(e4) {
                  return e4.textContent.replace(/\s/g, "").length > 0;
                }(e3) && (Le.delayBgJudge ? tt.push(e3) : rt.contains(e3, (e4) => {
                  var _a2;
                  n2 += nt.genCss(e4.className, e4.cssKV), (_a2 = e4.cb) == null ? void 0 : _a2.call(e4, e4);
                }));
              }
              return et.emit(r2 ? je.AFTER_CONVERT_NODE_BY_UPDATE_STYLE : je.AFTER_CONVERT_NODE, e3), n2;
            }
            getContrast(e3, t3) {
              const r2 = Ce(e3), n2 = Ce(t3);
              return r2 && n2 ? r2.contrast(n2) : 0;
            }
            reset() {
              this._idx = 0, this._defaultDarkTextColorRgb = [0, 0, 0, 0], this._defaultDarkBgColorRgb = [0, 0, 0, 0], this._defaultDarkBgColorHSL = [], this._defaultDarkTextColorBrightness = 0, this._defaultDarkBgColorBrightness = 0, this._defaultDarkBgColorHslBrightness = 0, this._maxLimitOffsetBrightness = 0, this.isDarkmode = false;
            }
          }(), it = new RegExp(`${a}[^ ]+`, "g");
          let st = null;
          const lt = (e3, t3 = { type: "dom" }) => {
            var _a2, _b, _c;
            if (t3.force && (nt.isFinish = false), !nt.isFinish) try {
              if (Le.mode) at.isDarkmode = "dark" === Le.mode;
              else {
                if (!e3) return;
                at.isDarkmode = e3.matches;
              }
              "dom" === t3.type ? (at.isDarkmode && ((_a2 = Le.begin) == null ? void 0 : _a2.call(Le, ot.hasDelay())), Array.prototype.forEach.call(ot.get(), (e4) => {
                var _a3;
                if (at.isDarkmode && e4.className && "string" == typeof e4.className && (e4.className = e4.className.replace(it, "")), at.isDarkmode || et.length) if (Le.needJudgeFirstPage) {
                  const t4 = e4.getBoundingClientRect(), r2 = t4.top, n2 = t4.bottom;
                  r2 <= 0 && n2 <= 0 ? nt.addCss(at.convert(e4)) : r2 > 0 && r2 < m || n2 > 0 && n2 < m ? (ot.addFirstPageNode(e4), nt.addCss(at.convert(e4), true)) : (Le.needJudgeFirstPage = false, nt.writeStyle(true), ot.showFirstPageNodes(), (_a3 = Le.showFirstPage) == null ? void 0 : _a3.call(Le), nt.addCss(at.convert(e4)));
                } else nt.addCss(at.convert(e4));
              }), et.loopTimes++) : "bg" === t3.type && at.isDarkmode && tt.forEach((e4) => rt.contains(e4, (e5) => {
                nt.addCss(nt.genCss(e5.className, e5.cssKV));
              })), (Le.needJudgeFirstPage || !Le.needJudgeFirstPage && !ot.showFirstPage) && ((_b = Le.showFirstPage) == null ? void 0 : _b.call(Le)), nt.writeStyle(), ot.emptyFirstPageNodes(), at.isDarkmode || (Le.needJudgeFirstPage = false, Le.delayBgJudge = false, null === Le.container && "dom" === t3.type && ot.length && ot.delay());
            } catch (e4) {
              console.log("An error occurred when running the dark mode conversion algorithm\n", e4), (_c = Le.error) == null ? void 0 : _c.call(Le, e4);
            }
          };
          function ut(e3, t3 = {}) {
            ht(t3), ot.set(e3), lt(st, { force: true, type: "dom" });
          }
          function ht(e3 = {}) {
            if (Le.hasInit) return void console.log("Dark Mode can only be initialized once");
            Le.hasInit = true;
            const t3 = Le.whitelist.tagName, r2 = Le.whitelist.attribute;
            e3.whitelist && (e3.whitelist.tagName instanceof Array && e3.whitelist.tagName.forEach((e4) => {
              e4 = e4.toUpperCase(), -1 === t3.indexOf(e4) && t3.push(e4);
            }), e3.whitelist.attribute instanceof Array && e3.whitelist.attribute.forEach((e4) => {
              -1 === r2.indexOf(e4) && r2.push(e4);
            })), e3.mode && ["dark", "light"].indexOf(e3.mode) > -1 && (Le.set("string", e3, "mode"), "dark" === e3.mode && document.getElementsByTagName("html")[0].classList.add(l)), Le.set("function", e3, "begin"), Le.set("function", e3, "showFirstPage"), Le.set("function", e3, "error"), Le.set("boolean", e3, "needJudgeFirstPage"), Le.set("boolean", e3, "delayBgJudge"), Le.set("boolean", e3, "noEmit"), Le.set("dom", e3, "container"), Le.set("string", e3, "cssSelectorsPrefix"), Le.setDefaultColor(e3), at.init(), Le.mode || st || !window.matchMedia || (st = window.matchMedia(o), st.addListener(lt));
          }
          function ct(e3) {
            ot.set(e3), null !== Le.container && (rt.update(e3), tt.update(e3)), lt(st, { force: true, type: "bg" });
          }
          function dt(e3, t3) {
            nt.isFinish && (nt.addCss(at.convert(e3, t3 ? Object.keys(t3).map((e4) => [e4, t3[e4]]) : void 0, true)), nt.writeStyle());
          }
          function gt(e3, t3) {
            return at.getContrast(e3, t3);
          }
          function ft(e3) {
            e3.forEach((e4) => et.extend(e4));
          }
          function bt(e3) {
            Le.reset(), et.reset(), tt.reset(), rt.reset(), nt.reset(), ot.reset(), at.reset(), document.getElementsByTagName("html")[0].classList.remove(l), st && (st.removeListener(lt), st = null), e3 == null ? void 0 : e3.forEach((e4) => {
              delete e4[u], delete e4[h], delete e4[c], delete e4[d], delete e4[g], delete e4[f], delete e4[b];
            });
          }
          function mt(e3, t3, r2) {
            return function(e4, t4, r3) {
              const n2 = document.createTreeWalker(e4, NodeFilter.SHOW_ELEMENT, (e5) => e5 instanceof HTMLElement ? "none" === e5.style.display || C.test(e5.style.backgroundImage || "") || C.test(e5.style.webkitBorderImage || e5.style.borderImage || "") || e5 instanceof SVGElement ? NodeFilter.FILTER_REJECT : (r3 == null ? void 0 : r3(e5)) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT), o2 = [];
              for (; n2.nextNode(); ) {
                const e5 = n2.currentNode;
                if (e5 instanceof HTMLElement) {
                  const r4 = (e5.dataset.ignoreDm || "").split(/\s+/);
                  !r4.includes(T.LOW_CONTRAST) && Array.prototype.some.call(e5.childNodes, (e6) => 3 === e6.nodeType && e6.nodeValue.replace(/\s/g, "").length) && at.getContrast(e5[u] || Le.defaultDarkTextColor, e5[h] || Le.defaultDarkBgColor) < (t4.minContrast || 1.5) && o2.push({ dom: e5, key: "darkmode-low-contrast", violateRules: "\u6587\u5B57\u4E0E\u80CC\u666F\u8272\u5BF9\u6BD4\u5EA6\u592A\u4F4E\uFF08\u53C2\u8003\u6587\u6863#1.1\u4F7F\u7528\u5BF9\u6BD4\u5EA6\u9002\u4E2D\u7684\u989C\u8272\uFF09" }), !r4.includes(T.TEXT_BG_GRADIENT) && e5[f] && o2.push({ dom: e5, key: "darkmode-no-gradient", violateRules: "\u6587\u5B57\u80CC\u666F\u5C3D\u91CF\u4E0D\u8981\u4F7F\u7528\u6E10\u53D8\uFF08\u53C2\u8003\u6587\u6863#1.2\u5982\u975E\u5FC5\u8981\uFF0C\u6587\u5B57\u80CC\u666F\u5C3D\u91CF\u4E0D\u8981\u4F7F\u7528\u6E10\u53D8\uFF09" }), Le.whitelist.attribute.some((t5) => e5.hasAttribute(t5)) && o2.push({ dom: e5, key: "darkmode-whitelist", violateRules: "\u6CE8\u610F\uFF0C\u6B64\u5904\u5305\u542B\u767D\u540D\u5355\u5C5E\u6027\uFF0C\u4F1A\u8DF3\u8FC7darkmode\u7B97\u6CD5\u8F6C\u6362\uFF08\u53C2\u8003\u6587\u6863#5.1 \u6307\u5B9A\u8282\u70B9\u8DF3\u8FC7\u7B97\u6CD5\u8F6C\u6362\uFF09" });
                }
              }
              return o2;
            }(e3, t3, r2);
          }
        })(), n;
      })());
    }
  });

  // engine/index.ts
  var engine_exports = {};
  __export(engine_exports, {
    verifyArticleStructure: () => verifyArticleStructure
  });

  // engine/paragraph.ts
  var blockEleTagName = ["P", "DIV", "SECTION", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "WX-VIEW"];
  var canNotSplitEleClassName = ["js_product_container", "js_blockquote_wrap"];
  var canNotSplitEleTagName = ["BLOCKQUOTE"];
  var selfTagName = ["HR", "IMG"];
  var noRenderEleTagName = ["STYLE", "SCRIPT", "META", "LINK", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE"];
  function childNodesHasBlockEle(element, opts) {
    if (!element || element.nodeType !== 1) return false;
    for (let i = 0, len = element.children.length; i < len; i++) {
      if (blockEleTagName.indexOf(element.children[i].tagName) !== -1 || opts.getSpan && element.children[i].tagName === "SPAN" && (childNodesHasBlockEle(element.children[i], opts) || element.children[i].querySelector("br") !== null)) {
        return true;
      }
    }
    return false;
  }
  function isNotSplitEle(ele, opts) {
    for (let i = 0; i < canNotSplitEleClassName.length; i++) {
      if (ele.className.indexOf(canNotSplitEleClassName[i]) > -1) return true;
    }
    if (opts.ignoreFlexChildren && ele.style.display === "flex" && (ele.style.flexDirection === "row" || ele.style.flexDirection === "row-reverse") && ele.children.length > 1 || opts.ignoreNotWriteableChildren && (ele.getAttribute("contenteditable") === "false" || ele.childNodes.length === 1 && ele.childNodes[0].getAttribute("contenteditable") === "false")) {
      return true;
    }
    return canNotSplitEleTagName.indexOf(ele.tagName) > -1;
  }
  function getParaList(element, opts, isRoot = true) {
    const children = element.children;
    if (!children.length) return children;
    let child;
    let paragraphList = [];
    for (let i = 0; i < children.length; i++) {
      child = children[i];
      child.isWrapper = void 0;
      if (noRenderEleTagName.indexOf(child.tagName) !== -1) continue;
      if (opts && opts.isMarkNode && opts.isMarkNode(child)) continue;
      if (childNodesHasBlockEle(child, opts) && !isNotSplitEle(child, opts)) {
        paragraphList = paragraphList.concat(getParaList(child, opts, false));
        if (opts.getNestedStructure && child.tagName !== "SPAN") {
          child.isWrapper = true;
          paragraphList.push(child);
        }
      } else if (opts.getSpan && child.querySelector("br") !== null) {
        let pushed = false;
        Array.prototype.forEach.call(child.querySelectorAll("br"), (br) => {
          let currentNode = br;
          let parentNode = br.parentNode;
          while (parentNode.tagName === "SPAN" && currentNode === parentNode.lastChild) {
            currentNode = parentNode;
            parentNode = parentNode.parentNode;
          }
          if (parentNode.tagName === "SPAN" || parentNode.tagName !== "SPAN" && currentNode !== parentNode.lastChild) {
            paragraphList.push(br);
            pushed = true;
          }
        });
        if (child.tagName !== "SPAN") {
          if (pushed === false) {
            paragraphList.push(child);
          } else if (opts.getNestedStructure) {
            child.isWrapper = true;
            paragraphList.push(child);
          }
        }
      } else if (!opts.getSpan || opts.getSpan && child.tagName !== "SPAN" && selfTagName.indexOf(child.tagName) === -1) {
        paragraphList.push(child);
      }
    }
    if (isRoot) {
      let needExecBr = true;
      for (let i = paragraphList.length - 1, c = paragraphList[i]; i >= 0; i--, c = paragraphList[i]) {
        if (c && c.isWrapper) {
          needExecBr = true;
        } else if (c && needExecBr && c.tagName === "BR") {
          needExecBr = false;
          while (c && !c.isWrapper) {
            if (c.nextElementSibling !== null) {
              paragraphList.splice(i + 1, 0, c.nextElementSibling);
              break;
            } else {
              c = c.parentNode;
            }
          }
        }
      }
    }
    return paragraphList;
  }
  getParaList.paragraphStartIdx = 1e6;
  var paragraph_default = getParaList;

  // engine/dom.ts
  var bookmarkPrefix = "_baidu_bookmark_";
  var checktextTagName = "mpchecktext";
  var checktextTmpTagName = "mptmpchecktext";
  var payFilterTagName = "mp-pay-preview-filter";
  function isMarkNode(node) {
    if (!node || !node.tagName) return false;
    const tagName = node.tagName.toLowerCase();
    if (tagName === checktextTagName || tagName === checktextTmpTagName || tagName === payFilterTagName) {
      return true;
    }
    if (node.nodeType === 1 && node.id && new RegExp("^" + bookmarkPrefix, "i").test(node.id)) {
      return true;
    }
    return false;
  }
  var specialTags = /iframe|video|audio|cps|mp|img|animateTransform|hr|path|br|svg|^g$|^a$/i;
  var domUtils = { isMarkNode, specialTags };
  function isEmptyParagraph(element) {
    const html = element.innerHTML.trim();
    return html === "" || /^(\s*<br[^>]*?\s*\/?>\s*)*$/i.test(html) || /^\s*$/.test(html) || /^<span[^>]*\bleaf\b[^>]*>\s*(<br[^>]*>)?\s*<\/span>$/i.test(html);
  }

  // engine/nest.ts
  var getElementChildren = (node) => {
    if (!node || !node.children) return [];
    const children = node.children;
    if (typeof children.item === "function") return children;
    return children.filter((c) => !!c.tagName);
  };
  var hasOtherSignificantContent = (node, excludeChild) => {
    if (!node) return false;
    if (node.childNodes && typeof node.childNodes.item === "function") {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child === excludeChild) continue;
        if (child.nodeType === 3 && child.textContent && child.textContent.trim()) return true;
        if (child.nodeType === 1) return true;
      }
      return false;
    }
    if (node.children && Array.isArray(node.children)) {
      for (let j = 0; j < node.children.length; j++) {
        const c = node.children[j];
        if (c === excludeChild) continue;
        if (!c.tagName && c.data && c.data.trim()) return true;
        if (c.tagName) return true;
      }
      return false;
    }
    return false;
  };
  function deleteNestNode({ root, isNeedDelete = false, isTest = false }) {
    const MAX_STYLE_LEVEL = 15;
    const hasNestedNode = [];
    const willBeDeletedNodes = [];
    const willBeDeletedSet = /* @__PURE__ */ new Set();
    const pushWillBeDeleted = (node) => {
      if (!node || willBeDeletedSet.has(node)) return false;
      willBeDeletedSet.add(node);
      willBeDeletedNodes.push(node);
      return true;
    };
    const getTag = (node) => (node && node.tagName || "").toLowerCase();
    const getStyle = (node) => {
      if (!node) return "";
      if (node.attrs && typeof node.attrs.style === "string") return node.attrs.style;
      if (typeof node.getAttribute === "function") return node.getAttribute("style") || "";
      return "";
    };
    const depth1 = (node) => {
      if (node === null) return;
      if (node.children) {
        node.level = node.parentNode && node.parentNode.level ? node.parentNode.level + 1 : 1;
        if (node.attrs) node.attrs["data-nest-level"] = String(node.level);
        if (typeof node.setAttribute === "function") node.setAttribute("data-nest-level", String(node.level));
        if (node.level >= MAX_STYLE_LEVEL) {
          hasNestedNode.push(node);
          return;
        }
      }
      const children = getElementChildren(node);
      for (let i = 0; i < children.length; i++) depth1(children[i]);
    };
    root.level = 0;
    depth1(root);
    if (hasNestedNode.length > 0 && (isNeedDelete || isTest)) {
      hasNestedNode.forEach((item) => {
        let deleteLevel = MAX_STYLE_LEVEL - 2;
        let currentNode = item;
        let tagList = [];
        let styleDetailList = [];
        let parentStyleDetailList = [];
        const parentHasTag = (tagName) => {
          let result = true;
          if (!tagList.includes(tagName)) {
            tagList.push(tagName);
            result = false;
          }
          return result;
        };
        const parentHasStyle = (str = "", isParentNode = false) => {
          const allStyle = str.split(";");
          let result = true;
          if (isParentNode) {
            allStyle.forEach((s) => {
              if (!parentStyleDetailList.includes(s)) {
                result = false;
                parentStyleDetailList.push(s);
              }
            });
          } else {
            allStyle.forEach((s) => {
              if (!styleDetailList.includes(s) && !parentStyleDetailList.includes(s)) {
                result = false;
                styleDetailList.push(s);
              }
            });
          }
          return result;
        };
        while (deleteLevel) {
          const grandParent = currentNode.parentNode && currentNode.parentNode.parentNode;
          const gpChildren = grandParent ? getElementChildren(grandParent) : [];
          const gpChildrenLen = gpChildren.length;
          if (currentNode.parentNode && grandParent && gpChildrenLen === 1) {
            const nodeTagName = getTag(currentNode.parentNode);
            const nodeStyle = getStyle(currentNode.parentNode);
            if (!parentHasTag(nodeTagName) || parentHasTag(nodeTagName) && !parentHasStyle(nodeStyle, true)) {
              currentNode = currentNode.parentNode;
            } else {
              if (!domUtils.specialTags.test(nodeTagName)) {
                if (!isTest) {
                  const deletedNode = currentNode.parentNode;
                  if (hasOtherSignificantContent(deletedNode, currentNode)) {
                    currentNode = currentNode.parentNode;
                    deleteLevel -= 1;
                    continue;
                  }
                  const grandParentNode = currentNode.parentNode.parentNode;
                  if (grandParentNode.replaceChild) {
                    grandParentNode.replaceChild(currentNode, deletedNode);
                  } else {
                    currentNode.parentNode = grandParentNode;
                    grandParentNode.children[grandParentNode.children.indexOf(deletedNode)] = currentNode;
                  }
                } else {
                  pushWillBeDeleted(currentNode.parentNode);
                  return;
                }
              }
            }
          }
          deleteLevel -= 1;
        }
        currentNode = item;
        const stack = [currentNode];
        while (stack.length) {
          const downNode = stack.pop();
          if (downNode.isNeedEmpty) {
            tagList = [];
            styleDetailList = [];
          }
          const downChildren = getElementChildren(downNode);
          const downChildrenLen = downChildren.length;
          if (downChildrenLen === 1) {
            const child = downChildren[0];
            const childChildren = getElementChildren(child);
            const childChildrenLen = childChildren.length;
            if (childChildrenLen === 1) {
              const grandChild = childChildren[0];
              const gcChildren = getElementChildren(grandChild);
              const gcChildrenLen = gcChildren.length;
              if (gcChildrenLen > 0) {
                const nodeTagName = getTag(child);
                const nodeStyle = getStyle(child);
                if (!parentHasTag(nodeTagName) || parentHasTag(nodeTagName) && !parentHasStyle(nodeStyle)) {
                  stack.push(child);
                } else {
                  if (!domUtils.specialTags.test(nodeTagName)) {
                    if (!isTest) {
                      if (hasOtherSignificantContent(child, childChildren[0])) {
                        stack.push(child);
                        continue;
                      }
                      const tmp = childChildren[0];
                      if (downNode.replaceChild) {
                        downNode.replaceChild(tmp, child);
                      } else {
                        downNode.children[downNode.children.indexOf(child)] = tmp;
                        tmp.parentNode = downNode;
                      }
                      stack.push(downNode);
                    } else {
                      pushWillBeDeleted(child);
                      return;
                    }
                  }
                }
              }
            } else if (childChildrenLen > 1) {
              for (let i = childChildrenLen - 1; i >= 0; i--) {
                childChildren[i].isNeedEmpty = true;
                stack.push(childChildren[i]);
              }
            }
          } else if (downChildrenLen > 1) {
            for (let i = downChildrenLen - 1; i >= 0; i--) {
              downChildren[i].isNeedEmpty = true;
              stack.push(downChildren[i]);
            }
          }
        }
      });
    }
    if (isTest) return willBeDeletedNodes;
  }

  // engine/darkmode.ts
  var import_mp_darkmode = __toESM(require_darkmode_min(), 1);
  var DEFAULT_DARK_TEXT = "#a3a3a3";
  var DEFAULT_DARK_BG = "#191919";
  var MIN_CONTRAST = 1.5;
  var DARK_COLOR_ATTR = /^data-darkmode-color-/;
  var DARK_BG_ATTR = /^data-darkmode-bgcolor-/;
  var DARK_ORIG_BG_ATTR = /^data-darkmode-original-bgcolor-/;
  var DARK_BGIMAGE_ATTR = /^data-darkmode-bgimage-/;
  var DARK_BGGRADIENT_ATTR = /^data-darkmode-bggradient-mix-color-/;
  var HAS_URL = /url\([^)]*\)/i;
  function readDarkAttr(el, re) {
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (re.test(attr.name)) return attr.value;
    }
    for (const key of Object.keys(el)) {
      if (re.test(key)) {
        const val = el[key];
        if (val == null) return null;
        if (val === true) return "true";
        return String(val);
      }
    }
    return null;
  }
  function collectWhitelistAttributes(opts) {
    var _a;
    const attrs = ["data-no-dark", ...((_a = opts == null ? void 0 : opts.whitelist) == null ? void 0 : _a.attribute) || []];
    return attrs;
  }
  function reset(nodes, _opts) {
    var _a, _b;
    try {
      (_b = (_a = import_mp_darkmode.default).resetCss) == null ? void 0 : _b.call(_a);
    } catch (e) {
    }
    const html = document.getElementsByTagName("html")[0];
    html == null ? void 0 : html.classList.remove("js_darkmode__");
    Array.from(nodes).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const toRemove = [];
      for (let i = 0; i < node.attributes.length; i++) {
        const name = node.attributes[i].name;
        if (DARK_COLOR_ATTR.test(name) || DARK_BG_ATTR.test(name) || DARK_ORIG_BG_ATTR.test(name) || DARK_BGIMAGE_ATTR.test(name) || /^data-darkmode-original-color-/.test(name) || /^data-darkmode-complementary-bgimagecolor-/.test(name)) {
          toRemove.push(name);
        }
      }
      toRemove.forEach((n) => node.removeAttribute(n));
    });
  }
  function validate(articleBody, opts) {
    const minContrast = (opts == null ? void 0 : opts.minContrast) || MIN_CONTRAST;
    const defaultDarkTextColor = (opts == null ? void 0 : opts.defaultDarkTextColor) || DEFAULT_DARK_TEXT;
    const defaultDarkBgColor = (opts == null ? void 0 : opts.defaultDarkBgColor) || DEFAULT_DARK_BG;
    const whitelistAttrs = collectWhitelistAttributes(opts);
    const violations = [];
    const walker = document.createTreeWalker(articleBody, NodeFilter.SHOW_ELEMENT, (node) => {
      if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_REJECT;
      const cs = node.style;
      if (cs.display === "none") return NodeFilter.FILTER_REJECT;
      if (HAS_URL.test(cs.backgroundImage || "") || HAS_URL.test(cs.webkitBorderImage || cs.borderImage || "")) return NodeFilter.FILTER_REJECT;
      if (node instanceof SVGElement) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    });
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const ignoreRules = (el.getAttribute("data-ignore-dm") || "").split(/\s+/);
      const hasText = Array.prototype.some.call(
        el.childNodes,
        (c) => c.nodeType === 3 && c.nodeValue.replace(/\s/g, "").length > 0
      );
      if (!ignoreRules.includes("low-contrast") && hasText) {
        const textColor = readDarkAttr(el, DARK_COLOR_ATTR) || defaultDarkTextColor;
        const bgColor = readDarkAttr(el, DARK_BG_ATTR) || readDarkAttr(el, DARK_ORIG_BG_ATTR) || defaultDarkBgColor;
        const contrast = import_mp_darkmode.default.getContrast ? import_mp_darkmode.default.getContrast(textColor, bgColor) : 1;
        if (contrast < minContrast) {
          violations.push({ dom: el, key: "darkmode-low-contrast", violateRules: "\u6587\u5B57\u4E0E\u80CC\u666F\u8272\u5BF9\u6BD4\u5EA6\u592A\u4F4E\uFF08\u53C2\u8003\u6587\u6863#4.1.1\u4F7F\u7528\u5BF9\u6BD4\u5EA6\u9002\u4E2D\u7684\u989C\u8272\uFF09" });
        }
      }
      if (!ignoreRules.includes("text-bg-gradient") && readDarkAttr(el, DARK_BGGRADIENT_ATTR)) {
        violations.push({ dom: el, key: "darkmode-no-gradient", violateRules: "\u6587\u5B57\u80CC\u666F\u5C3D\u91CF\u4E0D\u8981\u4F7F\u7528\u6E10\u53D8\uFF08\u53C2\u8003\u6587\u6863#4.1.2\u5982\u975E\u5FC5\u8981\uFF0C\u6587\u5B57\u80CC\u666F\u5C3D\u91CF\u4E0D\u8981\u4F7F\u7528\u6E10\u53D8\uFF09" });
      }
      if (whitelistAttrs.some((attr) => el.hasAttribute(attr))) {
        violations.push({ dom: el, key: "darkmode-whitelist", violateRules: "\u6CE8\u610F\uFF0C\u6B64\u5904\u5305\u542B\u767D\u540D\u5355\u5C5E\u6027\uFF0C\u4F1A\u8DF3\u8FC7darkmode\u7B97\u6CD5\u8F6C\u6362\uFF08\u53C2\u8003\u6587\u6863#4.5.1 \u6307\u5B9A\u8282\u70B9\u8DF3\u8FC7\u7B97\u6CD5\u8F6C\u6362\uFF09" });
      }
    }
    return violations;
  }
  var DarkmodeEngine = {
    reset,
    run(nodes, runOpts) {
      import_mp_darkmode.default.run(nodes, runOpts);
    },
    validate
  };
  var darkmode_default = DarkmodeEngine;

  // engine/rules-text.ts
  var propertyRules = {
    "font-family": "\u5F53\u524D\u5185\u5BB9\u4F7F\u7528\u4E86\u81EA\u5B9A\u4E49\u5B57\u4F53\uFF0C\u79FB\u52A8\u7AEF\u53EF\u80FD\u672A\u9884\u88C5\u8BE5\u5B57\u4F53\uFF0C\u5B9E\u9645\u663E\u793A\u6548\u679C\u53EF\u80FD\u4E0E\u9884\u89C8\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u6838\u5B9E\uFF08\u53C2\u8003\u6587\u6863 #3\u3001\u5B57\u4F53\u4F7F\u7528\u89C4\u8303\uFF09",
    "opacity": "\u8BE5\u56FE\u7247 opacity \u503C\u4E3A 0\uFF08\u5B8C\u5168\u900F\u660E\uFF09\uFF0C\u79FB\u52A8\u7AEF\u53EF\u80FD\u65E0\u6CD5\u6B63\u5E38\u663E\u793A\uFF0C\u4E14\u53D1\u5E03\u540E\u65E0\u6CD5\u901A\u8FC7\u540E\u53F0\u66FF\u6362\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u7B26\u5408\u9884\u671F\uFF08\u53C2\u8003\u6587\u6863 #1.1 opacity\uFF09",
    "caret-color": "\u5149\u6807\u989C\u8272\uFF08caret-color\uFF09\u88AB\u8BBE\u7F6E\u4E3A\u900F\u660E\uFF0C\u53EF\u80FD\u5BFC\u81F4\u7F16\u8F91\u65F6\u65E0\u6CD5\u5B9A\u4F4D\u5149\u6807\u4F4D\u7F6E\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u7B26\u5408\u9884\u671F\uFF08\u53C2\u8003\u6587\u6863 #1.2 caret-color\uFF09",
    "line-height": "\u5F53\u524D\u5185\u5BB9\u884C\u9AD8\uFF08line-height\uFF09\u8FC7\u5C0F\uFF0C\u591A\u884C\u6587\u672C\u53EF\u80FD\u5B58\u5728\u91CD\u53E0\uFF0C\u8BF7\u6838\u5B9E\u9605\u8BFB\u6548\u679C\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.3 line-height\uFF09",
    "text-align": "\u6587\u672C\u5BF9\u9F50\u5C5E\u6027\u4F7F\u7528\u4E86 start \u6216 end\uFF0C\u4E0D\u540C\u7EC8\u7AEF\u89E3\u6790\u53EF\u80FD\u5B58\u5728\u5DEE\u5F02\uFF0C\u8BF7\u6838\u5B9E\u5404\u7AEF\u663E\u793A\u662F\u5426\u4E00\u81F4\uFF08\u53C2\u8003\u6587\u6863 #1.6 text-align\uFF09",
    "height": "\u8BE5\u5BB9\u5668 height \u503C\u4E3A 0\uFF0C\u53EF\u80FD\u5BFC\u81F4\u79FB\u52A8\u7AEF\u5185\u5BB9\u663E\u793A\u5F02\u5E38\u6216\u4E0D\u53EF\u89C1\uFF0C\u8BF7\u6838\u5B9E\u662F\u5426\u7B26\u5408\u9884\u671F\uFF08\u53C2\u8003\u6587\u6863 #1.5.1 height:0\uFF09",
    "width": "\u5F53\u524D\u5185\u5BB9\u5B58\u5728\u7279\u6B8A\u6392\u7248\uFF0C\u53EF\u80FD\u5728\u4E0D\u540C\u5C4F\u5E55\u4E0B\u51FA\u73B0\u5C45\u4E2D\u4E0D\u4E00\u81F4\u3001\u5BBD\u5EA6\u5DEE\u5F02\u6216\u6EA2\u51FA\u95EE\u9898\uFF0C\u8BF7\u6838\u5B9E\u663E\u793A\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.4 width\uFF09",
    "animate-begin": "\u8BE5\u52A8\u753B begin \u5305\u542B touchstart \u89E6\u6478\u4E8B\u4EF6\uFF0C\u4F46\u672A\u5305\u542B click \u70B9\u51FB\u4E8B\u4EF6\uFF0CPC \u7AEF\u53EF\u80FD\u65E0\u6CD5\u901A\u8FC7\u9F20\u6807\u89E6\u53D1\u64AD\u653E\uFF0C\u8BF7\u786E\u8BA4\u4EA4\u4E92\u662F\u5426\u7B26\u5408\u9884\u671F\uFF08\u53C2\u8003\u6587\u6863 #1.7 begin\uFF09",
    "height-nodisplay": "\u5185\u5BB9\u5B9E\u9645\u9AD8\u5EA6\u8D85\u51FA\u5BB9\u5668\u8BBE\u5B9A\u7684 height \u9650\u5236\uFF0C\u6EA2\u51FA\u90E8\u5206\u53EF\u80FD\u5728\u79FB\u52A8\u7AEF\u88AB\u88C1\u5207\uFF0C\u8BF7\u6838\u5B9E\u663E\u793A\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.5.2 \u5185\u5BB9\u6EA2\u51FA\u5BB9\u5668\uFF09",
    "line-height-overlapping": "\u884C\u95F4\u8DDD\uFF08line-height\uFF09\u8BBE\u7F6E\u8F83\u5C0F\uFF0C\u591A\u884C\u6587\u672C\u53EF\u80FD\u5B58\u5728\u91CD\u53E0\uFF0C\u8BF7\u6838\u5B9E\u9605\u8BFB\u6548\u679C\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.3 line-height\uFF09",
    "nest-level": "\u5F53\u524D\u5185\u5BB9 DOM \u5D4C\u5957\u5C42\u7EA7\u8F83\u6DF1\uFF0C\u5B58\u5728\u5197\u4F59\u7684\u91CD\u590D\u5D4C\u5957\u7ED3\u6784\uFF0C\u53EF\u80FD\u5F71\u54CD\u6E32\u67D3\u8868\u73B0\uFF0C\u8BF7\u6838\u5B9E\uFF08\u53C2\u8003\u6587\u6863 #2.1 \u5D4C\u5957\u5C42\u7EA7\u9650\u5236\uFF09",
    // Reserved copy: this rule has no spec chapter or CLI implementation yet.
    "redundant-node": "\u5F53\u524D\u5185\u5BB9\u5B58\u5728\u5927\u91CF\u7A7A\u767D\u5B50\u8282\u70B9\uFF08\u5B50\u8282\u70B9\u6570 > 20 \u4E14\u7A7A\u8282\u70B9\u6570 > 15\uFF09\uFF0C\u8FD9\u4E9B\u5197\u4F59\u7A7A\u8282\u70B9\u4F1A\u88AB\u7F16\u8F91\u5668\u81EA\u52A8\u5220\u9664\uFF0C\u8BF7\u6838\u5B9E\u662F\u5426\u7B26\u5408\u9884\u671F",
    "node-leaf": "\u7EC4\u4EF6\u5BB9\u5668\uFF08section[nodeleaf]\uFF09\u5185\u90E8\u7ED3\u6784\u53EF\u80FD\u4E0D\u7B26\u5408\u89C4\u8303\uFF0C\u8BE5\u5BB9\u5668\u4EC5\u5141\u8BB8\u5305\u542B\u5B98\u65B9\u6307\u5B9A\u7684\u7279\u5B9A\u7EC4\u4EF6\u6216 img \u56FE\u7247\u5143\u7D20\uFF0C\u8BF7\u6838\u5B9E\uFF08\u53C2\u8003\u6587\u6863 #2.3 section[nodeleaf] \u8282\u70B9\u89C4\u8303\uFF09",
    "span-leaf": "\u884C\u5185\u5BB9\u5668\uFF08span[leaf]\uFF09\u4E2D\u68C0\u6D4B\u5230\u5757\u7EA7\u5B50\u5143\u7D20\uFF0C\u8BE5\u5BB9\u5668\u4EC5\u5141\u8BB8\u5305\u542B\u6587\u672C\u6216\u884C\u5185\u5143\u7D20\uFF08\u5982 span\u3001strong\u3001\u94FE\u63A5\u53CA\u884C\u5185\u56FE\u7247\u7B49\uFF09\uFF0C\u8BF7\u6838\u5B9E\u7ED3\u6784\u662F\u5426\u6B63\u786E\uFF08\u53C2\u8003\u6587\u6863 #2.2 span[leaf] \u8282\u70B9\u89C4\u8303\uFF09",
    "pre": "\u5F53\u524D pre \u6807\u7B7E\u5185\u7684\u5185\u5BB9\u8D85\u51FA\u5BB9\u5668\u5BBD\u5EA6\uFF0C\u4E14\u672A\u542F\u7528\u6A2A\u5411\u6EDA\u52A8\uFF0C\u79FB\u52A8\u7AEF\u53EF\u80FD\u65E0\u6CD5\u5B8C\u6574\u9605\u8BFB\uFF0C\u8BF7\u6838\u5B9E\u663E\u793A\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.8 pre \u6807\u7B7E\uFF09",
    "darkmode-low-contrast": "\u6587\u5B57\u4E0E\u80CC\u666F\u8272\u5BF9\u6BD4\u5EA6\u592A\u4F4E\uFF08\u53C2\u8003\u6587\u6863#4.1.1\u4F7F\u7528\u5BF9\u6BD4\u5EA6\u9002\u4E2D\u7684\u989C\u8272\uFF09",
    "darkmode-no-gradient": "\u6587\u5B57\u80CC\u666F\u5C3D\u91CF\u4E0D\u8981\u4F7F\u7528\u6E10\u53D8\uFF08\u53C2\u8003\u6587\u6863#4.1.2\u5982\u975E\u5FC5\u8981\uFF0C\u6587\u5B57\u80CC\u666F\u5C3D\u91CF\u4E0D\u8981\u4F7F\u7528\u6E10\u53D8\uFF09"
  };
  var WIDTH_DETAIL_RULES = {
    "\u5C45\u4E2D\u5E03\u5C40\u4E0D\u4E00\u81F4": "\u5F53\u524D\u5143\u7D20\u5728\u4E0D\u540C\u5C4F\u5E55\u5BBD\u5EA6\u4E0B\u5C45\u4E2D\u72B6\u6001\u4E0D\u4E00\u81F4\uFF08\u90E8\u5206\u5C4F\u5E55\u5C45\u4E2D\u3001\u90E8\u5206\u4E0D\u5C45\u4E2D\uFF09\uFF0C\u901A\u5E38\u7531\u56FA\u5B9A px \u5BBD\u5EA6\u6216\u5916\u8FB9\u8DDD\u504F\u79FB\u5F15\u8D77\uFF0C\u79FB\u52A8\u7AEF\u663E\u793A\u6548\u679C\u53EF\u80FD\u4E0E\u7F16\u8F91\u5668\u9884\u89C8\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u6838\u5B9E\uFF08\u53C2\u8003\u6587\u6863 #1.4.1 \u5C45\u4E2D\u5E03\u5C40\u4E0D\u4E00\u81F4\uFF09",
    "\u5B58\u5728\u6EA2\u51FA\u95EE\u9898": "\u5F53\u524D\u5143\u7D20\u5BBD\u5EA6\u8D85\u51FA\u5BB9\u5668\u8FB9\u754C\uFF0C\u79FB\u52A8\u7AEF\u53EF\u80FD\u51FA\u73B0\u6C34\u5E73\u6EDA\u52A8\u6216\u5185\u5BB9\u88AB\u88C1\u5207\uFF0C\u5E38\u89C1\u539F\u56E0\u5305\u62EC\u56FA\u5B9A\u5BBD\u5EA6\u8FC7\u5927\u3001margin/padding \u504F\u79FB\u3001transform \u4F4D\u79FB\u7B49\uFF0C\u8BF7\u6838\u5B9E\u663E\u793A\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.4.2 \u5B58\u5728\u6EA2\u51FA\u95EE\u9898\uFF09",
    "\u4E0D\u540C\u5C4F\u5E55\u4E0B\u5BBD\u5EA6\u5DEE\u5F02": "\u5F53\u524D\u5143\u7D20\u5728\u4E0D\u540C\u5C4F\u5E55\u5BBD\u5EA6\u4E0B\u6E32\u67D3\u5BBD\u5EA6\u5DEE\u5F02\u8F83\u5927\uFF0C\u4E14\u5360\u7236\u5BB9\u5668\u7684\u6BD4\u4F8B\u4E5F\u4E0D\u4E00\u81F4\uFF0C\u901A\u5E38\u7531\u56FA\u5B9A px \u5BBD\u5EA6\u672A\u505A\u54CD\u5E94\u5F0F\u9002\u914D\u5F15\u8D77\uFF0C\u8BF7\u6838\u5B9E\u663E\u793A\u662F\u5426\u6B63\u5E38\uFF08\u53C2\u8003\u6587\u6863 #1.4.3 \u4E0D\u540C\u5C4F\u5E55\u4E0B\u5BBD\u5EA6\u5DEE\u5F02\uFF09"
  };

  // engine/layout.ts
  var DEFAULT_SCREENS = [
    { width: 585, style: { width: "585px" } },
    { width: 677, style: { width: "677px" } },
    { width: 375, style: { width: "375px" } }
  ];
  function removeLayoutSandbox(sandbox) {
    if (!sandbox || typeof sandbox.remove !== "function") {
      return;
    }
    if (sandbox.__debugSandbox) {
      console.log("[LayoutSandbox] \u8C03\u8BD5\u6A21\u5F0F\uFF1Asandbox \u4FDD\u7559\u5728 DOM \u91CC\uFF0C\u4FBF\u4E8E\u6392\u67E5");
      return;
    }
    if (sandbox.__selfDestructTimer) {
      clearTimeout(sandbox.__selfDestructTimer);
      sandbox.__selfDestructTimer = null;
    }
    try {
      if (sandbox.parentNode) {
        sandbox.parentNode.removeChild(sandbox);
      }
    } catch (e) {
    }
  }
  function createLayoutSandbox(htmlString, options) {
    const sandbox = document.createElement("div");
    sandbox.id = "test";
    sandbox.className = "rich_media_content";
    const debugSandbox = (options == null ? void 0 : options.debugSandbox) === true;
    if (debugSandbox) {
      Object.assign(sandbox.style, {
        position: "absolute",
        zIndex: "10000",
        border: "2px dashed red",
        background: "#fff",
        boxSizing: "border-box",
        color: "rgba(0, 0, 0, 0.9)",
        fontSize: "var(--articleFontsize)",
        overflow: "hidden",
        textAlign: "justify"
      });
      sandbox.__debugSandbox = true;
    } else {
      Object.assign(sandbox.style, {
        position: "fixed",
        left: "-9999px",
        top: "-9999px",
        visibility: "hidden",
        pointerEvents: "none",
        zIndex: "-1",
        boxSizing: "border-box",
        color: "rgba(0, 0, 0, 0.9)",
        fontSize: "var(--articleFontsize)",
        overflow: "hidden",
        textAlign: "justify"
      });
      sandbox.__selfDestructTimer = setTimeout(() => {
        if (sandbox.parentNode) {
          console.warn("[LayoutSandbox] \u8D85\u65F6\u81EA\u6BC1\uFF0C\u53EF\u80FD removeLayoutSandbox \u672A\u6B63\u5E38\u6267\u884C");
          sandbox.parentNode.removeChild(sandbox);
        }
      }, 1e4);
    }
    if (!document.getElementById("rich-media-styles")) {
      const style = document.createElement("style");
      style.id = "rich-media-styles";
      style.textContent = `
      .rich_media_content * {
        max-width: 100% !important;
        box-sizing: border-box !important;
        -webkit-box-sizing: border-box !important;
        word-wrap: break-word !important;
      }
    `;
      document.head.appendChild(style);
    }
    document.body.appendChild(sandbox);
    sandbox.innerHTML = htmlString;
    return sandbox;
  }
  function waitForImagesToLoad(sandbox, timeoutMs = 5e3) {
    return __async(this, null, function* () {
      const imgs = Array.from(sandbox.querySelectorAll("img")).filter((img) => {
        const cls = (img.className || "").toString();
        if (cls.includes("ProseMirror-separator")) return false;
        if (img.getAttribute && Number.isFinite(parseFloat(img.getAttribute("data-w")))) return false;
        if (!img.getAttribute("src")) return false;
        return true;
      });
      if (!imgs.length) return;
      const settled = imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          img.addEventListener("DOMNodeRemoved", done, { once: true });
        });
      });
      yield Promise.race([
        Promise.all(settled),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    });
  }
  function getShellHTML(el) {
    if (!el || typeof el.cloneNode !== "function") return "";
    const clone = el.cloneNode(false);
    clone.removeAttribute("data-blockidx");
    clone.removeAttribute("data-violation-id");
    const tmp = document.createElement("div");
    tmp.appendChild(clone);
    return tmp.innerHTML;
  }
  function getCleanOuterHTML(el) {
    if (!el || typeof el.cloneNode !== "function") return "";
    const clone = el.cloneNode(true);
    clone.removeAttribute("data-blockidx");
    clone.removeAttribute("data-violation-id");
    clone.querySelectorAll("[data-blockidx]").forEach((n) => n.removeAttribute("data-blockidx"));
    clone.querySelectorAll("[data-violation-id]").forEach((n) => n.removeAttribute("data-violation-id"));
    const tmp = document.createElement("div");
    tmp.appendChild(clone);
    return tmp.innerHTML;
  }
  function hasWidthVariance(screenFindings, tolerance = 10, ratioTolerance = 0.2, debug = false) {
    if (!screenFindings.length) return { isValid: true, rules: "" };
    const isOverflowOnly = screenFindings[0].overflowOnly;
    const baseWidth = screenFindings[0].computedWidth;
    const baseRatio = screenFindings[0].widthRatio;
    const baseOverflowing = screenFindings[0].isOverflowing;
    const hasWidthDiff = screenFindings.some((f) => Math.abs(f.computedWidth - baseWidth) > tolerance);
    const isNormalResponsive = hasWidthDiff && screenFindings.every((f) => {
      const sameAsBase = Math.abs(f.computedWidth - baseWidth) <= tolerance;
      const filledScreen = Math.abs(f.widthRatio - 1) < 0.1;
      return sameAsBase || filledScreen;
    });
    const dynamicRatioTolerance = screenFindings.some((f) => f.widthRatio === 1) ? 0 : ratioTolerance;
    const hasRatioDiff = screenFindings.some((f) => Math.abs(f.widthRatio - baseRatio) > dynamicRatioTolerance);
    const hasOverflowDiff = screenFindings.some((f) => f.isOverflowing !== baseOverflowing);
    if (isOverflowOnly) {
      const isActuallyOverflowing = screenFindings.some((f) => f.isOverflowing);
      return { isValid: !isActuallyOverflowing, rules: isActuallyOverflowing ? "\u5B58\u5728\u6EA2\u51FA\u95EE\u9898" : "" };
    }
    const hasCenterInconsistency = screenFindings.some((f) => f.isHorizontallyCentered) && screenFindings.some((f) => !f.isHorizontallyCentered);
    const rulesList = [];
    if (hasWidthDiff && hasRatioDiff && !isNormalResponsive) rulesList.push("\u4E0D\u540C\u5C4F\u5E55\u4E0B\u5BBD\u5EA6\u5DEE\u5F02");
    if (hasCenterInconsistency) rulesList.push("\u5C45\u4E2D\u5E03\u5C40\u4E0D\u4E00\u81F4");
    if (hasOverflowDiff) rulesList.push("\u5B58\u5728\u6EA2\u51FA\u95EE\u9898");
    const isValid = rulesList.length === 0;
    const rules = rulesList.join("\uFF1B");
    if (debug) {
      console.log("[DEBUG hasWidthVariance]", {
        screenCount: screenFindings.length,
        widths: screenFindings.map((f) => `${f.screenWidth}\u2192${f.computedWidth}(ratio=${f.widthRatio.toFixed(3)})`),
        centered: screenFindings.map((f) => `${f.screenWidth}\u2192${f.isHorizontallyCentered}`),
        overflow: screenFindings.map((f) => `${f.screenWidth}\u2192${f.isOverflowing}`),
        hasWidthDiff,
        isNormalResponsive,
        hasRatioDiff,
        hasOverflowDiff,
        hasCenterInconsistency,
        isValid,
        rules: rules || "(\u65E0)"
      });
    }
    return { isValid, rules };
  }
  function hasLineHeightOverlapping(screenFindings) {
    if (!screenFindings.length) return { isValid: true };
    return { isValid: !screenFindings.some((f) => f.isOverlapping) };
  }
  var MAX_DEPTH = 10;
  function findHeightAncestor(chain) {
    for (let i = 0; i < chain.length; i++) {
      const el = chain[i];
      if (!el || typeof el.getAttribute !== "function") continue;
      const styleStr = el.getAttribute("style");
      if (!styleStr) continue;
      const heightMatch = styleStr.match(/(^|;)\s*height\s*:\s*([^;]+)/i);
      if (heightMatch && !/^auto$/i.test(heightMatch[2].trim())) return el;
    }
    return null;
  }
  function checkChildHeightOverflow(parentElement, parentRect, depth = 0, ancestorChain = []) {
    if (!parentElement || !parentRect || depth > MAX_DEPTH) return null;
    const children = Array.from(parentElement.children);
    const currentChain = [...ancestorChain, parentElement];
    for (const child of children) {
      const childHeight = child.offsetHeight;
      const overflowY = window.getComputedStyle(child).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") continue;
      if (parentRect.height > 200 && childHeight > parentRect.height + 20 || parentRect.height <= 200 && childHeight > parentRect.height + 5) {
        return {
          overflowChild: child,
          childHeight,
          parentHeight: parentRect.height,
          suspectAncestor: findHeightAncestor(currentChain)
        };
      }
      const result = checkChildHeightOverflow(child, parentRect, depth + 1, currentChain);
      if (result) return result;
    }
    return null;
  }
  function detectLineHeightOverlap(node) {
    const cs = window.getComputedStyle(node);
    const fontSize = parseFloat(cs.fontSize);
    const lhRaw = cs.lineHeight;
    const lineHeight = lhRaw === "normal" ? fontSize * 1.2 : parseFloat(lhRaw);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.height > 0 && r.width > 0
    );
    const lines = [];
    for (const r of rects) {
      const top = r.top;
      const bottom = top + r.height;
      const hit = lines.find((l) => {
        const overlap = Math.min(l.bottom, bottom) - Math.max(l.top, top);
        const minH = Math.min(l.bottom - l.top, bottom - top);
        return overlap > minH * 0.5;
      });
      if (hit) {
        hit.top = Math.min(hit.top, top);
        hit.bottom = Math.max(hit.bottom, bottom);
      } else {
        lines.push({ top, bottom });
      }
    }
    const lineCount = lines.length;
    const contentHeight = range.getBoundingClientRect().height;
    let overlapping = false;
    if (Number.isFinite(lineHeight) && lineHeight === 0) {
      overlapping = true;
    } else if (lineCount >= 2) {
      const avgLineHeight = contentHeight / lineCount;
      overlapping = avgLineHeight < fontSize * 0.95;
    }
    return { fontSize, lineHeight, lineCount, contentHeight, overlapping };
  }
  function collectLineHeightFallback(sandbox, debug = false) {
    const blockTags = /* @__PURE__ */ new Set(["p", "div", "section", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "a"]);
    const items = [];
    sandbox.querySelectorAll("*").forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (!blockTags.has(tag)) return;
      const hasDirectText = Array.from(node.childNodes).some(
        (c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim().length > 0
      );
      if (!hasDirectText) return;
      const text = (node.textContent || "").trim().replace(/\s+/g, " ");
      if (!text.length) return;
      const m = detectLineHeightOverlap(node);
      if (debug) {
        console.log("[DEBUG lineHeight]", tag, {
          fontSize: m.fontSize,
          lineHeight: m.lineHeight,
          lineCount: m.lineCount,
          contentHeight: m.contentHeight,
          avgLineHeight: m.lineCount > 0 ? Number((m.contentHeight / m.lineCount).toFixed(2)) : 0,
          overlapThreshold: Number((m.fontSize * 0.95).toFixed(2)),
          textPreview: text.slice(0, 20),
          overlapping: m.overlapping
        });
      }
      if (m.overlapping) {
        items.push({
          node,
          fontSize: m.fontSize,
          lineHeight: m.lineHeight,
          elementHeight: node.getBoundingClientRect().height,
          estLines: m.lineCount,
          text: text.slice(0, 60)
        });
      }
    });
    return items;
  }
  function findParagraphIndexInSandbox(node) {
    let el = node;
    while (el) {
      if (typeof el.getAttribute === "function") {
        const idx = el.getAttribute("data-blockidx");
        if (idx !== null && idx !== void 0 && idx !== "") {
          const parsed = parseInt(idx, 10);
          if (Number.isFinite(parsed)) return parsed;
        }
      }
      el = el.parentNode;
    }
    return -1;
  }
  function detectLayoutIssues() {
    return __async(this, arguments, function* (invalidNodes = [], htmlString = "", opts = {}) {
      const screenConfigs = opts.screenConfigs || DEFAULT_SCREENS;
      const debug = opts.debugSandbox === true;
      const sandbox = createLayoutSandbox(htmlString, { debugSandbox: opts.debugSandbox });
      yield waitForImagesToLoad(sandbox);
      sandbox.querySelectorAll("img").forEach((img) => {
        var _a;
        if ((img.className || "").includes("ProseMirror-separator")) return;
        if (img.complete && img.naturalWidth > 0) return;
        const dataW = parseFloat(img.getAttribute("data-w"));
        const ratio = parseFloat(img.getAttribute("data-ratio"));
        const inlineWidth = img.style.width;
        const htmlWidthAttr = parseFloat(img.getAttribute("width"));
        let width = null;
        if (inlineWidth) width = parseFloat(inlineWidth);
        if ((!width || width <= 0 || Number.isNaN(width)) && Number.isFinite(dataW) && dataW > 0) width = dataW;
        if ((!width || width <= 0 || Number.isNaN(width)) && Number.isFinite(htmlWidthAttr) && htmlWidthAttr > 0) width = htmlWidthAttr;
        if (debug) console.log("[DEBUG img fallback]", { inlineWidth, dataW, ratio, htmlWidthAttr, parsedWidth: width, src: (_a = img.src) == null ? void 0 : _a.substring(0, 80), complete: img.complete, naturalWidth: img.naturalWidth });
        if (width && width > 0 && Number.isFinite(width)) {
          img.style.width = width + "px";
          if (debug) console.log("[DEBUG img fallback] \u2192 \u8BBE\u7F6E width:", width + "px");
          if (ratio && ratio > 0 && Number.isFinite(ratio)) img.style.height = width * ratio + "px";
        } else {
          img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";
        }
      });
      try {
        const allScreenFindings = {};
        const caretColorNodes = invalidNodes.filter((n) => n.property === "caret-color");
        const opacityNodes = invalidNodes.filter((n) => n.property === "opacity");
        const textAlignNodes = invalidNodes.filter((n) => n.property === "text-align");
        const animateBeginNodes = invalidNodes.filter((n) => n.property === "animate-begin");
        const preNodes = invalidNodes.filter((n) => n.property === "pre");
        const heightZeroNodes = invalidNodes.filter((n) => n.property === "height");
        Object.assign(sandbox.style, screenConfigs[0].style);
        yield new Promise((r) => setTimeout(r, 100));
        const parentRect = sandbox.getBoundingClientRect();
        const overflowResult = checkChildHeightOverflow(sandbox, parentRect);
        let heightIssues = [];
        if (overflowResult) {
          heightIssues.push({
            violateRules: propertyRules["height-nodisplay"],
            outerHTML: overflowResult.suspectAncestor ? getShellHTML(overflowResult.suspectAncestor) : "",
            childHeight: overflowResult.childHeight,
            parentHeight: overflowResult.parentHeight
          });
        }
        const fallbackItems = collectLineHeightFallback(sandbox, debug);
        for (const config of screenConfigs) {
          Object.assign(sandbox.style, config.style);
          yield new Promise((r) => setTimeout(r, 100));
          const pRect = sandbox.getBoundingClientRect();
          const widthNodes = invalidNodes.filter((n) => n.property === "width");
          const lineHeightNodes = invalidNodes.filter((n) => n.property === "line-height");
          widthNodes.forEach((nodeInfo) => {
            const violationId = nodeInfo.violationId;
            if (!violationId) return;
            const cloned = sandbox.querySelector(`[data-violation-id="${violationId}"]`);
            if (!cloned) return;
            const rect = cloned.getBoundingClientRect();
            const computedWidth = Math.round(parseFloat(rect.width));
            const leftDistance = rect.left - pRect.left;
            const rightDistance = pRect.right - rect.right;
            const horizontalCenterDiff = Math.abs(leftDistance - rightDistance);
            const isHorizontallyCentered = horizontalCenterDiff <= 1;
            const isNotRendered = rect.width === 0 && rect.height === 0;
            const isOverflowing = !isNotRendered && (rect.left < pRect.left - 1 || rect.right > pRect.right + 1) && !isHorizontallyCentered;
            const finding = {
              violationId,
              node: nodeInfo.node,
              property: "width",
              screenWidth: config.width,
              widthRatio: computedWidth / config.width,
              computedWidth: Number.isFinite(computedWidth) ? computedWidth : 0,
              isHeightZero: rect.height < 1,
              isOverflowing,
              isHorizontallyCentered,
              overflowOnly: nodeInfo.overflowOnly || false
            };
            if (!allScreenFindings[violationId]) allScreenFindings[violationId] = { width: [], "line-height": [] };
            allScreenFindings[violationId].width.push(finding);
          });
          lineHeightNodes.forEach((nodeInfo) => {
            const violationId = nodeInfo.violationId;
            if (!violationId) return;
            const cloned = sandbox.querySelector(`[data-violation-id="${violationId}"]`);
            if (!cloned) return;
            const m = detectLineHeightOverlap(cloned);
            const finding = { node: nodeInfo.node, violationId, property: "line-height", isOverlapping: m.overlapping };
            if (!allScreenFindings[violationId]) allScreenFindings[violationId] = { width: [], "line-height": [] };
            allScreenFindings[violationId]["line-height"].push(finding);
          });
          preNodes.forEach((nodeInfo) => {
            const violationId = nodeInfo.violationId;
            if (!violationId) return;
            const cloned = sandbox.querySelector(`[data-violation-id="${violationId}"]`);
            if (!cloned) return;
            const overflowX = getComputedStyle(cloned).overflowX;
            const canScrollX = overflowX === "auto" || overflowX === "scroll";
            const isOverflowing = cloned.scrollWidth > cloned.clientWidth + 1 && !canScrollX;
            if (!allScreenFindings[violationId]) allScreenFindings[violationId] = { width: [], "line-height": [] };
            if (!allScreenFindings[violationId].pre) allScreenFindings[violationId].pre = [];
            const finding = { violationId, isOverflowing, screenWidth: config.width };
            allScreenFindings[violationId].pre.push(finding);
          });
        }
        const optimizedIssues = {};
        Object.entries(allScreenFindings).forEach(([violationId, findings]) => {
          if (findings.width && findings.width.length > 0) {
            if (debug) {
              console.log(`[DEBUG screenFindings] violationId=${violationId}`, findings.width.map((f) => ({
                screenWidth: f.screenWidth,
                computedWidth: f.computedWidth,
                widthRatio: f.widthRatio.toFixed(3),
                isHorizontallyCentered: f.isHorizontallyCentered,
                isOverflowing: f.isOverflowing,
                isHeightZero: f.isHeightZero,
                overflowOnly: f.overflowOnly
              })));
            }
            const { isValid, rules } = hasWidthVariance(findings.width, 10, 0.2, debug);
            if (!isValid) {
              const paragraphIndex = violationId.split("-")[1];
              const itemViolateRulesDesc = WIDTH_DETAIL_RULES[rules] || propertyRules["width"];
              if (!optimizedIssues.width) optimizedIssues.width = { violateRules: propertyRules["width"], items: [] };
              optimizedIssues.width.items.push({
                violationId,
                screenFindings: findings.width,
                rules,
                paragraphIndex,
                outerHTML: getCleanOuterHTML(findings.width[0].node),
                violateRules: itemViolateRulesDesc
              });
            }
          }
          if (findings["line-height"].length > 0) {
            const { isValid } = hasLineHeightOverlapping(findings["line-height"]);
            if (!isValid) {
              const paragraphIndex = violationId.split("-")[1];
              if (!optimizedIssues["line-height"]) optimizedIssues["line-height"] = { violateRules: propertyRules["line-height-overlapping"], items: [] };
              optimizedIssues["line-height"].items.push({
                violationId,
                screenFindings: findings["line-height"],
                paragraphIndex,
                outerHTML: getCleanOuterHTML(findings["line-height"][0].node)
              });
            }
          }
        });
        if (heightIssues.length > 0) {
          optimizedIssues["height-nodisplay"] = { violateRules: propertyRules["height-nodisplay"], items: heightIssues };
        }
        if (heightZeroNodes.length > 0) optimizedIssues.height = { violateRules: propertyRules["height"], items: heightZeroNodes };
        if (caretColorNodes.length > 0) optimizedIssues["caret-color"] = { violateRules: propertyRules["caret-color"], items: caretColorNodes };
        if (opacityNodes.length > 0) optimizedIssues.opacity = { violateRules: propertyRules["opacity"], items: opacityNodes };
        if (animateBeginNodes.length > 0) optimizedIssues["animate-begin"] = { violateRules: propertyRules["animate-begin"], items: animateBeginNodes };
        if (textAlignNodes.length > 0) optimizedIssues["text-align"] = { violateRules: propertyRules["text-align"], items: textAlignNodes };
        if (preNodes.length > 0) {
          const preOverflowItems = [];
          preNodes.forEach((preNode) => {
            const violationId = preNode.violationId;
            if (!violationId) return;
            const findings = allScreenFindings[violationId];
            if (!findings || !findings.pre || !findings.pre.length) return;
            if (findings.pre.some((f) => f.isOverflowing)) {
              preOverflowItems.push({ violationId, paragraphIndex: preNode.paragraphIndex, outerHTML: getCleanOuterHTML(preNode.node) });
            }
          });
          if (preOverflowItems.length > 0) optimizedIssues["pre"] = { violateRules: propertyRules["pre"], items: preOverflowItems };
        }
        if (fallbackItems.length > 0) {
          let localCounter = 0;
          if (!optimizedIssues["line-height"]) optimizedIssues["line-height"] = { violateRules: propertyRules["line-height-overlapping"], items: [] };
          fallbackItems.forEach((it) => {
            const paragraphIndex = findParagraphIndexInSandbox(it.node);
            const safePIdx = paragraphIndex >= 0 ? paragraphIndex : -1;
            let violationId = null;
            const node = it.node;
            if (node && typeof node.getAttribute === "function" && typeof node.setAttribute === "function") {
              const existing = node.getAttribute("data-violation-id");
              if (existing) {
                violationId = existing;
              } else {
                violationId = `violation-${safePIdx}-${localCounter++}-${Date.now()}`;
                node.setAttribute("data-violation-id", violationId);
              }
            }
            optimizedIssues["line-height"].items.push({
              violationId,
              paragraphIndex: safePIdx,
              outerHTML: getCleanOuterHTML(it.node),
              rules: it.lineHeight === 0 ? "\u7EE7\u627F\u7684 line-height: 0 \u5BFC\u81F4\u6587\u5B57\u53E0\u5B57\uFF08\u515C\u5E95\u68C0\u6D4B\uFF09" : "\u884C\u9AD8\u5C0F\u4E8E\u5B57\u4F53\u5927\u5C0F\uFF0C\u4E14\u5B58\u5728\u591A\u884C\u6587\u672C\uFF0C\u53EF\u80FD\u5BFC\u81F4\u6587\u5B57\u91CD\u53E0\uFF08\u5B9E\u6D4B\uFF09"
            });
          });
        }
        if (debug) {
          const summary = {};
          Object.entries(optimizedIssues).forEach(([key, entry]) => {
            var _a;
            summary[key] = {
              violateRules: entry.violateRules,
              count: ((_a = entry.items) == null ? void 0 : _a.length) || 0,
              items: (entry.items || []).map((it) => {
                var _a2;
                return {
                  violationId: it.violationId,
                  rules: it.rules,
                  paragraphIndex: it.paragraphIndex,
                  outerHTML: (_a2 = it.outerHTML) == null ? void 0 : _a2.substring(0, 120)
                };
              })
            };
          });
          console.log("[DEBUG detectLayoutIssues] \u6700\u7EC8\u7ED3\u679C:", JSON.stringify(summary, null, 2));
        }
        return optimizedIssues;
      } finally {
        removeLayoutSandbox(sandbox);
      }
    });
  }

  // engine/rules/helpers.ts
  function getInlineStyleValue(node, propName) {
    if (!node) return null;
    const styleStr = node.getAttribute("style");
    if (!styleStr) return null;
    const regex = new RegExp("(^|;)\\s*" + propName + "\\s*:\\s*([^;]+)", "i");
    const match = styleStr.match(regex);
    return match ? match[2].trim() : null;
  }
  function isTransparentRgba(value) {
    if (!value) return false;
    return /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value.replace(/\s+/g, ""));
  }

  // engine/rules/font-family.ts
  var normalizeFontFamily = (fontStr) => fontStr.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  var allowedFontFamily = normalizeFontFamily('"mp-quote", PingFang SC, system-ui, -apple-system');

  // engine/rules/opacity.ts
  function checkOpacityViolation(n, paragraphIndex, propertyMaps, tag, ctx) {
    if (tag !== "img") return null;
    const op = ctx.getInlineStyleValue(n, "opacity");
    const s = n.getAttribute("style") || "";
    if (op !== null && (/^0(?:\.0+)?$/.test(op) || parseFloat(op) === 0) || /opacity\s*:\s*0\b/i.test(s)) {
      const item = {
        paragraphIndex,
        node: n,
        property: "opacity",
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n),
        value: op !== null ? op : "0 (from style attribute)"
      };
      propertyMaps["opacity"].set(paragraphIndex, item);
      return item;
    }
    return null;
  }

  // engine/rules/caret-color.ts
  function checkCaretColorViolation(n, paragraphIndex, propertyMaps, ctx) {
    const caret = ctx.getInlineStyleValue(n, "caret-color");
    if (caret && ctx.isTransparentRgba(caret)) {
      const item = {
        paragraphIndex,
        node: n,
        property: "caret-color",
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n)
      };
      if (!ctx.isEmptyParagraph(n)) propertyMaps["caret-color"].set(paragraphIndex, item);
      return item;
    }
    return null;
  }

  // engine/rules/line-height.ts
  function checkLineHeightViolation(n, paragraphIndex, propertyMaps, tag, ctx) {
    if (tag === "svg") return null;
    const textContent = n.textContent ? n.textContent.replace(/​/g, "").replace(/ /g, "").replace(/\s+/g, "") : null;
    const lh = ctx.getInlineStyleValue(n, "line-height");
    if (lh !== null && /^0(px)?$/i.test(lh.trim())) {
      if (!textContent) return null;
    }
    if (textContent) {
      const item = {
        paragraphIndex,
        node: n,
        property: "line-height",
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n)
      };
      propertyMaps["line-height"].set(paragraphIndex, item);
      return item;
    }
    return null;
  }

  // engine/rules/width.ts
  function checkWidthViolation(n, paragraphIndex, propertyMaps, tag, ctx) {
    if (n.closest && n.closest("[data-ignore-width]")) return null;
    if (!n.closest && n.hasAttribute && n.hasAttribute("data-ignore-width")) return null;
    if (tag === "img" && !n.classList.contains("ProseMirror-separator")) {
      const item = {
        paragraphIndex,
        node: n,
        property: "width",
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n)
      };
      propertyMaps["width"].set(paragraphIndex, item);
      return item;
    }
    const w = ctx.getInlineStyleValue(n, "width");
    if (tag === "table") {
      const thead = n.querySelector("thead");
      if (thead) {
        thead.querySelectorAll("th").forEach((th, thIndex) => {
          const item = {
            paragraphIndex,
            node: th,
            property: "width",
            rule: ctx.propertyRules["width"],
            violationId: ctx.ensureViolationId(th, paragraphIndex),
            thIndex
          };
          propertyMaps["width"].set(`${paragraphIndex}_th${thIndex}`, item);
        });
      }
      return null;
    }
    if (tag !== "img" && tag !== "svg" && w !== null && w !== "" && !/auto|100%/i.test(w)) {
      const item = {
        paragraphIndex,
        node: n,
        property: "width",
        value: w,
        rule: ctx.propertyRules["width"],
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n)
      };
      propertyMaps["width"].set(paragraphIndex, item);
      return item;
    }
    return null;
  }

  // engine/rules/text-align.ts
  function checkTextAlignViolation(n, paragraphIndex, propertyMaps, ctx) {
    const ta = ctx.getInlineStyleValue(n, "text-align");
    if (ta && /^(start|end)$/i.test(ta)) {
      const item = {
        paragraphIndex,
        node: n,
        property: "text-align",
        value: ta,
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n)
      };
      propertyMaps["text-align"].set(paragraphIndex, item);
      return item;
    }
    return null;
  }

  // engine/rules/animate-begin.ts
  function checkAnimateBeginViolation(n, paragraphIndex, propertyMaps, tag, ctx) {
    if (tag !== "animate" && tag !== "animateTransform" && tag !== "animateMotion") return null;
    const beginAttr = n.getAttribute && n.getAttribute("begin");
    if (beginAttr && /\btouchstart\b/i.test(beginAttr) && !/\bclick\b/i.test(beginAttr)) {
      const item = {
        paragraphIndex,
        node: n,
        property: "animate-begin",
        value: beginAttr,
        violationId: ctx.ensureViolationId(n, paragraphIndex),
        outerHTML: ctx.getCleanOuterHTML(n)
      };
      propertyMaps["animate-begin"].set(paragraphIndex, item);
      return item;
    }
    return null;
  }

  // engine/rules/height-zero.ts
  function checkHeightZeroViolation(n, paragraphIndex, propertyMaps, tag, isInsideSvg, isInsideSvgMode, ctx) {
    if (isInsideSvg || isInsideSvgMode) return null;
    const h = ctx.getInlineStyleValue(n, "height");
    if (h !== null && /^0(px)?$/i.test(h.trim())) {
      const textContent = n.textContent ? n.textContent.replace(/​/g, "").replace(/ /g, "").replace(/\s+/g, "") : "";
      if (textContent.length > 0) {
        const violationId = ctx.ensureViolationId(n, paragraphIndex);
        const item = {
          paragraphIndex,
          node: n,
          property: "height",
          value: h,
          violationId,
          outerHTML: ctx.getCleanOuterHTML(n)
        };
        propertyMaps["height"].set(violationId, item);
        return item;
      }
    }
    return null;
  }

  // engine/rules/pre.ts
  function checkPreViolation(n, paragraphIndex, propertyMaps, ctx) {
    const textContent = n.textContent ? n.textContent.replace(/​|\s/g, "") : "";
    if (textContent.length === 0) return null;
    const violationId = ctx.ensureViolationId(n, paragraphIndex);
    const item = {
      paragraphIndex,
      node: n,
      property: "pre",
      violationId,
      outerHTML: ctx.getCleanOuterHTML(n)
    };
    propertyMaps["pre"].set(paragraphIndex, item);
    return item;
  }

  // engine/collect.ts
  var commentRegex = /<!--[\s\S]*?-->/g;
  var quickRegex = /\b(?:font-family|caret-color|opacity|line-height|text-align|width|height|animate)\b|<pre[\s>]/i;
  function toArray(maybeList) {
    if (!maybeList) return [];
    if (Array.isArray(maybeList)) return maybeList;
    try {
      return Array.prototype.slice.call(maybeList);
    } catch (e) {
      return [];
    }
  }
  function makeContext() {
    let counter = 0;
    const ensureViolationId = (node, paragraphIndex) => {
      if (!node || typeof node.getAttribute !== "function" || typeof node.setAttribute !== "function") return null;
      const existing = node.getAttribute("data-violation-id");
      if (existing) return existing;
      const id = `violation-${paragraphIndex}-${counter++}-${Date.now()}`;
      node.setAttribute("data-violation-id", id);
      return id;
    };
    return { getInlineStyleValue, isTransparentRgba, isEmptyParagraph, getCleanOuterHTML, propertyRules, ensureViolationId };
  }
  function collectViolationsInParagraph(paragraphNode, paragraphIndex) {
    const found = [];
    if (!paragraphNode) return found;
    if (isEmptyParagraph(paragraphNode)) return found;
    const ctx = makeContext();
    const propertyMaps = {
      "line-height": /* @__PURE__ */ new Map(),
      "width": /* @__PURE__ */ new Map(),
      "height": /* @__PURE__ */ new Map(),
      "caret-color": /* @__PURE__ */ new Map(),
      "opacity": /* @__PURE__ */ new Map(),
      "text-align": /* @__PURE__ */ new Map(),
      "animate-begin": /* @__PURE__ */ new Map(),
      "pre": /* @__PURE__ */ new Map()
    };
    if (!(paragraphNode.hasAttribute && paragraphNode.hasAttribute("data-ignore-width"))) {
      const paraViolationId = ctx.ensureViolationId(paragraphNode, paragraphIndex);
      propertyMaps["width"].set(`${paragraphIndex}_para`, {
        paragraphIndex,
        node: paragraphNode,
        property: "width",
        violationId: paraViolationId,
        outerHTML: paragraphNode.outerHTML,
        overflowOnly: true
      });
    }
    const q = [{ node: paragraphNode, isInsideSvg: false, isInsideSvgMode: false }];
    while (q.length) {
      const { node: n, isInsideSvg, isInsideSvgMode } = q.shift();
      const tag = n.tagName && typeof n.tagName === "string" ? n.tagName.toLowerCase() : "";
      n.setAttribute("data-blockidx", String(paragraphIndex));
      const currentInsideSvg = isInsideSvg || tag === "svg";
      const currentInsideSvgMode = isInsideSvgMode || n.getAttribute && n.getAttribute("data-mode") === "svg";
      const opacity = checkOpacityViolation(n, paragraphIndex, propertyMaps, tag, ctx);
      if (opacity) found.push(opacity);
      const caretColor = checkCaretColorViolation(n, paragraphIndex, propertyMaps, ctx);
      if (caretColor) found.push(caretColor);
      const lineHeight = checkLineHeightViolation(n, paragraphIndex, propertyMaps, tag, ctx);
      if (lineHeight) found.push(lineHeight);
      const width = checkWidthViolation(n, paragraphIndex, propertyMaps, tag, ctx);
      if (width) found.push(width);
      const textAlign = checkTextAlignViolation(n, paragraphIndex, propertyMaps, ctx);
      if (textAlign) found.push(textAlign);
      const animateBegin = checkAnimateBeginViolation(n, paragraphIndex, propertyMaps, tag, ctx);
      if (animateBegin) found.push(animateBegin);
      const heightZero = checkHeightZeroViolation(n, paragraphIndex, propertyMaps, tag, currentInsideSvg, currentInsideSvgMode, ctx);
      if (heightZero) found.push(heightZero);
      if (tag === "pre") {
        const pre = checkPreViolation(n, paragraphIndex, propertyMaps, ctx);
        if (pre) found.push(pre);
      }
      const children = toArray(n.children || n.childNodes);
      for (let i = 0; i < children.length; i++) {
        q.push({ node: children[i], isInsideSvg: currentInsideSvg, isInsideSvgMode: currentInsideSvgMode });
      }
    }
    const allResults = [];
    for (const map of Object.values(propertyMaps)) allResults.push(...Array.from(map.values()));
    return allResults;
  }
  function stampParagraphSubtree(paragraphNode, paragraphIndex) {
    if (!paragraphNode || typeof paragraphNode.setAttribute !== "function") return;
    const q = [paragraphNode];
    while (q.length) {
      const n = q.shift();
      if (n && typeof n.setAttribute === "function") {
        n.setAttribute("data-blockidx", String(paragraphIndex));
      }
      const children = toArray(n.children || n.childNodes);
      for (let i = 0; i < children.length; i++) q.push(children[i]);
    }
  }
  function getInvalidNodes(paragraphList) {
    const invalid = [];
    for (let i = 0; i < paragraphList.length; i++) {
      const pNode = paragraphList[i];
      if (!pNode || typeof pNode.parentNode === "undefined") continue;
      let anc = pNode.parentNode;
      while (anc && typeof anc.getAttribute === "function" && typeof anc.setAttribute === "function") {
        if (anc.getAttribute("data-blockidx") !== null) break;
        anc.setAttribute("data-blockidx", String(i));
        anc = anc.parentNode;
      }
    }
    paragraphList.forEach((pNode, idx) => {
      if (!pNode) return;
      stampParagraphSubtree(pNode, idx);
      let htmlStr = "";
      if (typeof pNode.outerHTML === "string") {
        htmlStr = pNode.outerHTML.replace(commentRegex, "");
      } else if (typeof pNode.innerHTML === "string") {
        htmlStr = `<root>${pNode.innerHTML}</root>`.replace(commentRegex, "");
      } else if (pNode.html) {
        htmlStr = String(pNode.html).replace(commentRegex, "");
      }
      if (htmlStr && !quickRegex.test(htmlStr)) return;
      const founds = collectViolationsInParagraph(pNode, idx);
      for (let j = 0; j < founds.length; j++) invalid.push(founds[j]);
    });
    return { isValid: invalid.length === 0, invalidNodes: invalid };
  }

  // engine/index.ts
  var DARKMODE_RUN_OPTS = {
    mode: "dark",
    defaultDarkTextColor: "#989898",
    whitelist: { attribute: ["data-no-dark"] },
    needJudgeFirstPage: false,
    noEmit: true
  };
  function resolveParagraphIndex(node, paragraphList) {
    let el = node;
    while (el) {
      if (typeof el.getAttribute === "function") {
        const idx = el.getAttribute("data-blockidx");
        if (idx !== null && idx !== void 0 && idx !== "") {
          const i = parseInt(idx, 10);
          const p = paragraphList[i];
          if (p && typeof p.contains === "function" && p.contains(node)) return i;
        }
      }
      el = el.parentNode;
    }
    return paragraphList.findIndex((p) => p && p.contains && p.contains(node));
  }
  function verifyArticleStructure(_0) {
    return __async(this, arguments, function* (articleBody, opts = {}) {
      const nodes = articleBody.querySelectorAll("*");
      const doc = typeof document !== "undefined" ? document : null;
      const detached = doc && doc.body && !articleBody.parentNode;
      if (detached) doc.body.appendChild(articleBody);
      darkmode_default.reset(nodes, DARKMODE_RUN_OPTS);
      darkmode_default.run(nodes, DARKMODE_RUN_OPTS);
      const darkmodeResult = darkmode_default.validate(articleBody, DARKMODE_RUN_OPTS);
      if (detached) doc.body.removeChild(articleBody);
      const paragraphList = paragraph_default(articleBody, {
        isMarkNode(node) {
          return domUtils.isMarkNode(node);
        },
        getNestedStructure: opts.getNestedStructure,
        ignoreFlexChildren: opts.ignoreFlexChildren,
        ignoreNotWriteableChildren: opts.ignoreNotWriteableChildren,
        getSpan: opts.getSpan
      });
      const nestedNodes = deleteNestNode({ root: articleBody, isTest: true }) || [];
      const invalidNodesResult = getInvalidNodes(paragraphList);
      const fullHtmlString = articleBody && articleBody.outerHTML ? articleBody.outerHTML : articleBody && articleBody.innerHTML ? `<section>${articleBody.innerHTML}</section>` : "";
      const layoutIssues = yield detectLayoutIssues(
        invalidNodesResult.invalidNodes,
        fullHtmlString,
        opts.layoutDetectOptions
      );
      if (nestedNodes.length > 0) {
        const byPara = /* @__PURE__ */ new Map();
        nestedNodes.forEach((item) => {
          const paragraphIndex = resolveParagraphIndex(item, paragraphList);
          const outerHTML = item.outerHTML || "";
          const key = paragraphIndex !== void 0 && paragraphIndex !== -1 ? `p_${paragraphIndex}` : item;
          const exist = byPara.get(key);
          if (!exist || (exist.outerHTML || "").length < outerHTML.length) {
            byPara.set(key, { paragraphIndex, outerHTML });
          }
        });
        layoutIssues.nestNodes = { violateRules: propertyRules["nest-level"], items: Array.from(byPara.values()) };
      }
      if (darkmodeResult.length > 0) {
        const byKey = {};
        darkmodeResult.forEach((item) => {
          if (!item || !item.key) return;
          if (!byKey[item.key]) byKey[item.key] = { violateRules: item.violateRules || "", items: [] };
          byKey[item.key].items.push({
            outerHTML: item.outerHTML || (item.dom ? item.dom.outerHTML : ""),
            // 用违规 dom 节点反查真实段号（mp-darkmode 不返回段落信息，旧逻辑
            // `|| 0` 把所有 item 兜底成第 1 段，编辑器「定位」按钮全部跳错）。
            // dom 已在原始容器上，data-blockidx 由 getInvalidNodes 盖章，可反查。
            // 找不到时返回 -1（诚实未知），不要假装成第 1 段。
            paragraphIndex: resolveParagraphIndex(item.dom, paragraphList)
          });
        });
        Object.assign(layoutIssues, byKey);
      }
      const filteredInfo = {};
      for (const [property, issueGroup] of Object.entries(layoutIssues)) {
        filteredInfo[property] = {
          violateRules: issueGroup.violateRules,
          items: issueGroup.items.map((item) => {
            const filtered = { paragraphIndex: item.paragraphIndex, outerHTML: item.outerHTML };
            if (item.rules) filtered.rules = item.rules;
            if (item.thIndex !== void 0) filtered.thIndex = item.thIndex;
            return filtered;
          })
        };
      }
      const hasInValidData = Object.values(filteredInfo).some((g) => g.items && g.items.length > 0);
      return hasInValidData ? { isValid: false, inValidInfo: filteredInfo } : { isValid: true, inValidInfo: {} };
    });
  }
  return __toCommonJS(engine_exports);
})();
