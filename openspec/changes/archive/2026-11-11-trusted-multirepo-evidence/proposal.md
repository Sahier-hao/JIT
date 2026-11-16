# 可信模型证据与多仓库闭环

## Why

当前产品已有九种方法、真实训练、行级研究预览与项目分析，但交付证据仍有三类缺口：全新环境导入内置模型包会返回 `partial`；项目分析的训练/测试/留出标签按时间边界推断，而不是模型真实成员；多个模型、跨仓库与时间外评价缺少可复现的完整结果，行级定位仍基于每提交约两个候选的抽样。新版机器交付、结果身份一致与模型效果可测因这些缺口无法被独立核对。

## What Changes

- 内置模型包在新环境完整导入九种方法；重算与交付参考预测按方法声明容差比较，指标与时间桶聚合按冻结参考预测严格重算。历史失败逐项解释，不以“既有 PyTorch 问题”概括。
- 项目分析与风险趋势共用模型运行谱系：训练/验证/测试只来自冻结成员；清洗排除、未纳入、训练截止后的留出时间视图、现成模型与未知谱系分别标注；留出数量与分区标签来自同一总体。
- 提供可中断恢复的多仓库真实数据批处理：任务清单、固定 revision、阶段进度、单仓库失败、取消、重试与内容身份幂等；新版本使用完整 SZZ，不覆盖旧数据。
- 在固定协议下完成多模型（LR/DT/RF/MLP）的仓库内时间外与跨仓库评价，报告 ROC-AUC、PR-AUC、MCC、Precision/Recall/F1 与相同 LOC 预算下的 Recall/Popt/IFA，并保留简单基线与失败格。
- 在完整候选集上做行级定位评价：从真实 Git diff 导出候选行，报告覆盖、排除与 IFA/Top-K/预算召回，与旧抽样结果区分口径。
- 把上述真实事实接回现有数据集、训练、模型卡与项目页面；旧结果在源或模型变化时显示 `unavailable`/`stale`，不静默换用最新结果。
- 提交触发的分析提供可审查的 push/PR 触发配置，固定 base/head 与模型身份；VS Code 扩展在真实仓库重复导入、过期与工作树变化时给出明确状态。

## Capabilities

### New Capabilities

（无新增能力；本轮只调整既有能力的可观察行为。）

### Modified Capabilities

- `model-catalog`：内置模型包的导入结果、失败原因与复现校验口径。
- `focused-project-review`：项目分析分区来自冻结成员，未知谱系降级为未知而不是时间推断。
- `repository-collection`：多仓库批处理的进度、失败、取消、重试与恢复。
- `dataset-registry`：批处理产出的数据版本保留来源、SZZ 版本与观察窗口。
- `multi-method-experiments`：固定协议下的多方法、跨仓库与时间外评价矩阵。
- `multi-dataset-evaluation`：跨项目评价的报告口径与失败格。
- `line-level-prediction`：完整候选集导出与行级定位评价。
- `code-candidate-location`：完整候选集上的定位指标与覆盖统计。
- `commit-triggered-analysis`：push/PR 触发与固定模型身份。
- `ide-report-consumption`：真实仓库中的报告导入、过期与工作树核对。

## Impact

- 后端：`artifacts.py` 的复现校验、`model_lineage.py`、`analysis_scope.py`、`project_trends.py`、采集/数据集/训练/实验模块；新增批处理入口与候选导出。
- 契约：`docs/api/openapi.yaml` 的分区枚举与分析口径覆盖字段。
- 前端：项目分析口径卡、提交分区标签、数据集/训练/模型卡的真实证据展示。
- 数据与模型：只新增版本，不覆盖既有数据集、模型产物与运行身份；本机开发库升级前先备份。
