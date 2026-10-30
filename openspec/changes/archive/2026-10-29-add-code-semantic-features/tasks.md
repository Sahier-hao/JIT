## 1. 有界文本产物

- [x] 1.1 `collect-repository` 产出 `text.jsonl`（commit_id、subject、有界 diff、截断/跳过标记），规则固定为 `diff-bound-v1`；验证：同仓库同范围重采顺序与内容一致，记录规则版本与 SHA-256
- [x] 1.2 数据集描述文件新增 `text` 块并形成新版本；验证：登记校验通过，既有版本与运行不受影响

## 2. 预训练嵌入

- [x] 2.1 固定 `transformers` 与编码器 revision；验证：CPU 单线程可加载并编码小样本，元数据记录编码器 id/revision/维度/池化/最大长度
- [x] 2.2 新增 `build-embeddings` 命令，产出 `embeddings.npy`/`ids.json`/`meta.json`；验证：行数与 ids 对齐、文本与嵌入哈希写入元数据、缺失 id 或哈希不符时明确失败

## 3. 语义输入与训练

- [x] 3.1 schema 增加可选语义块与 `kamei14-semantic-codebert-v1`、`code-semantic-codebert-v1`；验证：纯数值 schema 的训练矩阵与既有结果逐位一致
- [x] 3.2 训练矩阵按"专家 | 语义"拼接，标准化只作用于专家块；验证：语义-only 与语义+专家的运行可通过 `verify`，缺失嵌入的运行被拒绝

## 4. 评估与文档

- [x] 4.1 在同一 Git 数据集上并列专家-only、语义-only、语义+专家（同一测试成员、`metric-set-v2`）；验证：三方案指标并列，失败保留，不自动择优
- [x] 4.2 如有第二个文本数据集，产出跨项目并列报告（`directlyRankable: false`）；验证：标签语义与样本差异被列出。当前仅一个文本数据集，条件不成立；已在 design 与团队文档记录
- [x] 4.3 更新 `backend/README.md`、`PROTOCOL.md`、`docs/团队分工.md`（采集/编码/评估命令、离线边界与限制）；验证：文档与实现一致

## 5. 验证与证据

- [x] 5.1 运行后端全量测试与完整验证脚本；验证：全部通过，输出写入运行工作区且不写入已归档 change 的证据目录
- [x] 5.2 冻结本次证据并校验完整性清单；验证：冻结清单通过，受保护位置未被改动
