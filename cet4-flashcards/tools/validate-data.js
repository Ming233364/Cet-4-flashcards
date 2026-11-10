#!/usr/bin/env node
/**
 * 词库校验：结构、字段、音标、释义、例句、短语、考频星级、真题标记、词表一致性
 * 用法：node tools/validate-data.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.resolve(__dirname, "..");
var Core = require(path.join(ROOT, "js", "core.js"));

var DATA_FILES = [
  { rel: "js/data-a.js", global: "CET4_WORDS_A", list: "tools/words-a.txt" },
  { rel: "js/data-b.js", global: "CET4_WORDS_B", list: "tools/words-b.txt" }
];

var errors = [];
var warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function loadData(spec) {
  var file = path.join(ROOT, spec.rel);
  if (!fs.existsSync(file)) {
    fail("缺少数据文件：" + spec.rel);
    return null;
  }
  var code = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  var sandbox = { window: {} };
  try {
    vm.runInNewContext(code, sandbox, { filename: spec.rel, timeout: 8000 });
  } catch (e) {
    fail(spec.rel + " 执行失败：" + e.message);
    return null;
  }
  var arr = sandbox.window[spec.global];
  if (!Array.isArray(arr)) {
    fail(spec.rel + " 未定义 window." + spec.global + " 数组");
    return null;
  }
  return arr;
}

function readWordList(rel) {
  var file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { fail("缺少词表：" + rel); return []; }
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function hasChinese(s) { return /[\u4e00-\u9fa5]/.test(s); }
function isIpa(s) { return /^\/.+\/$/.test(s); }

/* 常见不规则变形，避免把 arose / began 这类正确例句误报 */
var IRREGULAR = {
  arise: ["arose", "arisen"], become: ["became"], begin: ["began", "begun"],
  break: ["broke", "broken"], bring: ["brought"], buy: ["bought"], catch: ["caught"],
  choose: ["chose", "chosen"], come: ["came"], do: ["did", "done"], drive: ["drove", "driven"],
  fall: ["fell", "fallen"], feel: ["felt"], find: ["found"], get: ["got", "gotten"],
  give: ["gave", "given"], grow: ["grew", "grown"], hold: ["held"], keep: ["kept"],
  know: ["knew", "known"], leave: ["left"], lose: ["lost"], make: ["made"], mean: ["meant"],
  meet: ["met"], pay: ["paid"], rise: ["rose", "risen"], run: ["ran"], say: ["said"],
  see: ["saw", "seen"], sell: ["sold"], send: ["sent"], show: ["shown"], speak: ["spoke", "spoken"],
  spend: ["spent"], take: ["took", "taken"], teach: ["taught"], tell: ["told"],
  think: ["thought"], throw: ["threw", "thrown"], wear: ["wore", "worn"], write: ["wrote", "written"]
};

/* 宽松判断例句是否使用了目标词（允许常见变形） */
function stemUsed(sentence, word) {
  var s = sentence.toLowerCase();
  if (s.indexOf(word) !== -1) return true;
  var irregular = IRREGULAR[word] || [];
  if (irregular.some(function (f) { return s.indexOf(f) !== -1; })) return true;
  var base = word.replace(/e$/, "");
  var patterns = [base + "s", base + "ed", base + "ing", base + "d", base + "ly"];
  if (/[^aeiou]y$/.test(word)) {
    var yBase = word.slice(0, -1);
    patterns.push(yBase + "ies", yBase + "ied", yBase + "ier", yBase + "iest");
  }
  return patterns.some(function (p) { return s.indexOf(p) !== -1; });
}

function checkEntry(raw, where) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(where + "：不是对象");
    return null;
  }
  ["word", "us", "uk", "pos", "senses", "examples", "phrases", "star", "examYears", "examCount", "forms", "idioms"].forEach(function (k) {
    if (!(k in raw)) fail(where + "：缺少字段 " + k);
  });

  var word = typeof raw.word === "string" ? raw.word.trim() : "";
  if (!/^[a-z][a-z'-]*$/.test(word)) fail(where + "：word 非法「" + raw.word + "」");

  ["us", "uk"].forEach(function (k) {
    if (typeof raw[k] !== "string" || !raw[k].trim()) fail(where + "：缺少 " + k + " 音标");
    else if (!isIpa(raw[k].trim())) warn(where + "：" + k + " 音标格式可疑「" + raw[k] + "」");
  });

  if (!Array.isArray(raw.pos) || !raw.pos.length) fail(where + "：pos 必须为非空数组");
  else if (raw.pos.some(function (p) { return typeof p !== "string" || !p.trim(); })) {
    fail(where + "：pos 含空值");
  }

  if (!Array.isArray(raw.senses) || raw.senses.length < 1 || raw.senses.length > 3) {
    fail(where + "：senses 数量应为 1–3");
  } else {
    raw.senses.forEach(function (s, i) {
      if (!Array.isArray(s) || s.length < 2) fail(where + "：senses[" + i + "] 应为 [词性, 中文]");
      else {
        if (typeof s[0] !== "string" || !s[0].trim()) fail(where + "：senses[" + i + "][0] 词性为空");
        if (typeof s[1] !== "string" || !s[1].trim()) fail(where + "：senses[" + i + "][1] 释义为空");
        else if (!hasChinese(s[1])) fail(where + "：senses[" + i + "][1] 不含中文「" + s[1] + "」");
      }
    });
  }

  if (!Array.isArray(raw.examples) || raw.examples.length > 2) {
    fail(where + "：examples 数量应为 0–2");
  } else {
    raw.examples.forEach(function (ex, i) {
      if (!Array.isArray(ex) || ex.length < 2) {
        fail(where + "：examples[" + i + "] 应为 [英文, 中文]");
        return;
      }
      if (typeof ex[0] !== "string" || ex[0].trim().length < 4) fail(where + "：examples[" + i + "] 英文过短");
      else if (!hasChinese(ex[1])) fail(where + "：examples[" + i + "] 缺中文翻译");
      if (typeof ex[0] === "string" && word && !stemUsed(ex[0], word)) {
        warn(where + "：examples[" + i + "] 英文例句可能未使用该词");
      }
    });
  }

  var phraseMax = raw.star >= 4 ? 4 : (raw.star === 3 ? 3 : 2);
  if (!Array.isArray(raw.phrases) || raw.phrases.length > phraseMax) {
    fail(where + "：phrases 数量应为 0–" + phraseMax + "（当前 star=" + raw.star + "）");
  } else {
    raw.phrases.forEach(function (p, i) {
      if (!Array.isArray(p) || p.length < 2) fail(where + "：phrases[" + i + "] 应为 [搭配, 中文]");
      else if (typeof p[0] !== "string" || !p[0].trim()) fail(where + "：phrases[" + i + "][0] 为空");
      else if (!hasChinese(p[1])) fail(where + "：phrases[" + i + "] 缺中文");
    });
  }

  if (!Array.isArray(raw.forms) || raw.forms.length > 4) {
    fail(where + "：forms 数量应为 0–4");
  } else {
    raw.forms.forEach(function (f, i) {
      if (!Array.isArray(f) || f.length < 2) fail(where + "：forms[" + i + "] 应为 [形式, 词性]");
      else {
        if (typeof f[0] !== "string" || !/^[a-z][a-z' -]*$/.test(f[0].trim())) fail(where + "：forms[" + i + "][0] 非法「" + f[0] + "」");
        if (typeof f[1] !== "string" || !f[1].trim()) fail(where + "：forms[" + i + "][1] 词性为空");
        if (f.length >= 3 && (!hasChinese(f[2]) || String(f[2]).trim().length > 60)) fail(where + "：forms[" + i + "][2] 中文释义缺失或过长");
      }
    });
  }

  if (!Array.isArray(raw.idioms) || raw.idioms.length > 2) {
    fail(where + "：idioms 数量应为 0–2");
  } else {
    raw.idioms.forEach(function (p, i) {
      if (!Array.isArray(p) || p.length < 2) fail(where + "：idioms[" + i + "] 应为 [英文, 中文]");
      else {
        if (typeof p[0] !== "string" || p[0].trim().length < 3) fail(where + "：idioms[" + i + "][0] 英文过短");
        if (!hasChinese(p[1])) fail(where + "：idioms[" + i + "] 缺中文");
      }
    });
  }

  if (!Number.isInteger(raw.star) || raw.star < 1 || raw.star > 5) {
    fail(where + "：star 应为 1–5 的整数，实际「" + raw.star + "」");
  }

  if (!Array.isArray(raw.examYears)) {
    fail(where + "：examYears 必须为数组");
  } else {
    raw.examYears.forEach(function (y) {
      if (typeof y !== "string" || !/^\d{4}-\d{2}$/.test(y)) {
        fail(where + "：examYears 含非法场次「" + y + "」");
      }
    });
    if (new Set(raw.examYears).size !== raw.examYears.length) {
      fail(where + "：examYears 含重复场次");
    }
  }

  if (!Number.isInteger(raw.examCount) || raw.examCount < 0) {
    fail(where + "：examCount 应为非负整数");
  } else if (raw.examYears.length === 0 && raw.examCount !== 0) {
    fail(where + "：examYears 为空但 examCount 非 0");
  }

  return { word: word, raw: raw };
}

function main() {
  var allWords = [];
  var total = 0;

  DATA_FILES.forEach(function (spec) {
    var arr = loadData(spec);
    if (!arr) return;
    total += arr.length;
    console.log("• " + spec.rel + "：" + arr.length + " 条记录");

    var expected = readWordList(spec.list);
    var seen = Object.create(null);
    var actual = [];

    arr.forEach(function (raw, i) {
      var where = spec.rel + " 第 " + (i + 1) + " 条";
      var info = checkEntry(raw, where);
      if (!info) return;
      if (!info.word) return;
      if (seen[info.word]) fail(where + "：单词重复「" + info.word + "」");
      seen[info.word] = true;
      actual.push(info.word);
      allWords.push(info.word);
    });

    if (expected.length && actual.length === expected.length) {
      for (var i = 0; i < expected.length; i++) {
        if (expected[i] !== actual[i]) {
          fail(spec.list + " 与 " + spec.rel + " 顺序/内容不一致：第 " + (i + 1) +
            " 个应为「" + expected[i] + "」，实际「" + actual[i] + "」");
          break;
        }
      }
    } else if (expected.length && actual.length !== expected.length) {
      fail(spec.rel + " 单词数 " + actual.length + " 与词表 " + spec.list + " 的 " + expected.length + " 不一致");
    }

    var dupInFile = actual.filter(function (w, i) { return actual.indexOf(w) !== i; });
    if (dupInFile.length) fail(spec.rel + " 存在重复单词：" + dupInFile.join(", "));

    // 标准化后检查（与运行时解析保持一致）
    var normalized = Core.normalizeWords(arr);
    if (normalized.length !== arr.length) {
      fail(spec.rel + "：标准化后词数 " + normalized.length + " ≠ 原始 " + arr.length + "（存在非法/重复条目）");
    }
    normalized.forEach(function (w) {
      if (!w.us || !w.uk) fail(spec.rel + "：" + w.word + " 缺音标");
      if (!w.senses.length) fail(spec.rel + "：" + w.word + " 缺释义");
      if (w.examples.length > 2) fail(spec.rel + "：" + w.word + " 例句数超过 2");
      if (w.forms.length > 4) fail(spec.rel + "：" + w.word + " 词性转换超过 4");
      if (w.idioms.length > 2) fail(spec.rel + "：" + w.word + " 地道表达超过 2");
      var pm = w.star >= 4 ? 4 : (w.star === 3 ? 3 : 2);
      if (w.phrases.length > pm) fail(spec.rel + "：" + w.word + " 短语数超过 " + pm);
      if (!w.star || w.star < 1 || w.star > 5) fail(spec.rel + "：" + w.word + " 星级非法");
      if (w.examYears.length && !w.examCount) fail(spec.rel + "：" + w.word + " 有真题场次但次数为 0");
    });
  });

  var dupAll = allWords.filter(function (w, i) { return allWords.indexOf(w) !== i; });
  if (dupAll.length) fail("A/B 两组存在跨文件重复：" + dupAll.join(", "));

  console.log("\n合计：" + total + " 词（去重后 " + new Set(allWords).size + "）");
  if (warnings.length) {
    console.log("\n⚠ 警告 " + warnings.length + " 条：");
    warnings.slice(0, 30).forEach(function (w) { console.log("  - " + w); });
    if (warnings.length > 30) console.log("  … 其余 " + (warnings.length - 30) + " 条省略");
  }
  if (errors.length) {
    console.error("\n✗ 校验失败，共 " + errors.length + " 个问题：");
    errors.slice(0, 60).forEach(function (e) { console.error("  - " + e); });
    if (errors.length > 60) console.error("  … 其余 " + (errors.length - 60) + " 条省略");
    process.exit(1);
  }
  console.log("\n✓ 词库校验通过");
}

main();
