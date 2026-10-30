# Proposal

## Why

分支分析的个人审查计划无法阻止已合并提交进入审查，也没有跨设备或团队能力；它与 PR 工作单的轮次、问题和证据重复，容易让评审员把浏览器里的清单误解为审查进度或共享计划。2026-10-30 用户要求分支分析只承担风险度量与复盘，删除计划入口，避免两套个人选择并存。

## What Changes

- 删除服务端 `review-plan/validate` 端点、`ReviewPlanService` 及三个计划错误码；OpenAPI 移除对应路径、请求模型与错误码枚举。
- 固定分析的审查页只保留提交明细、筛选、分页与单条详情；删除「审查计划」分段视图、列表/详情加入清单、计划移除及 JSON 导入导出。
- 提交详情改为对话框按需打开；`/plan` 旧地址显示同一份提交明细，不报错也不重建计划。
- 浏览器中旧计划数据保留但不读取、不迁移、不展示，也不再写入。
- PR 工作单的轮次、问题、证据、交付与「我的审查」保持不变；旧计划数据不被当作 PR 审查进度。

## Capabilities

### Modified Capabilities
- `commit-risk-review`: 移除个人优先审查清单、其浏览器恢复与保存失败要求；搜索、排序与桌面可操作性仅保留列表与详情。
- `focused-project-review`: 聚焦提交只保留列表与详情，详情以对话框展示；移除计划备份与合并恢复。
- `interface-presentation`: 工作区适配与当前结果卡按钮文案改为提交明细，不再出现空计划占位。
- `workspace-navigation`: 业务措辞不再把分支分析的个人选择称为审查计划。

## Impact

- 后端：删除 `backend/jit_baseline/review_plan.py` 与 `tests/test_review_plan.py`；`api.py` 移除端点；`api_errors.py` 移除 `REVIEW_PLAN_CONTEXT_MISMATCH`、`REVIEW_PLAN_COMMIT_UNKNOWN`、`REVIEW_PLAN_LIMIT_EXCEEDED`。
- 前端：删除 `shortlist.ts`、`reviewPlanTransfer.ts`、`components/PlanTransfer.tsx`、`plan-transfer.css` 及对应测试；`ReviewWorkbench.tsx`、`ProjectPage.tsx`、`App.tsx`、`navigation.ts` 调整；`/plan` 保持兼容。
- 契约与文档：`docs/api/openapi.yaml`、`docs/当前产品.md`、`docs/PR审查使用指南.md`、`frontend/README.md`、产品需求/设计/测试计划。
- 数据：不新增数据库迁移；不清理或改写浏览器中的旧计划键。
- 不在范围：PR 工作单的个人轮次、问题、证据、交付与「我的审查」；不删除既有分析、模型或历史结果。
