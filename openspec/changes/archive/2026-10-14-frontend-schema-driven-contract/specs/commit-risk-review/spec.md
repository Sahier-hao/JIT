# Spec Delta

## ADDED Requirements

### Requirement: CRR-14 新旧运行形态兼容

系统 SHALL 同时接受无字段声明的旧运行与携带 featureSchema 与 algorithmVersion 声明的具名运行。旧运行按 openstack-six-v1 口径解析与展示；具名运行按各自声明的 schema 与方法解析与展示。前端升级 MUST NOT 使既有旧运行不可用或展示行为回退。形态判定 MUST 依据响应中字段声明的存在性，而不是契约版本号。

#### Scenario: 旧运行升级后仍可用
- **WHEN** 真实服务返回不含 featureSchema 声明的旧六字段批次
- **THEN** 工作台按 openstack-six-v1 口径解析成功，列表、详情与基线摘要行为与升级前一致

#### Scenario: 具名运行按声明解析
- **WHEN** 真实服务返回携带 featureSchema（含入模字段、unavailable 字段及原因）与 algorithmVersion 声明的批次
- **THEN** 工作台解析成功，基线摘要按该 schema 展示入模字段、未提供字段及原因、方法标识与模型标识

#### Scenario: 形态判定依据字段声明
- **WHEN** 批次契约版本号未变化，但 summary 携带 featureSchema 与 algorithmVersion 声明
- **THEN** 系统仍按具名形态解析与展示，不因契约版本号未变化而拒绝数据

#### Scenario: 声明信号不完整按旧形态处理
- **WHEN** 批次携带 algorithmVersion 但缺少 featureSchema 声明
- **THEN** 系统按旧形态解析（形态判定唯一依据是字段声明的存在性），不产生第三种解释

#### Scenario: 声明与数据不符仍不可用
- **WHEN** 具名批次的 schema 声明与 summary 的字段列表或记录度量键集合不一致
- **THEN** 批次判为不可用并显示原因，不退回六字段口径解读
