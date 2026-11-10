#!/usr/bin/env node
/**
 * 静态 UI 契约检查（不需要浏览器）：
 * - index.html 引用的 css/js 文件是否存在、脚本顺序是否正确
 * - app.js 里 $("id") / getElementById 引用的 id 是否都在 index.html 中存在
 * - app.js/HTML 使用的 data-* 取值是否齐全
 * 用法：node tools/check-ui.js
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var errors = [];
var warnings = [];

function read(rel) {
  var file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    errors.push("缺少文件 " + rel);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

var html = read("index.html");
var appJs = read("js/app.js");
var css = read("css/styles.css");

/* 1. 资源引用与脚本顺序 */
var links = [];
html.replace(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g, function (_, href) { links.push(href); return _; });
links.forEach(function (href) {
  if (/^(data:|https?:)/.test(href)) return;
  if (!fs.existsSync(path.join(ROOT, href))) errors.push("index.html 引用了不存在的样式：" + href);
});

var scripts = [];
html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) { scripts.push(src); return _; });
var expected = ["js/data-a.js", "js/data-b.js", "js/core.js", "js/app.js"];
if (scripts.join("|") !== expected.join("|")) {
  errors.push("脚本顺序应为 " + expected.join(" → ") + "，实际：" + scripts.join(" → "));
}
scripts.forEach(function (src) {
  if (!fs.existsSync(path.join(ROOT, src))) errors.push("index.html 引用了不存在的脚本：" + src);
});

/* 2. ID 契约 */
var ids = Object.create(null);
html.replace(/\bid="([^"]+)"/g, function (_, id) { ids[id] = true; return _; });

var refs = Object.create(null);
appJs.replace(/\$\("([^"]+)"\)/g, function (_, id) { refs[id] = true; return _; });
appJs.replace(/getElementById\("([^"]+)"\)/g, function (_, id) { refs[id] = true; return _; });

Object.keys(refs).sort().forEach(function (id) {
  if (!ids[id]) errors.push('app.js 引用了 index.html 中不存在的 id：“' + id + '”');
});

/* 3. data-* 取值契约 */
function collectAttr(source, attr) {
  var set = Object.create(null);
  var re = new RegExp(attr + '="([^"]+)"', "g"), m;
  while ((m = re.exec(source)) !== null) set[m[1]] = true;
  return set;
}
["data-view", "data-mark", "data-mode", "data-accent"].forEach(function (attr) {
  var inHtml = Object.keys(collectAttr(html, attr));
  // app.js 通常通过 getAttribute(attr) 读取，值散落在常量里，因此逐值在 JS 全文中查找
  if (appJs.indexOf(attr) === -1) {
    warnings.push(attr + " 在 HTML 中出现，但 app.js 未读取该属性");
    return;
  }
  var unused = inHtml.filter(function (v) { return appJs.indexOf(v) === -1; });
  if (unused.length) warnings.push(attr + " 的取值未在 app.js 中出现：" + unused.join(", "));
});

/* 4. 动态类名是否至少出现在 CSS（警告级） */
["empty", "sense", "pos-chip", "example", "phrase", "option", "wrong-item", "history-item"].forEach(function (cls) {
  if (css.indexOf("." + cls) === -1) warnings.push("CSS 中未见动态类 ." + cls);
});

/* 5. 页脚/顶栏统计占位符存在性 */
["stat-mastered", "stat-total", "stat-accuracy", "footer-count"].forEach(function (id) {
  if (!ids[id]) errors.push("缺少统计占位元素 #" + id);
});

if (warnings.length) {
  console.log("⚠ 警告：");
  warnings.forEach(function (w) { console.log("  - " + w); });
}
if (errors.length) {
  console.error("✗ UI 契约检查失败：");
  errors.forEach(function (e) { console.error("  - " + e); });
  process.exit(1);
}
console.log("✓ UI 契约检查通过（" + Object.keys(refs).length + " 个 id 引用、脚本顺序正确）");
