# Design

## Context

现状与约束（动机见 proposal.md）：

- 测试资产已存在但未组织成分层计划：backend pytest 9 个文件、frontend Vitest 单元与领域测试、Playwright e2e 3 个 spec、`frontend/scripts/verify.ps1` 全链路验证。
- 易用性素材已存在：CRR-12 已规定桌面视口与键盘行为，README 记录了纯键盘链路（Tab 定位 → Enter 打开 → 详情区滚动 → Escape 关闭并返回焦点），Playwright 已有 `desktop-1280`（1280×720）与 `desktop-1440`（1440×900）两个视口 project。
- 证据机制已存在：运行工作区 `docs/evidence/_run/`（已 gitignore）、`python -m jit_baseline.cli freeze-evidence` 与 `check-evidence` 命令（evidence.py 的 `freeze`/`check`）、VEV 规格的受保护位置比对。
- 在线预测 API 尚未实现：NFR-01 的完整协议（200 次单条 JSON、4 LAN 客户端、阈值判定）无法执行，本轮只能测当前本机链路基线。

## Goals / Non-Goals

**Goals:**

- 产出一份可执行、可评审的测试计划文档，明确分层、覆盖目标与 Sprint 3 执行安排。
- 把易用性/无障碍从"已有行为"变成"可测量的检查"：逐项判据 + 两视口证据。
- 产出当前本机链路的性能基线：方法可复现、样本与 P95 计算透明、环境记录完整。

**Non-Goals:**

- 不优化任何性能问题；只测不改。发现慢点写入报告，不在本 change 修复。
- 不执行 NFR-01 完整协议与阈值判定（待在线预测 change）；不宣称性能目标达标。
- 不做真实用户走查/访谈（NFR-03 的"未参与开发者走查"留待补，不编造）。
- 不改产品运行行为、主规格与现有测试判据；缺陷管理工具的选型是团队事务，文档只给记录规范。

## Decisions

### D1. 测试计划文档的结构与位置

`docs/测试计划.md`，按四层组织：

| 层 | 现有资产 | 文档写什么 |
|---|---|---|
| 单元 | backend pytest、frontend Vitest | 覆盖目标、执行命令、与 change 的对应关系 |
| 集成 | `verify.ps1`、API 契约校验 | 全链路复验的定位与触发时机 |
| 系统 | Playwright e2e（workbench/historical/storage） | 核心端到端链路的定义与扩展点（新页面接入后） |
| 非功能 | 本 change 的两项 + Sprint 3 计划 | 判据、方法、证据形式与重测安排 |

另含缺陷记录规范（现象、复现条件、优先级、处理状态、关联提交/change）与 Sprint 3（11/16 起）执行安排表。

**替代方案**：分散写进各 README——被否，课程点名"测试计划文档"为交付物，需要单一评审入口；产品文档附录 A 引用它。

### D2. 易用性/无障碍的"可测量"定义

检查清单由 CRR-12 与产品文档 NFR-03 逐条推导，每条含判据、方法与证据形式，示例：

- 两视口无页面级横向溢出 → Playwright 检查 `scrollWidth <= clientWidth`，两 project 各跑；
- 纯键盘完成「列表→详情→加入→清单→返回」→ 按 README 已记录链路逐键走查并记录每一步焦点落点；
- 关闭详情后焦点返回触发位置 → 断言 `document.activeElement` 是原提交按钮；
- 状态不只靠颜色区分 → 断言模式徽标与错误提示有文字内容（`demo-badge` 内文本、`role="alert"` 文案）。

走查以真实历史链路为准（与现有 e2e 同环境、同服务），演示模式抽测模式切换。证据为两视口截图 + 逐项通过/失败记录（`browser-results.json` 与清单记录）。`accessibility.spec.ts` 随 `npm run test:e2e` 进入 `verify.ps1` 全链路（verify.ps1 第 79 行），因此易用性检查不是一次性手测，而是每次复验都自动重跑；verify 链上新增检查、判据变严是预期行为。

浏览器来源（实施时确定，用户确认）：官方 chromium 下载在当前网络不通（CDN 网关 400、镜像无 revision 1248），改用已安装 Edge 的 `channel: 'msedge'`（仍是 chromium 内核），`playwright.config.ts` 与测量脚本均显式声明 channel；证据记录中如实标注 channel，规格约束的是视口与键盘行为，不绑定浏览器下载来源。

**替代方案**：只贴截图——被否，截图无法证明"焦点返回触发位置"这类行为判据；清单 + 断言记录才可复核。

### D3. 性能基线测量方法

两个独立脚本，**不并入 `verify.ps1`**（verify 链要求确定性通过/失败，性能数字有波动，混入会引入假失败）：

1. `backend/scripts/perf_baseline.py`：用已锁定的 httpx 对本机 `GET /api/review-batch` 发 30 次顺序请求，逐次计时，nearest-rank P95；记录 Python 版本、CPU/RAM、服务进程信息、错误数。该接口每次 GET 实际执行 1,853 条推理，测量的是完整推理响应链路。
2. 前端首屏：Playwright 脚本对两视口各跑 10 次，记录导航到 `performance.timing` 可用节点的时间与 fetch→解析→渲染完成标记（页面加载与资源时间戳），nearest-rank P95。

原始逐次计时写入运行工作区；报告（`docs/evidence/<change>/nfr-performance.md`）写样本数、P95 计算方法（nearest-rank）、环境版本、错误数，并明示：这是本机链路基线，不是 NFR-01 阈值判定。

**替代方案**：用 curl/计时器手测——被否，样本不足且无法记录渲染阶段；脚本可复现是 PDB/VEV 一致的可追踪要求。

注：D2 的易用性断言会随 `test:e2e` 进入 verify 链（链上新增检查属预期）；性能脚本因数字波动保持独立，不并入 verify.ps1。

### D4. 证据与冻结流程

全部原始输出写入 `docs/evidence/_run/`（gitignore 内、可被覆盖），冻结用现有 `freeze-evidence` 命令把选定的证据文件写入 `docs/evidence/establish-test-plan-and-nfr-evidence/` 并生成完整性清单，冻结后跑 `check-evidence` 校验。测试与测量不写任何已归档 change 的证据目录；verify 链已有的受保护位置比对（VEV-06）继续适用，测量脚本遵守同一约定。

**替代方案**：直接写最终证据目录——被否，违反 VEV-01/02，正是 10-12 change 修复过的问题。

### D5. skip_specs 依据

本 change 无产品运行行为变化：新增的是文档、验证脚本与证据。CRR-12/NFR 相关行为已由现有主规格覆盖，不为凑规格条目新建能力；`.openspec.yaml` 已设 `skip_specs: true`，与 10-12 产品基线 change 同例。

## Risks / Trade-offs

- [性能基线被误读为"性能达标"] → 报告显式标注"本机链路基线，未做阈值判定"；NFR-01 完整协议与阈值留在线预测落地后的 Sprint 3 重测。
- [测量脚本写入受保护位置或已归档证据] → 输出只指向 `_run`；冻结前后跑受保护位置比对；e2e/脚本 review 时核对路径白名单。
- [键盘链路检查沦为截图] → 清单逐项判据 + 断言记录，截图只是辅助证据。
- [性能数字受本机负载影响] → 记录环境与样本原始数据；基线只作 Sprint 3 重测的对照起点，不下达标结论。
