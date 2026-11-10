#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给词性转换补中文释义。

优先用词库本身（派生形式若也是 CET-4 词条，直接取该词条首要中文释义）；
其余形式用有道词典 jsonapi 取中文，并缓存到 .work/form-zh.json。
输出：每条 forms 从 [form, pos] 变为 [form, pos, zh]。
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = [os.path.join(ROOT, "js", "data-a.js"), os.path.join(ROOT, "js", "data-b.js")]
CACHE = os.path.join(ROOT, ".work", "form-zh.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

POS_RE = re.compile(r"^(?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|aux|int|abbr)\.\s*", re.I)
TAG_RE = re.compile(r"<[^>]+>")


def load(path):
    text = open(path, encoding="utf-8").read()
    start = text.index("[")
    end = text.rindex("]") + 1
    return json.loads(text[start:end])


def dump(path, rows):
    head = "window.CET4_WORDS_A = [\n" if path.endswith("data-a.js") else "window.CET4_WORDS_B = [\n"
    body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
    open(path, "w", encoding="utf-8", newline="\n").write(head + body + "\n];\n")


def clean_zh(s):
    s = TAG_RE.sub("", s or "")
    s = POS_RE.sub("", s).strip()
    s = re.sub(r"\s+", " ", s)
    parts = [p.strip() for p in re.split(r"[；;]", s) if p.strip()]
    out = "；".join(parts[:2])
    return out[:60].strip()


def fetch(word):
    url = "https://dict.youdao.com/jsonapi?q=" + urllib.parse.quote(word)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
    trs = (((data.get("ec") or {}).get("word") or [{}])[0].get("trs") or [])
    vals = []
    for t in trs:
        for tr in t.get("tr") or []:
            vals.extend((tr.get("l") or {}).get("i") or [])
    return "；".join(x for x in (clean_zh(v) for v in vals) if x)[:80]


def fetch_with_retry(word):
    last = ""
    for i in range(3):
        try:
            zh = fetch(word)
            if zh:
                return word, zh
            last = "empty"
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(0.6 * (i + 1))
    return word, last


def main():
    rows = []
    for p in DATA:
        rows.extend(load(p))
    by_word = {r["word"].lower(): r for r in rows}

    cache = {}
    if os.path.exists(CACHE):
        try:
            cache = json.load(open(CACHE, encoding="utf-8"))
        except Exception:
            cache = {}

    forms = {}
    for r in rows:
        for f in r.get("forms", []):
            forms.setdefault(f[0], set()).add(f[1])

    # 1) 词库内已有词条，直接取词条首要释义
    for form in forms:
        if form in by_word and cache.get(form) is None:
            senses = by_word[form].get("senses") or []
            if senses:
                cache[form] = clean_zh(senses[0][1])
    # 2) 联网补
    todo = [f for f in sorted(forms) if not cache.get(f)]
    print("forms:", len(forms), "local:", len(forms) - len(todo), "remote:", len(todo), flush=True)
    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_with_retry, w): w for w in todo}
        for fut in as_completed(futs):
            w, zh = fut.result()
            if zh and zh != "empty" and not zh.startswith(("HTTP Error", "<urlopen error")):
                cache[w] = zh
            done += 1
            if done % 200 == 0:
                json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
                print("  %d/%d  %.0fs" % (done, len(todo), time.time() - t0), flush=True)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    miss = 0
    for path in DATA:
        data = load(path)
        for r in data:
            base = (r.get("senses") or [["", ""]])[0][1]
            new_forms = []
            for f in r.get("forms", []):
                zh = cache.get(f[0]) or clean_zh(base)
                if not zh:
                    miss += 1
                new_forms.append([f[0], f[1], zh] if zh else [f[0], f[1]])
            r["forms"] = new_forms
        dump(path, data)
        print("written", os.path.basename(path), len(data), flush=True)
    print("done; missing zh:", miss, "cache:", len(cache))


if __name__ == "__main__":
    sys.exit(main())
