# Proposal

## Why

项目里有多次成功分析时，能用于审查的那一次被固定为最新一次成功分析。评审者如果认为早先那次的范围更合适，只能重新跑一遍分析，既浪费时间，也会产生一条重复记录。

## What Changes

- 项目页的「分析记录」里，任一已完成记录都可以设为当前结果；顶部「当前分析结果」随之切换。
- 设为当前结果只改变项目的视图指向（`viewSyncId`），不删除、不复制、不改写任何历史记录；风险计数与提交数按所选分析重新计算。
- 默认行为不变：新分析完成后仍自动成为当前结果；删除当前结果记录仍回到「无结果」，不回退。
- 后端复用 `PATCH /api/v1/repositories/{id}`，请求体带 `viewSyncId` 时表示切换当前结果；只允许属于该项目且已完成的记录，失败/中断记录返回 409，跨项目记录返回 404。
- 项目本身的管理（重命名、删除）从项目页移到项目列表页的卡片菜单，项目页只保留分析相关操作。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `focused-project-review`: FPR-02 的当前结果定义从「最新一次成功分析」改为「默认为最新一次成功分析，并可在分析记录中选择任一已完成分析」。

## Impact

- 后端：`backend/jit_baseline/sync.py`（新增 `select_view`）、`backend/jit_baseline/api.py`（PATCH 分流）、`backend/tests/test_repository_management.py`（新增两个用例）。
- 前端：`frontend/src/projectClient.ts`（`selectRepositoryView`）、`frontend/src/pages/ProjectPage.tsx`（记录行「设为当前结果」）、`frontend/src/pages/ProjectsPage.tsx`（卡片管理菜单）、`frontend/src/components/AnalysisForm.tsx`（分析选项常显）、`frontend/src/styles/product.css`。
- 无数据库迁移，无新增依赖。
