/* =========================================================
   CET-4 高频单词卡 · 界面逻辑
   ========================================================= */
(function () {
  "use strict";

  var Core = window.CET4Core;
  var $ = function (id) { return document.getElementById(id); };
  var MODE_LABEL = {
    en2cn: "英译中", cn2en: "中译英", listen: "听音选词", spell: "拼写挑战",
    phrase: "词组搭配", "phrase-en2cn": "短语英译中", "phrase-listen": "短语听音",
    mixed: "混合题型", week: "周测", month: "月测"
  };
  var MODE_HINT = {
    en2cn: "看单词，选出正确的中文释义",
    cn2en: "看中文释义，选出对应单词",
    listen: "听发音，选出对应单词",
    spell: "看释义，输入正确拼写",
    phrase: "看中文搭配，选出对应的英文词组",
    "phrase-en2cn": "看英文短语，选出正确中文",
    "phrase-listen": "听短语发音，选出对应英文"
  };
  var THEME_KEY = "cet4.theme";

  var engine = null;
  var view = "study";
  var deck = [];
  var index = 0;
  var lastWord = null;
  var quiz = null;
  var selectedModes = ["en2cn"];
  var theme = "light";
  var toastTimer = 0;
  var searchTimer = 0;
  var currentAudio = null;
  var swipeStart = null;
  var suppressCardClick = false;
  var deckSortDirty = false;

  /* ---------------- 基础工具 ---------------- */
  function ce(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setText(id, text) {
    var n = $(id);
    if (n) n.textContent = text;
  }
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
  }
  function showError(msg) {
    var box = $("app-error");
    if (!box) return;
    box.textContent = msg;
    box.hidden = false;
  }
  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function debounce(fn, ms) {
    return function () {
      var args = arguments, self = this;
      clearTimeout(fn._t);
      fn._t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ---------------- 标准发音（有道词典音频，不用浏览器 TTS） ---------------- */
  function audioUrl(text, accent) {
    var type = accent === "uk" ? 1 : 2;
    return "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(text) + "&type=" + type;
  }

  function playAudio(text, accent, btn) {
    if (!text) return;
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      currentAudio = new Audio(audioUrl(text, accent));
      currentAudio.preload = "auto";
      if (btn) {
        btn.classList.add("is-playing");
        currentAudio.onended = function () { btn.classList.remove("is-playing"); };
        currentAudio.onerror = function () { btn.classList.remove("is-playing"); };
      }
      var p = currentAudio.play();
      if (p && p.catch) {
        p.catch(function () {
          if (btn) btn.classList.remove("is-playing");
          toast("发音加载失败，请联网后重试");
        });
      }
    } catch (e) {
      if (btn) btn.classList.remove("is-playing");
      toast("发音播放失败：" + e.message);
    }
  }

  function speak(text, accent, btn) { playAudio(text, accent, btn); }

  /* ---------------- 主题 ---------------- */
  function applyTheme(t) {
    theme = t === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    setText("theme-toggle", theme === "dark" ? "☀️" : "🌙");
    var metaTheme = $("meta-theme");
    if (metaTheme) metaTheme.setAttribute("content", theme === "dark" ? "#0d1020" : "#f3f6fd");
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    if (engine) engine.setTheme(theme);
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      saved = "dark";
    }
    applyTheme(saved || "light");
  }

  /* ---------------- 学习卡片 ---------------- */
  function currentEntry() {
    return deck.length ? deck[index] : null;
  }

  function currentFilters() {
    return {
      q: $("search").value,
      letter: $("letter").value,
      status: $("filter").value,
      star: $("star").value,
      exam: $("exam-only").checked
    };
  }

  function filtersActive() {
    return !!$("search").value.trim() ||
      $("letter").value !== "all" ||
      $("filter").value !== "all" ||
      $("star").value !== "all" ||
      $("exam-only").checked;
  }

  function buildDeck(resetIndex) {
    if (resetIndex !== false) index = 0;
    deck = engine.listWords(currentFilters());
    if (index >= deck.length) index = 0;
    renderCard();
  }

  // 标记/收藏会改变筛选结果；重拉卡组并尽量停在原单词（已被筛掉则停在同位置的下一个词）
  function rebuildDeckKeeping(word) {
    var oldIndex = index;
    deck = engine.listWords(currentFilters());
    var found = -1;
    for (var i = 0; i < deck.length; i++) {
      if (deck[i].word === word) { found = i; break; }
    }
    if (found >= 0) index = found;
    else if (!deck.length) index = 0;
    else index = Math.min(oldIndex, deck.length - 1);
    renderCard();
  }

  function highlightSentence(sentence, word) {
    var node = document.createDocumentFragment();
    var re = new RegExp("\\b(" + escRe(word) + ")(s|es|ed|d|ing|ly|er|est)?\\b", "ig");
    var last = 0, m;
    while ((m = re.exec(sentence)) !== null) {
      if (m.index > last) node.appendChild(document.createTextNode(sentence.slice(last, m.index)));
      node.appendChild(ce("b", null, m[0]));
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (last < sentence.length) node.appendChild(document.createTextNode(sentence.slice(last)));
    return node;
  }

  function examYearsText(entry) {
    return (entry.examYears || []).map(function (y) { return y.replace("-", "."); }).join("、");
  }

  function fillBadges(id, entry) {
    var box = $(id);
    box.innerHTML = "";
    if (!entry) return;

    var stars = Math.max(1, Math.min(5, Number(entry.star) || 1));
    var starWrap = ce("span", "star-rating star-" + stars);
    starWrap.title = "考频 " + stars + " 星（5 星为最高频）";
    starWrap.setAttribute("aria-label", "考频 " + stars + " 星");
    starWrap.textContent = "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
    box.appendChild(starWrap);

    if (entry.examYears && entry.examYears.length) {
      var badge = ce("span", "exam-badge", "近三年真题");
      badge.title = "近三年真题出现场次：" + examYearsText(entry) +
        "（15 套真题中共出现 " + entry.examCount + " 次）";
      box.appendChild(badge);
    }
  }

  function renderCard() {
    var card = $("card");
    var entry = currentEntry();
    var sameWord = !!(entry && lastWord === entry.word);
    if (!sameWord) {
      card.classList.remove("is-flipped");
      // 手机端卡背可能停留在上一条释义的滚动位置，换词时回到顶部
      document.querySelectorAll("#card .card-face").forEach(function (face) {
        try { face.scrollTop = 0; } catch (e) { /* ignore */ }
      });
    }
    lastWord = entry ? entry.word : null;
    var marks = document.querySelectorAll(".btn.mark");
    var favBtns = [$("fav-btn"), $("fav-btn-back")];
    var speakBtns = document.querySelectorAll(".speak-btn[data-accent]");

    if (!entry) {
      setText("word", "没有匹配的单词");
      $("word").style.fontSize = "";
      setText("ipa-us", "—");
      setText("ipa-uk", "—");
      $("pos-chips").innerHTML = "";
      fillBadges("word-badges", null);
      fillBadges("word-back-badges", null);
      setText("word-back", "—");
      $("senses").innerHTML = "";
      $("senses").appendChild(ce("div", "empty", "试试调整搜索词、筛选条件或首字母。"));
      $("examples").innerHTML = "";
      $("phrases").innerHTML = "";
      $("phrases-block").hidden = true;
      $("forms").innerHTML = "";
      $("forms-block").hidden = true;
      $("idioms").innerHTML = "";
      $("idioms-block").hidden = true;
      setText("position", "0 / 0");
      marks.forEach(function (b) { b.classList.remove("is-active"); b.disabled = true; });
      favBtns.forEach(function (b) { b.disabled = true; b.textContent = "☆"; b.classList.remove("is-fav"); });
      speakBtns.forEach(function (b) { b.disabled = true; });
      return;
    }

    marks.forEach(function (b) { b.disabled = false; });
    favBtns.forEach(function (b) { b.disabled = false; });
    speakBtns.forEach(function (b) { b.disabled = false; });

    setText("word", entry.word);
    setText("word-back", entry.word);
    fillBadges("word-badges", entry);
    fillBadges("word-back-badges", entry);
    setText("ipa-us", entry.us || "—");
    setText("ipa-uk", entry.uk || "—");

    var chips = $("pos-chips");
    chips.innerHTML = "";
    (entry.pos.length ? entry.pos : ["—"]).forEach(function (p) {
      chips.appendChild(ce("span", "pos-chip", p));
    });

    var senses = $("senses");
    senses.innerHTML = "";
    entry.senses.forEach(function (s) {
      var row = ce("div", "sense");
      if (s[0]) row.appendChild(ce("span", "pos-chip", s[0]));
      row.appendChild(ce("span", null, s[1]));
      senses.appendChild(row);
    });

    var ex = $("examples");
    ex.innerHTML = "";
    entry.examples.forEach(function (pair) {
      var wrap = ce("div", "example");
      var en = ce("div", "example-en");
      en.appendChild(highlightSentence(pair[0], entry.word));
      wrap.appendChild(en);
      if (pair[1]) wrap.appendChild(ce("div", "example-zh", pair[1]));
      ex.appendChild(wrap);
    });
    if (!entry.examples.length) ex.appendChild(ce("div", "empty", "暂无例句"));

    var ph = $("phrases");
    ph.innerHTML = "";
    entry.phrases.forEach(function (p) {
      var row = ce("div", "phrase");
      row.appendChild(ce("span", "phrase-en", p[0]));
      if (p[1]) row.appendChild(ce("span", "phrase-zh", p[1]));
      ph.appendChild(row);
    });
    $("phrases-block").hidden = !entry.phrases.length;

    var forms = $("forms");
    forms.innerHTML = "";
    (entry.forms || []).forEach(function (f) {
      var row = ce("div", "form-item");
      row.appendChild(ce("span", "form-word", f[0]));
      if (f[1]) row.appendChild(ce("span", "form-pos", f[1]));
      if (f[2]) row.appendChild(ce("span", "form-zh", f[2]));
      forms.appendChild(row);
    });
    if (!(entry.forms || []).length) forms.appendChild(ce("div", "empty", "暂无词性转换"));
    $("forms-block").hidden = false;

    var idioms = $("idioms");
    idioms.innerHTML = "";
    (entry.idioms || []).forEach(function (p) {
      var row = ce("div", "idiom-item");
      row.appendChild(ce("span", "idiom-en", p[0]));
      if (p[1]) row.appendChild(ce("span", "idiom-zh", p[1]));
      idioms.appendChild(row);
    });
    if (!(entry.idioms || []).length) idioms.appendChild(ce("div", "empty", "暂无地道表达"));
    $("idioms-block").hidden = false;

    var mark = engine.getMark(entry.word);
    marks.forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-mark") === mark);
    });
    refreshFav();
    setText("position", (index + 1) + " / " + deck.length);
  }

  function refreshFav() {
    var entry = currentEntry();
    var on = entry ? engine.isFav(entry.word) : false;
    [$("fav-btn"), $("fav-btn-back")].forEach(function (b) {
      b.textContent = on ? "★" : "☆";
      b.classList.toggle("is-fav", on);
    });
  }

  function flipCard() {
    if (!currentEntry()) return;
    $("card").classList.toggle("is-flipped");
  }

  function move(delta) {
    if (!deck.length) return;
    index = (index + delta + deck.length) % deck.length;
    renderCard();
  }

  function markCurrent(mark) {
    var entry = currentEntry();
    if (!entry) return;
    engine.setMark(entry.word, mark);
    haptic(8);
    if (filtersActive()) rebuildDeckKeeping(entry.word);
    else renderCard();
    refreshGlobalStats();
    toast("已标记：" + ({ unknown: "不认识", fuzzy: "有点印象", known: "认识", new: "未学习" }[mark] || mark));
  }

  function toggleFav() {
    var entry = currentEntry();
    if (!entry) return;
    var on = engine.toggleFav(entry.word);
    if ($("filter").value === "fav") rebuildDeckKeeping(entry.word);
    else refreshFav();
    refreshGlobalStats();
    toast(on ? "已收藏 " + entry.word : "已取消收藏");
  }

  function refreshGlobalStats() {
    var s = engine.stats();
    setText("stat-mastered", s.mastered);
    setText("stat-total", s.total);
    setText("stat-accuracy", s.answered ? s.accuracy + "%" : "—");
    setText("legend-known", s.mastered);
    setText("legend-fuzzy", s.fuzzy);
    setText("legend-unknown", s.unknown);
    setText("legend-new", s.fresh);
    var pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
    $("bar-mastered").style.width = pct + "%";
    setText("progress-caption", "已掌握 " + s.mastered + " / " + s.total);
    setText("progress-percent", pct + "%");
    setText("side-fav", s.favs);
    setText("side-tested", s.testedWords);
    setText("side-exam", s.examWords);
    setText("footer-count", s.total);
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(name) {
    view = name;
    document.querySelectorAll(".tab").forEach(function (t) {
      var on = t.getAttribute("data-view") === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("is-active", v.id === "view-" + name);
    });
    if (window.scrollY > 0) {
      try {
        var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      } catch (e) { window.scrollTo(0, 0); }
    }
    if (name === "quiz") refreshQuizHistory();
    if (name === "stats") renderStatsView();
    if (name === "study") {
      refreshGlobalStats();
      if (deckSortDirty) { deckSortDirty = false; buildDeck(true); }
      else if (!deck.length) buildDeck();
    }
  }

  /* ---------------- 测试流程 ---------------- */
  function refreshQuizHistory() {
    var box = $("quiz-history");
    box.innerHTML = "";
    var head = ce("h3", null, "最近测试");
    box.appendChild(head);
    var list = engine.history(5);
    if (!list.length) {
      box.appendChild(ce("div", "empty", "还没有测试记录，选好模式开始第一次测试吧。"));
      return;
    }
    list.forEach(function (h) {
      var row = ce("div", "history-item");
      row.appendChild(ce("b", null, MODE_LABEL[h.mode] || h.mode));
      row.appendChild(ce("span", null, h.total + " 题"));
      var pct = h.total ? Math.round((h.correct / h.total) * 100) : 0;
      row.appendChild(ce("span", "ok", pct + "%"));
      var d = h.at ? new Date(h.at) : null;
      row.appendChild(ce("span", "time", d && !isNaN(d) ? d.toLocaleString("zh-CN", { hour12: false }) : ""));
      box.appendChild(row);
    });
  }

  function showQuizSetup() {
    $("quiz-setup").hidden = false;
    $("quiz-run").hidden = true;
    $("quiz-result").hidden = true;
    refreshQuizHistory();
  }

  function selectedModeList() {
    var modes = [];
    document.querySelectorAll(".mode-card.is-selected").forEach(function (c) {
      modes.push(c.getAttribute("data-mode"));
    });
    return modes.length ? modes : ["en2cn"];
  }

  function reviewScope() {
    var v = $("quiz-scope").value;
    return v === "week" || v === "month" ? v : "";
  }

  function syncQuizScopeUI() {
    var r = reviewScope();
    setText("quiz-count-label", r ? "抽查词数" : "题目数量");
    setText("quiz-count-unit", r ? "词" : "题");
    var note = $("quiz-note");
    if (note) note.hidden = !r;
    var count = $("quiz-count");
    if (count) {
      if (r === "week") { count.max = "350"; }
      else if (r === "month") { count.max = "750"; }
      else { count.max = "2000"; }
      var v = Number(count.value) || (r ? 20 : 20);
      if (v > Number(count.max)) count.value = count.max;
      if (v < 1) count.value = "1";
    }
    var grid = $("mode-grid");
    if (grid) {
      grid.classList.toggle("is-disabled", !!r);
      grid.setAttribute("aria-disabled", r ? "true" : "false");
    }
  }

  function startQuiz(opts) {
    opts = opts || {};
    var modes = opts.modes || selectedModeList();
    var size = Number(opts.size || $("quiz-count").value) || 10;
    var scope = opts.scope || $("quiz-scope").value;
    var isReview = scope === "week" || scope === "month";

    if (isReview) {
      size = Math.max(1, Math.min(size, scope === "week" ? 350 : 750));
    } else if (size > 2000) {
      size = 2000;
    }

    var s = engine.stats();
    if (scope === "fav" && !s.favs) { toast("收藏夹还是空的，先收藏几个单词吧"); return; }
    if (scope === "wrong" && !engine.wrongList().length) { toast("错题本是空的，先去测试一轮吧"); return; }
    if (isReview && !engine.recentWords(scope === "week" ? 7 : 30).length) {
      toast(scope === "week" ? "近一周还没有学习记录，先去学习页标记几个词吧" : "近一月还没有学习记录");
      return;
    }

    var built;
    if (isReview) {
      built = engine.buildReviewQuiz({
        period: scope === "month" ? "month" : "week",
        size: size,
        avoidPrevious: scope === "week"
      });
    } else {
      built = engine.buildQuiz({ modes: modes, size: size, scope: scope, phraseMix: true });
    }
    if (!built.questions.length) { toast("该范围内没有可出题的单词"); return; }

    // 周测开考即记录本批词/题型，供下一次周测去重
    if (isReview && scope === "week") engine.commitWeekQuiz(built);

    quiz = {
      mode: isReview ? scope : built.mode,
      modes: built.modes || modes,
      scope: scope,
      size: size,
      isReview: isReview,
      questions: built.questions,
      wordCount: built.wordCount || 0,
      i: 0,
      correct: 0,
      wrongWords: [],
      answers: [],
      wordStats: Object.create(null),
      locked: false,
      hints: 0,
      hintTimer: 0,
      autoNextTimer: 0,
      startedAt: Date.now()
    };

    $("quiz-setup").hidden = true;
    $("quiz-result").hidden = true;
    $("quiz-run").hidden = false;
    var label = isReview ? MODE_LABEL[scope] + " · 混合题型" :
      (quiz.modes.length > 1 ? "混合题型（" + quiz.modes.map(function (m) { return MODE_LABEL[m] || m; }).join(" + ") + "）" : MODE_LABEL[quiz.mode]);
    setText("quiz-mode-label", label);
    renderQuestion();
  }

  function resetSpellHints() {
    quiz.hints = 0;
    clearInterval(quiz.hintTimer);
    clearTimeout(quiz.autoNextTimer);
    $("hint-btn").disabled = false;
    $("hint-btn").textContent = "提示（3）";
    setText("spell-hint-text", "可获取 3 次提示");
    $("hint-choices").hidden = true;
    $("spell-timer").hidden = true;
    setText("spell-timer", "");
  }

  function renderQuestion() {
    var q = quiz.questions[quiz.i];
    quiz.locked = false;

    var fb = $("feedback");
    fb.hidden = true;
    fb.className = "feedback";

    setText("question-prompt", q.prompt);
    setText("quiz-progress", (quiz.i + 1) + " / " + quiz.questions.length);
    setText("quiz-score", "得分 " + quiz.correct);
    $("quiz-bar").style.width = Math.round((quiz.i / quiz.questions.length) * 100) + "%";

    var extra = $("question-extra");
    extra.innerHTML = "";
    var audioText = q.audioText || (q.mode === "listen" ? q.word : "");
    if (q.mode === "en2cn") {
      extra.appendChild(document.createTextNode("美 " + (q.entry.us || "—") + "　英 " + (q.entry.uk || "—")));
    } else if (q.mode === "phrase" || q.mode === "phrase-en2cn" || q.mode === "phrase-listen") {
      if (q.mode === "phrase-listen") {
        var pb = ce("button", "speak-btn phrase-speak");
        pb.type = "button";
        pb.textContent = "🔊";
        pb.title = "播放短语";
        pb.setAttribute("aria-label", "播放短语发音");
        pb.addEventListener("click", function () { speak(q.audioText, "us", pb); });
        extra.appendChild(pb);
        extra.appendChild(document.createTextNode(" 点击重听短语"));
        setTimeout(function () {
          if (quiz && quiz.questions[quiz.i] === q && !quiz.locked) speak(q.audioText, "us", pb);
        }, 260);
      }
    } else if (q.mode === "listen" || q.mode === "spell") {
      var btn = ce("button", "speak-btn");
      btn.type = "button";
      btn.textContent = "🔊";
      btn.title = "播放发音";
      btn.setAttribute("aria-label", "播放发音");
      btn.addEventListener("click", function () { speak(audioText || q.word, "us", btn); });
      extra.appendChild(btn);
      extra.appendChild(document.createTextNode(q.mode === "listen" ? " 点击重听" : " 点击听发音（提示）"));
      if (q.mode === "listen") {
        setTimeout(function () {
          if (quiz && quiz.questions[quiz.i] === q && !quiz.locked) speak(audioText || q.word, "us", btn);
        }, 260);
      }
    }

    var options = $("options");
    options.innerHTML = "";
    var form = $("spell-form");
    var input = $("spell-input");
    var hints = $("spell-hints");

    if (q.mode === "spell") {
      options.hidden = true;
      form.hidden = false;
      hints.hidden = false;
      input.value = "";
      input.disabled = false;
      input.className = "";
      var submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = false;
      resetSpellHints();
      setText("quiz-tip", "输入单词后按 Enter 或点击「检查」提交；可点「提示」获取 3 次帮助");
      setText("quiz-tip-touch", "输入单词后点「检查」提交；可点「提示」获取帮助");
      setTimeout(function () { input.focus(); }, 30);
    } else {
      form.hidden = true;
      hints.hidden = true;
      options.hidden = false;
      setText("quiz-tip", "按 1–4 选择答案，Enter 进入下一题");
      setText("quiz-tip-touch", "点击选项作答，答完点「下一题」继续");
      q.options.forEach(function (text, i) {
        var b = ce("button", "option");
        b.type = "button";
        b.setAttribute("data-index", String(i));
        b.appendChild(ce("span", "key", String(i + 1)));
        b.appendChild(ce("span", null, text));
        b.addEventListener("click", function () { answerByOption(i); });
        options.appendChild(b);
      });
    }
  }

  function answerByOption(i) {
    if (!quiz || quiz.locked) return;
    var q = quiz.questions[quiz.i];
    var picked = q.options[i];
    var ok = picked === q.answer;
    quiz.locked = true;

    document.querySelectorAll("#options .option").forEach(function (b) {
      b.disabled = true;
      var idx = Number(b.getAttribute("data-index"));
      if (idx === i) b.classList.add(ok ? "is-correct" : "is-wrong");
      if (idx === q.options.indexOf(q.answer) && !ok) b.classList.add("is-correct");
    });

    resolveAnswer(ok, picked, q);
  }

  function resolveAnswer(ok, picked, q) {
    clearInterval(quiz.hintTimer);
    clearTimeout(quiz.autoNextTimer);
    $("spell-timer").hidden = true;
    $("hint-choices").hidden = true;
    $("hint-btn").disabled = true;

    var res = engine.recordAnswer(q.word, ok);
    if (ok) {
      quiz.correct += 1;
    } else {
      var exists = quiz.wrongWords.some(function (w) { return w.word === q.word; });
      if (!exists) quiz.wrongWords.push(q.entry);
    }
    quiz.answers.push({ word: q.word, ok: ok, picked: picked });
    var ws = quiz.wordStats[q.word] || (quiz.wordStats[q.word] = { total: 0, correct: 0 });
    ws.total += 1;
    if (ok) ws.correct += 1;

    setText("quiz-score", "得分 " + quiz.correct);
    $("quiz-bar").style.width = Math.round(((quiz.i + 1) / quiz.questions.length) * 100) + "%";
    showFeedback(ok, picked, q);
    if (res && res.demoted) {
      deckSortDirty = true;
      var toLabel = res.to === "fuzzy" ? "有点印象" : "不认识";
      var fd = $("feedback-detail");
      if (fd) fd.textContent += "　⚠ 连续答错，已移入「" + toLabel + "」，该词答题记录已重置";
      toast("「" + q.word + "」已移入「" + toLabel + "」");
      haptic(12);
    }
    refreshGlobalStats();

    if (ok) {
      quiz.autoNextTimer = setTimeout(function () {
        if (quiz && quiz.locked && quiz.questions[quiz.i] === q) nextQuestion();
      }, 900);
    }
  }

  function showFeedback(ok, picked, q) {
    var fb = $("feedback");
    fb.hidden = false;
    fb.className = "feedback " + (ok ? "is-correct" : "is-wrong");
    setText("feedback-head", ok ? "✅ 回答正确" : "❌ 回答错误");

    var fw = $("feedback-word");
    fw.innerHTML = "";
    fw.appendChild(document.createTextNode(q.word));
    var ipa = ce("span", "ipa", q.entry.us || q.entry.uk || "");
    fw.appendChild(ipa);

    var detail = "释义：" + Core.senseText(q.entry);
    var meta = ["考频 " + q.entry.star + " 星"];
    if (q.entry.examYears.length) meta.push("近三年真题（" + examYearsText(q.entry) + "）");
    detail += "　" + meta.join("　");
    if (!ok) {
      if (picked) detail += "　你的答案：" + picked;
      else detail += "　未作答";
      detail += "　正确答案：" + q.answer;
    }
    setText("feedback-detail", detail);

    var next = $("next-question");
    next.textContent = quiz.i + 1 >= quiz.questions.length ? "查看结果 →" : "下一题 →";
    next.focus();

    var spellInput = $("spell-input");
    if (q.mode === "spell") {
      spellInput.classList.add(ok ? "is-correct" : "is-wrong");
      spellInput.disabled = true;
      var submit = $("spell-form").querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
    }
  }

  function submitSpelling(e) {
    if (e) e.preventDefault();
    if (!quiz || quiz.locked) return;
    var q = quiz.questions[quiz.i];
    var val = $("spell-input").value.trim().toLowerCase();
    if (!val) { toast("请先输入答案"); return; }
    quiz.locked = true;
    resolveAnswer(val === q.answer, val, q);
  }

  function oddLetterPattern(word) {
    var w = String(word || "").toLowerCase();
    var out = [];
    for (var i = 0; i < w.length; i++) {
      out.push(i % 2 === 0 ? w.charAt(i) : "_");
    }
    return out.join(" ");
  }

  function startHintTimer(q) {
    var left = 10;
    $("spell-timer").hidden = false;
    setText("spell-timer", left + " 秒");
    clearInterval(quiz.hintTimer);
    quiz.hintTimer = setInterval(function () {
      if (!quiz || quiz.locked) { clearInterval(quiz.hintTimer); return; }
      left -= 1;
      setText("spell-timer", left + " 秒");
      if (left <= 0) {
        clearInterval(quiz.hintTimer);
        $("spell-timer").hidden = true;
        quiz.locked = true;
        resolveAnswer(false, "", q);
        quiz.autoNextTimer = setTimeout(function () {
          if (quiz && quiz.locked && quiz.questions[quiz.i] === q) nextQuestion();
        }, 1400);
      }
    }, 1000);
  }

  function useSpellHint() {
    if (!quiz || quiz.locked) return;
    var q = quiz.questions[quiz.i];
    if (q.mode !== "spell") return;
    var input = $("spell-input");
    if (quiz.hints === 0) {
      quiz.hints = 1;
      setText("spell-hint-text", "首字母：" + q.word.charAt(0).toUpperCase());
      $("hint-btn").textContent = "提示（2）";
    } else if (quiz.hints === 1) {
      quiz.hints = 2;
      setText("spell-hint-text", "这个单词共 " + q.word.length + " 个字母");
      $("hint-btn").textContent = "提示（1）";
    } else if (quiz.hints === 2) {
      quiz.hints = 3;
      $("hint-btn").disabled = true;
      $("hint-btn").textContent = "提示（0）";
      setText("spell-hint-text", "最后一次提示：选择「整词」会直接记为答错，或只提示奇数位字母");
      $("hint-choices").hidden = false;
    }
  }

  function chooseWholeWordHint() {
    if (!quiz || quiz.locked) return;
    var q = quiz.questions[quiz.i];
    $("hint-choices").hidden = true;
    setText("spell-hint-text", "整词：" + q.word);
    $("spell-input").value = q.word;
    quiz.locked = true;
    resolveAnswer(false, "整词提示", q);
    quiz.autoNextTimer = setTimeout(function () {
      if (quiz && quiz.locked && quiz.questions[quiz.i] === q) nextQuestion();
    }, 1600);
  }

  function chooseOddLettersHint() {
    if (!quiz || quiz.locked) return;
    var q = quiz.questions[quiz.i];
    $("hint-choices").hidden = true;
    setText("spell-hint-text", "奇数位字母：" + oddLetterPattern(q.word) + "（10 秒内完成拼写）");
    $("spell-input").focus();
    startHintTimer(q);
  }

  function nextQuestion() {
    if (!quiz) return;
    clearInterval(quiz.hintTimer);
    clearTimeout(quiz.autoNextTimer);
    $("spell-timer").hidden = true;
    quiz.i += 1;
    if (quiz.i >= quiz.questions.length) { finishQuiz(); return; }
    renderQuestion();
  }

  function finishQuiz() {
    var total = quiz.questions.length;
    var correct = quiz.correct;
    var percent = total ? Math.round((correct / total) * 100) : 0;
    var seconds = Math.max(1, Math.round((Date.now() - quiz.startedAt) / 1000));

    $("quiz-run").hidden = true;
    $("quiz-result").hidden = false;
    $("score-ring").style.setProperty("--p", String(percent));
    setText("result-percent", percent + "%");

    var title = percent >= 95 ? "太棒了，几乎全对！" :
      percent >= 80 ? "表现不错，继续保持！" :
      percent >= 60 ? "基础还行，再巩固一轮。" : "别灰心，错题本已帮你记下。";
    setText("result-title", title);
    var sub = "共 " + total + " 题，答对 " + correct + " 题，用时 " + seconds + " 秒";
    if (quiz.isReview) sub += "；覆盖 " + quiz.wordCount + " 个近期单词";
    setText("result-sub", sub);

    var statBox = $("result-stats");
    statBox.innerHTML = "";
    [["正确", correct], ["错误", total - correct], ["正确率", percent + "%"]].forEach(function (pair) {
      var d = ce("div");
      d.appendChild(ce("b", null, String(pair[1])));
      d.appendChild(document.createTextNode(pair[0]));
      statBox.appendChild(d);
    });

    var wl = $("wrong-list");
    wl.innerHTML = "";
    if (!quiz.wrongWords.length) {
      wl.appendChild(ce("div", "empty", "本次全部答对，没有错题 🎉"));
    } else {
      quiz.wrongWords.forEach(function (w) {
        var row = ce("div", "wrong-item");
        row.appendChild(ce("b", null, w.word));
        row.appendChild(ce("span", "zh", Core.primarySense(w)));
        wl.appendChild(row);
      });
    }

    $("retry-wrong").disabled = !quiz.wrongWords.length;

    var markCounts = { known: 0, fuzzy: 0, unknown: 0 };
    Object.keys(quiz.wordStats).forEach(function (w) {
      var ws = quiz.wordStats[w];
      var mark = ws.correct === ws.total ? "known" : (ws.correct === 0 ? "unknown" : "fuzzy");
      engine.setMark(w, mark);
      markCounts[mark] += 1;
    });
    deckSortDirty = true;
    var marksEl = $("result-marks");
    if (Object.keys(quiz.wordStats).length) {
      marksEl.hidden = false;
      marksEl.textContent = "已根据本次答题更新掌握标记：认识 " + markCounts.known +
        " 词 · 有点印象 " + markCounts.fuzzy + " 词 · 不认识 " + markCounts.unknown + " 词。";
    } else {
      marksEl.hidden = true;
    }

    engine.recordTest({ mode: quiz.mode, total: total, correct: correct, at: new Date().toISOString() });
    refreshGlobalStats();
    refreshQuizHistory();
  }

  /* ---------------- 数据页 ---------------- */
  function renderStatsView() {
    var s = engine.stats();
    setText("m-mastered", s.mastered);
    setText("m-mastered-sub", (s.total ? Math.round((s.mastered / s.total) * 100) : 0) + "% 词库占比");
    setText("m-tests", s.testCount);
    setText("m-accuracy", s.answered ? s.accuracy + "%" : "—");
    setText("m-accuracy-sub", s.answered ? "已答 " + s.answered + " 题" : "暂无数据");
    setText("m-fav", s.favs);
    setText("m-exam", s.examWords);
    setText("m-exam-sub", "占词库 " + (s.total ? Math.round((s.examWords / s.total) * 100) : 0) + "%");
    setText("m-star5", s.star5);
    setText("m-star5-sub", "全部 " + s.total + " 词");

    var wb = $("wrong-book");
    wb.innerHTML = "";
    var wrong = engine.wrongList(12);
    if (!wrong.length) {
      wb.appendChild(ce("div", "empty", "还没有错题，保持住！"));
    } else {
      wrong.forEach(function (item) {
        var row = ce("div", "wrong-word");
        row.appendChild(ce("b", null, item.word));
        row.appendChild(ce("span", "zh", Core.primarySense(item.entry)));
        row.appendChild(ce("span", "count", "错 " + item.count));
        wb.appendChild(row);
      });
    }

    var hl = $("history-list");
    hl.innerHTML = "";
    var history = engine.history(6);
    if (!history.length) {
      hl.appendChild(ce("div", "empty", "暂无测试记录"));
    } else {
      history.forEach(function (h) {
        var pct = h.total ? Math.round((h.correct / h.total) * 100) : 0;
        var row = ce("div", "history-item");
        row.appendChild(ce("b", null, MODE_LABEL[h.mode] || h.mode));
        row.appendChild(ce("span", null, h.correct + "/" + h.total + " · " + pct + "%"));
        var d = h.at ? new Date(h.at) : null;
        row.appendChild(ce("span", "time", d && !isNaN(d) ? d.toLocaleString("zh-CN", { hour12: false }) : ""));
        hl.appendChild(row);
      });
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { switchView(t.getAttribute("data-view")); });
    });

    $("theme-toggle").addEventListener("click", function () {
      applyTheme(theme === "dark" ? "light" : "dark");
    });

    $("card").addEventListener("click", function (e) {
      if (suppressCardClick) { suppressCardClick = false; return; }
      if (e.target.closest("button")) return;
      flipCard();
    });

    // 手机端左右滑动切词；纵向滑动仍交给卡面滚动
    (function bindSwipe() {
      var card = $("card");
      card.addEventListener("touchstart", function (e) {
        if (e.touches.length !== 1) { swipeStart = null; return; }
        swipeStart = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          t: Date.now()
        };
      }, { passive: true });

      card.addEventListener("touchend", function (e) {
        if (!swipeStart) return;
        var touch = e.changedTouches[0];
        var dx = touch.clientX - swipeStart.x;
        var dy = touch.clientY - swipeStart.y;
        var dt = Date.now() - swipeStart.t;
        swipeStart = null;
        if (dt > 800 || Math.abs(dx) < 52) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.4) return;
        suppressCardClick = true;
        setTimeout(function () { suppressCardClick = false; }, 420);
        haptic(6);
        move(dx < 0 ? 1 : -1);
      }, { passive: true });
    })();

    document.querySelectorAll(".speak-btn[data-accent]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var entry = currentEntry();
        if (entry) speak(entry.word, b.getAttribute("data-accent"), b);
      });
    });

    [$("fav-btn"), $("fav-btn-back")].forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); toggleFav(); });
    });

    document.querySelectorAll(".btn.mark").forEach(function (b) {
      b.addEventListener("click", function () { markCurrent(b.getAttribute("data-mark")); });
    });

    $("prev").addEventListener("click", function () { move(-1); });
    $("next").addEventListener("click", function () { move(1); });
    $("shuffle").addEventListener("click", function () {
      for (var i = deck.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      index = 0;
      renderCard();
      toast("已随机排序");
    });

    $("search").addEventListener("input", debounce(function () { buildDeck(); }, 160));
    $("filter").addEventListener("change", function () { buildDeck(); });
    $("letter").addEventListener("change", function () { buildDeck(); });
    $("star").addEventListener("change", function () { buildDeck(); });
    $("exam-only").addEventListener("change", function () { buildDeck(); });

    document.querySelectorAll(".mode-card").forEach(function (card) {
      card.addEventListener("click", function () {
        if (reviewScope()) { toast("周测/月测为混合题型，无需选择单一模式"); return; }
        var mode = card.getAttribute("data-mode");
        var idx = selectedModes.indexOf(mode);
        if (idx >= 0) {
          if (selectedModes.length === 1) { toast("至少保留一种测试模式"); return; }
          selectedModes.splice(idx, 1);
        } else {
          selectedModes.push(mode);
        }
        document.querySelectorAll(".mode-card").forEach(function (c) {
          var on = selectedModes.indexOf(c.getAttribute("data-mode")) >= 0;
          c.classList.toggle("is-selected", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
    });

    $("quiz-scope").addEventListener("change", syncQuizScopeUI);
    $("quiz-count").addEventListener("change", syncQuizScopeUI);

    $("start-quiz").addEventListener("click", function () { startQuiz(); });

    $("hint-btn").addEventListener("click", useSpellHint);
    $("hint-whole").addEventListener("click", chooseWholeWordHint);
    $("hint-odd").addEventListener("click", chooseOddLettersHint);

    $("quit-quiz").addEventListener("click", function () {
      if (quiz) {
        clearInterval(quiz.hintTimer);
        clearTimeout(quiz.autoNextTimer);
      }
      quiz = null;
      showQuizSetup();
      toast("已退出本轮测试");
    });

    $("spell-form").addEventListener("submit", submitSpelling);
    $("next-question").addEventListener("click", nextQuestion);

    $("retry-same").addEventListener("click", function () {
      startQuiz({ modes: quiz.modes, size: quiz.size, scope: quiz.scope });
    });
    $("retry-wrong").addEventListener("click", function () {
      if (!quiz.wrongWords.length) { toast("没有错题可练"); return; }
      var wrongModes = quiz.isReview ? ["en2cn"] : quiz.modes;
      startQuiz({ modes: wrongModes, size: quiz.size, scope: "wrong" });
    });
    $("back-setup").addEventListener("click", function () { quiz = null; showQuizSetup(); });

    $("reset-data").addEventListener("click", function () {
      if (!window.confirm("确定清空所有学习数据吗？包括掌握标记、收藏、错题本和测试记录。此操作不可恢复。")) return;
      quiz = null;
      engine.resetAll();
      applyTheme(theme);
      buildDeck();
      refreshGlobalStats();
      renderStatsView();
      showQuizSetup();
      toast("学习数据已清空");
    });

    document.addEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    // 不拦截浏览器/系统快捷键（Ctrl+F、Ctrl+1、Alt+← 等），也忽略输入法组合与长按重复
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return;
    var t = e.target;
    var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
    if (view === "study") {
      if (typing) return;
      if (e.key === " " && t && t.closest && t.closest("button, a, input, select, textarea")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
      else if (e.key === " ") { e.preventDefault(); flipCard(); }
      else if (e.key === "Enter" && t && t.id === "card") { e.preventDefault(); flipCard(); }
      else if (e.key === "1") { e.preventDefault(); markCurrent("unknown"); }
      else if (e.key === "2") { e.preventDefault(); markCurrent("fuzzy"); }
      else if (e.key === "3") { e.preventDefault(); markCurrent("known"); }
      else if (e.key.toLowerCase() === "s") {
        var en = currentEntry(); if (en) speak(en.word, "us", null);
      } else if (e.key.toLowerCase() === "d") {
        var en2 = currentEntry(); if (en2) speak(en2.word, "uk", null);
      } else if (e.key.toLowerCase() === "f") {
        toggleFav();
      }
      return;
    }

    if (view === "quiz" && quiz && !$("quiz-run").hidden) {
      if (quiz.locked) {
        if (e.key === "Enter" && t && t.tagName === "BUTTON") return; // 交给按钮自身 click，避免连跳两题
        if (e.key === "Enter" && t !== $("spell-input")) { e.preventDefault(); nextQuestion(); }
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        var cur = quiz.questions[quiz.i];
        if (!cur || cur.mode === "spell") return;
        e.preventDefault();
        answerByOption(Number(e.key) - 1);
      }
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (!Core) { showError("核心脚本 core.js 加载失败，请确认文件完整。"); return; }

    var raw = [];
    if (Array.isArray(window.CET4_WORDS_A)) raw = raw.concat(window.CET4_WORDS_A);
    if (Array.isArray(window.CET4_WORDS_B)) raw = raw.concat(window.CET4_WORDS_B);
    if (!raw.length) {
      showError("词库未加载：请确认 js/data-a.js 与 js/data-b.js 存在且内容有效。");
      return;
    }

    engine = Core.createEngine(raw);
    if (!engine.words.length) { showError("词库解析结果为空，请检查数据文件格式。"); return; }

    initTheme();
    bindEvents();

    var letters = engine.letterCounts();
    Object.keys(letters).sort().forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c.toUpperCase() + "（" + letters[c] + "）";
      $("letter").appendChild(opt);
    });

    buildDeck();
    syncQuizScopeUI();
    refreshGlobalStats();
    renderStatsView();
    refreshQuizHistory();

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      try { init(); } catch (err) {
        showError("初始化失败：" + err.message);
        if (window.console) console.error(err);
      }
    });
  } else {
    try { init(); } catch (err) {
      showError("初始化失败：" + err.message);
      if (window.console) console.error(err);
    }
  }
})();
