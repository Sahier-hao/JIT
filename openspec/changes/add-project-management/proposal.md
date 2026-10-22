# Proposal

## Why

现在只能通过发起一次分析（`POST /api/v1/repository-syncs`）顺带建立项目：无法先建项目再选分析参数，无法重命名或删除项目，也无法查看、清理项目内的分析记录。项目页要展示「最新分析 / 分析记录 / 失败响应」，缺少稳定的管理接口，前端只能把历史作业当项目历史。

## What Changes

- 新增 `POST /api/v1/repositories`：只登记项目（规范化地址幂等），不产生分析记录。
- 新增 `PATCH /api/v1/repositories/{id}`：只改显示名（1–80 字）。
- 新增 `DELETE /api/v1/repositories/{id}`：硬删项目及其分析记录、提交；存在进行中分析时返回 409。
- 新增 `GET /api/v1/repositories/{id}/syncs`：按项目分页查询分析记录（创建时间倒序，含阶段与失败原因）。
- 新增 `DELETE /api/v1/repository-syncs/{id}`：只删除已结束记录；删除项目当前结果时项目回到「无结果」，不自动回退。
- 新增错误码 `CONFLICT_ACTIVE_SYNC`。
- 不修改现有 `POST /api/v1/repository-syncs` 的「顺带建项目」行为，保持兼容。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `repository-collection`: 增加项目登记/重命名/硬删与分析记录列表/删除的要求（RCL-15 至 RCL-17），不改变 RCL-01 至 RCL-14 的既有行为。

## Impact

- `backend/jit_baseline/sync.py`：`SyncStorage` 与 `SyncService` 增加项目管理、记录列表与删除。
- `backend/jit_baseline/api.py`、`backend/jit_baseline/api_errors.py`：5 个路由与 `CONFLICT_ACTIVE_SYNC`。
- `backend/tests/test_repository_management.py`：新增 11 个用例。
- 无数据库迁移：现有 `repository` / `repository_sync` 索引已覆盖查询。
- 前端暂未接入，由后续变更消费。
