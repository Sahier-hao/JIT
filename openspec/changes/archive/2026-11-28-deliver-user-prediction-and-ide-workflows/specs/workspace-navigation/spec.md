## ADDED Requirements

### Requirement: WSN-09 缺陷预测与评估地址恢复

系统 SHALL 提供「缺陷预测」主导航入口和稳定页面地址，并继续解析 `#/my-predictions`。`#/my-predictions/:batchId` MUST 刷新恢复到原批次；兼容别名 MUST 进入同一页面。预测评估 SHALL 使用稳定地址，在查询中携带批次、模型、数据版本、可选分区和切分预设；刷新或重开 MUST 恢复同一评估，并拒绝与批次不一致的查询身份。

#### Scenario: 旧预测地址

- **WHEN** 用户打开 `#/my-predictions/:batchId`
- **THEN** 页面恢复同一批次结果

#### Scenario: 新别名

- **WHEN** 用户打开缺陷预测兼容别名
- **THEN** 进入同一缺陷预测页，旧书签不断裂

#### Scenario: 评估刷新

- **WHEN** 用户刷新带批次、模型和分区参数的评估地址
- **THEN** 仍显示同一预测的评估

#### Scenario: 评估上下文不一致

- **WHEN** 查询中的模型、数据版本或分区与批次不一致
- **THEN** 页面明确拒绝，不显示另一预测的指标
