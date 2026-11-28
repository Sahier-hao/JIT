# Tasks

## 1. 行级证据脱离实时源码读取

- [x] 1.1 从 `score_lines` 提取 `_scored_line`，保持 `line_logit`、截距、语言项和前 3 个非零贡献口径不变
- [x] 1.2 新增 `score_patch_candidates`，只用固定 patch 的 `line`/`text` 打分；模型启用位置特征时以 `LINE_PREVIEW_CONTEXT_REQUIRED` 失败
- [x] 1.3 `build_line_evidence` 移除 `code`、`content_complete`、`content_absent` 参数，覆盖信息返回 `textSource: patch`、`usesFullFile: false`
- [x] 1.4 候选超过 `MAX_LINES` 时返回 `content-unavailable` + `patch-candidate-limit`，不截断后假装完整
- [x] 1.5 PR 快照与固定提交调用方停止请求 `/contents/`；本地 Git 路径也只使用固定 patch

## 2. 契约与文档

- [x] 2.1 `docs/api/openapi.yaml` 的 `LineReviewEvidence.coverage` 增加 `textSource`、`usesFullFile`
- [x] 2.2 重新生成 `frontend/src/lib/api-generated` 并运行 `check:api-types`
- [x] 2.3 更新 `docs/当前产品.md` 与 `docs/离线与研究.md` 的行级证据口径

## 3. 前端行级排序

- [x] 3.1 默认视图改为候选列表 + 排名 + 人话摘要 + 行内特征条形图
- [x] 3.2 研究分固定标注 0–1、未校准、不是缺陷概率；完整表格与 `logit` 分解放入“技术口径与完整贡献”
- [x] 3.3 语言项从人话摘要和条形图排除，技术表格保留并说明“不参与行间比较”
- [x] 3.4 `PRLineEvidence` 透传定位回调，PR 代码区点击「在代码中定位」滚动到对应 Diff 行
- [x] 3.5 不可用状态区分 `LINE_PREVIEW_CONTEXT_REQUIRED` 与 `patch-candidate-limit`，不再统一显示“源码不完整”

## 4. 解释与 PR 版面

- [x] 4.1 提交解释首屏只显示摘要和主要输入；完整表格、基线、稳定性、元数据折叠
- [x] 4.2 只有多于一种方法时显示选择器；多方法并列核对折叠
- [x] 4.3 PR 文件阅读区默认收起检查侧栏，打开「行级排序」或「检查文件」时展开
- [x] 4.4 侧栏页签改为「规则命中」「行级排序」「问题草稿」，补关闭按钮
- [x] 4.5 文件行移除无标签提交分和重复“未覆盖”，保留按提交分排序
- [x] 4.6 后续修复证据折叠为一行摘要，展开后显示修复提交、文件与行号

## 5. 验证

- [x] 5.1 `backend/.venv/Scripts/python.exe -m pytest tests/test_line_preview.py tests/test_pr_review.py tests/test_commit_line_evidence.py -q`：56 passed
- [x] 5.2 `backend/.venv/Scripts/python.exe -m pytest tests/test_openapi.py -q`：20 passed
- [x] 5.3 对截图中的真实快照 `1a3f1362-7210-59b8-92f7-c7f0f4d7e554` / `plugins/security-guard.ts` 运行 `build_line_evidence`：`status=supported`，15 个候选行，首行 L27 分数 0.6272
- [x] 5.4 `frontend: npm run typecheck`
- [x] 5.5 `frontend: npm run lint`（仅有既有 warning）
- [x] 5.6 前端完整测试：87 个测试文件、694 个测试全部通过
- [x] 5.7 更新 `PullRequestJourney` 的修复证据展开路径和 `LineRiskPanel` 的「行级排序」入口断言
- [x] 5.8 后端完整测试：1166 passed；唯一失败 `test_openapi_operation_inventory` 为既有口径漂移（HEAD 的 `openapi.yaml` 同样为 112 个操作，测试仍期望 102），与本次改动无关
