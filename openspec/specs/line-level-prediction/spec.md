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

### Requirement: LLP-02 可移植复现清单

行级实验 SHALL 输出可移植 manifest，记录源仓库与 revision、数据与 JSONL 哈希、SZZ 版本与限制、采样策略与种子、train/validation/test 成员摘要、特征与模型配置、运行环境和复现命令。报告 MUST NOT 只引用临时绝对路径；大型原始数据 MAY 不入版本库，但 MUST 提供哈希与获取说明。

#### Scenario: 生成 manifest

- **WHEN** 完成一次行级训练与评估
- **THEN** manifest 包含输入哈希、切分成员摘要、特征/模型配置、环境与复现命令

#### Scenario: 输入缺失

- **WHEN** 报告引用的输入文件不存在或哈希不符
- **THEN** 报告明确标为不可复现，不声称已复现

### Requirement: LLP-03 分语言与仓库评估

行级评估 SHALL 分语言、按仓库留出或在训练内按仓库分组，并报告各仓库结果。需要选择方案时 MUST 使用验证仓库或训练内分组，MUST NOT 用被留出的测试仓库选择方案。已用于观察结果的仓库 MUST NOT 被重新称为全新盲测。补数据时 SHOULD 优先增加每语言多个足量仓库，而不是只放大一个仓库。

#### Scenario: 分仓库结果

- **WHEN** 执行固定实验计划
- **THEN** 报告按语言与留出仓库列出样本量、正例率与指标

#### Scenario: 样本不足

- **WHEN** 某语言留出仓库样本过少
- **THEN** 标注为探索性结果，不据此宣称可泛化

### Requirement: LLP-04 定位指标与诚实结论

行级评估 SHALL 在完整且有意义的提交/文件候选集上报告 IFA、Top-k 命中或 Recall@行预算；只有抽样正负列表时 MUST 明确其代理性质，MUST NOT 冒充真实审查收益。Brier 与校准结论 MUST 说明采样分布。零收益或负结果 MUST 保留。行级研究模型 MUST NOT 在本轮登记为通用逐行概率模型或接入用户主流程；结论允许为暂不上线。

#### Scenario: 代理指标

- **WHEN** 评估数据来自正负抽样列表而非完整候选集
- **THEN** 定位指标标注为上限代理，不表述为实际审查节省

#### Scenario: 结论为暂缓

- **WHEN** 跨仓库泛化或校准证据不足
- **THEN** 报告明确“暂不上线”，产品继续使用提交级风险与 SZZ 数据层
