# Spec Delta

## MODIFIED Requirements

### Requirement: CMP-05 提交与特征只读查询

系统 SHALL 提供按数据集版本查询提交列表与按提交标识查询单条提交及其特征与标签；列表 MUST 分页且有上限、MUST 返回总数、MUST NOT 在单次响应中携带全部特征；来源提供模块时支持按模块过滤。未知标识或版本 MUST 返回明确错误，MUST NOT 返回空成功。

#### Scenario: 分页查询提交列表
- **WHEN** 请求某数据集版本下指定 limit 与 offset 的提交列表
- **THEN** 返回不超过上限的摘要项（标识、时间、标签、模块）与总数，完整特征不随列表返回

#### Scenario: 超出上限的分页参数
- **WHEN** 请求的 limit 超过声明上限、为负数或不是整数
- **THEN** 返回可定位的输入错误，不截断为上限继续返回

#### Scenario: 按版本查询
- **WHEN** 请求某数据集版本下的提交
- **THEN** 返回该范围内的提交、特征与标签

#### Scenario: 查询未知提交标识
- **WHEN** 按一个不存在的提交标识查询
- **THEN** 返回可区分的未找到错误
