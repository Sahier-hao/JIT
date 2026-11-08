# configurable-training-parameters Specification

## Purpose
TBD - created by archiving change nightly-multi-method-and-location-loop. Update Purpose after archive.

## Requirements

### Requirement: CTP-01 参数声明与校验

系统 SHALL 为支持可配置训练的方法声明参数白名单，包含名称、类型、取值下限与上限。请求中的未知参数、错误类型或越界值 MUST 被拒绝；系统 MUST NOT 接受任意 estimator、Python 表达式或服务端路径。未列入白名单的参数 MUST NOT 影响训练。

#### Scenario: 合法参数

- **WHEN** 管理员为逻辑回归设置范围内的 C 并为随机森林设置树数
- **THEN** 参数被接受并记录在子任务与运行配置中

#### Scenario: 越界或未知参数

- **WHEN** 请求包含越界值、错误类型或未声明参数
- **THEN** 请求被拒绝并指出具体参数，不创建训练任务

### Requirement: CTP-02 默认身份与旧运行兼容

未显式提供参数时，训练运行的身份、配置与校验 MUST 与既有冻结参数完全一致。显式提供参数时，运行 MUST 写入实际参数与参数契约版本；加载校验 MUST 按契约校验实际参数。既有运行 MUST 继续按原冻结参数校验，MUST NOT 因新增参数能力而失效。

#### Scenario: 默认参数

- **WHEN** 管理员不修改任何参数创建训练
- **THEN** 运行配置中的参数与该方法冻结声明一致，运行身份不因本轮改动改变

#### Scenario: 旧产物

- **WHEN** 校验一个没有参数契约字段的既有产物
- **THEN** 仍要求其参数与注册表冻结声明完全相等

#### Scenario: 参数配置的产物

- **WHEN** 校验一个有参数契约的产物
- **THEN** 按声明校验实际参数的范围与类型，拒绝被篡改或不兼容的配置

### Requirement: CTP-03 配置贯穿请求到模型卡

实际参数 MUST 从请求、数据库、重试、工作进程、运行清单、加载校验贯通到模型卡与任务详情；同一方法的不同参数配置 MUST 有不同的运行身份和可区分配置摘要。训练成功后参数 MUST 与产物一起保存，MUST NOT 在重试时被替换为默认值。

#### Scenario: 重试保留参数

- **WHEN** 一个失败训练任务被重试
- **THEN** 新任务沿用原数据、切分、方法与实际参数

#### Scenario: 模型卡展示配置

- **WHEN** 打开一个参数化训练的模型卡
- **THEN** 显示实际参数及与默认值的差异，不显示注册表默认值冒充实际配置

### Requirement: CTP-04 冻结后训练

参数 MUST 在训练开始前锁定。系统 MUST NOT 进行自动超参数搜索，MUST NOT 依据测试指标挑选参数或模型；测试分区只用于冻结评价。固定 epoch 的迭代方法 MUST 按创建时锁定的次数执行，MUST NOT 引入早停。

#### Scenario: 无自动搜索

- **WHEN** 管理员提交一次训练
- **THEN** 只执行所声明的一组参数，不产生额外候选运行

#### Scenario: 固定 epoch

- **WHEN** 深度方法以锁定的 epoch 数训练
- **THEN** 训练完整执行该次数并记录历史，不因验证表现提前停止
