# 集成测试交付报告

- change：`deliver-ide-handoff-and-integration-tests`
- 提交：`bf2f42eaec0bce3fe046a8392412c68c07e4bb7c`（`feature/ide-handoff-and-integration-tests`）
- 生成时间：2026-11-25T04:57:28.075878+00:00
- 机器检查：通过
- 人工复核：完成
- 不适用格复核：完成

## 汇总

| 项目 | 结果 |
| --- | --- |
| OpenAPI 操作总数 | 99 |
| 业务 API 清单 | 95 |
| admin 认证单独排除 | 4 |
| 高风险业务操作 | 73 |
| 矩阵操作数 | 95 |
| 高风险四类全部实际通过 | 是 |
| 矩阵测试 | 90 passed / 0 failed / 0 skipped |
| 后端完整回归 | 1067 passed / 0 failed / 1 skipped |
| 前端单测 | 609/609 passed / 0 failed |
| VS Code 扩展 | 8 passed / 0 failed |
| 真实 E2E | 1 passed / 0 unexpected |
| 报告交接校验 | 通过 |
| AI 来源测试 | 15 项；复核 completed |

## 不适用格

- `GET /api/v1/commits`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/commits/{commitId}`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/project-events`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories/{repositoryId}`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories/{repositoryId}/commits`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories/{repositoryId}/commits/{commitId}`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories/{repositoryId}/events`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories/{repositoryId}/overview`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）
- `GET /api/v1/repositories/{repositoryId}/summary`：boundary、concurrency；只读或契约级接口；无共享可变写入，不适用并发。；只读或契约级接口；输入与响应边界由 OpenAPI 契约校验，无独立可变状态。；复核：徐卓航（2026-11-25）

## 已知限制

- VS Code 宿主冒烟已通过并截取 Extension Development Host 窗口；截图展示工作区与本机 VS Code 1.147.0，JIT 报告树未在截图中展开（报告导入、身份、命令由宿主冒烟断言验证）。
- Eclipse 与 Visual Studio 只交付可行性结论，未交付插件。
- 只读 GET 的边界与并发场景使用人工复核的不适用理由，详见 notApplicable。

## 证据索引

- inventory: `api-inventory.json`
- matrix: `scenario-matrix.json`
- matrixResults: `matrix-results.json`
- backendJunit: `backend-full-junit.xml`
- frontendUnit: `frontend-unit-results.json`
- browser: `browser-results.json`
- handoffValidation: `handoff-validation.json`
- vscodeHostSmoke: `smoke-host.log`
- vscodeScreenshotSmoke: `smoke-screenshot.log`
- vscodeHostScreenshot: `screenshots/vscode-extension-host.png`
