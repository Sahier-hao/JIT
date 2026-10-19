> 2026-10-19 审计收尾：部分实现保留，未完成项与已被新方案替代项继续留空；归档不代表全部验收通过。详见 [收尾审计](../../../../docs/审计/2026-10-19-change-closeout.md)。本 change 的 delta 不同步到主规格。

# Tasks: 仓库工作区后端

## 1. 迁移与数据模型

- [x] 1.1 新建 `backend/jit_baseline/migrations/004_repository.sql`：建 `repository` 表（D1 的列与索引），给 `repository_sync` 加 `repository_id`，给 `repository_commit` 加 `subject`
- [x] 1.2 `backend/jit_baseline/catalog_storage.py` 的 `MIGRATIONS` 追加第 4 项，`VERSION` 变 4；`backend/tests/test_catalog_storage.py` 的版本断言改为 4
- [x] 1.3 `backend/jit_baseline/sync.py` 的 `COLUMNS` 增 `repository_id`；`write_commits` 的插入列表增 `subject`

## 2. 仓库实体与归属

- [x] 2.1 新增 `normalize_repository_url(url)` 与 `repository_id_for(url)`（`uuid5(NAMESPACE_URL, …)`），处理 `.git`、尾斜杠、协议与主机大小写
- [x] 2.2 `SyncStorage` 增 `repository_create`、`repository_by_url`、`repository_get`、`repository_update(stats)`、`repositories(limit)`、`backfill_repositories()`
- [x] 2.3 `SyncService.create` 在写作业前完成归仓：查或建仓库，作业写 `repository_id`，更新 `latest_sync_id` / `latest_sync_at` / `default_branch`
- [x] 2.4 `SyncService._run` 成功分支在写完提交后更新 `view_sync_id`、`head_commit`、`commit_count` 与四段计数、`distribution_rule`；失败分支只更新 `latest_*`
- [x] 2.5 `SyncService.recover()` 先执行 `backfill_repositories()`，吞 `STORAGE_UNAVAILABLE` 返回 0

## 3. 采集产物补标题

- [x] 3.1 `SyncService._persist` 与 `_run` 写 `repository_commit` 时带上 `record["subject"]`
- [x] 3.2 采集器已提供 `subject`，确认 `collect()` 的 records 与 `rawRecords` 都含该字段并有测试覆盖

## 4. 查询接口

- [x] 4.1 `GET /api/v1/repositories`：`limit` 1..100 默认 50，返回 `{repositories: [...], total}`，按 `updated_at DESC`
- [x] 4.2 `GET /api/v1/repositories/{id}`：未知返回 404 `REPOSITORY_UNKNOWN`；含 `modelStrategy`、`degradeReason`、`limitations`
- [ ] 4.3 `GET /api/v1/repositories/{id}/commits`：`limit` 1..200、`offset`、`search`（标识或标题，转义 `%`/`_`/`\`）、`sort=risk|time`；返回 `total`、`commits`（含 `subject` 与 `features`）
- [x] 4.4 `GET /api/v1/repositories/{id}/commits/{commit_id}`：返回 14 个特征与标签说明
- [x] 4.5 `GET /api/v1/repositories/{id}/summary`：`total`、`high`、`medium`、`low`、`unknown`、`distributionRule`
- [x] 4.6 `backend/jit_baseline/api.py` 注册 5 条路由；`team_access.py` 增成员路径与 `managed_path` 正则，补 `REPOSITORY_UNKNOWN` 的中文与 404 映射

## 5. 契约与文档

- [x] 5.1 `docs/api/openapi.yaml` 增 API-26～30 与 schema（`Repository`、`RepositoryList`、`RepositoryCommit`、`RepositoryCommitPage`、`RepositorySummary`），版本升到 1.3.0
- [x] 5.2 `docs/产品设计文档.md` 增 `T-16 repository` 表、接口表补 5 行、4.1.1 架构图补仓库实体
- [x] 5.3 `docs/产品需求文档.md` 5.4 说明「仓库视图」已落地，仍未落地的是多分支并列与增量同步

## 6. 测试

- [ ] 6.1 新增 `backend/tests/test_repository_workspace.py`：归仓（三次不同写法地址归一条）、分支切换更新视图、失败作业不清空视图、分布口径边界（0.099/0.10/0.249/0.25）、分页与总数一致、搜索命中第二页之外、空仓库返回空页
- [x] 6.2 `backend/tests/test_repository_sync.py` 补：作业写入 `repository_id`、`subject` 入库并可查询
- [x] 6.3 迁移与回填测试：旧库（`repository_id` 为空）启动后回填成功且幂等
- [x] 6.4 全量回归 `python -m pytest tests -q --basetemp=.pytest-tmp`

## 7. 前端对接前置

- [x] 7.1 在 `docs/api/openapi.yaml` 里标注仓库接口与既有 `/api/v1/repository-syncs` 的关系：仓库视图读、作业历史查
- [ ] 7.2 用真实仓库（`https://github.com/Sahier-hao/JIT.git`）同步一次，确认 `/api/v1/repositories` 返回该仓库、`/commits` 返回带标题的提交（2026-10-18 实测：32 条，高 27／中 1／低 4；按头提交前 8 位搜索命中 1 条）
