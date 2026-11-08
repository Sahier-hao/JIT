# line-level-prediction Specification

## Purpose
TBD - created by archiving change train-line-level-baseline. Update Purpose after archive.

## Requirements

### Requirement: LLP-01 行级基线训练与评估

系统 SHALL 能从 `line-szz-v1` 样本训练行级基线并给出可复现的评估报告。切分 MUST 按仓库留出或按提交分组，MUST NOT 让同一提交的行同时进入训练与测试。报告 MUST 记录输入文件、样本/提交/仓库数、切分方式、特征与模型参数、正负例数和指标；测试集单类或指标不可计算时 MUST 返回空值并说明原因。训练 MUST NOT 登记模型、修改默认模型、写回数据集或产品结果。

#### Scenario: 仓库内分组切分

- **WHEN** 未指定测试仓库
- **THEN** 按提交分组切分训练/测试，同一提交的行只出现在一侧
- **AND** 报告记录训练与测试的提交数和仓库分布

#### Scenario: 跨仓库留出

- **WHEN** 指定 `--test-repo`
- **THEN** 该仓库的全部行只用于测试，其他仓库用于训练
- **AND** 报告将其标注为跨仓库评估

#### Scenario: 指标不可计算

- **WHEN** 测试集只有正例或只有负例
- **THEN** ROC-AUC、PR-AUC 与 Brier 返回空值并说明单类原因，不伪造数值

#### Scenario: 不写回

- **WHEN** 基线训练完成
- **THEN** 输入 JSONL、数据集、目录库与模型目录保持不变
