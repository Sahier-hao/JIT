# Spec Delta

## MODIFIED Requirements

### Requirement: FIP-01 明确的单条原始特征输入

系统 SHALL 接收含 modelId、featureSchemaVersion、project 和一条 record 的 JSON 请求；record SHALL 包含非空 recordId，并在原始 features 与持久化提交（commitId 加顶层 datasetVersion）中至少提供一种来源，允许可选带时区 time。首版预测 MUST 仅支持 openstack-six-v1 的 ns、nd、nf、ent、la、ld；其他 schema MUST 明确拒绝，不补零、猜别名或伪造提交上下文。

#### Scenario: 提交合法六字段输入
- **WHEN** 成员提交与已登记模型匹配的一条六字段原始输入
- **THEN** 服务接收独立外部记录，无真实 SHA 或时间时保留未提供状态，调用方不需要提供标签或预先变换的向量

#### Scenario: 请求未支持的输入范围
- **WHEN** 请求十二或十四字段 schema、CSV、记录数组或其他未支持输入
- **THEN** JSON 形态或 schema 不兼容明确返回 422，未实现的 CSV 操作不执行预测，不把其转成六字段继续

#### Scenario: 请求缺少两种来源
- **WHEN** record 既没有原始 features 也没有 commitId
- **THEN** 返回 422 并指出 record 缺少特征来源，不补零、不推测提交上下文

### Requirement: FIP-04 保存完整来源后才返回成功

系统 SHALL 在完整保存批次和唯一预测记录后返回 201。响应 MUST 含本次预测模式、来源标注（client-features 或 persisted-commit）、批次及预测身份、原始特征、所选模型与运行业务身份、原产物身份、模型 hash、schema、输入 hash、UTC 创建时刻和局限。保存失败 MUST 返回 503 STORAGE_UNAVAILABLE，不以已计算风险冒充已保存结果。

#### Scenario: 正常保存单条预测
- **WHEN** 单条合法输入完成真实推理并成功提交存储
- **THEN** 返回一个新 batchId 和 predictionId，以及恰一条风险记录，其模型、运行和输入来源互相一致

#### Scenario: 保存被拒绝或部分写入失败
- **WHEN** 数据库不可写、锁等待超时或批次与记录提交失败
- **THEN** 整体回滚并返回明确存储错误，不留下缺记录的 ready 批次，不返回 201 或已计算风险

## ADDED Requirements

### Requirement: FIP-07 持久化提交作为特征来源

系统 SHALL 在以持久化提交为来源时按请求给出的数据集版本与提交标识读取特征，只采用该提交在模型 schema 中声明为入模的字段。提交不存在或版本内不含该提交 MUST 返回 404；数据集版本未登记 MUST 返回 404；同时提供原始特征与顶层 datasetVersion MUST 返回 422。保存的预测记录 MUST 记录本次实际入模的特征与来源版本。

#### Scenario: 从持久化提交预测
- **WHEN** 请求给出 datasetVersion 与 commitId 且省略 record.features
- **THEN** 返回风险且来源标注为 persisted-commit，保存的特征值与该提交在库中的记录一致

#### Scenario: 提交标识不存在
- **WHEN** 请求的 commitId 在该数据集版本中不存在
- **THEN** 返回 404，不返回空成功或使用其他提交的特征

#### Scenario: 同时给出两种来源
- **WHEN** 请求同时包含 record.features 与顶层 datasetVersion
- **THEN** 返回 422 并指出来源互斥，不静默择一

#### Scenario: 数据集版本未登记
- **WHEN** 请求的 datasetVersion 没有对应的数据集记录
- **THEN** 返回 404 并指出该版本不可用，不尝试按提交标识猜测版本
