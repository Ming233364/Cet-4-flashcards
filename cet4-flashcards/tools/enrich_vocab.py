#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为 CET-4 词库补充词性转换（forms）与常用地道表达（idioms）。

数据来源：
- WordNet 3.1（wordnet-db）：派生关系（+ 指针）与词性，双向补全。
- BAWF（British and American Word Families Project）：词族补充，按词频过滤。
- tools/idioms.json：人工整理的高频地道表达。

用法：python3 tools/enrich_vocab.py
"""
import csv
import gzip
import json
import os
import re
import sys
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, ".work")
DATA_FILES = ["js/data-a.js", "js/data-b.js"]
wn_dir = os.path.join(WORK, "wordnet", "package", "dict")

POS_MAP = {"n": "n.", "v": "v.", "a": "adj.", "s": "adj.", "r": "adv."}
SUFFIX_POS = [
    ("ization", "n."), ("isation", "n."), ("ability", "n."), ("ibility", "n."),
    ("ation", "n."), ("ition", "n."), ("ment", "n."), ("ness", "n."),
    ("ance", "n."), ("ence", "n."), ("ancy", "n."), ("ency", "n."),
    ("ity", "n."), ("ism", "n."), ("ist", "n."), ("ship", "n."),
    ("hood", "n."), ("dom", "n."), ("tion", "n."), ("sion", "n."),
    ("ure", "n."), ("age", "n."), ("ee", "n."),
    ("ive", "adj."), ("ous", "adj."), ("ful", "adj."), ("less", "adj."),
    ("able", "adj."), ("ible", "adj."), ("ical", "adj."), ("ic", "adj."),
    ("al", "adj."), ("ary", "adj."), ("ory", "adj."), ("ish", "adj."),
    ("ant", "adj."), ("ent", "adj."), ("ly", "adv."),
    ("ize", "v."), ("ise", "v."), ("ify", "v."), ("ate", "v."),
]
ADJ_LY = {
    "friendly", "lovely", "likely", "lonely", "daily", "early", "only",
    "silly", "ugly", "holy", "orderly", "monthly", "weekly", "yearly",
    "elderly", "costly", "deadly", "lively", "manly", "scholarly", "timely",
}
MANUAL_FORMS = {
    "ability": [["able", "adj."], ["enable", "v."], ["disable", "v."], ["ably", "adv."]],
    "able": [["ability", "n."], ["enable", "v."], ["disable", "v."], ["ably", "adv."]],
    "vary": [["variation", "n."], ["variety", "n."], ["various", "adj."], ["variously", "adv."]],
    "beauty": [["beautiful", "adj."], ["beautify", "v."], ["beautifully", "adv."]],
    "beautiful": [["beauty", "n."], ["beautifully", "adv."], ["beautify", "v."]],
    "nation": [["national", "adj."], ["nationality", "n."], ["nationally", "adv."], ["nationalism", "n."]],
    "national": [["nation", "n."], ["nationality", "n."], ["nationally", "adv."]],
    "care": [["careful", "adj."], ["carefully", "adv."], ["careless", "adj."], ["carefulness", "n."]],
    "careful": [["care", "n./v."], ["carefully", "adv."], ["careless", "adj."]],
    "happy": [["happiness", "n."], ["happily", "adv."], ["unhappy", "adj."]],
    "important": [["importance", "n."], ["importantly", "adv."]],
    "succeed": [["success", "n."], ["successful", "adj."], ["successfully", "adv."]],
    "success": [["succeed", "v."], ["successful", "adj."], ["successfully", "adv."]],
    "use": [["usage", "n."], ["useful", "adj."], ["useless", "adj."], ["user", "n."]],
    "produce": [["product", "n."], ["production", "n."], ["productive", "adj."], ["producer", "n."]],
    "product": [["produce", "v."], ["production", "n."], ["productive", "adj."]],
    "friend": [["friendly", "adj."], ["friendship", "n."], ["friendliness", "n."]],
    "friendly": [["friend", "n."], ["friendship", "n."]],
    "create": [["creation", "n."], ["creative", "adj."], ["creativity", "n."], ["creator", "n."]],
    "decide": [["decision", "n."], ["decisive", "adj."], ["decisively", "adv."]],
    "depend": [["dependence", "n."], ["dependent", "adj."], ["dependable", "adj."]],
    "differ": [["difference", "n."], ["different", "adj."], ["differently", "adv."]],
    "vary": [["variety", "n."], ["various", "adj."], ["variation", "n."]],
    "economy": [["economic", "adj."], ["economical", "adj."], ["economist", "n."], ["economize", "v."]],
    "economic": [["economy", "n."], ["economical", "adj."], ["economist", "n."]],
}

def load_words():
    entries = []
    for fn in DATA_FILES:
        with open(os.path.join(ROOT, fn), encoding="utf-8") as f:
            for line in f:
                line = line.strip().rstrip(",")
                if line.startswith("{"):
                    entries.append(json.loads(line))
    return entries

def load_wordnet():
    syn = {}
    idx = collections.defaultdict(list)
    fwd = collections.defaultdict(list)
    rev = collections.defaultdict(list)
    lemma_pos = {}
    files = [("data.noun", "n"), ("data.verb", "v"), ("data.adj", "a"), ("data.adv", "r")]
    for fn, pos in files:
        path = os.path.join(wn_dir, fn)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                if not re.match(r"^\d{8} ", line):
                    continue
                parts = line.split("|", 1)[0].split()
                off = parts[0]
                wc = int(parts[3], 16)
                lemmas = []
                i = 4
                for _ in range(wc):
                    lemmas.append(parts[i].replace("_", " "))
                    i += 2
                syn[off] = (pos, lemmas)
                for j, lemma in enumerate(lemmas):
                    low = lemma.lower()
                    idx[low].append((off, j))
                    lemma_pos.setdefault(low, set()).add(POS_MAP.get(pos, pos))
                pc = int(parts[i])
                i += 1
                for _ in range(pc):
                    sym = parts[i]
                    poff = parts[i + 1]
                    st = int(parts[i + 3], 16)
                    i += 4
                    if sym == "+":
                        src, tgt = st >> 8, st & 0xFF
                        fwd[(off, src)].append((poff, tgt))
                        rev[(poff, tgt)].append((off, src))
    return syn, idx, fwd, rev, lemma_pos

def load_bawf():
    """返回 word -> [(member, zipf)] 同族词，以及 word -> zipf。"""
    fam = collections.defaultdict(list)
    zipf = {}
    path = os.path.join(WORK, "BAWF_FINAL.csv.gz")
    if not os.path.exists(path):
        path = os.path.join(WORK, "BAWF_curated.csv.gz")
    if not os.path.exists(path):
        return fam, zipf
    with gzip.open(path, "rt", encoding="latin-1") as f:
        for row in csv.DictReader(f):
            w = row["Word"].strip().lower()
            b = row["Baseword"].strip().lower()
            try:
                z = float(row["Word_frq_Zipf"] or 0)
            except ValueError:
                z = 0.0
            if not re.fullmatch(r"[a-z]+", w):
                continue
            fam[b].append((w, z))
            zipf[w] = max(zipf.get(w, 0), z)
    return fam, zipf

def bawf_base(entries, fam):
    # 为词条找 BAWF 词族：自身 Baseword，或按同族成员反查
    member_to_base = {}
    for b, members in fam.items():
        for m, _ in members:
            member_to_base.setdefault(m, b)
    return member_to_base

def suffix_pos(word):
    for suf, pos in SUFFIX_POS:
        if word.endswith(suf) and len(word) > len(suf) + 2:
            return pos
    return ""

def clean_form(word, pos):
    word = word.lower().strip()
    if not re.fullmatch(r"[a-z][a-z'-]{2,}", word):
        return ""
    if word.endswith("'s"):
        return ""
    return word

def related_form(word, cand):
    """过滤语义不相关的派生词：词干需有 3 个以上共同前缀字符。"""
    if cand.startswith(word) or word.startswith(cand):
        return True
    n = 0
    for a, b in zip(word, cand):
        if a != b:
            break
        n += 1
    return n >= 4


def main():
    entries = load_words()
    syn, idx, fwd, rev, wn_pos = load_wordnet()
    fam, zipf = load_bawf()
    member_to_base = bawf_base(entries, fam)
    words_set = {e["word"] for e in entries}
    idioms_path = os.path.join(ROOT, "tools", "idioms.json")
    idioms = {}
    if os.path.exists(idioms_path):
        with open(idioms_path, encoding="utf-8") as f:
            idioms = json.load(f)

    empty = 0
    total_forms = 0
    for entry in entries:
        w = entry["word"]
        cands = collections.OrderedDict()

        def add(form, pos, rank, force=False):
            form = clean_form(form, pos)
            if not form or form == w:
                return
            if not force and not related_form(w, form):
                return
            if form in cands and cands[form][1] <= rank:
                return
            cands[form] = (pos, rank)

        # WordNet 双向派生
        for off, wi in idx.get(w, []):
            for poff, tgt in fwd.get((off, wi + 1), []):
                tp, tl = syn.get(poff, (None, []))
                if tgt - 1 < len(tl):
                    add(tl[tgt - 1], POS_MAP.get(tp, ""), 0)
            for soff, src in rev.get((off, wi + 1), []):
                sp, sl = syn.get(soff, (None, []))
                if src - 1 < len(sl):
                    add(sl[src - 1], POS_MAP.get(sp, ""), 0)

        # BAWF 词族补充
        base = member_to_base.get(w, w)
        for m, z in fam.get(base, []):
            if m == w or z < 1.9:
                continue
            # 排除明显屈折形式
            if re.search(r"(ed|ing|s)$", m) and m not in words_set:
                continue
            pos = " ".join(sorted(wn_pos.get(m, []))) or suffix_pos(m)
            if not pos:
                continue
            add(m, pos, 2)

        manual = MANUAL_FORMS.get(w)
        if manual:
            for form, pos in manual:
                add(form, pos, -10, force=True)

        # 过滤低频/冷僻派生词：非人工、非 CET4、BAWF 词频低于 2.0 的候选剔除
        for form in list(cands.keys()):
            pos, rank = cands[form]
            if rank == -10:
                continue
            if form in words_set:
                continue
            if zipf.get(form, 0) < 2.0:
                del cands[form]

        # 排序：人工/常见派生优先，其次 CET4 内词，最后长词
        def score(item):
            form, (pos, rank) = item
            in_cet4 = 0 if form in words_set else 1
            return (rank, in_cet4, -len(form), form)

        items = sorted(cands.items(), key=score)
        old_zh = {}
        for f in entry.get("forms", []):
            if len(f) >= 3 and f[2]:
                old_zh[(f[0], f[1])] = f[2]
        forms = []
        used_pos = set()
        for form, (pos, rank) in items:
            p0 = (pos.split()[0] if pos else "")
            if p0 and p0 in used_pos and len(forms) >= 2:
                continue
            item = [form, pos or ""]
            zh = old_zh.get((form, pos or ""))
            if zh:
                item.append(zh)
            forms.append(item)
            used_pos.add(p0)
            if len(forms) >= 4:
                break
        entry["forms"] = forms
        total_forms += len(forms)
        if not forms:
            empty += 1

        entry["idioms"] = [[x[0], x[1]] for x in idioms.get(w, [])][:2]

    # 写回
    mid = (len(entries) + 1) // 2
    groups = [entries[:mid], entries[mid:]]
    for idx_group, group in enumerate(groups):
        name = "A" if idx_group == 0 else "B"
        path = os.path.join(ROOT, "js", "data-%s.js" % name.lower())
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("window.CET4_WORDS_%s = [\n" % name)
            for i, e in enumerate(group):
                f.write(json.dumps(e, ensure_ascii=False, separators=(",", ":")))
                f.write(",\n" if i < len(group) - 1 else "\n")
            f.write("];\n")
        print("wrote", path, len(group))

    print("total", len(entries), "forms", total_forms, "empty", empty,
          "idioms", sum(1 for e in entries if e["idioms"]))

if __name__ == "__main__":
    main()
