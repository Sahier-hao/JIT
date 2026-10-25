# Tasks

## 1. 数据层

- [x] 1.1 `SyncStorage` 增加 `repository_syncs`、`repository_latest_sync`、`repository_active`、`repository_delete`、`sync_delete`；以记录分页、最新记录和删除后的数据库状态核验。
- [x] 1.2 `SyncService` 增加 `create_repository`、`rename_repository`、`delete_repository`、`repository_syncs`、`delete_sync`；以同址复用、名称更新、在途拒绝和已结束记录删除核验。

## 2. HTTP 接口

- [x] 2.1 `POST /api/v1/repositories`（201 新建 / 200 复用）
- [x] 2.2 `PATCH /api/v1/repositories/{id}`：校验显示名 1–80 字，并核对读取结果与非法输入响应。
- [x] 2.3 `DELETE /api/v1/repositories/{id}`（硬删，在途 409）
- [x] 2.4 `GET /api/v1/repositories/{id}/syncs`：核对创建时间倒序、分页总数及项目隔离。
- [x] 2.5 `DELETE /api/v1/repository-syncs/{id}`（仅已结束；删除当前结果回到无结果）

## 3. 错误与契约

- [x] 3.1 新增 `CONFLICT_ACTIVE_SYNC`（409）
- [x] 3.2 404、422 复用既有错误码并带 requestId

## 4. 验证

- [x] 4.1 `backend/tests/test_repository_management.py` 11 个用例通过
- [x] 4.2 后端全量 338 通过；10 个失败为环境既有（缺少 `jsonschema`、数据集目录与 evidence 夹具）
- [x] 4.3 `openspec validate add-project-management --strict` 通过
