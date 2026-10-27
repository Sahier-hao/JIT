# Design

## Context

动机见 [proposal](proposal.md)；行为约定见 [multi-dataset-evaluation](specs/multi-dataset-evaluation/spec.md)。

现有可复用面：

- `artifacts.build_run(source_dir, output, schema=None, algorithm=None, metric_set=None, dataset_manifest=None, holdout=None)`：给出 `dataset_manifest` 时读取数据集描述文件、校验 CSV 的 SHA-256、按描述里的 schema 与 cohort 训练；每个运行已经有自己的 manifest 与运行身份。
- `algorithms.ALGORITHMS` 有 9 个方法（5 经典 + 4 深度）；`metrics.METRIC_SETS` 有 v1 与 v2（v2 含 Popt／IFA）。
- `artifacts.compare_methods` 只能在相同 datasetVersion、schema、阈值、指标集与测试成员下声明可直接排名。
- 数据集描述文件带 `dataset`、`version`、`schemaName`、`quality`、`timeRange`；Git 采集的数据集另有 `collection`（含 `szz.rule = szz-simple-v1` 与两条限制）。
- 现有项目分析对比明确拒绝跨项目；本 change 不复用它，而是新建独立的套件/报告路径。

## Goals / Non-Goals

**Goals:**

- 一个命令把现有方法套件跑到一个已登记数据集上，产出可追溯的逐方法运行。
- 一份按项目分组的报告，能在同一页里看各项目的实测结果，同时不误导成跨项目排名。

**Non-Goals:**

- 不做训练 A → 测试 B 的迁移评估。
- 不做代码语义模型、不做自动择优、不改服务与前端。
- 不改变模型注册表、运行身份与既有比较规则。

## Decisions

### D1. 套件是 `build_run` 的编排层，不引入第二条训练路径

套件逐方法调用既有 `build_run`（同一 dataset manifest、同一 schema、同一指标集），因此运行身份、产物校验、标签规则、时间切分与指标结果全部沿用既有契约。套件只负责"选哪些方法、放哪里、记录什么"。

**备选与否决理由**：另写一条批量训练路径——会复制训练/校验逻辑，且容易与单方法运行产生口径漂移。

### D2. 套件目录、身份与记录

套件输出根目录 `artifacts/suites/<dataset>-<version>/`，每个方法一个子目录；套件自身写 `suite.json`，至少记录：

- 数据集描述文件路径与 SHA-256、dataset、version、schemaName；
- 指标集与参与方法列表；
- 每个方法的 `runId`、`status`、失败时的 `code`/`message`；
- 训练代码版本与环境摘要（可引用各运行 manifest，不重复大字段）。

套件目录已存在时拒绝覆盖，需显式换名或删旧目录。

### D3. 失败隔离

单个方法失败（不收敛、依赖缺失、样本不足）时，套件捕获领域错误，记录 `failed + code + message` 并继续下一个方法。`suite.json` 的整体状态为 `complete`（全部成功）或 `partial`（至少一个失败），不把部分成功写成全部成功。

### D4. 跨项目报告：按项目分组，跨项目永不可排名

报告结构：

```
projects: [
  {
    dataset, version, datasetVersion, schema,
    labelSemantics, limitations,
    methods: [{method, runId, metrics, testCount, trainingSeconds}],
    withinProject: {directlyRankable, reasons}
  }, ...
]
crossProject: {directlyRankable: false, reasons: [...]}
```

- 项目内比较调用既有 `compare_methods` 的判定逻辑（同一 datasetVersion/schema/阈值/指标集/测试成员）。
- 跨项目固定 `directlyRankable: false`；原因逐项列出：数据集版本不同、测试成员不同、schema 可能不同、标签语义不同、指标集可能不同。
- 报告不计算跨项目排名或"最优方法"，也不把正例比例当作可比缺陷率。

### D5. 标签语义由数据集描述文件推导，并原样披露

- `schemaName == "kamei14-git-v1"`（或描述文件含 `collection.kind == "git-repository"`）：标签语义为"简化 SZZ（`collection.szz.rule`）"，并带上 `collection` 中的限制文本（提交级聚合、非完整 SZZ）。
- 其余数据集（OpenStack 系）：标签语义为"发布者 `bugcount > 0`，零/空表示未观测到缺陷引入"。
- 报告保留原始 `collection.kind`／`szz.rule` 供核对，不只写一句概括。

### D6. 套件默认指标集为 v2

套件是新入口，默认 `metric-set-v2`（含 Popt／IFA），允许显式覆盖；同一份跨项目报告里的套件必须使用同一指标集，否则列为不可比原因。单方法 `run` 的默认仍是 v1，保持既有行为不变。

### D7. 范围边界

只做 CLI 编排与 JSON 报告；不做前端展示、不改服务、不改模型注册表、不写回已归档证据。

## Risks / Trade-offs

- [跨项目结果被误读成排名] → 报告强制 `directlyRankable: false` 与差异项，并禁止跨项目"最优"字段。
- [9 个方法 × 多个数据集耗时长（FT-Transformer 单次约 3 分钟）] → 允许方法子集；套件记录耗时；失败不阻塞。
- [第二数据集样本量不足，训练/测试缺少两类标签] → 按既有契约失败并记录，不调整切分或补样本。
- [不同数据集的标签语义天然不同] → D5 强制披露；不把简化 SZZ 与发布者标签混算。
- [深度方法随机性] → 沿用各方法声明的复现容差；套件不宣称逐字节一致。
- [套件目录重复执行] → 已存在即拒绝，换名形成新套件。

## Migration Plan

1. 实现套件编排与 `suite.json`（复用 `build_run`）。
2. 实现跨项目报告（复用 `compare_methods` 的项目内判定）。
3. 准备第二数据集（真实仓库采集并登记），对 OpenStack 与该数据集各跑 9 个方法。
4. 生成跨项目报告、更新 README/团队分工、冻结证据。
5. 回退方式：删除套件命令与产物目录不影响既有单方法运行；报告是独立文件。

## Open Questions

- 是否在后续把套件结果接入前端（本 change 不做）。
- 是否需要跨项目的"方法排序一致性"指标（如 rank 相关性）——本轮只并列，不做。
