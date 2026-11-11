# 固定协议的多模型评价（2026-11-11）

本记录只写实际运行结果。协议在运行前冻结：数据版本与文件哈希、切分预设、方法参数、种子、
LOC 预算、阈值与指标集都写入报告（`protocolSha256` 标识）。不重训已交付模型、不改默认模型。

## 协议

- 切分：`temporal-70-15-15`（按去重提交时间，UTC）。
- 方法：逻辑回归 `logistic-regression-l2-v1`、决策树 `decision-tree-v1`、随机森林
  `random-forest-v1`、MLP `mlp-v1`，参数取各自冻结声明。
- 随机方法：随机森林覆盖 `random_state`、MLP 覆盖 `seed`，种子 42/43/44；确定性方法只运行一次。
- 评价：ROC-AUC、PR-AUC 与无信息基线、MCC、Precision/Recall/F1（阈值 0.5）、
  20% LOC 整提交预算下的 Recall、Popt、IFA；验证集 Brier 与五桶校准。
- 基线：改动量降序、时间降序、固定种子随机顺序，使用同一测试成员与同一预算。

## 仓库内时间外评价（Python）

报告：`docs/evidence/evaluation-matrix/2026-11-11-python.json`（`protocolSha256=575a3976…`），
24 个单元格全部成功，0 个失败格。下表为同一方法多种子均值。

| 仓库（测试段） | 方法 | AUC | AP | MCC | Recall@20%LOC | Popt | IFA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flask（560 条 / 31 正例） | 逻辑回归 | 0.759 | 0.153 | 0.112 | 0.032 | 0.850 | 1.0 |
| flask | 决策树 | 0.717 | 0.104 | 未定义（阈值下无预测正类） | 0.097 | 0.845 | 17.0 |
| flask | 随机森林 | 0.780 | 0.168 | 未定义 | 0.129 | 0.850 | 3.0 |
| flask | MLP | 0.783 | 0.171 | 0.101 | 0.075 | 0.853 | 1.7 |
| pydantic（825 / 69） | 逻辑回归 | 0.767 | 0.263 | 0.288 | 0.116 | 0.721 | 0.0 |
| pydantic | 决策树 | 0.733 | 0.249 | 0.268 | 0.130 | 0.688 | 3.0 |
| pydantic | 随机森林 | 0.747 | 0.289 | 0.297 | 0.121 | 0.716 | 0.0 |
| pydantic | MLP | 0.768 | 0.291 | 0.307 | 0.097 | 0.719 | 0.0 |
| httpx（216 / 3） | 逻辑回归 | 0.552 | 0.095 | 0.245 | 0.000 | 0.907 | 3.0 |
| httpx | 决策树 | 0.515 | 0.040 | 0.152 | 0.333 | 0.286 | 2.0 |
| httpx | 随机森林 | 0.579 | 0.180 | 未定义 | 0.333 | 0.914 | 1.0 |
| httpx | MLP | 0.607 | 0.126 | 未定义 | 0.111 | 0.926 | 2.3 |

同一仓库的简单基线（20% LOC 预算）：

| 仓库 | 改动量降序 | 时间降序 | 随机 42 / 43 / 44 |
| --- | --- | --- | --- |
| flask Recall@20% | 0.032 | 0.097 | 0.161 / 0.161 / 0.226 |
| pydantic Recall@20% | 0.058 | 0.130 | 0.246 / 0.217 / 0.159 |
| httpx Recall@20% | 0.000 | 0.333 | 0.000 / 0.333 / 0.000 |

结论按事先声明如实保留：模型在 AUC/AP 上普遍高于改动量与时间基线，但在 20% LOC 的召回上
没有稳定胜出；flask 与 pydantic 上固定种子的随机顺序在若干种子下更高。测试段样本量差异很大
（httpx 只有 3 个正例，MCC 与召回不具稳定性），不据此宣称模型收益。

## 留一仓库评价（Python）

每折用另外两个仓库的训练段训练，留出仓库的测试段评价：

| 留出仓库 | 逻辑回归 AUC/AP | 决策树 | 随机森林（均值） | MLP（均值） |
| --- | --- | --- | --- | --- |
| flask | 0.767 / 0.205 | 0.734 / 0.158 | 0.774 / 0.223 | 0.744 / 0.151 |
| pydantic | 0.781 / 0.317 | 0.642 / 0.161 | 0.714 / 0.189 | 0.736 / 0.189 |
| httpx | 0.559 / 0.079 | 0.771 / 0.089 | 0.686 / 0.137 | 0.662 / 0.080 |

跨仓库迁移没有一致最优方法：逻辑回归在 pydantic 最好，随机森林在 flask 最好，决策树在 httpx
的 AUC 最好但样本只有 3 个正例。报告不排序、不宣布“全局最佳”。

## 验证集校准

验证集（flask 552 条 / 36 正例）Brier：逻辑回归 0.0588、决策树 0.0626、随机森林（42）0.0605；
pydantic 与 httpx 的校准按同一方法计算并保存在报告 `calibration` 字段。一次校准指标改善不代表
可在未知仓库称为“缺陷概率”，产品默认仍用风险分。

## 复现

```bash
cd backend
./.venv/Scripts/python.exe -m jit_baseline.cli run-evaluation-matrix \
  --data python=data/datasets/kamei14-git-v2-flask-mature/kamei14-git-v2-flask-mature-2010-04-06_2026-07-30-742c2cc8.json \
  --data python=data/datasets/kamei14-git-v2-pydantic-mature/kamei14-git-v2-pydantic-mature-2017-05-03_2026-07-31.json \
  --data python=data/datasets/kamei14-git-v2-httpx-mature/kamei14-git-v2-httpx-mature-2019-04-04_2026-02-23.json \
  --output ../docs/evidence/evaluation-matrix/2026-11-11-python.json
```

## 边界

- 本轮 Python 报告生成时训练历史采集尚未接入，报告不含逐 epoch 损失；JS 报告使用接入后的代码。
- `pydantic-mature`、`axios-mature`、`cc-switch-farion-mature` 的 SZZ 在修复提交上限内被截断
  （描述文件 `truncated=true`）；`flask-mature` 与 `httpx-mature` 未截断。
- 标签是弱标签：未观测不等于已证实无缺陷；本报告不是缺陷概率，也不改变默认模型。
