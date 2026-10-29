# Design

## Context

动机见 [proposal](proposal.md)；行为约定见 [code-semantic-features](specs/code-semantic-features/spec.md)。

现有接入面：

- `collect.py` 用 `git log --numstat` 遍历提交，只保留 subject 与文件级增删行数，**没有 diff 文本**；产物是 CSV + 数据集描述文件。
- `schemas.Schema` 只有 `name` 与数值 `fields`；`fit_model` 把 `r["features"]` 变成矩阵，`Log1pColumns` 只变换 schema 声明的列，随后可选 `StandardScaler`。
- `build_run` 支持 `dataset_manifest`，按描述文件的 schema/cohort 训练；`test-input.json` 记录测试特征用于重算风险。
- 已有 9 个数值方法、`metric-set-v2`、`run-suite`/`compare-projects`。
- OpenStack 快照没有提交文本；语义方案只能用于 Git 采集数据。

## Goals / Non-Goals

**Goals:**

- 在 Git 采集数据上建立"有界文本 → 预训练代码嵌入 → 语义输入 → 三方案同口径评估"的可复用链路。
- 让语义特征是**可追溯、可离线复用**的产物，而不是训练时临时调用编码器。

**Non-Goals:**

- 不做 SHAP/解释、不在训练循环里编码、不做在线文本输入、不做 A→B 迁移。
- 不把全文 diff 入库，不改既有 9 个数值方法的运行与结果。

## Decisions

### D1. 有界 diff 文本 sidecar

文本采集是可选开关（`collect-repository --with-text`）：开启时额外产出 `text.jsonl`（与 CSV 同目录），每行对应一个纳入提交；默认采集与同步链路保持原行为，不承担补丁输出的开销。

```
{"commit_id": "...", "subject": "...", "diff": "...", "truncated": false, "skippedFiles": []}
```

截断规则固定为 `diff-bound-v1`：按文件路径升序、每文件最多 80 行、每提交累计最多 8KB、二进制文件跳过并记入 `skippedFiles`。产物记录规则版本、字节数与 SHA-256；同一仓库与范围重采必须得到相同顺序与内容。

### D2. 文本作为新的数据集版本

数据集内容变化必须形成新版本：CSV 不变，但描述文件新增 `text` 块（路径、SHA-256、规则版本），因此版本名要新（如 `flask-3y-text-v1`）。既有版本与运行不受影响。

### D3. 固定 revision 的预训练代码编码器

编码器定稿为 `microsoft/codebert-base`、revision `3b0952feddeffad0063f274080e3c23d75e7eb39`、mean pooling、最大 256 token、768 维；离线构建时 CPU 单线程、固定 batch，模型标识、revision、池化方式与最大长度同时写入元数据并可随 schema 校验。若改用其他权重源或模型，**必须换一个新标识并记录**，不得静默替换。

产出：`embeddings.npy`（行顺序与 ids 对齐）、`ids.json`、`meta.json`（编码器 id/revision、维度、池化、最大长度、文本 SHA-256、嵌入表 SHA-256）。训练只读这些产物。

### D4. schema 增加可选语义块

`Schema` 增加可选 `semantic` 描述（维度、编码器、嵌入表引用）。新增两个 schema：

- `kamei14-semantic-codebert-v1`：14 个专家字段 + 768 维 CodeBERT 语义块（融合方案，输入 782 维）；
- `code-semantic-codebert-v1`：无专家字段 + 768 维 CodeBERT 语义块（语义-only 方案）。

schema 语义块固定声明编码器、revision、维度、池化与最大长度；嵌入表通过运行参数
`--embedding-dir` 引用，训练前同时核对 schema 声明、嵌入元数据与数据集 `text.sha256`。

既有数值 schema 的 `semantic=None`，行为不变。

### D5. 训练矩阵 = 专家变换后 | 语义向量

`feature_matrix` 在专家列后拼接 `r["semantic"]`；`Log1pColumns` 仍只作用于专家列；标准化只作用于专家块，嵌入保持原值（编码器输出已归一化）。方法声明中的 `preprocess` 仍控制是否对专家块标准化。纯数值 schema 的矩阵与现在逐位一致。

### D6. 三方案使用同一分类器族

- 专家-only：`kamei14-git-v1` + 既有方法（如 logistic-regression / mlp）；
- 语义-only：`code-semantic-codebert-v1` + 同一分类器族；
- 语义+专家：`kamei14-semantic-codebert-v1` + 同一分类器族。

三者使用同一时间切分、同一测试成员与 `metric-set-v2`；报告并列指标，不自动择优，失败保留。

### D7. 离线边界

语义运行只在离线训练/评估中使用；六字段单条数值预测接口不接入文本，也不得把语义模型登记为可服务模型。无文本数据集（OpenStack）不得用于语义方案。

## Risks / Trade-offs

- [HuggingFace/权重下载不可达或很慢] → 预先检查，允许镜像或更小模型，但必须换标识并如实记录；失败不阻塞数值主线。
- [只取前 80 行/8KB 会丢失部分语义] → 截断规则固定、显式标记；在报告里披露，不把结果外推为"全 diff 语义"。
- [782 维（14+768）输入与 475 条训练样本] → 高维过拟合风险；使用正则化/小模型，效果如实报告，不据测试结果改方案。
- [OpenStack 无文本] → 语义方案只在 Git 采集数据上评估；文档与错误路径明确拒绝。
- [Flask 测试集只有 70 条] → 语义评估的样本量也小；必要时再采一个更大的公开仓库作为第二语义数据集。
- [语义模型无法通过六字段 API 服务] → 明确限定为离线评估，避免把不可服务的模型登记为可预测模型。
- [diff 可能含敏感内容] → 只用于公开仓库；有界截断；不把文本写入日志或对外响应。

## Migration Plan

1. 采集文本 sidecar，形成新数据集版本并登记；既有版本不动。
2. 固定编码器并生成嵌入表；校验文本/嵌入哈希与维度。
3. 扩展 schema 与训练矩阵；先证明纯数值 schema 逐位不变，再跑语义-only 与融合。
4. 在同一数据集上并列三方案；如有第二文本数据集，再做跨项目并列（仍不可直接排名）。
5. 回退方式：移除语义 schema 与嵌入产物即可回到纯数值方法；既有运行与证据不受影响。

## Resolved Questions

- 编码器已定稿为固定 revision 的 `microsoft/codebert-base`，避免评估中途替换模型。
- 当前只有 `flask-3y-text` 一个登记了文本 sidecar 的数据集；跨项目语义报告因此不生成。Flask 测试集仅 70 条，结果不用于声明跨项目泛化。
