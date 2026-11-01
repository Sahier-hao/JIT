## ADDED Requirements

### Requirement: MC-11 模型审查收益读取

系统 SHALL 为已登记模型提供受管理员保护的审查收益读取，按原产物运行标识匹配冻结报告。无报告时 MUST 返回 `available=false` 与原因；报告无效时 MUST 返回结构化错误；MUST NOT 重新训练、改变默认模型或返回其他模型报告。

#### Scenario: 已有收益报告

- **WHEN** 管理员请求一个有匹配收益报告的模型
- **THEN** 返回该报告、受控来源和报告标识，不返回其他模型的收益

#### Scenario: 尚无收益报告

- **WHEN** 模型没有匹配的收益报告
- **THEN** 返回 `available=false` 和明确原因，不伪造指标

#### Scenario: 报告无效

- **WHEN** 匹配报告的类型、版本或结构无效
- **THEN** 返回 `REPORT_INVALID`，不展示部分或猜测结果
