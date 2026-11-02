# 实验模型登记证据

本证据对应 `register-promotable-experiment-models`，采集于 2026-11-02。

## 文件

| 文件 | 内容 |
|---|---|
| `experiment-runs.json` | 本机真实产物根的实验运行快照；49 个唯一运行身份、重复位置合并、2 个报告型结果 |
| `promotion-results.json` | 隔离目录库中的真实 HTTP 登记结果；空目录单条登记成功，混合批量得到 `failed` 与 `registered` 两项结果 |
| `models-readiness.json` | 本机目录库迁移 19、9 个 `ready` 标准模型、唯一默认及仓库分析兼容性 |
| `verification.json` | 完整验收的 12 项检查，全部退出码为 0 |
| `verification.log` | 完整后端、前端、浏览器与 OpenSpec 命令输出 |
| `unit-results.json` | 前端 Vitest 结果；40 个文件、325 项通过 |
| `browser-results.json` | 默认 Playwright；14 项通过 |
| `admin-training-browser-results.json` | 大型仓库训练闭环；1 项通过、1 项按项目条件跳过 |
| `experiment-model-browser-results.json` | 实验登记闭环；1 项通过、1 项按项目条件跳过 |
| `screenshots/admin-experiments-{1280,1440,390}.png` | 实验运行页面在三个目标视口的截图 |

## 关键结果

- 本机目录库有 9 个 `ready` 模型和 1 个默认模型，迁移版本为 19。
- 隔离空目录库登记前没有任何服务模型；登记一条兼容运行后，用户仓库模型选择可读取同一模型身份。
- 混合批量登记中，损坏的决策树产物逐项失败，离线 JIT-Fine 基准独立登记成功，成功项未被失败项回滚。
- 离线基准登记后 `repositoryPredictionSupported` 仍为 `false`，不会成为用户仓库分析的可选模型。
- `multi-project-report.json` 只作为不可登记报告出现，不生成实验运行候选。
- 完整验收覆盖后端 `632 passed, 1 skipped`、前端 `325 passed`、typecheck、lint、build、三套 Playwright 和 OpenSpec strict。

隔离证据使用的数据库与模型副本位于系统临时目录，不进入本目录或提交；本机实验清单和模型就绪状态只描述当前产物，不宣称离线基准或报告型结果可直接用于用户分析。
