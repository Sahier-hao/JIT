# Tasks

## 1. 批量分析入口

- [x] 1.1 后端新增 `analyze_all_prs` 与 `POST /repositories/{id}/pull-requests/analyze`，支持可选 `modelId`，后台逐个分析并跳过已有完成分析的 PR；验证：`tests/test_pr_updates.py` 27 项通过。
- [x] 1.2 前端项目页「分析全部 PR」弹出模型选择对话框，确认后提交批量任务并跳转 PR 审查页；验证：浏览器检查对话框含模型下拉与开始分析按钮。

## 2. 记录与状态

- [x] 2.1 项目分析记录接口排除 `source_kind='pr'`，PR 任务只在 PR 页展示；验证：`GET /repositories/{id}/syncs` 只返回分支任务。
- [x] 2.2 PR 清单状态如实映射 `queued`/`running`/`completed`/`interrupted`/`cancelled`/`failed`，完成才计算最高分；验证：浏览器记录显示「已中断」而非「分析中」。
- [x] 2.3 手动 PR 分析返回实际模型，前端显示模型名称；验证：记录显示「分析完成 · 逻辑回归 · 六字段」。

## 3. PR 审查界面

- [x] 3.1 PR 审查页改为左侧清单、右侧「PR 分析记录」两栏，记录显示状态、模型、最高分与时间并可点击进入详情；验证：浏览器 764px + 340px 两栏与记录渲染。
- [x] 3.2 只读详情移除模型选择、生成、重试与取消，只展示已保存结果；验证：`ProjectPRJourney.test.tsx` 与 `PRModelClues.test.tsx` 通过。
- [x] 3.3 删除 PR 页解释性小字与重复汇总，保留状态、数据与操作；验证：浏览器无 `pr-hub-note` 与左栏汇总。

## 4. 契约、文档与验证

- [x] 4.1 `docs/api/openapi.yaml` 新增两条分析路径与请求/响应 schema；验证：`tests/test_openapi.py` 11 项通过。
- [x] 4.2 更新 `AGENTS.md` 的界面文案约定与本轮审计记录；验证：文档与实际界面一致。
- [x] 4.3 后端全量 584 项、前端全量 301 项通过；类型检查与构建通过。

## Workflow follow-up

- 用户复核后归档本变更。
- 真实浏览器 E2E 与部署切换由用户在本机执行。
