# Spec Delta

## MODIFIED Requirements

### Requirement: FIP-06 解释未支持状态与风险边界

系统 SHALL 对每次预测返回 `explanationStatus`，取 `supported` 或 `not-supported` 之一。`supported` 时 MUST 同时返回解释方法与归因列表；`not-supported` 时 MUST 返回可公开原因。系统 MUST NOT 创建等待中的解释任务、人工贡献，或把归因与原始特征称作缺陷原因或缺陷结论。响应 SHALL 说明原始特征来自调用方、风险为模型估计，尚无真实标签、代码定位或线上效果验证。

#### Scenario: 模型已登记解释口径
- **WHEN** 所选模型登记了可用的解释方法并完成 JSON 预测
- **THEN** 返回已支持状态、解释方法与归因列表，风险与来源字段照常返回

#### Scenario: 模型尚无解释方法
- **WHEN** 所选模型未登记解释方法并完成 JSON 预测
- **THEN** 显示解释未支持及原因，不返回 pending、空贡献冒充 ready 或把原始特征称作缺陷原因

#### Scenario: 归因不改变风险语义
- **WHEN** 一次预测同时返回风险与归因
- **THEN** 风险仍按 FIP-03 由所选模型独立推理产生，归因不参与风险计算，也不把高风险表述为已确认缺陷
