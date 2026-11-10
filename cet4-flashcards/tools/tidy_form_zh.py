#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""精简 forms 第三项中文释义：去括号解释、最多两个短句、过滤“的现在分词”类说明。"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = [os.path.join(ROOT, "js", "data-a.js"), os.path.join(ROOT, "js", "data-b.js")]
TAG_RE = re.compile(r"<[^>]+>")
PAREN_RE = re.compile(r"[（(][^（）()]*[）)]")
INFLECT_RE = re.compile(r"的(现在分词|过去式|过去分词|复数|第三人称|动名词)")


def load(path):
    text = open(path, encoding="utf-8").read()
    return json.loads(text[text.index("["):text.rindex("]") + 1])


def dump(path, rows):
    head = "window.CET4_WORDS_A = [\n" if path.endswith("data-a.js") else "window.CET4_WORDS_B = [\n"
    body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
    open(path, "w", encoding="utf-8", newline="\n").write(head + body + "\n];\n")


def base_clean(s):
    s = TAG_RE.sub("", s or "")
    s = PAREN_RE.sub("", s)
    s = re.sub(r"\s+", " ", s).strip(" ，,；;。")
    return re.split(r"[；;]", s)[0].strip()


def shorten(s):
    s = base_clean(s)
    if INFLECT_RE.search(s):
        return ""
    if len(s) <= 30:
        return s
    parts = [p for p in re.split(r"[，,；;]", s) if p.strip()]
    out = ""
    for p in parts:
        cand = (out + "，" + p) if out else p
        if len(cand) > 30:
            break
        out = cand
    return out or parts[0][:30]


for path in DATA:
    rows = load(path)
    n = 0
    for r in rows:
        base = shorten((r.get("senses") or [["", ""]])[0][1])
        for f in r.get("forms", []):
            if len(f) >= 3:
                z = shorten(f[2])
                if not z or INFLECT_RE.search(f[2] or ""):
                    z = base
                if z != f[2]:
                    n += 1
                f[2] = z
    dump(path, rows)
    print(os.path.basename(path), "tidied", n)
