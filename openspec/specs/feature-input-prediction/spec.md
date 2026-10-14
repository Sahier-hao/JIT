# feature-input-prediction Specification

## Purpose

让成员选择已登记的真实模型，对自己提供的一条原始特征记录获得可追踪风险，并把输入、模型版本和结果作为独立批次保存，使服务重启或模型后续变化不会暗中改写已完成预测的含义。

## Requirements

### Requirement: FIP-01 明确的单条原始特征输入

系统 SHALL 接收含 modelId、featureSchemaVersion、project 和一条 record 的 JSON 请求；record SHALL 包含非空 recordId 与原始 features，允许可选真实 commitId 和带时区 time。首版预测 MUST 仅支持 openstack-six-v1 的 ns、nd、nf、ent、la、ld；其他 schema MUST 明确拒绝，不补零、猜别名或伪造提交上下文。

#### Scenario: 提交合法六字段输入
- **WHEN** 成员提交与已登记模型匹配的一条六字段原始输入
- **THEN** 服务接收独立外部记录，无真实 SHA 或时间时保留未提供状态，调用方不需要提供标签或预先变换的向量

#### Scenario: 请求未支持的输入范围
- **WHEN** 请求十二或十四字段 schema、CSV、记录数组或其他未支持输入
- **THEN** JSON 形态或 schema 不兼容明确返回 422，未实现的 CSV 操作不执行预测，不把其转成六字段继续

### Requirement: FIP-02 严格字段与类型校验

系统 SHALL 按模型 schema 核对字段名和数值类型，计数字段为非负整数且不接受布尔值，ent 为有限非负 JSON 数值；所有层级 MUST 拒绝未知字段、标签、缺失值、字符串数值及非有限值。JSON 属性顺序 MUST NOT 决定模型输入顺序。非法 JSON 和超出已声明大小限制 MUST 明确失败，不产生成功预测。

#### Scenario: 属性顺序改变
- **WHEN** 两个合法请求只有 features 属性顺序不同
- **THEN** 模型输入按 schema 声明形成，风险在所选方法声明容差内一致

#### Scenario: 不合法输入
- **WHEN** 存在 label 或 bugcount 等额外字段、缺字段、计数字段为布尔或小数、字符串数值、NaN、负值或无时区时间
- **THEN** 返回 422 INPUT_INVALID 或 INPUT_SCHEMA_MISMATCH 并定位字段，不保存成功批次或给出风险

#### Scenario: 请求体超过配置上限
- **WHEN** JSON 请求体超过服务声明的单条输入上限
- **THEN** 返回 413 INPUT_LIMIT_EXCEEDED，不截断正文或继续推理

### Requirement: FIP-03 模型选择与标签独立推理

系统 SHALL 只使用请求选择的已登记可用模型、其声明 schema 与已拟合预处理生成正类 1 的风险。模型不存在 MUST 返回 404，不可用 MUST 返回 503；推理异常、输出数量不为一或风险不在有限 [0,1] 内 MUST 返回 500。预测过程 MUST NOT 训练、重新拟合、读取评价标签或参考预测生成风险，也不依据测试指标替换所选方法。

#### Scenario: 同输入与已交付模型一致
- **WHEN** 对已校验模型提交与其参考记录相同的原始特征
- **THEN** 风险与该模型独立推理结果在其声明容差内一致，不把单条新输入称为已验证在线仓库效果

#### Scenario: 推理失败或模型不可用
- **WHEN** 所选模型缺失、损坏、推理抛异常、返回非法风险或错误数量
- **THEN** 返回对应错误，不带风险、演示值、先前预测或其他模型的结果，且不发布成功批次

### Requirement: FIP-04 保存完整来源后才返回成功

系统 SHALL 在完整保存批次和唯一预测记录后返回 201。响应 MUST 含 feature-input 模式、client-features 来源、批次及预测身份、原始特征、所选模型与运行业务身份、原产物身份、模型 hash、schema、输入 hash、UTC 创建时刻和局限。保存失败 MUST 返回 503 STORAGE_UNAVAILABLE，不以已计算风险冒充已保存结果。

#### Scenario: 正常保存单条预测
- **WHEN** 单条合法输入完成真实推理并成功提交存储
- **THEN** 返回一个新 batchId 和 predictionId，以及恰一条风险记录，其模型、运行和输入来源互相一致

#### Scenario: 保存被拒绝或部分写入失败
- **WHEN** 数据库不可写、锁等待超时或批次与记录提交失败
- **THEN** 整体回滚并返回明确存储错误，不留下缺记录的 ready 批次，不返回 201 或已计算风险

### Requirement: FIP-05 不可变结果重开

系统 SHALL 允许成员按 batchId 读取完整保存结果，服务重启后仍保留原身份、输入及风险；不存在 MUST 返回 404，存储不可用 MUST 返回 503。重开 MUST NOT 重新推理或把当前模型状态写入过去的来源快照。重复 POST SHALL 创建独立批次，recordId 仅在所属批次内标识记录，不作为全局去重键。

#### Scenario: 模型变化后重开
- **WHEN** 已完成预测后模型文件被移除、另登记新版本，或服务重启
- **THEN** 原批次仍按保存的模型来源与风险返回，不依赖加载当前模型；新预测仍须独立检查当前可用性

#### Scenario: 重复输入请求
- **WHEN** 成员两次提交相同合法输入且两次均成功
- **THEN** 返回两个独立批次及预测身份，各自保存相同输入上下文，不覆盖之前的合法结果

### Requirement: FIP-06 解释未支持状态与风险边界

系统 SHALL 对本轮预测返回 explanationStatus=not-supported 及明确原因，不创建等待中的解释任务、人工贡献或缺陷归因。响应 SHALL 说明原始特征来自调用方、风险为模型估计，尚无真实标签、代码定位或线上效果验证。

#### Scenario: 模型尚无解释方法
- **WHEN** 任一本轮可用模型完成 JSON 预测
- **THEN** 显示解释未支持及原因，不返回 pending、空贡献冒充 ready 或把原始特征称作缺陷原因
