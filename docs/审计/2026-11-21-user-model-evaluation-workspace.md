# 用户模型试算与数据评估工作区

## 范围

- 新增普通用户模型试算：固定数据版本与模型，批量评分、101 档阈值计数、Top 10 风险归因和不可变重开。
- 扩展清洗预览：整体前后统计与逐入模字段分位桶，用户端展示指定特征前后变化。
- 扩展训练方法目录：算法适用场景、收益、代价、预处理、解释口径和参数含义，训练入口增加算法库。
- 扩展 VS Code 扩展：复制报告生成命令、命令校验测试、`0.2.0` 版本和独立 VSIX 打包工作流。

## 实现要点

- 迁移 `042_user_predictions.sql` 新建 `user_prediction_batch` 与 `user_prediction_record`，旧单条预测表保持原结构。
- 用户试算只接受本人或共享数据，只列出可用、已启用、schema 一致的共享/本人模型；他人模型返回 `MODEL_FORBIDDEN`。
- 一次最多 20,000 条提交。缺失任一入模字段时整批失败；成功批次与逐记录结果在单事务保存。
- 阈值计数固定为 0–1、步长 0.01；页面只重算指标，不重新推理。归因只保存风险最高的 10 条，失败不回滚风险。
- 清洗分位桶以清洗前字段值为边界，来源版本和派生版本分别落桶；派生描述文件保存前后统计。
- 算法说明和方法参数标签进入 `/api/v1/training-methods` 响应，OpenAPI 类型已同步。
- VS Code 向导只复制命令；独立工作流在扩展文件变更时测试并上传 VSIX。

## 验证

已通过：

- `backend`：`python -m pytest tests/test_user_predictions.py -q`，3 passed。
- `backend`：`python -m pytest tests/test_curation.py::test_preview_derive_and_compare_keep_source_unchanged -q`，1 passed。
- `frontend`：聚焦测试 5 files、117 tests passed；完整 `npm test` 68 files、581 tests passed。
- `frontend`：`npm run typecheck`、`npm run check:api-types` 通过。
- `frontend`：`npm run build` 通过；`npm run check:styles` 与 `npm run check:modules` 通过。
- `frontend`：`npm run lint` 通过，保留仓库既有的 React effect/fast-refresh 警告；新增文件未产生错误。
- `vscode-extension`：`npm test`，7 tests passed。
- `backend`：对改动文件运行 Ruff，全部通过。
- `git diff --check` 通过（仅提示 Windows 换行转换）。
- `openspec validate "add-user-model-evaluation-workspace" --strict` 通过；归档后四个变更能力的主规格 strict 校验通过。
- OpenSpec change 已归档为 `openspec/changes/archive/2026-11-21-add-user-model-evaluation-workspace/`，主规格同步 4 个新增要求、7 个修改要求。

本地受限：

- 当前执行机没有安装 `torch`，`test_catalog_api` 中依赖现场重建冻结运行的 fixture 与 `test_curation.py::test_derived_version_can_train` 无法在本机完成；这不是新增用户预测测试的失败。完整回归工作流会安装 CPU PyTorch 后运行这些用例。
- 本机未启动 VS Code 扩展宿主，未重复执行 `scripts/smoke.js`；本轮验证覆盖扩展编译、报告解析和命令生成单测，VSIX 打包由 CI 工作流验证。
- 未运行真实浏览器端到端旅程；本轮用户页面验证为组件/路由测试加类型检查与构建检查。
- 管理端数据集详情改为按需检查训练准入，浏览旧版本不再自动请求训练方法或切分预览。

## 交付边界

- 阈值指标按数据版本现有标签试算，不是冻结测试集评价，也不是线上实时缺陷率。
- 用户预测不提供行级定位；静态候选和修复建议仍只在带源码快照的 PR 工作单中展示。
- 用户导入数据没有源码快照时，不根据提交 SHA 猜测文件或行号。
