## Why

本周目标是"多数据集训练与效果评估 + 跨项目比较"。数据侧已经具备条件：`kamei14-git-v1` 提供完整 14 维（含 `lt`、`fix`、`rexp`）与简化 SZZ 标签，`collect-repository` 能把真实仓库采集并登记，`dataset-registry` 支持多版本与 schema 绑定；模型侧也有 9 个方法、`metric-set-v2`（Popt／IFA）和同数据集内的 `compare-methods`。

但还缺两件事：

1. **在某个新数据集上整批重训现有方法**——同步流程一次只训练或选择一个模型，没有"对一个数据集跑完整方法套件"的入口；
2. **跨项目比较**——`compare-methods` 要求同一 `datasetVersion`，项目历史分析对比明确拒绝跨项目。

没有这两者，本周的"多数据集 + 跨项目比较"只能靠手工拼日志。

## What Changes

- 新增 **suite 批量运行**：给定一个已登记的数据集描述文件，默认对 9 个现有方法各生成独立运行（可指定子集与指标集，默认 `metric-set-v2`），记录 datasetVersion、schema、metricSet、method→runId 以及每个失败项。
- 新增**跨项目报告**：按项目分组列出各方法的指标（含 Popt／IFA）、样本与测试成员、schema、**标签语义**与限制；跨项目一律声明 `directlyRankable: false` 并列出差异项；项目内比较沿用既有规则。
- 失败隔离：单个方法训练失败时记录原因并继续其余方法；失败方法 MUST NOT 计入可用方法。
- 标签语义必须随报告披露：发布者 `bugcount > 0` 与简化 SZZ `szz-simple-v1` 不能混为一谈；简化 SZZ 的两条限制（提交级聚合、非完整 SZZ）必须可见。
- 不做：训练 A → 测试 B 的迁移评估、代码语义模型、自动择优、服务与前端改动。

## Capabilities

### New Capabilities

- `multi-dataset-evaluation`: 对已登记数据集批量训练现有方法套件，并按项目分组生成跨项目比较报告，明确不可比原因、标签语义与失败记录。

## Impact

- 后端代码：新增套件编排与跨项目报告模块、CLI 入口与测试；复用现有 `build_run`、`compare_methods`、数据集描述文件与指标集。
- 数据：需要一个第二数据集（真实采集仓库）与其描述文件；OpenStack 数据集保持不变。
- 文档：`backend/README.md` 增加命令说明；`docs/团队分工.md` 记录 A 席位本周的多数据集/跨项目进展。
- 不影响：模型注册表、运行身份与校验口径、服务与前端、既有运行与已归档证据。
