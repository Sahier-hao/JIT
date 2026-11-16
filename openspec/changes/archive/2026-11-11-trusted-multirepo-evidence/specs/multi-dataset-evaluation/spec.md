## ADDED Requirements

### Requirement: MPT-06 时间外与跨仓库评价报告

评价报告 SHALL 分别呈现仓库内时间外与留一仓库跨项目结果，并报告 ROC-AUC、PR-AUC 与正例率基线、MCC、Precision/Recall/F1，以及相同 LOC 预算下的 Recall、Popt、IFA 与实际覆盖量。缺失或单类样本 MUST 返回未定义与原因；区间 SHALL 按提交分组或时间块计算，不把行或样本当作独立观测。

#### Scenario: 单类测试样本

- **WHEN** 某仓库测试段没有正例或没有负例
- **THEN** 相应指标显示未定义与原因，不写成 0 或跳过该仓库

#### Scenario: 跨仓库留出

- **WHEN** 以某仓库全部提交作为测试、其余仓库作为训练
- **THEN** 报告该仓库单独结果并标明与已观察组合的区别，不混入总体准确率
