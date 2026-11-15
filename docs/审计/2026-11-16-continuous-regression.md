# 持续回归工作流验收

日期：2026-11-16。实施范围：OpenSpec change `add-continuous-regression`。工作流独立于模型风险报告，不改分支保护、不评论 PR、不部署。

## 1. 实现范围

- 新增 `.github/workflows/regression.yml`：
  - PR 创建/更新/重开与 main 推送运行关键层；同一 PR 新提交可取消旧运行，定期完整层使用独立并发组。
  - 每日 UTC 19:00 与 `workflow_dispatch` 运行完整层：全部后端测试、完整前端检查、扩展测试、模型包恢复与项目分析到 PR 续审两个专用浏览器旅程。
  - 只读 `contents: read` 权限，不使用特权事件、部署、PR 评论或分支保护修改。
- `backend/scripts/regression_scope.py` 显式维护后端与浏览器清单；空清单、缺失文件或完整层缺浏览器配置直接失败。关键层排除两个依赖开发机历史状态的用例，并在清单输出中列出。
- `backend/scripts/regression_environment.py` 在一次性运行根准备：
  - 缺少公开 OpenStack 数据时按配置 SHA-256 下载校验；
  - 缺失时构建 `artifacts/baseline`、隔离基线与 `artifacts/reproduction`；
  - 校验 `model-packages/*.zip` 及 `.sha256`；
  - 创建 `databases/artifacts/output/logs`，不读取个人 SQLite、未跟踪数据或已启动服务。
- 前端基础 Playwright 配置支持 `JIT_PYTHON`；新增 `playwright.regression-pr.config.ts` 与 `e2e/pr-account-continuation.spec.ts`，用真实隔离服务走通注册、创建/续审、作者版本更新、双账户隔离。预览服务支持 `JIT_PREVIEW_BASELINE` 指向一次性基线。
- 测试步骤不使用 `continue-on-error`；JUnit、前端/扩展日志、浏览器截图与 trace 使用 `if: always()` 上传。

## 2. 本地执行结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 关键后端 | `regression_scope.py --layer key` | 316 passed，2 deselected，0 skipped/failed，约 5 分 36 秒 |
| 完整后端 | `pytest tests` | 883 passed，0 failed/skipped，约 13 分 14 秒 |
| 前端 | `npm run typecheck`、`npm test`、`npm run build` | 55 个文件、399 项通过；构建成功 |
| 扩展 | `npm test` | 5 项通过 |
| 模型包恢复浏览器 | `playwright.model-package.config.ts` | 1 passed，1 skipped（桌面 1440 复用同一隔离状态的既有跳过） |
| 账户续审浏览器 | `playwright.regression-pr.config.ts` | 1 passed，13.9 秒 |

失败状态验证：在干净检出注入一个失败测试并调用 `regression_scope.run_pytest`，返回值为 1，说明脚本把 pytest 非零状态传出，不被空清单或后续步骤掩盖。

端口与服务失败：占用 18860 后运行浏览器配置，Playwright 明确报“端口已使用”且未结束占用进程；把 `JIT_PREVIEW_BASELINE` 指向不存在路径时，服务启动失败并保留准备日志，未静默跳过旅程。

## 3. 干净检出验证

从提交 `codex/continuous-regression` 克隆到独立目录，检出中没有未跟踪的 OpenStack 数据、个人数据库或开发机运行产物：

- 环境准备成功下载三份固定公开来源并校验哈希，构建 `baseline`、隔离基线与 `reproduction`，校验两个模型包。
- 关键层在干净检出运行：316 passed，2 deselected，0 skipped/failed，约 4 分 31 秒。
- 干净检出暴露出两个原有测试依赖：历史 baseline 缺少新诊断的语义、开发机真实目录库快照。二者已从关键层显式排除并记录原因，而不是改成静默 skip；完整层仍保留全部后端文件，其条件跳过会显示原因。

## 4. 完整层

- 完整后端：883 passed，0 failed/skipped，约 13 分 14 秒。
- 完整前端与扩展：同上表。
- 两个专用浏览器旅程：同上表。
- 输出位于 `docs/evidence/_run/`（每次运行覆盖的工作区，不属于归档证据）与一次性运行根；测试前后模型包哈希保持一致，未修改正式数据或归档文件。

## 5. 远端与平台边界

- 新工作流尚未进入默认分支，GitHub 不会在 PR 事件中运行来自未合并分支的新工作流；首次真实 PR 关键回归、首次手动完整回归和后续定期运行均为合入后 follow-up，未写成远端通过。
- 仅验证 Windows runner 与 Edge；未执行 Linux/macOS 矩阵。
- fork PR 实际触发未验证；配置使用普通 `pull_request`、只读权限和无密钥依赖，保留该边界。
- 未修改分支保护、合并策略或部署；模型风险报告工作流保持不变。

## 6. 未完成项

- 远端首次运行与定期运行依赖工作流合入默认分支，见 Workflow follow-up。
- fork 实际触发、更多平台与实际 runner 耗时需在远端观察后补充。
