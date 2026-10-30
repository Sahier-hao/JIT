# Tasks

## 1. 分析来源、归属与迁移

- [x] 1.1 在 `catalog_storage.py` 追加迁移 013–015 并更新版本；验证：`tests/test_catalog_storage.py` 覆盖 v12 升级、外键、旧引用、迁移失败回滚与重复初始化。
- [x] 1.2 `repository_sync` 保存 `source_kind`、`origin`、`source_snapshot_id`、`feature_schema_version`、`distribution_rule`，并让 `SyncStorage.create/complete` 原子写入；验证：`tests/test_pr_review.py`、`tests/test_sync_control.py` 通过。
- [x] 1.3 PR 任务归属基项目、保留 fork 代码来源、不为 fork 建项目，且只有分支任务推进项目 `latest/default` 与当前结果；验证：fork、同 HEAD 不同 base、用途隔离用例通过。
- [x] 1.4 迁移时冻结旧 PR 评分真实关联，读取时标注兼容限制，新任务不写旧绑定；验证：`test_pr_review.py` 的 legacy 与迁移后新关联用例通过。
- [x] 1.5 显式初始化旧库前生成一致的 SQLite 备份，备份失败阻止升级；验证：`test_catalog_storage.py` 的备份成功与失败用例通过。

## 2. 项目工作台与导航

- [x] 2.1 默认入口改为项目列表，项目页提供概览（仓库信息）、分析（当前结果与记录双栏，含「分析结果 / 风险趋势」页内切换）、PR 审查三个子视图；验证：`ProjectPage.test.tsx`、`workspaceRoutes.test.ts` 与 E2E 默认路由断言通过。
- [x] 2.2 项目子视图、固定 PR 快照与趋势 viewId 写入地址并可刷新恢复，旧 reviews、PR、分析地址继续映射；验证：路由测试与 E2E 重开旧视图断言通过。
- [x] 2.3 项目 PR 清单读取持久缓存、支持开放/历史分页与显式刷新，选择 PR 沿用同一工作单；验证：`ProjectPullRequests` 组件测试与 E2E PR 清单步骤通过。
- [x] 2.4 分析记录区分分支与 PR 来源：PR 记录只打开固定快照，不提供分支参数重试或设为当前结果；旧当前 PR 指针显示来源说明；验证：`ProjectPage.test.tsx` 回归与 E2E 断言通过。
- [x] 2.5 将「我的审查」并入项目列表标签，移除顶部独立入口、URL 接入和自动轮询；验证：`ProjectsPage.test.tsx`、`PullRequestJourney.test.tsx` 与浏览器标签切换通过。

## 3. 项目风险趋势

- [x] 3.1 实现 `ProjectTrendService` 的口径列表、视图创建/复用、读取与提交分页；验证：`tests/test_project_trends.py` 通过。
- [x] 3.2 固定 manifest 保存查询、口径、来源 syncId 与内容指纹，保存并恢复 `mode`，新来源只提示、显式刷新生成新视图；验证：幂等、mode、hasNewSources 用例与 E2E 刷新步骤通过。
- [x] 3.3 同 SHA 去重、时间/特征/分数冲突整组拒绝、来源删除或指纹变化不可用，返回 409；验证：冲突、失效、项目隔离用例通过。
- [x] 3.4 前端趋势图分平均模型风险分与高分占比两张单轴折线、等价表格、键盘与触屏、固定来源下钻，未知桶与最小样本不画 0；提交量保留在汇总与表格；验证：组件测试、调色板脚本与桌面/手机 E2E 通过。

## 4. PR 后台自动分析

- [x] 4.1 新增 `PullRequestUpdates` 与 015 表，接入应用 lifespan，使用独立单线程检查 executor；验证：`tests/test_pr_updates.py` 与生命周期用例通过。
- [x] 4.2 跟踪配置支持显式启用、固定兼容模型、二次确认、间隔范围与检查中禁止换模型；验证：配置、首次启用、非 GitHub 拒绝用例通过。
- [x] 4.3 实现意图去重、单 PR 单在途与最新待处理目标、持久游标轮转、每项目/全局队列上限、600 秒租约；验证：队列、轮转、复用、并发用例通过。
- [x] 4.4 实现临时失败 1/5/15 分钟重试、限流等待、模型失效终止、暂停不取消任务、取消/中断不复活与重启恢复；验证：重试、限流、取消、重启用例通过。

## 5. 站内提醒

- [x] 5.1 事件覆盖发现、版本更新、开放/关闭/合并、分析就绪与失败，使用幂等键、固定引用和 `isCurrent`；验证：`tests/test_pr_updates.py` 事件用例通过。
- [x] 5.2 前端提醒列表本地已读、查看固定来源只读预览、不自动创建或改写私人工作，覆盖不完整明确提示；验证：`ProjectActivity` 测试与 E2E 已读/固定来源步骤通过。

## 6. 契约、文档与联合验收

- [x] 6.1 更新 `docs/api/openapi.yaml` 与 `api_errors.managed_path`，覆盖 11 条路径、12 个公开操作、来源字段、`bindingKind/bindingLimitations`、`viewContext` 与趋势 `mode`；验证：`tests/test_openapi.py` 通过。
- [x] 6.2 更新 `docs/当前产品.md`、`docs/PR审查使用指南.md`、`backend/README.md`、产品需求/设计/测试计划，写明 013–015、自动备份与 PR 跟踪默认关闭；验证：文档内容与本轮实际行为一致。
- [x] 6.3 运行后端全量 600 项、前端 42 文件 329 项、类型检查/lint/构建与桌面/手机隔离 E2E；验证：各命令退出码与计数记录在 `docs/审计/2026-10-29-project-continuous-review.md`。
- [x] 6.4 编写验收记录与结构化证据 `docs/evidence/project-continuous-review-20261029.json`，注明受控 GitHub 响应、真实 Git/模型执行与未验证范围；验证：文件存在且与实际运行结果一致。

## 7. 仓库概览与只提醒

- [x] 7.1 新建项目只登记，不自动分析或开启提醒；项目页拆为概览（仓库信息）、分析与 PR 审查三子视图（风险趋势在分析页内切换）；验证：`ProjectPage.test.tsx`、`ProjectsPage.test.tsx`、`NewProjectForm.test.tsx` 与 E2E 默认落点通过。
- [x] 7.2 新增仓库概览接口、`repository_overview` 缓存与迁移 016；验证：`test_repository_overview.py` 覆盖公开元数据、语言、活跃度、缓存、限流与非 GitHub。
- [x] 7.3 前端概览展示元数据、活跃度柱图、语言条、最近提交、等价表格与限流/缓存状态；验证：项目页概览测试与浏览器桌面/手机检查通过。
- [x] 7.4 分支检查改为只提醒：写 `branch-updated` 事件、不创建分析、同一 HEAD 去重、分析完成后不再待处理；验证：`test_repository_updates.py` 与前端 `RepositoryUpdates.test.tsx` 通过。
- [x] 7.5 更新产品/指南/设计/测试计划、验收记录与 OpenSpec delta；验证：`openspec validate --strict` 与实际文档一致。
- [x] 7.6 PR 清单先打开只读详情，只有「开始审查」创建个人工作单；已有工作单显示继续审查；验证：`ProjectPRJourney.test.tsx`、桌面/手机 E2E 与预览截图通过。

## 8. 审查优先级与提交文件映射

- [x] 8.1 迁移 017 新增 `repository_commit.file_paths_json`，采集与任务完成时保存提交触及的文件路径；验证：`tests/test_catalog_storage.py` 覆盖 v16→v17，`tests/test_sync_control.py` 与 `tests/test_pr_review.py` 覆盖写入与读取。
- [x] 8.2 PR 读取返回每个提交的文件、增删行与文件数，以及按触及提交最高分排序的 `fileRisks`；旧任务缺少映射时返回空文件列表并标注限制；验证：`tests/test_pr_review.py` 的新关联与旧关联用例。
- [x] 8.3 项目 PR 清单显示最高提交分与评分覆盖数，支持当前页按更新或按风险排序；未分析 PR 排在后面并明确不能视为低风险；验证：`ProjectPullRequests.test.tsx` 与 E2E PR 清单步骤。
- [x] 8.4 只读详情与工作单先展示提交风险排序，选择提交只显示其触及文件，文件默认按风险排序并可切回路径；验证：`ProjectPRJourney.test.tsx`、`PullRequestJourney.test.tsx`。
- [x] 8.5 进入未指定 viewId 的风险趋势时按当前口径自动准备固定视图并写回地址；验证：`ProjectTrends.test.tsx` 与旧 `/trends` 地址检查。

## Workflow follow-up

- 用户复核后归档本变更（`openspec archive`），不自动执行。
- 提交、推送与 PR 由用户决定，本轮未执行。
- 真实本机数据库升级与部署切换另行安排。
