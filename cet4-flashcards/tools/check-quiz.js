#!/usr/bin/env node
/* 真实词库的出题集成检查：
   - 用 data-a/data-b 全量词库为四种题型各生成一轮「全覆盖」测验
   - 校验每题选项数量/去重/包含答案、拼写题无选项、题干与答案一致
   - 校验周测/月测的混合题型、4★ 全纳入、每词至少两种题型与词组题
   运行：node tools/check-quiz.js
*/
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");

function loadData(file) {
  var ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
  return ctx.window;
}

var w = loadData("js/data-a.js");
var w2 = loadData("js/data-b.js");
var words = (w.CET4_WORDS_A || []).concat(w2.CET4_WORDS_B || []);
if (words.length !== 4545) {
  console.error("✗ 期望 4545 词，实际 " + words.length);
  process.exit(1);
}

var Core = require(path.join(root, "js/core.js"));
var engine = Core.createEngine(words);
var MARKS = Core.MARKS;
var failures = [];
var checks = 0;

function fail(msg) {
  failures.push(msg);
}

var MODES = ["en2cn", "cn2en", "listen", "spell"];

MODES.forEach(function (mode) {
  var quiz = engine.buildQuiz({ mode: mode, size: words.length, scope: "all" });
  if (quiz.questions.length !== words.length) {
    fail(mode + "：题量 " + quiz.questions.length + " ≠ 词库 " + words.length);
  }
  var seen = Object.create(null);

  quiz.questions.forEach(function (q) {
    checks++;
    var tag = mode + " / " + q.word;
    if (seen[q.word]) fail(tag + "：同一轮出现重复单词");
    seen[q.word] = true;
    if (!q.entry || q.entry.word !== q.word) fail(tag + "：entry 缺失或词形不一致");
    if (!q.prompt) fail(tag + "：题干为空");
    if (mode !== "en2cn" && q.answer !== q.word) {
      fail(tag + "：答案应为单词本身，实际 " + q.answer);
    }

    if (mode === "spell") {
      if (q.options.length) fail(tag + "：拼写题不应有选项");
      if (q.prompt !== Core.senseText(q.entry)) fail(tag + "：拼写题题干应为完整释义");
      return;
    }

    if (q.options.length !== 4) fail(tag + "：选项应为 4 个，实际 " + q.options.length);
    if (q.options.indexOf(q.answer) === -1) fail(tag + "：选项未包含正确答案");
    if (new Set(q.options).size !== q.options.length) fail(tag + "：选项存在重复");

    if (mode === "en2cn") {
      if (q.prompt !== q.word) fail(tag + "：题干应为单词");
      if (q.answer !== Core.primarySense(q.entry)) fail(tag + "：答案应为主释义");
    } else {
      if (q.prompt === q.word) fail(tag + "：题干不应直接显示单词");
      q.options.forEach(function (opt) {
        if (!engine.entry(opt)) fail(tag + "：选项不是词库单词 → " + opt);
      });
    }
  });

  var covered = Object.keys(seen).length;
  if (covered !== words.length) fail(mode + "：仅覆盖 " + covered + " 词");
});

/* 拼写答案必须可被小写输入命中 */
var miss = words.filter(function (w) { return w.word !== w.word.trim().toLowerCase(); });
if (miss.length) fail("存在非小写/含空白词形：" + miss.map(function (w) { return w.word; }).join(", "));

/* 标记 -> 出题范围联动（抽样几个词验证 scope 过滤真的生效） */
var sample = words[0].word;
engine.setMark(sample, MARKS.KNOWN);
var unmastered = engine.buildQuiz({ mode: "en2cn", size: words.length, scope: "unmastered" });
if (unmastered.questions.some(function (q) { return q.word === sample; })) {
  fail("已掌握词仍出现在 unmastered 范围");
}
var mastered = engine.buildQuiz({ mode: "en2cn", size: 5, scope: "all" });
engine.toggleFav(words[1].word);
var favQuiz = engine.buildQuiz({ mode: "en2cn", size: 5, scope: "fav" });
if (!favQuiz.questions.length) fail("收藏范围出题为空");
else if (favQuiz.questions.some(function (q) { return q.word !== words[1].word; })) {
  fail("收藏范围混入未收藏词");
}

/* 星级 / 真题范围必须与统计一致，且只包含对应词 */
var stats = engine.stats();
var starQuiz = engine.buildQuiz({ mode: "en2cn", size: words.length, scope: "star5" });
if (starQuiz.questions.length !== stats.star5) {
  fail("star5 范围题量 " + starQuiz.questions.length + " ≠ 统计 " + stats.star5);
}
if (starQuiz.questions.some(function (q) { return q.entry.star !== 5; })) {
  fail("star5 范围混入非五星词");
}
var examQuiz = engine.buildQuiz({ mode: "en2cn", size: words.length, scope: "exam" });
if (examQuiz.questions.length !== stats.examWords) {
  fail("exam 范围题量 " + examQuiz.questions.length + " ≠ 统计 " + stats.examWords);
}
if (examQuiz.questions.some(function (q) { return !q.entry.examYears.length; })) {
  fail("exam 范围混入无真题标记的词");
}

/* 周测/月测：近期记录、星级题型限制、4★ 全纳入、每词至少两种题型、词组题 */
var picked = [];
[5, 4, 3, 2, 1].forEach(function (star) {
  var n = star >= 4 ? 3 : 2;
  words.filter(function (w) { return w.star === star; }).slice(0, n).forEach(function (w) {
    if (picked.length < 12 && picked.indexOf(w) === -1) picked.push(w);
  });
});
var reviewEngine = Core.createEngine(words, { storage: Core.memoryStorage() });
picked.forEach(function (w, i) {
  reviewEngine.setMark(w.word, [MARKS.FUZZY, MARKS.UNKNOWN, MARKS.KNOWN][i % 3]);
});
var review = reviewEngine.buildReviewQuiz({ period: "week", size: picked.length });
if (!review.questions.length) fail("周测没有生成任何题目");
if (review.wordCount !== picked.length) fail("周测词数 " + review.wordCount + " ≠ 抽样 " + picked.length);
var reviewModes = Object.create(null);
review.questions.forEach(function (q) {
  checks++;
  reviewModes[q.word] = reviewModes[q.word] || [];
  reviewModes[q.word].push(q.mode);
  if (["en2cn", "cn2en", "listen", "spell", "phrase", "phrase-en2cn", "phrase-listen"].indexOf(q.mode) === -1) {
    fail("周测未知题型 " + q.mode);
  }
  if (q.mode === "phrase" || q.mode === "phrase-en2cn" || q.mode === "phrase-listen") {
    if (q.entry.star < 4) fail("词组题只应出现在 4★ 以上：" + q.word);
    if (q.options.length !== 4) fail("词组题选项应为 4 个：" + q.word);
    if (q.options.indexOf(q.answer) === -1) fail("词组题未包含正确答案：" + q.word);
    if (q.mode === "phrase-listen" && q.audioText !== q.answer) fail("短语听音题 audioText 不正确：" + q.word);
    if (q.mode === "phrase" && String(q.prompt).toLowerCase().indexOf(String(q.word).toLowerCase()) >= 0) {
      fail("词组题不应在题干泄露相关词：" + q.word);
    }
  }
  if (q.entry.star <= 3 && q.mode === "spell") fail("低星词不应考拼写：" + q.word + "（" + q.entry.star + "★）");
});
picked.forEach(function (w) {
  var modes = reviewModes[w.word] || [];
  if (modes.length < 2) fail("周测词 " + w.word + " 少于两种题型");
  if (new Set(modes).size !== modes.length) fail("周测词 " + w.word + " 题型重复");
  if (w.star >= 4 && !modes.length) fail("4★ 以上词未纳入周测：" + w.word);
});
if (!review.questions.some(function (q) { return /^phrase/.test(q.mode); })) {
  fail("周测未出现词组类题目");
}
/* v2.3 多选模式：总题数受控且混合题型 */
var multi = reviewEngine.buildQuiz({ modes: ["en2cn", "cn2en", "phrase"], size: 12, scope: "all" });
if (multi.questions.length !== 12) fail("多选模式题数 " + multi.questions.length + " ≠ 12");
if (multi.mode !== "mixed") fail("多选模式未标记 mixed");
if (new Set(multi.questions.map(function (q) { return q.mode; })).size < 2) fail("多选模式未混合题型");

if (failures.length) {
  console.error("✗ 出题集成检查失败 " + failures.length + " 项：");
  failures.slice(0, 20).forEach(function (f) { console.error("  - " + f); });
  process.exit(1);
}
console.log("✓ 出题集成检查通过：" + checks + " 道题（" + MODES.length + " 种模式 × " + words.length + " 词）" +
  "，选项/答案/范围联动全部正常");
