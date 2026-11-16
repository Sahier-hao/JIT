# 行级实验固定计划（2026-11-09，运行前登记）

本计划在看结果之前固定。数据集位于 `D:/tmp/measure/`（不入版本库），由 `line-dataset --negative-mode same-file` 从真实仓库导出；每个 JSONL 旁有 `.summary.json` 记录正负例、采样模式与种子。

## 数据

| 文件 | 仓库 | 行数 | 主要语言 |
| --- | --- | ---: | --- |
| `cc-switch-same.jsonl` | cc-switch | 11,718 | TypeScript 5,875、Rust 3,924 |
| `axios.jsonl` | axios | 3,166 | JavaScript 1,970、TypeScript 182 |
| `JIT-same.jsonl` | JIT | 304 | TypeScript 227、Python 25 |
| `claude-scholar-same.jsonl` | kamei14-git-v2-claude-scholar-full | 272 | JavaScript 151、Python 30 |
| `sub2api-same.jsonl` | sub2api | 6,964 | Go 4,864、TypeScript 478 |
| `pydantic.jsonl` | pydantic | 1,598 | Python 615、Rust 607 |
| `flask.jsonl` / `httpx.jsonl` | flask / httpx | 26 / 8 | Python |

## 固定配置

- 特征：字符 n-gram（3–5，min_df=2，30k 上限）+ 行长度/缩进/空行/注释 + 文件长度与行位置 + 结构计数 + 语言 one-hot。
- 默认不含提交级 Kamei 特征，按仓库平衡样本权重。
- 模型：逻辑回归，`class_weight=balanced`，`liblinear`，`max_iter=2000`，固定阈值 0.5，seed=42。
- 切分：跨仓库留出整个测试仓库；不指定时按提交分组 80/20（仅用于仓库内参照）。
- 指标：ROC-AUC、PR-AUC、Brier、固定阈值 P/R/F1；随机基线为测试集正例率。定位指标按提交分组计算 Top-k 命中、20% 行预算召回与 IFA，并明确标注为抽样负例下的代理值。

## 实验清单（全部执行，零收益也保留）

| 编号 | 实验 | 训练 | 测试 | 语言过滤 |
| --- | --- | --- | --- | --- |
| E1 | JS/TS 跨仓库 | cc-switch + axios | JIT | typescript, javascript |
| E2 | JS/TS 跨仓库 | cc-switch + JIT | axios | typescript, javascript |
| E3 | JS/TS 跨仓库 | axios + JIT | cc-switch | typescript, javascript |
| E4 | JS/TS 跨仓库（多训练仓库） | cc-switch + axios + JIT | claude-scholar | typescript, javascript |
| E5 | TypeScript 语言内 | cc-switch | JIT | typescript |
| E6 | Python 语言内 | pydantic | claude-scholar | python |
| E7 | Rust 语言内 | cc-switch | pydantic | rust |
| E8 | Go 仓库内参照 | sub2api 按提交切分 | 同仓库留出 | go |
| A1 | 提交特征对照（E2 口径） | 同 E2 | 同 E2 | 加 `--include-commit-features` |
| A2 | 行位置消融（E2 口径） | 同 E2 | 同 E2 | `--no-position-features` |
| A3 | 文本特征消融（E2 口径） | 同 E2 | 同 E2 | `--no-text` |
| A4 | 仓库平衡消融（E2 口径） | 同 E2 | 同 E2 | `--no-repo-balance` |

E2 作为消融基准（此前结果最完整），A1–A4 与 E2 使用同一数据、同一测试仓库。E8 种子固定 42/43/44 三次，报告波动。

## 解释边界

- 正例来自历史 SZZ 弱标签，不是人工确认真值；未观测行不等于无缺陷。
- 负例是同一提交/同一文件的未标记行抽样，不是完整候选集，定位指标是上限代理。
- 已在旧审计中观察过的仓库组合仍标为“已观察”，不当作全新盲测。
- 若结果不支持上线，结论继续是“暂缓产品化”，不登记为通用行级概率模型。
