# 四项目训练与迁移比较证据

本目录冻结 `add-multi-project-training-comparison` 的四份数据描述、正式实验报告、测试结果和关键校验。原始采集 CSV、模型二进制与逐条提交数据不进入证据目录；它们可由四个公开仓库和固定窗口重新生成。

## 数据队列

固定窗口为 `2022-01-01` 至 `2025-01-01`，统一使用 `kamei14-git-v1`、提交级特征与 `szz-simple-v1` 简化标签。

| 项目 | 纳入/正例 | 训练 | 验证 | 测试 | CSV SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| apache/commons-lang | 1,581 / 157 | 1,106 / 110 | 238 / 31 | 237 / 16 | `dfbc04f04ecce5a2d12e23b0af504822aaa430f39daa7d23e5775f9fdd699b312` |
| vuejs/core | 2,288 / 1,052 | 1,602 / 741 | 343 / 170 | 343 / 141 | `74e8b4625d12bc94e7c9fe3e444a397e2ccf43bf528bab5d8ec31087529227fc7` |
| redis/redis | 1,471 / 572 | 1,029 / 405 | 221 / 96 | 221 / 71 | `7c4b4dfe43e076751c92f443d7cebd3425fe75a547951b2e6a01125fb51663e81` |
| scikit-learn/scikit-learn | 4,210 / 1,301 | 2,947 / 969 | 631 / 195 | 632 / 137 | `0d294a7b92371e2b84c7d7ae49f065a54ee26f3f336c4612901ca175ab25c7d` |

合计 9,550 条纳入提交。四份 `datasets/*.json` 保存来源 URL、HEAD、采集窗口、质量统计、CSV 哈希和两条简化标签限制。

## 正式实验

正式报告使用五种经典方法、`metric-set-v2` 和四种训练口径。5 × 4 × 4 = 80 个目标项目结果全部成功，失败记录为 0：

| 方法 | local AP | pooled AP | leave-one-project-out AP | global+local AP |
| --- | ---: | ---: | ---: | ---: |
| 逻辑回归 | 0.4953 | 0.4555 | 0.4583 | 0.4862 |
| 决策树 | 0.4573 | 0.4580 | 0.3839 | 0.4775 |
| 随机森林 | 0.4926 | 0.4762 | 0.4532 | 0.5049 |
| Gaussian NB | 0.4675 | 0.4453 | 0.4424 | 0.4755 |
| 梯度提升树 | 0.4731 | 0.4703 | 0.4556 | 0.4785 |

这些是四个项目的 AP 宏平均，不是跨项目权重排名。全部方法在 local、pooled 和 global+local 下的 AP 最差项目都是 `commons-lang`，其测试正例仅 16 条，应结合方差和测试规模理解。留一项目结果整体低于本地训练，说明零样本跨项目迁移仍不稳定；global+local 的权重只由各目标项目验证段决定。

## 文件

- `multi-project-report.json`：完整机器可读报告，含逐项目指标、训练来源、切分身份、融合权重、宏平均、总体方差、最差项目、环境与代码哈希。
- `datasets/`：四份数据集描述文件。
- `failure-records.json`：正式实验失败记录，本轮为空。
- `verification/pytest.xml`：后端全量测试 JUnit。
- `verification/report-invariants.json`：报告数量、状态和边界检查。
- `verification/openspec-validation.json`：change 严格校验。
- `verification.json`：统一验证摘要和关键哈希。

## 复现

在 `backend/` 下使用四份描述文件执行：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli run-multi-project `
  --dataset-manifest data/datasets/mp-commons-lang/mp-commons-lang-2022-01-30_2024-12-27.json `
    data/datasets/mp-vue-core/mp-vue-core-2022-01-04_2024-12-30.json `
    data/datasets/mp-redis/mp-redis-2022-01-01_2024-12-31.json `
    data/datasets/mp-scikit-learn/mp-scikit-learn-2022-01-02_2024-12-30.json `
  --output artifacts/multi-project/four-projects-2022-01-01_2025-01-01 `
  --methods logistic-regression-l2-v1 decision-tree-v1 random-forest-v1 `
    gaussian-naive-bayes-v1 gradient-boosting-v1 `
  --metric-set metric-set-v2
```
