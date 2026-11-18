# Tasks

## 1. 工作树收口

- [x] 1.1 保留 2026-11-17 的用户数据、训练、模型与管理共享改动，不 reset、不覆盖未跟踪数据。
- [x] 1.2 删除误生成目录 `$null`、空 `pytest-cache-files-*`、根 `node_modules/`、`backend/node_modules/`、`backend/backend/`、`backend/docs/`。
- [x] 1.3 清理 `docs/evidence/_run/` 中 15 个大体积运行目录（2.0G → 47M）与 `backend/.cache/` 中 200 余个一次性验证目录（22G → 1.7G），保留 `repositories/` 与 `deep/`。
- [x] 1.4 收紧 `.gitignore`：本机 `kamei14-git-v2-*/` 与 `kamei14-git-v1-cc-switch` 新版本不进入 Git；补充 `.claude/logs/`、`.archify/`、`backend/.claude/`。
- [x] 1.5 在 `backend/data/datasets/README.md` 记录 Git 准入规则。

## 2. 侧栏与数据集详情修复

- [x] 2.1 新增 `projectsNavActive(route)`，`AppShell` 只在项目与审查路由点亮“项目”。
- [x] 2.2 新增 `navActive.test.ts`，覆盖 7 个高亮路由与 12 个不应高亮路由。
- [x] 2.3 `AdminDatasetsPage` 为详情组件增加 `key={dataset:version}`，修复数据集/版本切换残留旧版本状态。

## 3. 共享开关闭环

- [x] 3.1 在隔离目录库副本与独立端口（后端 8124、前端 4274）启动管理员与用户会话，不写入真实目录库。
- [x] 3.2 验证 `PUT /api/admin/datasets/{version}/sharing` 开启后用户端共享列表出现、关闭后消失。
- [x] 3.3 验证用户自有版本返回 `DATASET_OWNED`，前端开关禁用并显示原因。
- [x] 3.4 用真实浏览器完成 8 项 UI 验收：登录、开关初值、开启、刷新保持、用户出现、关闭、用户隐藏、自有版本禁用。

## 4. 时间事实与完整性

- [x] 4.1 目录库无记录时，`registeredAt` 回退描述文件写入时间。
- [x] 4.2 目录库无记录时，`manifestSha256` 按描述文件内容计算，`sourceSha256` 回退清单声明的源哈希。
- [x] 4.3 后端 `test_user_dataset_view_exposes_provenance_quality_and_timestamps` 通过。

## 5. 验证与交付

- [x] 5.1 前端 `typecheck`、`lint`、`check:styles`、`check:modules`、`test`、`build` 通过。
- [x] 5.2 后端 `regression_scope.py --layer key` 通过（329 passed, 1 deselected）。
- [x] 5.3 提交到 `refactor/phase0-hygiene` 分支并创建 PR（https://github.com/Sahier-hao/JIT/pull/66）。
- [x] 5.4 归档本 change 并同步主规格（`openspec/changes/archive/2026-11-19-phase0-workspace-hygiene/`）。

## Workflow follow-up

- 修复批次 `express`、`redis` 的 `NoneType < str` 排序错误后重采，不降低成熟期标准。
- 在确认无其他会话使用后决定是否清理 `.dsh-tmp/`（247M）。
