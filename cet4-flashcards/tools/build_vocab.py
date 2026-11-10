#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 4500 词级 CET-4 词库。

输入（.work/ 下，不随发布包提供）：
  CET4_1_sentence.json / CET4_2_sentence.json / CET4_3_sentence.json
      来源：https://github.com/KyleBing/dict （CET4 词汇 + 英美音标 + 释义 + 例句 + 短语）
  cet4_words.csv
      来源：https://github.com/cduang/word-statistics-cet4
      2006-2017 年 36 套四级真题词频（GBK，列：单词,翻译,出现次数）
  papers/cet4-YYYY-MM-set-0N.txt
      来源：https://github.com/catteacher0515/cet4-download
      近三年 15 套真题 PDF 经 pdftotext -enc UTF-8 -layout 提取的文本
  ipa-extra.json
      对原词库缺失音标的词，用 dictionaryapi.dev 补齐的缓存

输出：
  js/data-a.js、js/data-b.js   window.CET4_WORDS_A/B（每条一行 JSON）
  tools/words-a.txt、tools/words-b.txt
  tools/vocab-report.json     构建统计，便于校验

字段：word, us, uk, pos, senses, examples, phrases, star, examYears, examCount
star: 1-5，5 为考频最高。exaYears: 近三年出现过的场次（如 ["2024-06"]）。
"""
import csv
import glob
import io
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, ".work")
SESSIONS = ["2023-12", "2024-06", "2024-12", "2025-06", "2025-12"]
BASE_FILES = ["CET4_1_sentence.json", "CET4_2_sentence.json", "CET4_3_sentence.json"]
DROP_WORDS = {"cigaret", "reservior"}  # 原数据中的拼写错误，已分别由 cigarette / reservoir 覆盖
MANUAL_IPA = {
    "advocator": ("/ˈædvəkeɪtər/", "/ˈædvəkeɪtə/"),
    "expressiveness": ("/ɪkˈspresɪvnəs/", "/ɪkˈspresɪvnəs/"),
    "groundlessly": ("/ˈɡraʊndləslɪ/", "/ˈɡraʊndləslɪ/"),
    "impermanency": ("/ɪmˈpɜːrmənənsi/", "/ɪmˈpɜːmənənsi/"),
    "irrationally": ("/ɪˈræʃənəli/", "/ɪˈræʃənəli/"),
    "miscalculation": ("/ˌmɪskælkjəˈleɪʃn/", "/ˌmɪskælkjəˈleɪʃn/"),
    "repave": ("/ˌriːˈpeɪv/", "/ˌriːˈpeɪv/"),
    "restock": ("/ˌriːˈstɑːk/", "/ˌriːˈstɒk/"),
    "unaffordable": ("/ˌʌnəˈfɔːrdəbl/", "/ˌʌnəˈfɔːdəbl/"),
    "durability": ("/ˌdʊrəˈbɪləti/", "/ˌdjʊərəˈbɪləti/"),
    "prohibitively": ("/prəˈhɪbətɪvli/", "/prəˈhɪbətɪvli/"),
    "retrain": ("/ˌriːˈtreɪn/", "/ˌriːˈtreɪn/"),
    "puzzling": ("/ˈpʌzlɪŋ/", "/ˈpʌzlɪŋ/"),
    "reframe": ("/ˌriːˈfreɪm/", "/ˌriːˈfreɪm/"),
    "racially": ("/ˈreɪʃəli/", "/ˈreɪʃəli/"),
    "implementation": ("/ˌɪmplɪmenˈteɪʃn/", "/ˌɪmplɪmenˈteɪʃn/"),
    "at": ("/æt/", "/æt/"),
    "australian": ("/ɔːˈstreɪliən/", "/ɒˈstreɪliən/"),
    "chinese": ("/ˌtʃaɪˈniːz/", "/ˌtʃaɪˈniːz/"),
    "christmas": ("/ˈkrɪsməs/", "/ˈkrɪsməs/"),
    "france": ("/fræns/", "/frɑːns/"),
    "friday": ("/ˈfraɪdeɪ/", "/ˈfraɪdeɪ/"),
    "from": ("/frəm/", "/frɒm/"),
    "mediterranean": ("/ˌmedɪtəˈreɪniən/", "/ˌmedɪtəˈreɪniən/"),
    "systematical": ("/ˌsɪstəˈmætɪkl/", "/ˌsɪstəˈmætɪkl/"),
    "christ": ("/kraɪst/", "/kraɪst/"),
    "heterogeneity": ("/ˌhetərədʒəˈniːəti/", "/ˌhetərədʒəˈniːəti/"),
    "world-wide": ("/ˌwɜːrldˈwaɪd/", "/ˌwɜːldˈwaɪd/"),
    "direction": ("/dəˈrekʃn/", "/dɪˈrekʃn/"),
}
POS_MAP = {
    "n": "n.", "v": "v.", "adj": "adj.", "adv": "adv.", "a": "adj.", "ad": "adv.",
    "vt": "vt.", "vi": "vi.", "prep": "prep.", "pron": "pron.", "num": "num.",
    "conj": "conj.", "int": "int.", "aux": "aux.", "art": "art.", "abbr": "abbr.",
    "pl": "pl.", "phr": "phr."
}
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
# 原始词库少量脏数据（释义只有词性、例句缺中文、短语缺中文），在此人工修正
SENSE_FIXES = {
    "do": {"senses": [["aux.", "（构成疑问句和否定句）"], ["v.", "做，干，办"]]},
    "spite": {"senses": [["n.", "恶意，怨恨"], ["n.", "（in spite of）尽管"]]},
    "statistics": {"examples": [["statistics for earnings by different age groups", "不同年龄组的收入统计数据"]]},
    "gratitude": {"pos": ["n."], "senses": [["n.", "感激，感谢，感恩"]]},
}
# 原始语料中 131 个词没有例句，用人工撰写的简短例句补齐（见 tools/example-fixes.json）
EXAMPLE_FIXES = {}
_example_fixes_path = os.path.join(ROOT, "tools", "example-fixes.json")
if os.path.exists(_example_fixes_path):
    with open(_example_fixes_path, encoding="utf-8") as _f:
        EXAMPLE_FIXES = json.load(_f)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def norm_type(t):
    t = (t or "").strip().lower().replace("&", " ").replace("/", " ").replace(",", " ")
    parts = [p for p in re.split(r"\s+", t) if p]
    out = []
    for p in parts:
        p = POS_MAP.get(p, p if p.endswith(".") else p + ".")
        if p not in out:
            out.append(p)
    return out


def clean_ipa(raw, word=""):
    if not raw:
        return ""
    s = str(raw).strip()
    s = s.strip("/[] ")
    s = s.split(";")[0].strip()
    s = re.sub(r"^,+", "ˌ", s)  # 行首逗号表示次重音，如 ,ækəˈdɛmɪk
    if "," in s:
        parts = [p for p in s.split(",") if p]
        if parts:
            variant = (word in ("and", "as")
                       or all("ˈ" in p for p in parts)
                       or any(p.startswith("-") or p.endswith("-") for p in parts))
            s = parts[0] if variant else "ˌ".join(parts)
    s = s.replace("'", "ˈ").replace("`", "ˈ")
    s = s.replace("ɹ", "r").replace("ɚ", "ər").replace("ɝ", "ɜːr").replace(":", "ː")
    s = re.sub(r"[.\u00b7]", "", s)
    s = re.sub(r"\s+", "", s)
    return "/" + s + "/" if s else ""


def load_base():
    words = {}
    for name in BASE_FILES:
        for raw in read_json(os.path.join(WORK, name)):
            w = str(raw.get("word", "")).strip().lower()
            if not w or w in DROP_WORDS:
                continue
            # 第一次出现的版本优先；后续文件只用于补齐缺失的音标/例句
            if w not in words:
                words[w] = raw
            else:
                cur = words[w]
                for k in ("us", "uk"):
                    if not cur.get(k) and raw.get(k):
                        cur[k] = raw[k]
                if len(raw.get("sentences") or []) > len(cur.get("sentences") or []):
                    cur["sentences"] = raw.get("sentences")
                if len(raw.get("phrases") or []) > len(cur.get("phrases") or []):
                    cur["phrases"] = raw.get("phrases")
    return words


def load_old_entries():
    out = []
    for name in ("data-a.js", "data-b.js"):
        path = os.path.join(ROOT, "js", name)
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip().rstrip(",")
                if line.startswith("{"):
                    out.append(json.loads(line))
    return out


def form_variants(w):
    """生成常见屈折形式，用于真题命中与词频归并（保守：不生成 -ly/-ness 等派生词）。"""
    vs = {w}
    if w.endswith("y") and len(w) > 2 and w[-2] not in "aeiou":
        stem = w[:-1]
        vs.update([stem + "ies", stem + "ied"])
    else:
        vs.add(w + "s")
    if w.endswith(("s", "x", "z", "ch", "sh")):
        vs.add(w + "es")
    if w.endswith("e"):
        vs.add(w + "d")
        vs.add(w[:-1] + "ing")
    else:
        vs.add(w + "ed")
        vs.add(w + "ing")
    if re.search(r"[^aeiou][aeiou][bdgkmlnprstvz]$", w):
        vs.update([w + w[-1] + "ed", w + w[-1] + "ing"])
    return vs


def load_freq():
    raw = open(os.path.join(WORK, "cet4_words.csv"), "rb").read().decode("gbk", "replace")
    rows = list(csv.reader(io.StringIO(raw)))
    out = {}
    for r in rows[1:]:
        if len(r) < 3 or not r[2].strip().isdigit():
            continue
        out[r[0].strip().lower()] = int(r[2])
    return out


def load_papers():
    counts = {}
    for s in SESSIONS:
        c = Counter()
        for path in sorted(glob.glob(os.path.join(WORK, "papers", "cet4-%s-set-*.txt" % s))):
            with open(path, encoding="utf-8") as f:
                text = f.read()
            text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)  # 断行连字符
            c.update(t.lower() for t in re.findall(r"[A-Za-z]+(?:['-][A-Za-z]+)*", text))
        counts[s] = c
    return counts


def build():
    base = load_base()
    old = {e["word"].strip().lower(): e for e in load_old_entries()}
    words = dict(base)
    for w, e in old.items():
        words[w] = e  # 精编条目覆盖原始条目
    freq = load_freq()
    papers = load_papers()
    ipa_extra = {}
    extra_path = os.path.join(WORK, "ipa-extra.json")
    if os.path.exists(extra_path):
        ipa_extra = read_json(extra_path)

    # 词频分数：旧 36 套 + 近三年 15 套，均折算成“每套平均出现次数”
    score = {}
    for w in words:
        vs = form_variants(w)
        old_c = sum(freq.get(v, 0) for v in vs)
        new_c = sum(papers[s].get(v, 0) for s in SESSIONS for v in vs)
        score[w] = old_c / 36.0 + new_c / 15.0

    # 星级：未在真题中出现过 → 1 星；出现过的按分数排序，前 10%/25%/50% 分别为 5/4/3 星，其余 2 星
    observed = sorted([w for w in words if score[w] > 0], key=lambda w: (-score[w], w))
    n = len(observed)
    star = {w: 1 for w in words}
    for i, w in enumerate(observed):
        if i < n * 0.10:
            star[w] = 5
        elif i < n * 0.25:
            star[w] = 4
        elif i < n * 0.50:
            star[w] = 3
        else:
            star[w] = 2

    entries = []
    star_count = Counter()
    exam_words = 0
    for w in sorted(words):
        raw = words[w]
        if w in old and "senses" in raw:
            pos = [str(x).strip() for x in raw.get("pos", []) if str(x).strip()]
            senses = [[str(a).strip(), str(b).strip()] for a, b in raw.get("senses", []) if str(b).strip()]
            examples = [[str(a).strip(), str(b).strip()] for a, b in raw.get("examples", [])][:2]
            phrases = [[str(a).strip(), str(b).strip()] for a, b in raw.get("phrases", [])][:20]
            us, uk = clean_ipa(raw.get("us"), w), clean_ipa(raw.get("uk"), w)
        else:
            pos, senses = [], []
            for t in raw.get("translations", []) or []:
                zh = re.sub(r"\s+", " ", str(t.get("translation", ""))).strip()
                if not zh:
                    continue
                types = norm_type(t.get("type"))
                if types and types[0] not in pos:
                    pos.append(types[0])
                senses.append([types[0] if types else "", zh])
            pos = pos[:4]
            senses = senses[:3]
            examples = []
            for s in (raw.get("sentences", []) or [])[:2]:
                en = re.sub(r"\s+", " ", str(s.get("sentence", ""))).strip()
                zh = str(s.get("translation", "")).strip()
                if en:
                    examples.append([en, zh])
            phrases = []
            for p in (raw.get("phrases", []) or [])[:20]:
                en = str(p.get("phrase", "")).strip()
                zh = str(p.get("translation", "")).strip()
                if en:
                    phrases.append([en, zh])
            us, uk = clean_ipa(raw.get("us"), w), clean_ipa(raw.get("uk"), w)

        # 精编条目偶有缺音标：从原始数据集回填
        if (not us or not uk) and w in base:
            us = us or clean_ipa(base[w].get("us"), w)
            uk = uk or clean_ipa(base[w].get("uk"), w)
        # 音标兜底：单边缺失时用 API 缓存/对侧补齐，再退回人工表
        if not us and not uk and w in MANUAL_IPA:
            us, uk = MANUAL_IPA[w]
        if w in ipa_extra:
            us = us or clean_ipa(ipa_extra[w].get("us"), w)
            uk = uk or clean_ipa(ipa_extra[w].get("uk"), w)
        if not us and uk:
            us = uk
        if not uk and us:
            uk = us
        if not us and not uk and w in MANUAL_IPA:
            us, uk = MANUAL_IPA[w]
        if not senses:
            senses = [["", "（暂无释义）"]]

        vs = form_variants(w)
        years = [s for s in SESSIONS if any(papers[s].get(v, 0) for v in vs)]
        exam_count = sum(papers[s].get(v, 0) for s in SESSIONS for v in vs)
        if years:
            exam_words += 1
        star_count[star[w]] += 1
        entries.append({
            "word": w,
            "us": us,
            "uk": uk,
            "pos": pos,
            "senses": senses,
            "examples": examples,
            "phrases": phrases,
            "star": star[w],
            "examYears": years,
            "examCount": exam_count
        })

    # 清洗脏释义/例句/短语：中文为空或只有词性的条目直接剔除；个别条目人工修正
    for e in entries:
        fix = SENSE_FIXES.get(e["word"])
        if fix:
            e.update(fix)
        e["senses"] = [s for s in e["senses"] if s[1] and CJK_RE.search(s[1])]
        if not e["senses"]:
            e["senses"] = [["", "（暂无释义）"]]
        e["examples"] = [x for x in e["examples"] if x[1] and CJK_RE.search(x[1])]
        if not e["examples"] and e["word"] in EXAMPLE_FIXES:
            e["examples"] = [list(x) for x in EXAMPLE_FIXES[e["word"]]][:2]
        e["phrases"] = [p for p in e["phrases"] if p[1] and CJK_RE.search(p[1])]

    # 按星级控制短语数量：高频词保留更多常见搭配
    def trim_phrases(e):
        out = []
        seen = set()
        for en, zh in e.get("phrases", []):
            en = re.sub(r"\s+", " ", en).strip()
            zh = re.sub(r"\s+", " ", zh).strip()
            if not en or not zh or not CJK_RE.search(zh):
                continue
            if en.lower() == e["word"].lower():
                continue
            if len(en.split()) > 4:
                continue
            if any(len(tok) > 16 for tok in re.findall(r"[A-Za-z]+", en)):
                continue
            key = en.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append([en, zh])
        limit = 4 if e["star"] >= 4 else (3 if e["star"] == 3 else 2)
        e["phrases"] = out[:limit]

    for e in entries:
        trim_phrases(e)

    # 按字母平均分成两份，避免单文件过大
    half = (len(entries) + 1) // 2
    chunks = [entries[:half], entries[half:]]
    names = ["A", "B"]
    for chunk, name in zip(chunks, names):
        path = os.path.join(ROOT, "js", "data-%s.js" % name.lower())
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("window.CET4_WORDS_%s = [\n" % name)
            for e in chunk:
                f.write(json.dumps(e, ensure_ascii=False, separators=(",", ":")) + ",\n")
            f.write("];\n")
        with open(os.path.join(ROOT, "tools", "words-%s.txt" % name.lower()), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(e["word"] for e in chunk) + "\n")

    report = {
        "total": len(entries),
        "sessions": SESSIONS,
        "stars": {str(k): star_count[k] for k in sorted(star_count, reverse=True)},
        "examWords": exam_words,
        "missingIpa": [e["word"] for e in entries if not e["us"] or not e["uk"]],
        "noExamples": sum(1 for e in entries if not e["examples"]),
        "noSenses": sum(1 for e in entries if not e["senses"]),
        "split": [len(chunks[0]), len(chunks[1])]
    }
    with open(os.path.join(ROOT, "tools", "vocab-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(build())
