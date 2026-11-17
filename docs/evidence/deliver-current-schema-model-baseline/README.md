# 当前 14 维 schema 模型基线证据

日期：2026-11-16。对应 change `deliver-current-schema-model-baseline`。

## 数据

四个公开仓库按固定 revision 和 2022-01-01 至 2025-01-01 窗口重新采集为 `kamei14-git-v2`。正式训练先排除未成熟标签，再执行项目内 `temporal-70-15-15` 切分。

| 项目 | 输入记录 | 未成熟排除 | 正例 | 测试记录 / 正例 |
| --- | ---: | ---: | ---: | ---: |
| `apache/commons-lang` | 1,581 | 138 | 154 | 217 / 33 |
| `vuejs/core` | 2,288 | 93 | 1,028 | 329 / 166 |
| `redis/redis` | 1,471 | 36 | 573 | 216 / 86 |
| `scikit-learn/scikit-learn` | 4,210 | 242 | 1,301 | 596 / 186 |

逐份 manifest、CSV 哈希、revision、状态计数和切分边界保存在多项目报告的项目段。报告中的四个项目全部采集、切分与协议训练成功。

## 九方法发布结果

九种方法均使用同一 pooled 数据集、`metric-set-v2`、阈值 0.5 和四个项目冻结测试分区。发布策略为 `jit-release-v1`。

| 方法 | 类别 | 结果 | 主要不合格原因 |
| --- | --- | --- | --- |
| 逻辑回归 | 经典 | 合格 | — |
| 决策树 | 经典 | 合格 | — |
| 随机森林 | 经典 | 合格 | — |
| 梯度提升 | 经典 | 合格 | — |
| 高斯朴素贝叶斯 | 经典 | 不合格 | Vue ROC-AUC 约 0.607，低于 0.65 |
| MLP | 深度 | 合格 | — |
| 表格 ResNet | 深度 | 合格 | — |
| FT-Transformer | 深度 | 合格 | — |
| Wide & Deep | 深度 | 合格 | — |

合格覆盖为 4 个经典方法和 4 个深度方法，共 8 种。高斯朴素贝叶斯保留训练运行、模型、指标和失败门槛，不因测试结果回退修改门槛。

## 四训练口径

[multi-project-report.json](multi-project-report.json) 并列记录 9 个方法的 local、pooled、leave-one-project-out 和 global+local 共 36 个结果，全部 `complete`，失败记录为 0。报告保留逐项目指标、宏平均、总体方差、最差项目和全局+本地融合权重；不宣布全局最佳方法，也不根据测试集调参。

主要观察：local 与 global+local 在多数方法上接近；pooled 的宏平均 AP/ROC-AUC 通常低于 local，但 Popt 仍保持较高；宏平均未掩盖各项目 effort 指标差异。该观察只用于训练策略研究，不替代模型发布资格。

## 人工默认候选

徐卓航于 2026-11-16 人工批准 `mlp-v1` 为默认候选。批准记录绑定模型 ID、`artifactRunId`、模型 SHA-256 和发布报告身份；系统没有按 AP、ROC-AUC 或其他测试指标自动选择默认。

## 正式包与复现

正式包 `backend/model-packages/jit-current-v2-models-v1.zip`：

- SHA-256：`f90e8f4d7d6b04518a44654d50a3da40b9d83f2f1c042a2cf4357ec91ab81972`
- 大小：5,131,768 字节
- 8 个模型、81 个文件；每个模型带 release report，仅 MLP 带人工批准文件
- 不包含 SQLite、原始仓库、散装运行目录或六字段模型

[release-audit.json](release-audit.json) 重算四份项目数据、九个运行、参考预测、切分成员、指标和发布报告身份，结果 `passed=true`。
[model-package-cpu-verification.json](model-package-cpu-verification.json) 在隔离目录重新导入正式包并完成 CPU 加载：8/8。
[current-schema-browser-results.json](current-schema-browser-results.json) 与 [截图](current-schema-model-package-1280.png) 记录空目录包初始化、默认 MLP、大型仓库分析、模型卡发布报告和普通用户权限边界；浏览器结果 1 passed、1 个桌面重复视口按条件跳过。

[source-and-license-audit.json](source-and-license-audit.json) 记录四个上游仓库 revision、许可证文件与观测到的许可证声明。包只分发派生表格特征、模型和指标，不包含上游源码；Redis 使用 RSALv2/SSPLv1/AGPLv3 三选一声明，正式对外分发前仍建议按组织政策做法律确认。
