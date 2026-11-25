## Why

训练比较与多方法解释的 PR1–PR3 已归档，剩余 PR5–PR8 分别覆盖 IDE 报告交接与真实仓库回归（PR5）以及 Sprint3 集成测试交付（PR6–PR8）。继续拆成多个 PR 会分散 API 清单、场景矩阵、联调与冻结证据，难以形成一份可复核的正式集成测试交付包；Eclipse 与 Visual Studio 目前也只有设想，没有成本与可行性结论。

## What Changes

- CI 报告交接：`pr-check-analyze` 生成的 `jit-commit-analysis-v1` 报告作为统一跨 IDE 协议；CI 只上传带仓库、提交、模型、覆盖和限制身份的报告产物，开发者下载后显式导入 VS Code。报告失败时不产生替代报告，CI 不评论 PR、不阻断合并。
- 真实仓库回归：VS Code 扩展在真实仓库中导入报告并核对仓库、提交与工作树身份；覆盖分支切换、工作树修改、文件重命名或删除、过期报告与重新生成，保留可复核截图与命令/请求记录。
- 跨 IDE 结论：给出 Eclipse 与 Visual Studio 的成本、插件 API、协议复用与风险结论；本 change 只交付可行性结论，不交付不成熟插件。
- 新增集成测试交付能力：以当前 OpenAPI 为事实来源建立 95 个业务 API 操作清单（99 个操作排除 4 个 admin 认证操作），为每个操作登记正常、边界、异常、并发/故障四类场景矩阵，并标注高风险接口、对应测试文件和覆盖缺口。
- 测试工具与框架：提供可重复的 API 清单/覆盖矩阵生成与校验工具，复用 pytest、OpenAPI 契约测试、前后端单元测试与 Playwright 隔离服务测试，输出机器可读结果。
- 交付顺序：先完成高风险接口（认证与权限、同步与取消、训练、模型登记与策略、PR 分析与报告、数据集导入、解释生成），再补齐剩余接口；前后端联调与并发/故障场景纳入同一矩阵。
- 交付证据：联调截图、AI 提示词、逐条人工复核、报告和 SHA-256 冻结清单组成一个交付包；只声明实际执行并通过的能力。

## Capabilities

### New Capabilities

- `integration-test-delivery`: 95 个业务 API 操作清单、四类场景矩阵、高风险与剩余接口覆盖、前后端联调、并发/故障验证、工具与冻结证据。

### Modified Capabilities

- `ide-report-consumption`: 增加 CI 报告交接、真实仓库回归和 Eclipse/Visual Studio 可行性结论；保持只读、身份核对和不执行报告命令的边界。

## Impact

- `vscode-extension/`：报告导入、身份核对、真实仓库回归与安装/命令证据；不自动执行分析或修改源码。
- `.github/workflows/commit-analysis.yml`、`docs/api/openapi.yaml`：报告产物交接与 API 清单事实来源；不新增合并门禁。
- `backend/scripts/`、`backend/tests/`、`frontend/e2e/`：API 清单、场景矩阵、联调与并发/故障测试。
- `docs/`：正式集成测试报告、Eclipse/Visual Studio 可行性结论和冻结证据。
- 不改变模型风险算法、默认模型、训练算法、项目分析口径或 PR 合并策略。
