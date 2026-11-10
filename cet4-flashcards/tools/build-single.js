#!/usr/bin/env node
/**
 * 打包单文件版：把 CSS 与全部 JS 内联进 index.html，输出 cet4-flashcards.html
 * 用法：node tools/build-single.js
 * 产物可直接双击打开，也可发给别人离线使用。
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var OUT = path.join(ROOT, "cet4-flashcards.html");
var INDEX = path.join(ROOT, "index.html");

function read(rel) {
  var file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error("缺少文件：" + rel);
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

function safeInline(code) {
  // 防止脚本内容提前闭合 <script>
  return code.replace(/<\/script/gi, "<\\/script");
}

function main() {
  var html = read("index.html");
  var css = read("css/styles.css");
  var jsFiles = ["js/data-a.js", "js/data-b.js", "js/core.js", "js/app.js"];

  if (!/<link[^>]+href="css\/styles\.css"[^>]*>/.test(html)) {
    throw new Error("index.html 中未找到 styles.css 的 link 标签");
  }
  html = html.replace(/<link[^>]+href="css\/styles\.css"[^>]*>/, function () {
    return "<style>\n" + css + "\n</style>";
  });

  jsFiles.forEach(function (rel) {
    var pattern = new RegExp('<script src="' + rel.replace(/\//g, "\\/") + '"><\\/script>');
    if (!pattern.test(html)) throw new Error("index.html 中未找到脚本标签：" + rel);
    html = html.replace(pattern, function () {
      return "<script>\n/* ===== " + rel + " ===== */\n" + safeInline(read(rel)) + "\n</script>";
    });
  });

  var banner = "<!-- CET-4 高频单词卡 · 单文件离线版（由 tools/build-single.js 生成，勿直接编辑） -->\n";
  fs.writeFileSync(OUT, banner + html, "utf8");

  var kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log("✓ 已生成 " + path.basename(OUT) + "（" + kb + " KB）");
  console.log("  内联：" + ["css/styles.css"].concat(jsFiles).join("、"));
}

try {
  main();
} catch (e) {
  console.error("✗ 打包失败：" + e.message);
  process.exit(1);
}
