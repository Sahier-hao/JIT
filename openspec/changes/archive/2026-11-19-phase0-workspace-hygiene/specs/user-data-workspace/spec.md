# Spec Delta

## ADDED Requirements

### Requirement: UDW-06 管理员显式共享白名单

普通用户的“共享数据” SHALL 只包含管理员通过共享接口显式开放、且没有用户所有者的数据集版本。未开放的全局版本 MUST NOT 自动出现在用户端；用户自有版本 MUST NOT 开放给其他用户。

#### Scenario: 管理员开启共享
- **WHEN** 管理员对无所有者的数据集版本开启共享
- **THEN** 该版本出现在普通用户的“共享数据”中，且用户不能修改或清理它

#### Scenario: 管理员撤销共享
- **WHEN** 管理员关闭共享
- **THEN** 该版本从普通用户的“共享数据”中消失，已有分析、模型和结果不受影响

#### Scenario: 用户自有版本
- **WHEN** 管理员尝试开放一个属于普通用户的版本
- **THEN** 服务端拒绝并返回 `DATASET_OWNED`，前端开关保持禁用并显示“用户自有版本不能开放共享。”

#### Scenario: 刷新后保持
- **WHEN** 管理员开启或关闭共享后刷新页面
- **THEN** 开关状态与用户端可见性保持为最后一次显式操作的结果

### Requirement: UDW-07 数据版本时间事实与完整性

用户数据列表和详情 SHALL 返回 `fieldCount`、`registeredAt`、`importedAt`、`ownedAt`、`builtAt` 以及 `manifestSha256`、`sourceSha256`。这些字段 MUST 分别表示登记、CSV 导入、归属和构建完成的事实，不得合并成一个“创建时间”。目录库尚未导入描述文件时，`registeredAt` SHALL 取描述文件的写入时间，`manifestSha256` SHALL 按描述文件内容计算。

#### Scenario: CSV 导入版本
- **WHEN** 用户导入 CSV 并查看版本详情
- **THEN** 登记时间与导入时间有值，构建完成时间为空，清单哈希可核对

#### Scenario: 构建版本
- **WHEN** 用户从仓库构建数据集并查看版本详情
- **THEN** 构建完成时间有值，导入时间为空，归属时间可核对

#### Scenario: 仅描述文件登记
- **WHEN** 版本只存在于描述文件而尚未导入目录库
- **THEN** 接口仍返回登记时间与清单哈希，不返回空值冒充“无记录”
