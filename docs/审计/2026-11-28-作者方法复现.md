# 作者方法复现审计（2026-11-28）

对应变更：`add-author-method-reproduction`。

## 来源核验

本轮使用网络核验并浅克隆以下仓库，实际 HEAD 与 catalog 一致：

| 仓库 | 实际 HEAD |
| --- | --- |
| `soarsmu/DeepJIT` | `bb3dd8a10dcfc44383c15734bb18e6a1ddc6ba45` |
| `awsm-research/JITLine-replication-package` | `1e06d33b44c19565301d31fce9984afbb8b3127c` |
| `jacknichao/JIT-Fine` | `584799fdec6095ab75a45fd2a5f8db5b12163aa5` |
| `JIT-A/JIT-Smart` | `e87569c56c8faa4ad236969d4a99074a76da3887` |
| `software-rebels/JITMovingTarget` | `184403ad3734894c8417cbec72fdef3da5edc0b9`（Kamei 长期历史背景，不作为 2013 12 字段训练数据） |

DeepJIT 与 JITLine 的 Zenodo 记录分别核验为 CC BY 4.0。JIT-Fine 与 JIT-Smart 未观察到许可证文件；JIT-Smart 的 `data/data.zip` 与 JIT-Fine 的 `data.zip` SHA-256 完全相同，证明两方法共用 JIT-Defect4J 数据。

## 实际发现

1. JITLine Zenodo `4433499` 只有 122,187 字节源码包，`4596503` 只有 6,785,832 字节源码包；README 需要的 `<project>_train.pkl`、`<project>_test.pkl` 和 `<project>_dict.pkl` 不在其中。因此原项目固定划分无法复现。JITLine 使用两个明确命名的替代表：JIT-Fine 作者固定基线输入，以及发布表 chronological 80/20 重建。
2. JIT-Fine/JIT-Smart 的作者包不包含训练好的 50 epoch checkpoint；只能用 `microsoft/codebert-base` 初始化。完整训练需要 GPU 或长时间 CPU 配额。
3. JIT-Fine 与 JIT-Smart 使用同一 JIT-Defect4J 数据。JIT-Smart 行标签表比 JIT-Fine 的完整行表多 `file`/`project` 字段，因此 JITLine/JIT-Fine 的行定位可借用其文件身份，但作者数据仍没有真实 Git 行号。
4. DeepJIT 作者 `train.py` 把 `l2_reg_lambda` 传给 Adam 学习率，`learning_rate` 参数未使用；代码与论文意图需要两个独立配置，不能悄悄修正后冒称同一运行。
5. 严格执行 `0.1` 等小样本验证会产生不稳定 AP/AUC；本文不据此宣称模型优劣或定位收益。

## 复跑结果

实际结果、样本范围和限制见 [作者方法复现](../作者方法复现.md) 与证据目录。以下摘要只用于核对本次机器运行：

| 运行 | 实际完成 | 是否计入完整协议 |
| --- | --- | --- |
| Kamei 12 字段 | 227,417 条、六项目 10 折 | 研究复现已完成；不是原 R 脚本 |
| Kamei 14 字段 | 同数据同折统一对照 | 否，是本地对照 |
| DeepJIT evaluate | 1,331 条作者测试、作者权重 | 是（推理）；训练未复跑 |
| JITLine baseline | 5,480 条测试、594 条解释行 | 否；作者原划分缺失 |
| JIT-Fine smoke | 8/4/16 条，93 条行 | 否；仅真实小跑 |
| JIT-Smart project/cross smoke | 4/2/4 条，121/187 条行 | 否；仅真实小跑 |
| `kamei14-git-v3` pydantic | 1,029 条采集、761 条合格、115 条测试 | 真实公开仓库迁移实验，发布不合格 |

## 边界

- 本轮没有把任何复现产物登记为产品默认模型。
- 没有修改已存在的 v2 数据、模型、分析或用户数据。
- 没有声称 JIT-Fine/JIT-Smart 已完成论文 50 epoch 性能复现。
- 没有把文件顺序基线或极小样本随机基线解释为定位收益。
