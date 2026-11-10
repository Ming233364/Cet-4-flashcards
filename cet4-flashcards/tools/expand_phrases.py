#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按星级扩充短语数量，保留现有词条其余字段。

输入：js/data-a.js、js/data-b.js、.work/CET4_{1,2,3}_sentence.json
输出：覆盖 data-a/b；之后运行 tools/enrich_vocab.py 重新补 forms/idioms。
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CJK = re.compile(r"[\u4e00-\u9fff]")
TOKEN = re.compile(r"[A-Za-z]+")


def load_cet4_words():
    words = set()
    for fn in ("js/data-a.js", "js/data-b.js"):
        path = os.path.join(ROOT, fn)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip().rstrip(",")
                if line.startswith("{"):
                    words.add(json.loads(line)["word"])
    return words

STOP = {"a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "by",
        "from", "up", "down", "out", "off", "over", "into", "onto", "as",
        "and", "or", "be", "is", "are", "one", "ones", "one's", "somebody",
        "something", "sb", "sth", "sb's", "sb.'s"}
BAD = {"adult movie", "adult film", "sex", "porn", "honda"}

def load_raw():
    raw = {}
    for name in ("CET4_1_sentence.json", "CET4_2_sentence.json", "CET4_3_sentence.json"):
        path = os.path.join(ROOT, ".work", name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for item in data:
            w = str(item.get("word", "")).strip().lower()
            if not w:
                continue
            cur = raw.setdefault(w, [])
            for p in item.get("phrases", []) or []:
                en = re.sub(r"\s+", " ", str(p.get("phrase", ""))).strip()
                zh = re.sub(r"\s+", " ", str(p.get("translation", ""))).strip()
                if en and zh and CJK.search(zh):
                    cur.append([en, zh])
    return raw


def choose(word, candidates, star, vocab):
    limit = 4 if star >= 4 else (3 if star == 3 else 2)
    out = []
    seen = set()
    for en, zh in candidates:
        low = en.lower()
        if low == word or low in BAD:
            continue
        if len(en.split()) > 4:
            continue
        if not CJK.search(zh):
            continue
        if re.match(r"^(n|v|adj|adv|prep|pron|conj)\.", zh):
            continue
        toks = [t.lower() for t in TOKEN.findall(en)]
        if not toks or any(len(t) > 15 for t in toks):
            continue
        if toks[-1] in STOP:
            continue
        content = [t for t in toks if t not in STOP]
        unknown = 0
        for t in content:
            if t in vocab:
                continue
            # 允许简单屈折
            if t.endswith("s") and t[:-1] in vocab:
                continue
            if t.endswith("es") and t[:-2] in vocab:
                continue
            if t.endswith("ed") and (t[:-2] in vocab or t[:-1] in vocab):
                continue
            if t.endswith("ing") and (t[:-3] in vocab or t[:-3] + "e" in vocab):
                continue
            unknown += 1
        if unknown:
            continue
        key = low
        if key in seen:
            continue
        seen.add(key)
        # 优先以该词开头/结尾的搭配、2-3 词、较短
        edge = 0 if (toks[0] == word or toks[-1] == word) else 1
        out.append((edge, len(toks), len(en), low, en, zh))
    out.sort()
    return [[en, zh] for _, _, _, _, en, zh in out[:limit]]


def main():
    raw = load_raw()
    vocab = load_cet4_words()
    files = ["js/data-a.js", "js/data-b.js"]
    total = 0
    counts = {}
    for idx, fn in enumerate(files):
        entries = []
        with open(os.path.join(ROOT, fn), encoding="utf-8") as f:
            for line in f:
                line = line.strip().rstrip(",")
                if line.startswith("{"):
                    entries.append(json.loads(line))
        for e in entries:
            cands = list(e.get("phrases") or [])
            cands += raw.get(e["word"], [])
            # 去重
            dedup = []
            seen = set()
            for en, zh in cands:
                k = en.lower()
                if k not in seen:
                    seen.add(k)
                    dedup.append([en, zh])
            e["phrases"] = choose(e["word"], dedup, int(e.get("star", 1)), vocab)
            counts[e["star"]] = counts.get(e["star"], 0) + len(e["phrases"])
            total += len(e["phrases"])
        name = "A" if idx == 0 else "B"
        path = os.path.join(ROOT, fn)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("window.CET4_WORDS_%s = [\n" % name)
            for i, e in enumerate(entries):
                f.write(json.dumps(e, ensure_ascii=False, separators=(",", ":")))
                f.write(",\n" if i < len(entries) - 1 else "\n")
            f.write("];\n")
        print("wrote", path, len(entries), "phrases", sum(len(e["phrases"]) for e in entries))
    print("total phrases", total, "counts", counts)


if __name__ == "__main__":
    main()
