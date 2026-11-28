# 证据索引与结果边界

本目录记录 2026-11-28 的缺陷预测、评估交接、项目自动预测与 VS Code 扩展交付证据。测试使用隔离目录库、临时目录、独立端口和临时 Git 仓库；没有使用本机主库做写入测试。

## 已通过

- 后端受影响测试：`125 passed`；命令与警告见 `backend-tests.log`。
- 前端完整 Vitest：87 个测试文件、`694 passed`；见 `frontend-tests.log`。
- 前端 `typecheck`、`check:api-types`、`lint`、`check:styles`、`check:modules`、`build` 均以退出码 0 完成；分别见 `frontend-typecheck.log`、`frontend-api-types.log`、`frontend-lint.log`、`frontend-styles.log`、`frontend-modules.log`、`frontend-build.log`。
- 扩展单测：`25 passed`；见 `extension-tests.log`。
- 扩展打包：`jit-commit-analysis-0.4.0.vsix`，23 个文件、41.06 KB；见 `extension-package.log`。
- 项目本地扩展目录安装版本：`local.jit-commit-analysis@0.4.0`；见 `extension-install.log` 与 `extension-installed-version.log`。
- 隔离 Playwright 缺陷预测旅程：1 个测试通过，覆盖单条/批量同分、无标签 CSV、字段缺失错误、刷新重开、冻结分区评估交接；截图见 `prediction-result-1440.png`、`prediction-unlabeled-1440.png`、`prediction-evaluation-1440.png`、`prediction-evaluation-390.png`，请求/服务日志见 `prediction-e2e.log`。
- OpenAPI 路径检查通过 155 个代码操作；见 `openapi-paths.log`。

## 外部阻塞

- 扩展宿主冒烟：本机 `D:\develop\Microsoft VS Code\661626d0e7` 的 Windows ACL 不允许 Electron sandbox token 读取，进程在扩展加载前退出。原文和命令见 `extension-host-smoke.log`；没有把该尝试写成宿主通过。
- 真实 GitHub PR 演练：当前环境无 `GITHUB_TOKEN`/`GH_TOKEN`，`gh` 默认账户 token 无效，沙箱网络访问 `api.github.com` 返回不可达；审批代理当时也不可用。见 `github-pr-drill-blocker.log`。可复现命令见对应审计文档。

## 还原与复现

- 隔离预测环境：`frontend` 下设置 `JIT_FRONTEND_PORT=18825`、`JIT_SERVICE_PORT=18824`、`JIT_E2E_PREDICTION_MODE=1`，运行 `npx playwright test --project=predictions --reporter=line --workers=1`。
- Playwright 1.64 在本机 Windows 上测试体结束后没有自动退出托管的 Uvicorn/Vite 进程；只终止本环境下端口 `18824/18825` 后，runner 返回 `1 passed (3.8m)`。这不是产品请求失败，截图和页面旅程已在测试体内完成。
- 扩展 CLI 证据：`ide-cli-e2e-report.json`、`ide-cli-e2e-summary.json`、`ide-cli-e2e.log`。
- 模型列表证据：`pr-check-models.json`。
