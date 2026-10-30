## Why

本周剩下的关键项是"预训练代码语义模型 + 语义／专家特征融合"。当前系统只有数值表格模型：采集器保留了提交标题（subject）与文件级增删行数，但**没有 diff/patch 文本**；schema 只接受数值字段；OpenStack 快照本身也不含任何提交文本。因此"代码语义"目前没有数据基础，也无法与 14 维专家特征做同口径比较。

已有基础设施可以直接复用：`kamei14-git-v1` 提供完整 14 维与简化 SZZ 标签，`dataset-registry` 支持多版本与文件校验，9 个模型、`metric-set-v2`、`run-suite`/`compare-projects` 已就绪。缺的是**有界文本产物 → 预训练编码 → 嵌入表 → 语义输入契约 → 三方案评估**这一条链。

## What Changes

- **有界 diff 文本产物**：`collect-repository --with-text` 额外产出与提交一一对应的文本 sidecar（JSONL），按固定规则截断（每文件最多 80 行、每提交最多 8KB、跳过二进制），记录截断规则与 SHA-256，并随数据集版本登记；默认采集（含同步链路）不开启，避免拖慢任意仓库。
- **离线嵌入表**：新增命令，用**固定 revision 的预训练代码模型**（CPU、单线程）对文本离线编码，产出 `embeddings`（按 commit_id 索引）与元数据（编码器 id/revision、维度、池化、最大长度、文本与嵌入表哈希）。
- **语义输入契约**：schema 增加可选的语义块（编码器、revision、维度、池化与最大长度声明）；新 schema `kamei14-semantic-codebert-v1` = 14 个专家字段 + 768 维语义向量，`code-semantic-codebert-v1` 为 768 维语义-only。训练矩阵为"专家变换后 | 嵌入向量"，方法输入形状按声明校验。
- **三种方案同口径评估**：在同一 Git 数据集、同一时间切分与 `metric-set-v2` 下训练并比较 **专家-only**、**语义-only**、**语义+专家**；不得据测试效果挑选方案，失败方案如实保留。
- **边界**：语义运行只用于离线评估；现有单条六字段 JSON 预测接口不含文本，不接入语义模型；OpenStack（无文本）不能用于语义方案。
- 不做：SHAP/解释、在线文本编码、把 diff 全量入库、跨项目迁移（A→B）。

## Capabilities

### New Capabilities

- `code-semantic-features`: 有界提交文本产物、预训练代码嵌入表及其溯源、语义输入契约，以及"专家／语义／融合"三种方案的离线同口径评估。

## Impact

- 数据：`collect.py` 新增文本 sidecar；`datasets.py` 描述文件新增文本/嵌入引用；既有数据集版本不变，新增版本。
- 模型：新增语义编码模块与嵌入加载；`schemas.py`、`data.py`、`model.py`、`artifacts.py` 支持"专家 + 语义"矩阵；新增 `build-embeddings` 命令。
- 依赖：需要 pinned 的 `transformers`（torch 已在），模型权重离线缓存；编码只发生在离线构建阶段。
- 文档与测试：PROTOCOL 增加语义口径与限制；README 增加采集/编码/评估命令；测试覆盖截断确定性、嵌入溯源、缺失嵌入拒绝、三方案运行与校验。
- 不影响：既有 9 个数值方法的运行与结果、服务与前端、已归档证据。
