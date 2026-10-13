## Why

A 席位最关键的两块工作——把 6 维特征补齐到完整 Kamei14、把单个逻辑回归扩成多方法——在开工前卡在同一个问题上：**同一个概念在两份团队文档里有两套定义，验收标准无法确定**。

1. **特征口径冲突**。`docs/团队分工.md` 第 2 节 A-1 把补齐目标写成 `ndev, age, nuc, exp, rexp, sexp, arexp, asexp`（缺 `lt`、`fix`，多 `arexp`、`asexp`），并把数据来源写成"提交历史聚合／路径聚类"（团队已决定不自建 Git 采集管线）；而 `docs/产品设计文档.md` §5.1.2 与 `docs/api/openapi.yaml` 的 `Kamei14Features` 用的是 Kamei TSE2013 的 14 项（含 `lt`、`fix`）。两份都自称"完整 Kamei14"，字段差 4 个。
2. **模型口径冲突**。`docs/团队分工.md` 第 2 节 A-2 要求深度方法为"MLP、LSTM 或 GRU、一维 CNN、Transformer 变体"；`docs/产品设计文档.md` §5.1.2 明确"不将任意顺序的度量伪装为自然时间序列"，把 CNN／GRU 划为后续数据路线，并只给出 3 个表格型深度候选。同一份图表还漏记了"深度要到 ≥4 个"这个课程要求。

而且口径不能只停在文档里：本机实现把特征集合写死为模块常量（`backend/jit_baseline/config.py` 的 `FEATURES`、`model.py` 的列索引 `[0,1,2,4,5]`、`artifacts.py` 的六字段比对与 `n_features_in_ != 6`），任何字段改动都会让既有基线产物直接加载失败。所以"定死定义"必须同时落到一个可按运行解析的具名特征 schema 上，否则定义改了仍然开不了工。

现在正值 Sprint 1 收尾、Sprint 2 要开工，而课程要求所有功能在第 9 周（2026-11-15）前完成；口径与定义不先定，A 席位的最长关键路径会一直空转。

## What Changes

- 统一"完整 Kamei14"为 Kamei TSE2013 的 14 项：`ns, nd, nf, entropy, la, ld, lt, fix, ndev, age, nuc, exp, rexp, sexp`；以 `docs/产品设计文档.md` §5.1.2 与 `docs/api/openapi.yaml` 的 `Kamei14Features` 为准，修正 `docs/团队分工.md` A-1 与之冲突的字段表与"数据来源"列。
- 统一模型方法口径为"只收表格型输入的方法"：修正 `docs/团队分工.md` A-2，删除 LSTM／GRU／一维 CNN（本数据集是每提交一行的表格，不是序列），保留 MLP／表格 ResNet／FT-Transformer 一类表格型深度方法，并如实记录"深度方法距 ≥4 还差 1 个"这一缺口。
- 新增"文档冲突以谁为准"的统一规则：涉及特征与模型语义时以 `docs/产品设计文档.md` §5.1.2 与 `docs/api/openapi.yaml` 为准，`docs/团队分工.md` 作为任务排期与分工视图从属于它。
- 把特征集合从"模块级冻结六字段"改为**具名、可注册、按运行解析的 schema**：每个字段记录来源列、语义核验状态、是否进入模型输入、以及变换方式（`log1p` 或保持原值）。
- 新增 `kamei14-v1` schema：12 个字段的来源与语义已按发布者固定文件核验；`lt` 与 `rexp` 记为 `unavailable` 并写明原因，不进入模型输入，也不得用同名列冒名替换。
- 补充缺失准入规则：来源缺少某个必需字段的行**不得以零值填补**，必须显式排除并记录数量与原因。
- **BREAKING**（仅内部契约）：产物校验不再与模块常量比较，而与该运行 manifest 中声明的 schema 比较；旧运行按自身声明的 schema 继续通过校验。

## Capabilities

### New Capabilities

- `feature-schema-versioning`: 定义具名特征 schema 的注册内容（字段顺序、来源列、语义核验状态、是否入模、变换方式）与运行绑定，并保证按旧 schema 生成的运行仍可加载、复现和校验。

### Modified Capabilities

- `public-data-baseline`: PDB-02 的"固定六字段"改为"注册表中的具名 schema"，并要求逐字段标注来源与语义核验状态；补充缺失准入规则（缺失不得填零，必须显式排除并计数）；新增具名方法清单与"只收表格型输入"的口径。
- `commit-risk-review`: CRR-13 要求摘要说明"特征尚非完整 Kamei14"，需改为按当前运行的 schema 如实列出已提供与未提供的字段，以及当前运行所声明的模型方法。

## Impact

- 后端代码：`backend/jit_baseline/config.py`（常量 → schema 引用）、`data.py`（按 schema 取列与统计缺失）、`model.py`（按 schema 变换，去掉写死的列索引）、`artifacts.py`（按 manifest 声明的 schema 校验、支持多 schema 并存）、`api.py`（模型标识不再写死）、`cli.py`（选择 schema）。
- 文档：`docs/团队分工.md`（A-1 字段表与来源列、A-2 方法与口径）、`docs/产品设计文档.md`（把已核验结论写进 §5.1.2 缺口表与状态列）、`backend/DATA.md`（逐列统计与来源结论）、`docs/全局错误码表.md`（新增 schema 相关错误码）；`docs/api/openapi.yaml` 的 `Kamei14Features` 口径不变，仅补 `description` 说明可用性。
- 数据与产物：新增 `kamei14-v1` 的独立运行目录；**不覆盖、不重写** `backend/artifacts/baseline`，也不改写 `docs/evidence/` 下任何已冻结证据。
- 依赖：本 change 只使用现有依赖（scikit-learn 等），不引入新框架；深度方法不在本 change 实现。
- 测试：新增 schema 注册表、按 schema 取列、旧运行仍通过的回归检查，以及 `kamei14-v1` 运行的完整性与复现检查。
- 不影响：`GET /api/review-batch` 的六字段响应契约、前端行为。
- 遗留：`lt` 与 `rexp` 需要用第二个公开数据集或发布者提取实现来补，且必须走新的 schema 版本；本 change 不承诺补齐这两项，也不承诺深度方法。
