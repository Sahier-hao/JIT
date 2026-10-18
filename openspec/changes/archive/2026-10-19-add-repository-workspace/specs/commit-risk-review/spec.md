# Delta: commit-risk-review

## ADDED Requirements

### Requirement: CRR-15 仓库维度的待审提交查询

系统 SHALL 支持按仓库查询待审提交，返回该仓库当前视图的提交总数与风险分布（高、中、低三段及各自计数），并支持按提交标识或标题搜索、按风险或时间排序、按 `limit` 与 `offset` 分页。搜索与排序 MUST 在服务端生效，MUST NOT 只过滤已加载的一页；分页结果 MUST 与总数一致，同一排序条件下的相邻两页 MUST NOT 重复或遗漏提交。

风险分布的分段口径 MUST 有版本标识并与列表使用的风险值一致。仓库没有提交时 MUST 返回空页与全零分布，MUST NOT 返回错误。

#### Scenario: 分页与总数一致

- **WHEN** 一个仓库有 26 条提交，请求 `limit=10&offset=20`
- **THEN** 返回最后 6 条提交，`total` 为 26，且两次相邻请求没有重复提交

#### Scenario: 搜索命中第二页之外的提交

- **WHEN** 目标提交位于第 5 页，用户按其标识片段搜索
- **THEN** 服务端返回命中的提交并给出新的 `total`，而不是在已加载的第一页里找不到

#### Scenario: 按时间排序

- **WHEN** 请求 `sort=time`
- **THEN** 提交按提交时间从新到旧返回，同时间按完整提交标识升序

#### Scenario: 空仓库

- **WHEN** 仓库没有任何提交
- **THEN** 返回空列表、`total` 为 0、分布三段均为 0

## MODIFIED Requirements

无。
