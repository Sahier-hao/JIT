# Spec Delta

## ADDED Requirements

### Requirement: FSV-04 同名度量语义变化必须使用独立 schema

当同一度量名从固定窗口计数改为时间衰减累计，或其他会改变数值含义、历史范围或计算规则的语义时，系统 MUST 注册新 schema 并记录口径版本。既有 schema MUST 保持原字段语义、指纹和历史运行可用；新 schema MUST 使用独立数据集描述、训练任务和模型产物，MUST NOT 静默替换旧值。

#### Scenario: 近期作者经验改为时间衰减

- **WHEN** 注册按论文时间衰减定义计算 `rexp` 的新 schema
- **THEN** 新 schema 与 `kamei14-git-v2` 名称及指纹不同
- **AND** v2 的 90 天计数、模型和分析保持可读

#### Scenario: 尝试在同一 schema 改变语义

- **WHEN** 请求在既有 schema 下把 `rexp` 从窗口计数改为衰减累计
- **THEN** 系统拒绝改变并报告需要新 schema，不覆盖既有声明

#### Scenario: 旧模型接收新 schema 数据

- **WHEN** 绑定 v2 的模型收到 v3 输入
- **THEN** 推理因 schema 不兼容失败，不按相同字段名继续
