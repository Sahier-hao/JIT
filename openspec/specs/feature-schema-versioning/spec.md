# feature-schema-versioning Specification

## Purpose

让特征集合成为可具名注册、按运行解析的契约：每个 schema 声明有序字段、来源列、语义核验状态、是否进入模型输入与变换方式，从而支持多种特征方案并存、按运行校验，并让新旧运行各自按自身声明被正确加载与复现。

## Requirements

### Requirement: FSV-01 具名 schema 的注册内容

系统 SHALL 以具名 schema 作为特征集合的唯一声明来源。每个 schema MUST 记录：唯一名称、有序字段清单、每字段的来源列、语义核验状态、是否进入模型输入、以及变换方式（`log1p` 或保持原值）。字段顺序 MUST 由该声明决定，调用方 MUST NOT 依赖任何按位置写死的字段假设。

#### Scenario: 取回已注册 schema

- **WHEN** 按名称请求一个已注册 schema
- **THEN** 返回其有序字段、每字段来源列、核验状态、入模标记与变换方式，且与注册声明一致

#### Scenario: 请求未知 schema

- **WHEN** 请求一个未注册的 schema 名称
- **THEN** 系统以明确错误拒绝，不退回默认 schema、不猜字段、不以部分字段继续

### Requirement: FSV-02 字段可用性与不可得声明

当某字段在固定来源中不存在或其语义无法核验时，系统 MUST 将其在该 schema 中标记为 `unavailable` 并写明原因。标记为 `unavailable` 的字段 MUST NOT 进入模型输入，也 MUST NOT 用同名列、相加推算值或含义不同的列冒名替换。

#### Scenario: 新建 schema 记录不可得字段

- **WHEN** 为固定发布者快照登记 `kamei14-v1`
- **THEN** `lt`（固定快照不含变更前文件规模）与 `rexp`（同名列是 Reviewer 经验，语义不可核验）记为 `unavailable` 并写明原因
- **AND** 二者不出现在该 schema 的入模字段中

#### Scenario: 试图用同名列替代

- **WHEN** 有请求要求用同名列或 `la+ld` 之类的推算值填补某个 `unavailable` 字段
- **THEN** 系统拒绝并报告不兼容，不静默替换

### Requirement: FSV-03 运行与 schema 绑定及校验

每个运行 SHALL 声明其使用的 schema（名称、有序入模字段、变换方式），且该声明 MUST 计入运行身份。产物校验 MUST 依据该运行 manifest 中声明的 schema，而非任何全局常量；模型输入形状校验 MUST 与该声明声明的入模字段数比较。

运行身份中的 schema 指纹 MUST 只包含实际生效的声明：未启用的可选扩展（扩展字段为空、扩展开关为关闭）MUST NOT 改变既有运行的指纹；一旦扩展被启用或声明了具体扩展内容，指纹 MUST 随之改变并与原声明区分。校验必须（MUST）能区分"声明被篡改"与"实现新增了未使用的默认字段"——前者失败，后者仍通过。

#### Scenario: 旧运行按自身 schema 校验

- **WHEN** 校验一个按 `openstack-six-v1` 生成的既有运行
- **THEN** 校验按该运行声明的六字段进行并通过，不因注册表新增了其它 schema 而失败

#### Scenario: 实现新增默认字段

- **WHEN** 实现给 schema 声明新增了带默认值、且既有运行并未启用的扩展字段
- **THEN** 该既有运行的 schema 指纹与登记时一致，产物校验通过，模型仍为可用状态

#### Scenario: 扩展被启用

- **WHEN** 某个运行声明了具体的语义扩展内容
- **THEN** 它的 schema 指纹与未启用扩展的同名 schema 不同，两者不会被当成同一份声明

#### Scenario: 声明被篡改的运行必须失败

- **WHEN** 某运行的声明字段顺序或入模字段与其产物实际内容不一致
- **THEN** 校验失败并指出不一致的类型与位置，不因"声明自洽"而放过

#### Scenario: 模型输入形状与声明不符

- **WHEN** 已训练模型接收到的输入列数与运行声明声明的入模字段数不同
- **THEN** 拒绝推理并以明确错误报告，不截断或补列
