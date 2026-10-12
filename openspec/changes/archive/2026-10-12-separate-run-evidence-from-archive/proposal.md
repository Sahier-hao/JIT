# Proposal

## Why

验证证据目录同时承担了两个互斥角色：开发期它是"可覆盖的最新运行输出"，归档后它是"不可变的那次运行快照"。当前 9 处测试硬编码写入**已归档** change 的证据目录，每次运行都覆盖归档证据；本次探索中已实际发生（`http-lifecycle.json` 的端口记录被改写），并由 git 恢复。归档证据一旦可被后续运行改写，"归档时规格与产品一致"的结论就没有可核验的载体。

## What Changes

- 引入**运行工作区** `docs/evidence/_run/`：测试与验证运行的输出只写这里，可自由覆盖，不提交版本控制。
- **BREAKING** 把 9 处硬编码的证据路径改为运行工作区（后端 1 处、前端 8 处），路径不再包含 change 名。
- 归档证据改为**只由显式冻结产生**：冻结时从运行工作区生成快照写入 `docs/evidence/<change>/`，并同时产出该快照的 SHA256 完整性清单；冻结之后不再被任何测试写入。
- 保留现有的测试间夹具传递：`runtime-context-fixture-batch.json` 由后端 TCP 生命周期检查产生、由前端浏览器检查消费，该通道一并迁入运行工作区并保持稳定。
- 移除 `frontend/scripts/verify.ps1` 中对已归档 change 的 `openspec validate`（主规格已在同一脚本中按 `--strict` 校验，重复且会随时间漂移）。
- 让等待服务就绪的检查容忍启动窗口期的瞬时未就绪（已接受连接但响应正文为空或不可解析），真正超时才失败并指出目标：该竞态实测约每 8～12 次完整运行出现一次，会污染运行记录并让即将启用的 CI 随机变红。
- **BREAKING** 把 `verify.ps1` 依赖的手工哈希快照 `protected-files.json` 换成运行前后的自动比对，受保护位置取自已归档 change 的证据目录、`openspec/specs`、`openspec/changes/archive`、`openspec/config.yaml` 与前端静态演示数据；删除该快照及其校验输出，验证不再读取任何需要人工维护的清单（理由见 design D4：该快照已因 10-11 的合法规格同步而过期）。
- 更新引用证据路径的说明文档。

**本轮已确认边界**：只改输出的**位置**、冻结方式与验证的比较基准，不改变任何测试的断言语义、不改变已验证的行为。两个已归档 change 的证据内容保持原样，不重写、不搬迁——**唯一例外**是删除已废的 `protected-files.json` 与 `protected-files-check.json`（旧手工快照机制的输入与输出）。冻结由人显式触发，不自动执行。不引入新工具或依赖。

**后续范围**：证据条目与规格场景的自动映射、按 capability 而非 change 索引证据、多次运行历史的保留策略。这些都需要先确定取舍，不在本轮。

## Capabilities

### New Capabilities

- `verification-evidence`: 验证运行输出的隔离、归档证据的不可变性，以及冻结时产出可校验的完整性清单，使"归档的证据确实来自被冻结的那次运行"成为可检查的约定。

### Modified Capabilities

（无。本 change 不改变 `commit-risk-review` 与 `public-data-baseline` 的任何要求；归档证据的写入方式是实现细节，两处主规格的行为不变。）

## Impact

- **后端**：`backend/tests/test_http_lifecycle.py` 的证据写入路径。
- **前端**：`frontend/vitest.config.ts`、`frontend/playwright.config.ts`、`frontend/scripts/verify.ps1`（3 处）、`frontend/e2e/historical.spec.ts`、`frontend/e2e/storage.spec.ts`、`frontend/e2e/workbench.spec.ts`。
- **配置**：`.gitignore` 增加运行工作区；运行工作区不进入版本控制，冻结后的快照进入版本控制（维持现状）。
- **文档**：`frontend/README.md` 中写明的证据输出位置。
- **不改变**：产品运行时行为、HTTP 接口、数据契约、模型与指标口径、任何现有主规格要求。
- 本轮只有规划。后续 apply 才移动输出位置、增加冻结步骤、更新文档并产生验证证据；不修改主规格或已归档 change 的证据。
