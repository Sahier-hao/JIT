# Spec Delta

## ADDED Requirements

### Requirement: RCL-15 指定模型的来源一致性

分析创建 SHALL 接受明确 modelId，指定时使用 generic-model 策略并在入队前校验模型存在、可加载且 schema 可读取当前仓库特征。requestedModelId MUST 持久化并参与活动任务去重；实际打分与结果 MUST 保存同一模型身份。指定模型失败 MUST 不静默换成其他模型。未指定时 SHALL 保留现有自动/强制训练策略。

#### Scenario: 指定真实深度或经典模型
- **WHEN** 用户选择兼容的已登记模型并发起分析
- **THEN** 请求和任务保留 requestedModelId，执行实际加载该模型，完成结果 modelId 与指定值一致

#### Scenario: 模型输入不兼容
- **WHEN** 请求指定不可用模型或不能读取仓库采集输入的 schema
- **THEN** 明确拒绝并说明原因，不回退其他模型或创建伪成功结果

#### Scenario: 不同模型不合并为同一活动任务
- **WHEN** 同一仓库、分支、范围、上限和策略分别指定两个不同模型
- **THEN** 不因其他参数相同而复用同一个活动作业；重复提交完全相同模型和参数时复用活动任务

#### Scenario: 指定模型的失败重试
- **WHEN** 用户恢复一条指定模型的失败任务并再次提交
- **THEN** 原指定身份可核对和编辑；未修改模型时新任务继续使用同一 modelId，原失败记录不被覆盖
