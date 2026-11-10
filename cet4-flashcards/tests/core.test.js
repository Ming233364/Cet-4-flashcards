#!/usr/bin/env node
"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("path");
var Core = require(path.join(__dirname, "..", "js", "core.js"));

function makeWord(i) {
  return {
    word: "word" + i,
    us: "/wɜːrd" + i + "/",
    uk: "/wɜːd" + i + "/",
    pos: ["n."],
    senses: [["n.", "释义" + i], ["v.", "动词义" + i]],
    examples: [["The word" + i + " is useful.", "这个词很有用。"], ["We use word" + i + " daily.", "我们每天使用它。"]],
    phrases: [["word" + i + " list", "词汇表" + i]],
    star: ((i - 1) % 5) + 1,
    examYears: i % 3 === 0 ? ["2024-06"] : [],
    examCount: i % 3 === 0 ? 2 : 0
  };
}

function makeWords(n) {
  var out = [];
  for (var i = 1; i <= n; i++) out.push(makeWord(i));
  return out;
}

function makeEngine(n, rng) {
  return Core.createEngine(makeWords(n || 40), {
    storage: Core.memoryStorage(),
    rng: rng || (function () {
      var s = 42;
      return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    })()
  });
}

test("normalizeWords 去重、转小写、补默认值", function () {
  var list = Core.normalizeWords([
    { word: " Apple ", us: "/ˈæpəl/", uk: "/ˈæpl/", pos: ["n."], senses: [["n.", "苹果"]] },
    { word: "apple", us: "", uk: "", pos: [], senses: [] },
    { word: "" },
    null
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].word, "apple");
  assert.equal(list[0].examples.length, 0);
  assert.equal(list[0].phrases.length, 0);
});

test("primarySense / senseText 拼接", function () {
  var w = Core.normalizeWord(makeWord(1)) || Core.normalizeWords([makeWord(1)])[0];
  assert.equal(Core.primarySense(w), "n. 释义1");
  assert.equal(Core.senseText(w), "n. 释义1；v. 动词义1");
});

test("标记与收藏写入统计", function () {
  var e = makeEngine(20);
  e.setMark("word1", Core.MARKS.KNOWN);
  e.setMark("word2", Core.MARKS.FUZZY);
  e.setMark("word3", Core.MARKS.UNKNOWN);
  assert.equal(e.getMark("word1"), "known");
  assert.equal(e.getMark("word4"), "new");

  e.toggleFav("word1");
  assert.equal(e.isFav("word1"), true);
  e.toggleFav("word1");
  assert.equal(e.isFav("word1"), false);

  var s = e.stats();
  assert.equal(s.total, 20);
  assert.equal(s.mastered, 1);
  assert.equal(s.fuzzy, 1);
  assert.equal(s.unknown, 1);
  assert.equal(s.fresh, 17);
  assert.equal(s.studied, 3);
  assert.equal(s.unmastered, 19);
  assert.equal(s.testedWords, 0); // 仅标记、未答题不得计入"已测词"
  assert.equal(s.answered, 0);
});

test("持久化：同一 storage 新建引擎可恢复状态", function () {
  var storage = Core.memoryStorage();
  var e1 = Core.createEngine(makeWords(10), { storage: storage });
  e1.setMark("word2", "known");
  e1.toggleFav("word3");
  e1.recordAnswer("word2", true);

  var e2 = Core.createEngine(makeWords(10), { storage: storage });
  assert.equal(e2.getMark("word2"), "known");
  assert.equal(e2.isFav("word3"), true);
  assert.equal(e2.stats().answered, 1);
  assert.equal(e2.stats().correct, 1);
});

test("答题统计与错题本增减", function () {
  var e = makeEngine(10);
  e.recordAnswer("word1", false);
  e.recordAnswer("word1", false);
  assert.equal(e.wrongList()[0].word, "word1");
  assert.equal(e.wrongList()[0].count, 2);

  e.recordAnswer("word1", true);
  assert.equal(e.wrongList()[0].count, 1);

  e.recordAnswer("word1", true);
  assert.equal(e.wrongList().length, 0);

  var s = e.stats();
  assert.equal(s.answered, 4);
  assert.equal(s.correct, 2);
  assert.equal(s.accuracy, 50);
  assert.equal(s.testedWords, 1);
});

test("英译中：4 个选项且包含正确答案", function () {
  var e = makeEngine(40);
  var quiz = e.buildQuiz({ mode: "en2cn", size: 10 });
  assert.equal(quiz.questions.length, 10);
  quiz.questions.forEach(function (q) {
    assert.equal(q.mode, "en2cn");
    assert.ok(q.prompt);
    assert.equal(q.options.length, 4);
    assert.ok(q.options.indexOf(q.answer) !== -1);
    assert.equal(new Set(q.options).size, 4);
  });
});

test("中译英：选项为单词且包含答案", function () {
  var e = makeEngine(40);
  var quiz = e.buildQuiz({ mode: "cn2en", size: 8 });
  quiz.questions.forEach(function (q) {
    assert.match(q.prompt, /释义/);
    assert.equal(q.options.length, 4);
    assert.ok(q.options.indexOf(q.word) !== -1);
    assert.ok(q.answer);
  });
});

test("听音选词：题干隐藏单词，选项为单词", function () {
  var e = makeEngine(40);
  var quiz = e.buildQuiz({ mode: "listen", size: 6 });
  quiz.questions.forEach(function (q) {
    assert.ok(q.prompt.indexOf("🔊") === 0);
    assert.equal(q.options.length, 4);
    assert.ok(q.options.indexOf(q.word) !== -1);
  });
});

test("拼写模式：无选项，答案为单词", function () {
  var e = makeEngine(40);
  var quiz = e.buildQuiz({ mode: "spell", size: 5 });
  quiz.questions.forEach(function (q) {
    assert.equal(q.options.length, 0);
    assert.equal(q.answer.indexOf("word"), 0);
    assert.ok(q.prompt.length > 0);
  });
});

test("出题范围：收藏 / 错题 / 未掌握", function () {
  var e = makeEngine(12);
  e.toggleFav("word1");
  e.toggleFav("word2");
  var favQuiz = e.buildQuiz({ mode: "cn2en", size: 5, scope: "fav" });
  assert.equal(favQuiz.questions.length, 2);
  favQuiz.questions.forEach(function (q) {
    assert.ok(q.word === "word1" || q.word === "word2");
  });

  e.recordAnswer("word5", false);
  var wrongQuiz = e.buildQuiz({ mode: "en2cn", size: 5, scope: "wrong" });
  assert.equal(wrongQuiz.questions.length, 1);
  assert.equal(wrongQuiz.questions[0].word, "word5");

  e.setMark("word3", "known");
  var unmastered = e.buildQuiz({ mode: "en2cn", size: 30, scope: "unmastered" });
  assert.equal(unmastered.questions.length, 11);
  assert.ok(unmastered.questions.every(function (q) { return q.word !== "word3"; }));
});

test("listWords：搜索、首字母、状态筛选", function () {
  var e = makeEngine(30);
  e.setMark("word1", "known");
  e.setMark("word2", "known");
  e.toggleFav("word3");

  assert.equal(e.listWords({ status: "mastered" }).length, 2);
  assert.equal(e.listWords({ status: "fav" }).length, 1);
  assert.equal(e.listWords({ q: "释义1" }).length, 11); // 释义1 / 释义10..19
  assert.equal(e.listWords({ q: "word1" }).length, 11);
  assert.equal(e.listWords({ letter: "w" }).length, 30);
  assert.equal(e.listWords({ letter: "all" }).length, 30); // "全部字母" 哨兵不得过滤掉任何词
  assert.equal(e.listWords({ letter: "W" }).length, 30);
});

test("星级与近三年真题：筛选、测验范围、统计", function () {
  var e = makeEngine(30);
  assert.equal(e.listWords({ star: "5" }).length, 6);       // word5/10/15/20/25/30
  assert.equal(e.listWords({ star: "1" }).length, 6);
  assert.equal(e.listWords({ exam: true }).length, 10);     // 3 的倍数
  assert.equal(e.listWords({ star: "5", exam: true }).length, 2); // word15、word30
  assert.equal(e.listWords({ star: "all" }).length, 30);

  var s = e.stats();
  assert.equal(s.examWords, 10);
  assert.equal(s.star5, 6);
  assert.deepEqual(s.starCounts, { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 });

  var starQuiz = e.buildQuiz({ mode: "en2cn", size: 30, scope: "star5" });
  assert.equal(starQuiz.questions.length, 6);
  starQuiz.questions.forEach(function (q) { assert.equal(q.entry.star, 5); });

  var examQuiz = e.buildQuiz({ mode: "en2cn", size: 30, scope: "exam" });
  assert.equal(examQuiz.questions.length, 10);
  examQuiz.questions.forEach(function (q) { assert.ok(q.entry.examYears.length > 0); });
});

test("星级/真题字段非法值归一化", function () {
  var list = Core.normalizeWords([
    { word: "alpha", star: 9, examYears: ["2024-06", "2024-06", "bad", "2023-12"], examCount: -3 },
    { word: "beta", star: "4", examYears: "2024-06", examCount: "x" }
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].star, 1);
  assert.deepEqual(list[0].examYears, ["2023-12", "2024-06"]);
  assert.equal(list[0].examCount, 0);
  assert.equal(list[1].star, 4);
  assert.deepEqual(list[1].examYears, []);
  assert.equal(list[1].examCount, 0);
});

test("recordTest：历史记录累计与上限", function () {
  var e = makeEngine(20);
  for (var i = 0; i < 25; i++) {
    e.recordTest({ mode: "en2cn", total: 10, correct: 7 });
  }
  assert.equal(e.stats().testCount, 25);
  assert.equal(e.history().length, 20);
  assert.equal(e.history(5).length, 5);
  assert.equal(e.history()[0].correct, 7);
});

test("resetProgress 清进度、resetAll 清收藏但保留主题", function () {
  var e = makeEngine(10);
  e.setMark("word1", "known");
  e.toggleFav("word2");
  e.recordAnswer("word1", false);
  e.recordTest({ mode: "en2cn", total: 1, correct: 0 });

  e.resetProgress();
  assert.equal(e.getMark("word1"), "new");
  assert.equal(e.stats().testCount, 0);
  assert.equal(e.wrongList().length, 0);
  assert.equal(e.isFav("word2"), true);

  e.setTheme("dark");
  e.resetAll();
  assert.equal(e.isFav("word2"), false);
  assert.equal(e.stats().testCount, 0);
});

test("buildQuiz 在题库不足时不会崩溃且题量受池大小限制", function () {
  var e = makeEngine(3);
  var quiz = e.buildQuiz({ mode: "cn2en", size: 10 });
  assert.equal(quiz.questions.length, 3);
  quiz.questions.forEach(function (q) {
    assert.ok(q.options.length >= 2);
    assert.ok(q.options.indexOf(q.answer) !== -1);
  });
});

test("非法输入不会污染状态", function () {
  var e = makeEngine(5);
  e.setMark("not-a-word", "known");
  e.toggleFav("not-a-word");
  e.recordAnswer("not-a-word", true);
  assert.equal(e.stats().mastered, 0);
  assert.equal(e.stats().answered, 0);
  assert.equal(e.isFav("not-a-word"), false);
});

test("空范围不复用全词库：收藏为空时返回 0 题", function () {
  var e = makeEngine(10);
  var quiz = e.buildQuiz({ mode: "en2cn", size: 5, scope: "fav" });
  assert.equal(quiz.questions.length, 0);
});

test("脏存储清洗：非法标记/收藏/统计/错题不计入状态", function () {
  var storage = Core.memoryStorage();
  storage.setItem(Core.STORAGE_KEY, JSON.stringify({
    marks: { word1: "bogus", word2: "known", " WORD3 ": "fuzzy" },
    favs: { word1: true, word2: "yes" },
    stats: {
      word1: { seen: -5, correct: "x", wrong: 2.7, streak: null },
      word2: "bad",
      word3: { seen: 1, correct: 1, wrong: 0, streak: 0 }
    },
    wrongBook: { word1: -2, word2: 3.9 }
  }));
  var e = Core.createEngine(makeWords(5), { storage: storage });
  assert.equal(e.getMark("word1"), "new");
  assert.equal(e.getMark("word2"), "known");
  assert.equal(e.getMark("word3"), "fuzzy");
  assert.equal(e.isFav("word1"), true);
  assert.equal(e.isFav("word2"), false);
  var s = e.stats();
  assert.equal(s.testedWords, 1);
  assert.equal(s.mastered, 1);
  assert.equal(s.fuzzy, 1);
  var wrong = e.wrongList();
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].word, "word2");
  assert.equal(wrong[0].count, 3);
});

test("学习卡组顺序：有点印象最先、认识最后，同组按字母", function () {
  var e = makeEngine(10);
  e.setMark("word5", "fuzzy");
  e.setMark("word2", "fuzzy");
  e.setMark("word1", "unknown");
  e.setMark("word3", "known");
  var list = e.listWords({}).map(function (w) { return w.word; });
  assert.equal(list[0], "word2");
  assert.equal(list[1], "word5");
  assert.equal(list[list.length - 1], "word3");
  assert.ok(list.indexOf("word1") < list.indexOf("word4"));
});

test("周测/月测：按 lastSeen 取近 7/30 天，空记录返回 0 题", function () {
  var now = Date.now();
  var storage = Core.memoryStorage();
  storage.setItem(Core.STORAGE_KEY, JSON.stringify({
    stats: {
      word1: { seen: 1, correct: 1, wrong: 0, streak: 1, lastSeen: now - 2 * 86400000 },
      word2: { seen: 1, correct: 1, wrong: 0, streak: 1, lastSeen: now - 10 * 86400000 },
      word3: { seen: 1, correct: 1, wrong: 0, streak: 1, lastSeen: now - 40 * 86400000 }
    }
  }));
  var e = Core.createEngine(makeWords(10), { storage: storage });
  assert.deepEqual(e.recentWords(7, now).map(function (w) { return w.word; }), ["word1"]);
  assert.deepEqual(e.recentWords(30, now).map(function (w) { return w.word; }), ["word1", "word2"]);

  var q = e.buildReviewQuiz({ period: "week", size: 10, now: now });
  assert.ok(q.questions.length >= 2);
  assert.equal(q.wordCount, 1);
  q.questions.forEach(function (item) {
    assert.equal(item.word, "word1");
    assert.ok(["en2cn", "cn2en", "listen", "spell"].indexOf(item.mode) !== -1);
    if (item.mode !== "spell") {
      assert.equal(item.options.length, 4, "近期词很少时干扰项仍须来自完整词库");
      assert.ok(item.options.indexOf(item.answer) !== -1);
    }
  });

  var empty = Core.createEngine(makeWords(5), { storage: Core.memoryStorage() });
  assert.equal(empty.buildReviewQuiz({ period: "week", size: 10 }).questions.length, 0);
});

test("周测/月测：4 星以上全部纳入，每词至少两种题型，低星不考拼写", function () {
  var e = makeEngine(20);
  makeWords(20).forEach(function (w) { e.setMark(w.word, "fuzzy"); });
  var q = e.buildReviewQuiz({ period: "week", size: 10 });

  var byWord = {};
  q.questions.forEach(function (item) {
    (byWord[item.word] = byWord[item.word] || []).push(item.mode);
    if (item.entry.star <= 2) assert.notEqual(item.mode, "spell");
    if (item.entry.star === 3) assert.notEqual(item.mode, "spell");
  });
  [4, 5, 9, 10, 14, 15, 19, 20].forEach(function (i) {
    assert.ok(byWord["word" + i], "4 星以上 word" + i + " 必须全部出现");
  });
  Object.keys(byWord).forEach(function (w) {
    assert.ok(byWord[w].length >= 2, w + " 至少两种题型");
    assert.equal(new Set(byWord[w]).size, byWord[w].length, w + " 同词题型不得重复");
  });
  assert.ok(q.questions.some(function (item) { return item.mode === "phrase"; }));
});

test("动态降级：认识错 3 次→有点印象，有点印象错 2 次→不认识并重置", function () {
  var e = makeEngine(5);
  e.setMark("word1", "known");
  assert.equal(e.recordAnswer("word1", false).demoted, false);
  assert.equal(e.recordAnswer("word1", false).demoted, false);
  var d = e.recordAnswer("word1", false);
  assert.equal(d.demoted, true);
  assert.equal(d.from, "known");
  assert.equal(d.to, "fuzzy");
  assert.equal(e.getMark("word1"), "fuzzy");
  assert.equal(e.state.stats.word1.seen, 0);
  assert.equal(e.state.stats.word1.wrong, 0);
  assert.equal(e.wrongList().length, 0);
  assert.equal(e.stats().answered, 3);

  e.setMark("word1", "fuzzy");
  assert.equal(e.recordAnswer("word1", false).demoted, false);
  var d2 = e.recordAnswer("word1", false);
  assert.equal(d2.demoted, true);
  assert.equal(d2.to, "unknown");
  assert.equal(e.getMark("word1"), "unknown");
  assert.equal(e.state.stats.word1.seen, 0);
  assert.equal(e.stats().answered, 5);
});

test("动态降级计数在重新标记时清零", function () {
  var e = makeEngine(5);
  e.setMark("word1", "fuzzy");
  e.recordAnswer("word1", false);
  e.setMark("word1", "fuzzy");
  e.setMark("word1", "known");
  assert.equal(e.recordAnswer("word1", false).demoted, false);
  assert.equal(e.getMark("word1"), "known");
});

test("v2.3：词性转换与地道表达归一化", function () {
  var w = Core.normalizeWord({
    word: "test", us: "/test/", uk: "/test/", pos: ["n."], senses: [["n.", "测试"]],
    forms: [["tests", "n.", "测试（复数）"], ["tested", "v."], ["testing", "v."], ["tester", "n."], ["x", ""]],
    idioms: [["test the water", "试探"], ["test", ""], ["a", "b"]]
  });
  assert.ok(w.forms.length <= 6);
  assert.equal(w.forms[0][0], "tests");
  assert.equal(w.forms[0][2], "测试（复数）");
  assert.equal(w.idioms.length, 1);
  assert.equal(w.idioms[0][1], "试探");
  assert.equal(Core.normalizeWord({ word: "x", forms: "bad", idioms: null }).forms.length, 0);
});

test("v2.3：多选模式按总题数出题且为混合题型", function () {
  var e = makeEngine(60);
  var r = e.buildQuiz({ modes: ["en2cn", "cn2en"], size: 10, scope: "all" });
  assert.equal(r.mode, "mixed");
  assert.equal(r.questions.length, 10);
  assert.ok(r.questions.some(function (q) { return q.mode === "en2cn"; }));
  assert.ok(r.questions.some(function (q) { return q.mode === "cn2en"; }));

  var r2 = e.buildQuiz({ modes: ["en2cn", "listen", "spell"], size: 10, scope: "all" });
  assert.equal(r2.questions.length, 10);
});

test("v2.3：短语英译中/短语听音题不泄露相关词", function () {
  var e = makeEngine(10);
  var p = e.buildQuiz({ modes: ["phrase"], size: 4, scope: "all" }).questions[0];
  assert.equal(p.mode, "phrase");
  assert.equal(p.extra, "");
  assert.ok(p.answer);
  assert.ok(p.options.indexOf(p.answer) >= 0);
  assert.ok(p.prompt.indexOf("word1") < 0);

  var pe = e.buildQuiz({ modes: ["phrase-en2cn"], size: 4, scope: "all" }).questions[0];
  assert.equal(pe.mode, "phrase-en2cn");
  assert.ok(pe.options.indexOf(pe.answer) >= 0);

  var pl = e.buildQuiz({ modes: ["phrase-listen"], size: 4, scope: "all" }).questions[0];
  assert.equal(pl.mode, "phrase-listen");
  assert.equal(pl.audioText, pl.answer);
  assert.ok(pl.prompt.indexOf("word1") < 0);
});

test("v2.3：普通英译中/听音选词自动混入 4★ 短语题", function () {
  var e = makeEngine(60);
  var r = e.buildQuiz({ modes: ["en2cn"], size: 30, scope: "all", phraseMix: true });
  assert.equal(r.questions.length, 30);
  assert.ok(r.questions.some(function (q) { return q.mode === "phrase-en2cn"; }));
  var l = e.buildQuiz({ modes: ["listen"], size: 30, scope: "all", phraseMix: true });
  assert.equal(l.questions.length, 30);
  assert.ok(l.questions.some(function (q) { return q.mode === "phrase-listen"; }));
});

test("v2.3：连续两次周测避免同词同题型", function () {
  var e = makeEngine(30);
  makeWords(30).forEach(function (w) { e.setMark(w.word, "fuzzy"); });
  var first = e.buildReviewQuiz({ period: "week", size: 12 });
  e.commitWeekQuiz(first);
  var second = e.buildReviewQuiz({ period: "week", size: 12 });
  var firstPairs = {};
  first.pairs.forEach(function (p) { firstPairs[p[0] + "|" + p[1]] = true; });
  second.pairs.forEach(function (p) {
    assert.ok(!firstPairs[p[0] + "|" + p[1]], "不得重复同词同题型：" + p.join("/"));
  });
});
