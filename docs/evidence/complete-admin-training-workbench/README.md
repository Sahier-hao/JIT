# 管理员训练工作区与大型仓库闭环证据

本目录冻结 `complete-admin-training-workbench` 的统一验证结果。验证时间为 2026-10-30。

## 验证结论

- 后端：`628 passed, 1 skipped`。
- 前端：39 个测试文件、`317 passed`；typecheck、Lint、生产构建通过。
- 默认 Playwright：`14 passed`，覆盖 1280、1440 和 390px。
- 大型仓库 Playwright：`1 passed, 1 skipped`。
- OpenSpec 严格校验：26 项通过。
- 验证脚本退出码为 0，受保护文件未变化。

## 真实大型仓库闭环

确定性夹具包含 300 个提交，实际采集并登记为 `kamei14-git-v1` 数据集：

- 纳入 300 条、正例 140 条，14 个专家字段均无缺失。
- 自动训练形成 210 条训练、45 条验证和 45 条测试记录；测试正例 13 条。
- 现成模型、自动训练和强制训练三条项目分析均完成。
- 自动训练模型来源为 `repository-sync-f4be2332`，管理员强制训练模型来源为 `training-task-5fe1c487`。
- AP、ROC-AUC、Recall@20%LOC、Popt、F1 和 IFA 均来自对应模型运行摘要，并保留数据版本与运行身份。

具体统计见 `large-repository-dataset.json`，模型指标与谱系见 `model-metrics.json`。

## 文件

- `verification.json`、`verification.log`：完整验证摘要和日志。
- `unit-results.json`：前端单元测试结果。
- `browser-results.json`：默认 Playwright 结果。
- `admin-training-browser-results.json`：大型仓库独立 Playwright 结果。
- `screenshots/`：1280、1440 和 390px 管理训练任务详情截图。

原始大型仓库、CSV、SQLite 数据库和模型二进制不在冻结范围内。
