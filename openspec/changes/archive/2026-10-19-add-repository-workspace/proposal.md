# Proposal

## Why

现在系统里只有一个一次性的「同步作业」概念：每同步一次就产生一个新作业，评审员只能凭作业标识翻看某一次采集的结果。仓库本身不是系统里的实体——同一个仓库同步两次，界面上就是两批互不相干的提交；没人知道这个仓库上次同步到哪、累计有多少提交、其中多少属于高风险。

界面重构需要以「仓库」为入口（左侧列出接入的仓库，点进去看这个仓库待审的提交），因此后端必须先把仓库做成可查询的实体，否则前端只能拿作业冒充仓库。

## What Changes

- 新增**仓库实体**：以规范化后的仓库地址为唯一键，记录显示名、默认分支、最近一次成功同步时间与 HEAD、当前提交数、风险分布（高/中/低）、最近一次同步作业标识。
- **同步作业归属仓库**：创建同步时按地址查找或创建仓库，作业记录 `repository_id`；同一仓库再次同步不新建仓库。
- **仓库的提交视图以最近一次成功同步为准**：新作业完成后替换仓库的提交集合与分布；历史作业仍可查询，但不参与仓库视图。
- 新增 5 个只读接口：
  - `GET /api/v1/repositories` 仓库列表（含提交数、风险分布、最近同步时间）
  - `GET /api/v1/repositories/{repository_id}` 仓库详情（含最近同步、所用模型、降级原因、标签说明）
  - `GET /api/v1/repositories/{repository_id}/commits` 分页查询（搜索、排序、limit/offset）
  - `GET /api/v1/repositories/{repository_id}/commits/{commit_id}` 单条提交详情（14 个原始度量）
  - `GET /api/v1/repositories/{repository_id}/summary` 风险分布与总数
- 迁移 `004_repository.sql`：新建 `repository` 表；`repository_sync` 增列 `repository_id`，对已有数据按 `repository_url` 回填。
- 权限：新路径归入成员路径，沿用既有令牌校验与错误信封。

## Capabilities

### New Capabilities

无。仓库实体是既有采集能力的延伸，不新开能力。

### Modified Capabilities

- `repository-collection`: 新增 RCL-10「仓库实体与同步归属」——同一仓库的多次同步归入同一实体，仓库视图以最近一次成功同步为准，并对外提供仓库列表与详情查询。
- `commit-risk-review`: 新增 CRR-15「仓库维度的待审提交查询」——按仓库分页查询提交，返回总数与风险分布，搜索与排序在服务端生效。

## Impact

- 数据库：新增迁移 `backend/jit_baseline/migrations/004_repository.sql`，`catalog_storage.MIGRATIONS` 增一项，`VERSION` 变为 4；本机既有库需要 `catalog-init` 升级。
- 后端：`backend/jit_baseline/sync.py`（创建时归仓、完成后写仓库统计、新增查询方法）、`backend/jit_baseline/api.py`（5 条路由）、`backend/jit_baseline/team_access.py`（成员路径与错误码）、`backend/jit_baseline/catalog_storage.py`（迁移登记）。
- 契约：`docs/api/openapi.yaml` 新增 API-26～30 与对应 schema，版本升到 1.3.0。
- 文档：`docs/产品设计文档.md` 增 T-16/T-17 与接口表，`docs/产品需求文档.md` 5.4 说明仓库视图已落地。
- 测试：新增 `backend/tests/test_repository_workspace.py`；`test_repository_sync.py` 补归属断言；`test_catalog_storage.py` 版本断言改为 4。
- 前端：本 change 不改前端；`restyle-review-workbench` 依赖本 change 的接口。
