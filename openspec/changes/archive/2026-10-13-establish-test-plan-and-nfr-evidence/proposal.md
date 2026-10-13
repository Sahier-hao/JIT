# Proposal

## Why

课程要求至少选择并落实 2 项非功能需求并给出验证证据，测试设计是明确的评分点；截至 2026-10-12 的盘点，本项目 NFR 实测为 0 项、无测试计划文档。Sprint 3（第 10–14 周）定位为只做测试，而测试的分层安排与两项 NFR 的实测需要在 Sprint 1 收尾周（本周）启动：本 change 产出测试计划文档，并对现有本机链路实测「易用性/无障碍」与「性能」两项 NFR，证据按 verification-evidence 规格冻结归档。

## What Changes

- 新增 `docs/测试计划.md`：把现有 pytest、Vitest、Playwright e2e 与 `verify.ps1` 全链路脚本组织为单元/集成/系统分层计划，写明各层覆盖目标、执行方式与 Sprint 3 执行安排；约定缺陷记录规范（现象、复现条件、优先级、处理状态、关联提交）。
- 实测 NFR 易用性/无障碍：把 CRR-12 已有的键盘与焦点行为扩展为可测量检查（1280×720 与 1440×900 两视口纯键盘走完「列表→详情→加入→清单→返回」、焦点可见且关闭返回触发位置、状态不只靠颜色区分），产出两视口截图与逐项通过记录。
- 实测 NFR 性能基线：测量本机推理服务 `GET /api/review-batch` 响应与前端首屏加载（fetch → 契约校验 → 渲染），记录样本数、P95 计算方法、CPU/RAM/Node/Python 版本。只报告当前本机链路基线；NFR-01 完整协议（每种模型 200 次单条 JSON 预测、4 个 LAN 客户端、阈值判定）待在线预测接口落地后重测，本轮不宣称性能目标达标。
- 证据纪律：测量与走查输出写入运行工作区 `docs/evidence/_run/`，经显式冻结进入 `docs/evidence/establish-test-plan-and-nfr-evidence/` 并附完整性清单；不写任何已归档 change 的证据目录，不修改已有归档证据。
- 不修改产品运行行为；不新增、不修改任何主规格。

## Capabilities

### New Capabilities

（无。本 change 是文档与验证证据，没有产品行为变化，已在 `.openspec.yaml` 设置 `skip_specs: true`，不为此编造规格条目。）

### Modified Capabilities

（无。）

## Impact

- 新增文档：`docs/测试计划.md`（测试分层、覆盖目标、缺陷记录约定与 Sprint 3 安排）。
- 新增测试工具：性能基线测量脚本（`frontend/scripts/` 或 `backend/scripts/` 下，仅验证工具，不进入产品构建）；新增 e2e 键盘/焦点显式断言（独立 spec 文件，不改现有 spec），不改变产品行为；该断言随 `test:e2e` 进入 verify 全链路，链上新增检查属预期。
- 新增证据目录：`docs/evidence/establish-test-plan-and-nfr-evidence/`（冻结时产生，附清单）。
- 不改产品代码、API、依赖与主规格；不改现有测试的判据。用户访谈、缺陷管理工具选型与完整 NFR-01 协议不在本轮。
