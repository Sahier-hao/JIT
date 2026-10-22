# Spec Delta

## ADDED Requirements

### Requirement: RCL-15 项目登记与重命名

系统 SHALL 允许只登记项目而不发起分析。同一规范化仓库地址 MUST 幂等复用既有项目：首次返回 201，重复返回 200，且 MUST 不产生分析记录。系统 SHALL 允许修改项目显示名；显示名 MUST 为 1 至 80 个字符，空白或超长 MUST 以 422 拒绝。

#### Scenario: 只登记项目不运行分析

- **WHEN** 客户端 `POST /api/v1/repositories` 提交公开仓库地址
- **THEN** 返回 201 与项目视图，`latestSync` 为空，该项目的分析记录列表为空

#### Scenario: 同址重复登记复用项目

- **WHEN** 同一地址在不同大小写或带 `.git` 后缀的情况下再次登记
- **THEN** 返回 200 与相同项目标识，不新增项目也不新增分析记录

#### Scenario: 修改显示名

- **WHEN** 客户端 `PATCH /api/v1/repositories/{id}` 提交合法显示名
- **THEN** 返回 200，显示名更新，仓库地址与分析记录保持不变

#### Scenario: 非法显示名被拒绝

- **WHEN** 显示名为空白或超过 80 个字符
- **THEN** 返回 422 `INPUT_INVALID`，项目名称保持不变

### Requirement: RCL-16 分析记录查询

系统 SHALL 提供按项目分页查询分析记录，按创建时间倒序返回。每条记录 MUST 包含状态、进行中的阶段、失败原因、提交范围、分支、数据集版本、模型与运行标识以及 requestId；分页 MUST 稳定，单页上限 100 条。

#### Scenario: 按项目倒序分页

- **WHEN** 客户端 `GET /api/v1/repositories/{id}/syncs?limit=&offset=`
- **THEN** 返回该项目的记录分页，按创建时间倒序，并带总数与分页边界

#### Scenario: 记录包含阶段与失败原因

- **WHEN** 项目中存在进行中与失败的记录
- **THEN** 进行中记录带当前阶段，失败记录带可读失败原因，已结束记录不带阶段

### Requirement: RCL-17 项目与记录删除

系统 SHALL 支持硬删项目（连带其分析记录与提交）与删除单条分析记录。存在进行中分析时删除项目 MUST 返回 409 `CONFLICT_ACTIVE_SYNC`。删除分析记录 MUST 只删除该记录：若记录是项目当前结果（`viewSyncId`），项目 MUST 回到无结果且 MUST NOT 自动回退到其他记录；项目最近请求字段 MUST 重算。删除不存在的项目或记录 MUST 返回 404 `NOT_FOUND`；进行中的记录 MUST 返回 409。

#### Scenario: 硬删项目

- **WHEN** 客户端 `DELETE /api/v1/repositories/{id}` 且项目无进行中分析
- **THEN** 返回 200，项目、其分析记录与提交均不可再读取

#### Scenario: 在途项目拒绝删除

- **WHEN** 项目存在进行中的分析时请求删除该项目
- **THEN** 返回 409 `CONFLICT_ACTIVE_SYNC`，项目与记录保持不变

#### Scenario: 删除当前结果记录回到无结果

- **WHEN** 删除项目当前结果对应的已结束记录
- **THEN** 项目 `viewSyncId` 与相关计数被清空，`latestSyncId` 重算，且不自动指向其他记录

#### Scenario: 删除旧记录不影响当前结果

- **WHEN** 删除一条不是当前结果的已结束记录
- **THEN** 返回 200，项目当前结果与提交统计不变

#### Scenario: 删除不存在或进行中的记录

- **WHEN** 删除不存在的记录或删除进行中的记录
- **THEN** 分别返回 404 `NOT_FOUND` 与 409 `CONFLICT_ACTIVE_SYNC`
