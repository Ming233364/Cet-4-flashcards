# CET-4 单词卡数据规范（必须严格遵守）

## 1. 目标文件

| 组别 | 文件 | 全局变量 | 规模 |
| --- | --- | --- | --- |
| A 组 | `cet4-flashcards/js/data-a.js` | `window.CET4_WORDS_A` | 2273 词 |
| B 组 | `cet4-flashcards/js/data-b.js` | `window.CET4_WORDS_B` | 2272 词 |

合计 4545 词；两组按字母顺序首尾相接，A 组在前。

## 2. 文件格式（逐字符照做）

```
window.CET4_WORDS_A = [
{"word":"abandon","us":"/əˈbændən/","uk":"/əˈbændən/","pos":["v."],"senses":[["v.","放弃；抛弃"]],"examples":[["They had to abandon the car in the snow.","他们不得不把车丢弃在雪地里。"]],"phrases":[["abandon oneself to","沉溺于；纵情于"]],"star":4,"examYears":["2023-12","2024-06"],"examCount":5},
];
```

- 第 1 行固定为 `window.CET4_WORDS_A = [`（B 组换成 `window.CET4_WORDS_B`）。
- 每个单词**占一行**，是一个合法的 JSON 对象，行尾有逗号（最后一条也带逗号，JavaScript 允许）。
- 最后一行固定为 `];`。
- 文件为纯 UTF-8 文本，**不要** Markdown 代码围栏、注释、说明文字、BOM。
- 不要换行拆开单条记录（一行一条，便于校验）。

## 3. 单条记录字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `word` | string | 小写原形，必须与词表完全一致；不得增删、不得重复 |
| `us` | string | 美式音标，带首尾 `/`，如 `/əˈbændən/`；美音要卷舌（`/ər/`、`/ɑːr/`、`/ɜːr/`） |
| `uk` | string | 英式音标，带首尾 `/`；英音不卷舌（词尾 -er 用 `/ə/`，`/ɑː/` 而非 `/ɑːr/`） |
| `pos` | string[] | 1–4 个词性缩写：`n.` `v.` `adj.` `adv.` `prep.` `conj.` `pron.` `num.` `int.` `aux.` `art.` |
| `senses` | [string, string][] | 1–3 条 `[词性, 中文释义]`；只收 CET-4 高频义项，用 `；` 连接近义项 |
| `examples` | [string, string][] | 0–2 条 `[英文例句, 中文翻译]`；原文语料无例句时可为空数组；有例句时翻译必须含中文 |
| `phrases` | [string, string][] | 按星级：5★/4★ 最多 4 条、3★ 最多 3 条、1–2★ 最多 2 条 `[常用搭配/短语, 中文]`；中文不得为空 |
| `forms` | [string, string, string][] | 0–4 条 `[同词族派生形式, 词性, 中文释义]`，如 `["ability","n.","能力；本领"]`；不得是屈折形式（-ed/-ing/-s） |
| `idioms` | [string, string][] | 0–2 条 `[英美地道表达, 中文]`；英文至少 3 个字符，中文不得为空 |
| `star` | number | 考频星级 1–5 的整数：5 = 最高频（约前 10%），1 = 未在真题中出现 |
| `examYears` | string[] | 近三年真题出现场次，元素形如 `"2024-06"`；可为空数组；不得重复 |
| `examCount` | number | 近三年 15 套真题总出现次数，非负整数；`examYears` 为空时必须为 0 |

## 4. 质量要求

1. **音标准确**是本项目的核心卖点：不确定的音标宁可查证常识也要写对；英美差异必须体现（如 `harm`: us `/hɑːrm/`, uk `/hɑːm/`）。
2. 中文释义写“高频解释”，不要罗列生僻义；一条释义 ≤ 20 字。
3. 例句不要出现中文式英语；不要用未转义的双引号（需要引号时用中文引号「」或干脆不用）。
4. 全组内 `word` 不得重复；两组合计必须覆盖词表全部单词。
5. 不要编造不存在的高频短语。
6. `star`、`examYears`、`examCount` 由 `tools/build_vocab.py` 按真题语料统一生成；手工增补词条时按实际考频填写，并保持字段齐全。

## 5. 自检（完成后必须做）

- 运行 `node tools/validate-data.js`：校验字段、音标、释义、例句/短语数量、星级、真题字段、与词表顺序、A/B 重复。
- 运行 `node tools/check-quiz.js`：确认 4 种基本题型 × 4545 词、周测/月测、多选与短语题出题正常。
- 运行 `node tools/build-single.js` 重新生成单文件版。
- 汇报：实际条数、覆盖情况、任何拿不准的地方。
