/* =========================================================
   CET-4 高频单词卡 · 核心逻辑
   - 纯函数 + 可注入 storage / rng，便于 Node 下单元测试
   - 浏览器挂到 window.CET4Core；Node 下 module.exports
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CET4Core = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "2.3.0";
  var STORAGE_KEY = "cet4-flashcards.state.v1";
  var MARKS = { NEW: "new", UNKNOWN: "unknown", FUZZY: "fuzzy", KNOWN: "known" };
  var MARK_ORDER = [MARKS.NEW, MARKS.UNKNOWN, MARKS.FUZZY, MARKS.KNOWN];

  /* ---------------- 小工具 ---------------- */
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function toStr(v) { return v == null ? "" : String(v); }
  function trimStr(v) { return toStr(v).trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function shuffled(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sample(list, n, rng) {
    if (n <= 0) return [];
    var a = shuffled(list, rng);
    return a.slice(0, Math.min(n, a.length));
  }

  /* ---------------- 数据标准化 ---------------- */
  function normalizeWord(raw) {
    if (!isObj(raw)) return null;
    var word = trimStr(raw.word).toLowerCase();
    if (!word) return null;

    var pos = Array.isArray(raw.pos)
      ? raw.pos.map(trimStr).filter(Boolean)
      : [];

    var senses = [];
    if (Array.isArray(raw.senses)) {
      raw.senses.forEach(function (s) {
        if (Array.isArray(s)) {
          var zh = trimStr(s[1]);
          if (zh) senses.push([trimStr(s[0]) || (pos[0] || ""), zh]);
        } else if (typeof s === "string" && trimStr(s)) {
          senses.push([pos[0] || "", trimStr(s)]);
        }
      });
    }
    if (!senses.length) senses.push([pos[0] || "", "（暂无释义）"]);

    var examples = [];
    if (Array.isArray(raw.examples)) {
      raw.examples.forEach(function (ex) {
        if (Array.isArray(ex) && trimStr(ex[0])) {
          examples.push([trimStr(ex[0]), trimStr(ex[1])]);
        } else if (typeof ex === "string" && trimStr(ex)) {
          examples.push([trimStr(ex), ""]);
        }
      });
    }

    var phrases = [];
    if (Array.isArray(raw.phrases)) {
      raw.phrases.forEach(function (p) {
        if (Array.isArray(p) && trimStr(p[0])) {
          phrases.push([trimStr(p[0]), trimStr(p[1])]);
        }
      });
    }

    var star = Math.floor(Number(raw.star));
    if (!(star >= 1 && star <= 5)) star = 1;

    var examYears = [];
    if (Array.isArray(raw.examYears)) {
      raw.examYears.forEach(function (y) {
        y = trimStr(y);
        if (/^\d{4}-\d{2}$/.test(y) && examYears.indexOf(y) === -1) examYears.push(y);
      });
      examYears.sort();
    }
    var examCount = Math.max(0, Math.floor(Number(raw.examCount) || 0));

    var forms = [];
    if (Array.isArray(raw.forms)) {
      raw.forms.forEach(function (f) {
        if (Array.isArray(f) && trimStr(f[0])) {
          var item = [trimStr(f[0]), trimStr(f[1])];
          if (trimStr(f[2])) item.push(trimStr(f[2]));
          forms.push(item);
        }
      });
      forms = forms.slice(0, 6);
    }

    var idioms = [];
    if (Array.isArray(raw.idioms)) {
      raw.idioms.forEach(function (p) {
        if (Array.isArray(p) && trimStr(p[0]) && /[一-鿿]/.test(trimStr(p[1]))) idioms.push([trimStr(p[0]), trimStr(p[1])]);
      });
      idioms = idioms.slice(0, 2);
    }

    return {
      word: word,
      us: trimStr(raw.us),
      uk: trimStr(raw.uk),
      pos: pos,
      senses: senses,
      examples: examples,
      phrases: phrases,
      star: star,
      examYears: examYears,
      examCount: examCount,
      forms: forms,
      idioms: idioms
    };
  }

  function normalizeWords(list) {
    if (!Array.isArray(list)) return [];
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (raw) {
      var w = normalizeWord(raw);
      if (!w || seen[w.word]) return;
      seen[w.word] = true;
      out.push(w);
    });
    return out;
  }

  function primarySense(entry) {
    if (!entry || !entry.senses || !entry.senses.length) return "";
    var s = entry.senses[0];
    return s[0] ? s[0] + " " + s[1] : s[1];
  }

  function senseText(entry) {
    return (entry.senses || []).map(function (s) {
      return s[0] ? s[0] + " " + s[1] : s[1];
    }).join("；");
  }

  /* ---------------- 持久化 ---------------- */
  function memoryStorage() {
    var data = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }
    };
  }

  function resolveStorage(storage) {
    if (storage && typeof storage.getItem === "function") return storage;
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.setItem("__cet4_probe__", "1");
        localStorage.removeItem("__cet4_probe__");
        return localStorage;
      }
    } catch (e) { /* 隐私模式等：回退内存 */ }
    return memoryStorage();
  }

  function emptyState() {
    return {
      version: 1,
      marks: {},
      favs: {},
      stats: {},
      tests: { count: 0, answered: 0, correct: 0 },
      wrongBook: {},
      history: [],
      lastWeekQuiz: null,
      theme: "light"
    };
  }

  function sanitizeState(raw) {
    var base = emptyState();
    if (!isObj(raw)) return base;
    function normKey(k) { return trimStr(k).toLowerCase(); }

    if (isObj(raw.marks)) {
      Object.keys(raw.marks).forEach(function (k) {
        var v = raw.marks[k];
        if (MARK_ORDER.indexOf(v) >= 0 && v !== MARKS.NEW) base.marks[normKey(k)] = v;
      });
    }
    if (isObj(raw.favs)) {
      Object.keys(raw.favs).forEach(function (k) {
        if (raw.favs[k] === true) base.favs[normKey(k)] = true;
      });
    }
    if (isObj(raw.stats)) {
      Object.keys(raw.stats).forEach(function (k) {
        var s = raw.stats[k];
        if (!isObj(s)) return;
        base.stats[normKey(k)] = {
          seen: Math.max(0, Math.floor(Number(s.seen) || 0)),
          correct: Math.max(0, Math.floor(Number(s.correct) || 0)),
          wrong: Math.max(0, Math.floor(Number(s.wrong) || 0)),
          streak: Math.max(0, Math.floor(Number(s.streak) || 0)),
          wrongSinceMark: Math.max(0, Math.floor(Number(s.wrongSinceMark) || 0)),
          lastSeen: Math.max(0, Math.floor(Number(s.lastSeen) || 0))
        };
      });
    }
    if (isObj(raw.wrongBook)) {
      Object.keys(raw.wrongBook).forEach(function (k) {
        var n = Math.max(0, Math.floor(Number(raw.wrongBook[k]) || 0));
        if (n > 0) base.wrongBook[normKey(k)] = n;
      });
    }
    if (isObj(raw.tests)) {
      base.tests.count = Math.max(0, Number(raw.tests.count) || 0);
      base.tests.answered = Math.max(0, Number(raw.tests.answered) || 0);
      base.tests.correct = Math.max(0, Number(raw.tests.correct) || 0);
    }
    if (Array.isArray(raw.history)) base.history = raw.history.slice(0, 30);
    if (isObj(raw.lastWeekQuiz) && Array.isArray(raw.lastWeekQuiz.words)) {
      var wordsSeen = Object.create(null);
      var lw = [];
      raw.lastWeekQuiz.words.forEach(function (w) {
        w = normKey(w);
        if (w && !wordsSeen[w]) { wordsSeen[w] = true; lw.push(w); }
      });
      var pairs = [];
      if (Array.isArray(raw.lastWeekQuiz.pairs)) {
        raw.lastWeekQuiz.pairs.forEach(function (p) {
          if (Array.isArray(p) && p.length >= 2) {
            var wk = normKey(p[0]), md = trimStr(p[1]);
            if (wk && md) pairs.push([wk, md]);
          }
        });
      }
      base.lastWeekQuiz = { words: lw, pairs: pairs, at: Math.max(0, Math.floor(Number(raw.lastWeekQuiz.at) || 0)) };
    }
    if (raw.theme === "dark" || raw.theme === "light") base.theme = raw.theme;
    return base;
  }

  /* ---------------- 引擎 ---------------- */
  function createEngine(rawWords, options) {
    options = options || {};
    var rng = typeof options.rng === "function" ? options.rng : Math.random;
    var storage = resolveStorage(options.storage);
    var key = options.storageKey || STORAGE_KEY;
    var words = normalizeWords(rawWords);
    var byWord = Object.create(null);
    words.forEach(function (w) { byWord[w.word] = w; });

    var state = emptyState();
    try {
      var saved = storage.getItem(key);
      if (saved) state = sanitizeState(JSON.parse(saved));
    } catch (e) { state = emptyState(); }

    function save() {
      try { storage.setItem(key, JSON.stringify(state)); } catch (e) { /* 配额/隐私模式忽略 */ }
    }

    function entry(word) { return byWord[trimStr(word).toLowerCase()] || null; }

    function wordStat(word) {
      if (!state.stats[word]) {
        state.stats[word] = { seen: 0, correct: 0, wrong: 0, streak: 0, wrongSinceMark: 0, lastSeen: 0 };
      }
      return state.stats[word];
    }

    function getMark(word) {
      return state.marks[word] || MARKS.NEW;
    }

    function setMark(word, mark) {
      word = trimStr(word).toLowerCase();
      if (!byWord[word]) return;
      if (MARK_ORDER.indexOf(mark) < 0) mark = MARKS.NEW;
      if (mark === MARKS.NEW) delete state.marks[word];
      else state.marks[word] = mark;
      var st = wordStat(word);
      st.wrongSinceMark = 0;
      st.lastSeen = Date.now();
      save();
    }

    function toggleFav(word) {
      word = trimStr(word).toLowerCase();
      if (!byWord[word]) return false;
      if (state.favs[word]) delete state.favs[word];
      else state.favs[word] = true;
      save();
      return !!state.favs[word];
    }

    function isFav(word) { return !!state.favs[word]; }

    function resetWordProgress(word, now) {
      state.stats[word] = {
        seen: 0, correct: 0, wrong: 0, streak: 0,
        wrongSinceMark: 0, lastSeen: now || Date.now()
      };
      delete state.wrongBook[word];
    }

    function recordAnswer(word, correct) {
      word = trimStr(word).toLowerCase();
      if (!byWord[word]) return { demoted: false };
      var markBefore = getMark(word);
      var now = Date.now();
      var st = wordStat(word);
      st.seen += 1;
      st.lastSeen = now;
      if (correct) {
        st.correct += 1;
        st.streak += 1;
        if (state.wrongBook[word]) {
          state.wrongBook[word] -= 1;
          if (state.wrongBook[word] <= 0) delete state.wrongBook[word];
        }
      } else {
        st.wrong += 1;
        st.streak = 0;
        state.wrongBook[word] = (state.wrongBook[word] || 0) + 1;
        st.wrongSinceMark += 1;
        var demotion = null;
        if (markBefore === MARKS.KNOWN && st.wrongSinceMark >= 3) {
          state.marks[word] = MARKS.FUZZY;
          demotion = { from: MARKS.KNOWN, to: MARKS.FUZZY };
        } else if (markBefore === MARKS.FUZZY && st.wrongSinceMark >= 2) {
          state.marks[word] = MARKS.UNKNOWN;
          demotion = { from: MARKS.FUZZY, to: MARKS.UNKNOWN };
        }
        if (demotion) {
          resetWordProgress(word, now);
          state.tests.answered += 1;
          save();
          return { demoted: true, from: demotion.from, to: demotion.to };
        }
      }
      state.tests.answered += 1;
      if (correct) state.tests.correct += 1;
      save();
      return { demoted: false };
    }

    function recordTest(session) {
      session = session || {};
      var total = Math.max(0, Number(session.total) || 0);
      var correct = Math.max(0, Math.min(total, Number(session.correct) || 0));
      state.tests.count += 1;
      state.history.unshift({
        mode: trimStr(session.mode) || "en2cn",
        correct: correct,
        total: total,
        at: session.at || new Date().toISOString()
      });
      state.history = state.history.slice(0, 20);
      save();
      return state.history[0];
    }

    function resetAll() {
      var theme = state.theme;
      state = emptyState();
      state.theme = theme;
      save();
    }

    function resetProgress() {
      state.marks = {};
      state.stats = {};
      state.wrongBook = {};
      state.tests = { count: 0, answered: 0, correct: 0 };
      state.history = [];
      save();
    }

    function listWords(filter) {
      filter = filter || {};
      var q = trimStr(filter.q).toLowerCase();
      var mark = filter.mark || "all";
      var status = filter.status || "all";
      var letter = trimStr(filter.letter).toLowerCase();
      if (letter === "all") letter = "";
      var onlyFav = !!filter.fav;
      var onlyExam = !!filter.exam;
      var star = filter.star;
      if (star != null && star !== "" && star !== "all") star = Number(star);
      else star = 0;
      var out = words.filter(function (w) {
        if (q) {
          var hit = w.word.indexOf(q) !== -1 ||
            senseText(w).toLowerCase().indexOf(q) !== -1;
          if (!hit) return false;
        }
        if (letter && w.word.charAt(0) !== letter) return false;
        if (onlyFav && !state.favs[w.word]) return false;
        if (onlyExam && !w.examYears.length) return false;
        if (star && w.star !== star) return false;
        var m = getMark(w.word);
        if (mark !== "all") {
          if (mark === "studied") { if (m === MARKS.NEW) return false; }
          else if (m !== mark) return false;
        }
        if (status === "unmastered" && m === MARKS.KNOWN) return false;
        if (status === "mastered" && m !== MARKS.KNOWN) return false;
        if (status === "fav" && !state.favs[w.word]) return false;
        return true;
      });
      var markRank = { fuzzy: 0, unknown: 1, new: 2, known: 3 };
      out.sort(function (a, b) {
        var ra = markRank[getMark(a.word)];
        var rb = markRank[getMark(b.word)];
        return ra - rb || a.word.localeCompare(b.word);
      });
      return out;
    }

    function scopePool(scope) {
      scope = scope || "all";
      if (scope === "new") {
        return words.filter(function (w) { return getMark(w.word) === MARKS.NEW; });
      }
      if (scope === "unmastered") {
        return words.filter(function (w) { return getMark(w.word) !== MARKS.KNOWN; });
      }
      if (scope === "fav") {
        return words.filter(function (w) { return !!state.favs[w.word]; });
      }
      if (scope === "wrong") {
        return words.filter(function (w) { return (state.wrongBook[w.word] || 0) > 0; });
      }
      if (scope === "exam") {
        return words.filter(function (w) { return w.examYears.length > 0; });
      }
      if (scope === "star5") {
        return words.filter(function (w) { return w.star === 5; });
      }
      return words.slice();
    }

    function distractorPool(target, pool, n) {
      var poolWords = pool.filter(function (w) { return w.word !== target.word; });
      if (poolWords.length < n) {
        poolWords = poolWords.concat(words.filter(function (w) {
          return w.word !== target.word && poolWords.indexOf(w) === -1;
        }));
      }
      return poolWords;
    }

    function buildQuestion(mode, target, pool) {
      var all = distractorPool(target, pool, 4);
      var options, answer, prompt, extra;

      if (mode === "en2cn") {
        var right = primarySense(target);
        var texts = [right];
        // 从全部干扰词中取 3 个不重复释义，避免抽样 12 个恰好撞义导致选项不足 4 个
        shuffled(all, rng).forEach(function (w) {
          if (texts.length >= 4) return;
          var t = primarySense(w);
          if (texts.indexOf(t) === -1) texts.push(t);
        });
        var shuffledTexts = shuffled(texts, rng);
        options = shuffledTexts;
        answer = right;
        prompt = target.word;
        extra = target.us || target.uk || "";
      } else if (mode === "cn2en") {
        prompt = primarySense(target);
        extra = "";
        var ws = [target];
        sample(all, 12, rng).forEach(function (w) {
          if (ws.length < 4 && w.word !== target.word) ws.push(w);
        });
        options = shuffled(ws, rng).map(function (w) { return w.word; });
        answer = target.word;
      } else if (mode === "listen") {
        prompt = "🔊 请选择你听到的单词";
        extra = "";
        var lw = [target];
        sample(all, 12, rng).forEach(function (w) {
          if (lw.length < 4 && w.word !== target.word) lw.push(w);
        });
        options = shuffled(lw, rng).map(function (w) { return w.word; });
        answer = target.word;
      } else if (mode === "phrase") {
        // 中译英搭配：题目不显示相关单词，避免泄题
        var pairs = target.phrases || [];
        if (!pairs.length) return null;
        var pair = pairs[Math.floor(rng() * pairs.length) % pairs.length];
        prompt = pair[1];
        extra = "";
        var phraseOptions = [pair[0]];
        shuffled(all, rng).forEach(function (w) {
          if (phraseOptions.length >= 4) return;
          (w.phrases || []).forEach(function (p) {
            if (phraseOptions.length < 4 && phraseOptions.indexOf(p[0]) === -1) phraseOptions.push(p[0]);
          });
        });
        if (phraseOptions.length < 4) return null;
        options = shuffled(phraseOptions, rng);
        answer = pair[0];
      } else if (mode === "phrase-en2cn") {
        // 短语英译中
        var pePairs = target.phrases || [];
        if (!pePairs.length) return null;
        var pe = pePairs[Math.floor(rng() * pePairs.length) % pePairs.length];
        prompt = pe[0];
        extra = "";
        var peOptions = [pe[1]];
        shuffled(all, rng).forEach(function (w) {
          if (peOptions.length >= 4) return;
          (w.phrases || []).forEach(function (p) {
            if (peOptions.length < 4 && p[1] && peOptions.indexOf(p[1]) === -1) peOptions.push(p[1]);
          });
        });
        if (peOptions.length < 4) return null;
        options = shuffled(peOptions, rng);
        answer = pe[1];
      } else if (mode === "phrase-listen") {
        // 短语听音选词
        var plPairs = target.phrases || [];
        if (!plPairs.length) return null;
        var pl = plPairs[Math.floor(rng() * plPairs.length) % plPairs.length];
        prompt = "🔊 请选择你听到的短语";
        extra = "";
        var plOptions = [pl[0]];
        shuffled(all, rng).forEach(function (w) {
          if (plOptions.length >= 4) return;
          (w.phrases || []).forEach(function (p) {
            if (plOptions.length < 4 && p[0] && plOptions.indexOf(p[0]) === -1) plOptions.push(p[0]);
          });
        });
        if (plOptions.length < 4) return null;
        options = shuffled(plOptions, rng);
        answer = pl[0];
        return {
          mode: mode, word: target.word, entry: target, prompt: prompt,
          extra: extra, options: options, answer: answer, audioText: pl[0]
        };
      } else { // spell
        prompt = senseText(target);
        extra = "";
        options = [];
        answer = target.word;
      }

      var q = {
        mode: mode,
        word: target.word,
        entry: target,
        prompt: prompt,
        extra: extra,
        options: options,
        answer: answer
      };
      if (mode === "listen") q.audioText = target.word;
      return q;
    }

    var DAY_MS = 24 * 60 * 60 * 1000;

    function recentWords(days, now) {
      now = Number(now) || Date.now();
      var cutoff = now - Math.max(1, Number(days) || 7) * DAY_MS;
      return words.filter(function (w) {
        var st = state.stats[w.word];
        return st && st.lastSeen > 0 && st.lastSeen >= cutoff;
      });
    }

    function allocateQuotas(total, ratios) {
      total = Math.max(0, Math.floor(Number(total) || 0));
      var raw = ratios.map(function (r) { return total * r; });
      var out = raw.map(function (v) { return Math.floor(v); });
      var used = out.reduce(function (a, b) { return a + b; }, 0);
      var rest = total - used;
      var order = raw.map(function (v, i) { return { i: i, frac: v - Math.floor(v) }; })
        .sort(function (a, b) { return b.frac - a.frac || a.i - b.i; });
      for (var i = 0; i < rest; i++) out[order[i % order.length].i] += 1;
      return out;
    }

    function reviewModeList(entry) {
      var modes;
      if (entry.star >= 4) modes = ["en2cn", "cn2en", "listen", "spell"];
      else if (entry.star === 3) modes = ["en2cn", "cn2en", "listen"];
      else modes = ["en2cn", "listen"];
      if (entry.star >= 4 && (entry.phrases || []).length) {
        // 4★ 优先词组题型；每轮只取前 4 种，给下一次周测留出未用过的题型
        modes = ["phrase", "phrase-en2cn", "en2cn", "cn2en", "listen", "spell", "phrase-listen"];
      }
      return modes;
    }

    // 周测 / 月测：近 7 / 30 天有学习记录的词；按 60/20/15/5 配比抽取；
    // 4 星以上全部纳入并额外考词组；每词至少两种题型。
    // size 为抽查词数；周测总题数硬上限 700，月测 1500。
    function buildReviewQuiz(opts) {
      opts = opts || {};
      var period = opts.period === "month" ? "month" : "week";
      var days = period === "month" ? 30 : 7;
      var now = Number(opts.now) || Date.now();
      var poolAll = recentWords(days, now);
      var size = Math.max(1, Number(opts.size) || 10);
      if (!poolAll.length) {
        return {
          mode: "review", period: period, scope: period, questions: [],
          total: 0, wordCount: 0, words: [], pairs: []
        };
      }

      // 连续两次周测去重：优先排除上次出现过的词；池不足时允许复用不同题型
      var avoidWords = Object.create(null);
      var avoidPairs = Object.create(null);
      if (period === "week" && opts.avoidPrevious !== false && state.lastWeekQuiz) {
        (state.lastWeekQuiz.words || []).forEach(function (w) { avoidWords[w] = true; });
        (state.lastWeekQuiz.pairs || []).forEach(function (p) {
          if (!avoidPairs[p[0]]) avoidPairs[p[0]] = Object.create(null);
          avoidPairs[p[0]][p[1]] = true;
        });
      }
      var freshPool = poolAll.filter(function (w) { return !avoidWords[w.word]; });
      var pool = freshPool.length >= Math.min(size, poolAll.length) ? freshPool : poolAll;

      var chosen = [];
      var seen = Object.create(null);
      function add(w) {
        if (!w || seen[w.word]) return;
        seen[w.word] = true;
        chosen.push(w);
      }

      // 4 星以上全部纳入（不受上次周测去重影响；若是重复词，则在题型层面避开上次用过的题型）
      shuffled(poolAll.filter(function (w) { return w.star >= 4; }), rng).forEach(add);

      var slots = Math.max(0, size - chosen.length);
      var quotas = allocateQuotas(slots, [0.6, 0.2, 0.15, 0.05]);
      var categories = [
        { name: "unknown", test: function (w) { return getMark(w.word) === MARKS.UNKNOWN; } },
        { name: "wrong", test: function (w) { return (state.wrongBook[w.word] || 0) > 0; } },
        { name: "fuzzy", test: function (w) { return getMark(w.word) === MARKS.FUZZY; } },
        { name: "known", test: function (w) { return getMark(w.word) === MARKS.KNOWN; } }
      ];
      categories.forEach(function (cat, ci) {
        var bucket = shuffled(pool.filter(function (w) { return !seen[w.word] && cat.test(w); }), rng);
        bucket.slice(0, quotas[ci]).forEach(add);
      });

      if (chosen.length < size) {
        shuffled(pool, rng).forEach(function (w) {
          if (chosen.length < size) add(w);
        });
      }

      var limits = [];
      var modeLists = chosen.map(function (w) {
        var modes = reviewModeList(w);
        var banned = avoidPairs[w.word];
        if (banned) modes = modes.filter(function (m) { return !banned[m]; });
        // 每轮每个词最多 4 种题型；4★ 已把词组题排前，保证词组表达被考到
        var maxModes = w.star >= 4 ? 4 : (w.star === 3 ? 3 : 2);
        if (modes.length > maxModes) modes = modes.slice(0, maxModes);
        if (!modes.length) modes = ["en2cn"];
        limits.push(maxModes);
        return modes;
      });
      var covered = Object.create(null);
      modeLists.forEach(function (list) {
        list.forEach(function (m) { covered[m] = true; });
      });
      // 保证四种基本题型至少各出现一次
      ["en2cn", "cn2en", "listen", "spell"].forEach(function (need) {
        if (covered[need]) return;
        var at = -1;
        for (var i = 0; i < chosen.length; i++) {
          if (chosen[i].star >= 3 &&
              modeLists[i].length < limits[i] &&
              modeLists[i].indexOf(need) === -1 &&
              ((avoidPairs[chosen[i].word] || {})[need] !== true)) { at = i; break; }
        }
        if (at >= 0) {
          modeLists[at].push(need);
          covered[need] = true;
        }
      });

      var questions = [];
      var pairs = [];
      chosen.forEach(function (w, wi) {
        modeLists[wi].forEach(function (mode) {
          var q = buildQuestion(mode, w, words);
          if (q) {
            questions.push(q);
            pairs.push([w.word, mode]);
          }
        });
      });
      questions = shuffled(questions, rng);
      pairs = questions.map(function (q) { return [q.word, q.mode]; });

      // 题数硬上限：优先去掉同词的第 3+ 道题，保留每词至少 2 种题型
      var cap = period === "week" ? 700 : 1500;
      if (questions.length > cap) {
        var countByWord = Object.create(null);
        questions.forEach(function (q) { countByWord[q.word] = (countByWord[q.word] || 0) + 1; });
        var i = questions.length - 1;
        while (questions.length > cap && i >= 0) {
          var q = questions[i];
          if (countByWord[q.word] > 2) {
            countByWord[q.word] -= 1;
            questions.splice(i, 1);
          }
          i -= 1;
        }
        while (questions.length > cap) questions.pop();
        pairs = questions.map(function (q) { return [q.word, q.mode]; });
      }

      return {
        mode: "review",
        period: period,
        scope: period,
        questions: questions,
        total: questions.length,
        wordCount: chosen.length,
        words: chosen.map(function (w) { return w.word; }),
        pairs: pairs
      };
    }

    function commitWeekQuiz(result) {
      if (!result || result.period !== "week") return;
      state.lastWeekQuiz = {
        words: (result.words || []).slice(),
        pairs: (result.pairs || []).map(function (p) { return [p[0], p[1]]; }),
        at: Date.now()
      };
      save();
    }

    function buildQuiz(opts) {
      opts = opts || {};
      var modes = Array.isArray(opts.modes) && opts.modes.length
        ? opts.modes.slice()
        : [opts.mode || "en2cn"];
      var size = Math.max(1, Number(opts.size) || 10);
      var scope = opts.scope || "all";
      var pool = scopePool(scope);
      var perWord = modes.length;
      var wordTarget = Math.min(pool.length, Math.max(1, Math.ceil(size / perWord) + 2));
      var chosen = shuffled(pool, rng).slice(0, wordTarget);
      var questions = [];
      chosen.forEach(function (w) {
        var list = modes.slice();
        // 英译中 / 听音选词：4★ 以上词条自动混入相关短语题
        if (opts.phraseMix === true && w.star >= 4 && (w.phrases || []).length) {
          if (modes.indexOf("en2cn") >= 0) list.push("phrase-en2cn");
          if (modes.indexOf("listen") >= 0) list.push("phrase-listen");
        }
        list.forEach(function (mode) {
          var q = buildQuestion(mode, w, pool);
          if (q) questions.push(q);
        });
      });
      questions = shuffled(questions, rng);
      var hardMax = Math.max(1, Math.floor(Number(opts.maxQuestions) || size));
      if (questions.length > hardMax) questions = questions.slice(0, hardMax);
      return {
        mode: modes.length > 1 ? "mixed" : modes[0],
        modes: modes,
        scope: opts.scope || "all",
        questions: questions,
        total: questions.length,
        wordCount: chosen.length
      };
    }

    function stats() {
      var s = {
        total: words.length,
        mastered: 0,
        fuzzy: 0,
        unknown: 0,
        fresh: 0,
        studied: 0,
        favs: 0,
        answered: state.tests.answered,
        correct: state.tests.correct,
        accuracy: 0,
        testCount: state.tests.count,
        wrongCount: Object.keys(state.wrongBook).length,
        examWords: 0,
        starCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
      words.forEach(function (w) {
        var m = getMark(w.word);
        if (m === MARKS.KNOWN) s.mastered += 1;
        else if (m === MARKS.FUZZY) s.fuzzy += 1;
        else if (m === MARKS.UNKNOWN) s.unknown += 1;
        else s.fresh += 1;
        if (state.favs[w.word]) s.favs += 1;
        if (w.examYears.length) s.examWords += 1;
        s.starCounts[w.star] += 1;
      });
      s.star5 = s.starCounts[5];
      s.studied = s.total - s.fresh;
      s.unmastered = s.total - s.mastered;
      s.testedWords = words.filter(function (w) {
        var st = state.stats[w.word];
        return st && st.seen > 0;
      }).length;
      if (s.answered > 0) s.accuracy = Math.round((s.correct / s.answered) * 100);
      return s;
    }

    function wrongList(limit) {
      var arr = Object.keys(state.wrongBook).map(function (w) {
        return { word: w, count: state.wrongBook[w], entry: byWord[w] };
      }).filter(function (x) { return x.entry; });
      arr.sort(function (a, b) { return b.count - a.count || a.word.localeCompare(b.word); });
      return limit ? arr.slice(0, limit) : arr;
    }

    function history(limit) {
      return limit ? state.history.slice(0, limit) : state.history.slice();
    }

    function setTheme(theme) {
      state.theme = theme === "dark" ? "dark" : "light";
      save();
      return state.theme;
    }

    function letterCounts() {
      var map = Object.create(null);
      words.forEach(function (w) {
        var c = w.word.charAt(0);
        map[c] = (map[c] || 0) + 1;
      });
      return map;
    }

    return {
      words: words,
      state: state,
      storageKey: key,
      save: save,
      entry: entry,
      getMark: getMark,
      setMark: setMark,
      toggleFav: toggleFav,
      isFav: isFav,
      recordAnswer: recordAnswer,
      recordTest: recordTest,
      resetAll: resetAll,
      resetProgress: resetProgress,
      listWords: listWords,
      recentWords: recentWords,
      buildQuiz: buildQuiz,
      buildReviewQuiz: buildReviewQuiz,
      commitWeekQuiz: commitWeekQuiz,
      stats: stats,
      wrongList: wrongList,
      history: history,
      setTheme: setTheme,
      letterCounts: letterCounts
    };
  }

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    MARKS: MARKS,
    normalizeWord: normalizeWord,
    normalizeWords: normalizeWords,
    primarySense: primarySense,
    senseText: senseText,
    createEngine: createEngine,
    memoryStorage: memoryStorage
  };
});
