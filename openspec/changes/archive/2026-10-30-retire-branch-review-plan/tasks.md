# Tasks

## 1. 后端移除

- [x] 1.1 删除 `ReviewPlanService`、`/api/v1/repositories/{repository_id}/review-plan/validate` 端点与三个计划错误码；验证：`tests/test_openapi.py` 通过，服务启动后路径返回 404。
- [x] 1.2 删除 `tests/test_review_plan.py` 与相关契约模型；验证：后端全量测试通过且没有引用旧符号。

## 2. 前端移除与兼容

- [x] 2.1 删除 `shortlist.ts`、`reviewPlanTransfer.ts`、`components/PlanTransfer.tsx`、`plan-transfer.css` 及对应测试；验证：`npm run typecheck` 与 lint 无未解析引用。
- [x] 2.2 `ReviewWorkbench` 只保留提交明细、筛选、分页与单条详情，详情改为对话框；`/plan` 地址显示同一份提交明细；验证：`ProductWorkspace.test.tsx`、`ProjectPage.test.tsx` 与旧 `/plan` 地址检查。
- [x] 2.3 当前结果入口文案改为「查看提交明细」，面包屑改为「提交明细」；验证：`ProjectPage.test.tsx` 与浏览器检查。

## 3. 文档与验收

- [x] 3.1 更新 `docs/api/openapi.yaml`、`docs/当前产品.md`、`docs/PR审查使用指南.md`、`frontend/README.md`、产品需求/设计/测试计划；验证：文档不再描述计划入口，旧 `/plan` 的兼容行为有说明。
- [x] 3.2 运行前端类型检查、构建与受影响测试；验证：命令退出码与结果记录在 `docs/审计/2026-10-30-project-workspace-convergence.md`。

## Workflow follow-up

- 用户复核后归档本变更。
- 提交、推送与 PR 由用户决定。
