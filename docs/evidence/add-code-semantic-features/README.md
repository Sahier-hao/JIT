# add-code-semantic-features 证据

本目录来自 2026-10-29 的本机运行，冻结内容包含：

- `dataset/`：`flask-3y-text` 数据集描述、原始 CSV 与有界文本 sidecar；
- `semantic/embeddings/`：CodeBERT 嵌入表及 ids/meta；
- `semantic/runs/`：专家-only、语义-only、语义+专家三份完整运行；
- `semantic/comparison.json`：三方案同口径并列报告；
- `verification/`：最终完整验证的摘要、日志、前后端测试结果及独立复现比较。

## 数据与编码器

- 数据集版本：`flask-3y-text-2022-01-11_2024-11-27`
- 原始 495 条，纳入 475 条，测试 70 条；测试正例 15 条。
- 文本规则：`diff-bound-v1`；文本 SHA-256
  `1d86bf688d7756324784f186fb92b430c6f42609a26d41adc2c5070c66633483`；
  58 条发生截断，228 个文件被跳过。
- 编码器：`microsoft/codebert-base`
  revision `3b0952feddeffad0063f274080e3c23d75e7eb39`；mean pooling，
  max length 256，768 维。
- 嵌入表 SHA-256
  `bd3f2d298c84da00f22ae98a2e313ef67044e53787dd34547dd7bdb664d88122`，
  495 条向量。

## 三方案运行

| 方案 | schema | runId |
| --- | --- | --- |
| 专家-only | `kamei14-git-v1` | `a70ce92c7f729dccc405c95292e4ac58e75a720ab952ff848da5e79a2e77f35f` |
| 语义-only | `code-semantic-codebert-v1` | `915ad341cd6c39189390923820f243a3bfa3601267deee2c29751e77b20e64da` |
| 语义+专家 | `kamei14-semantic-codebert-v1` | `e2ed3f267c7fe2661197a48b9446b5e958fe07195c43738ca4e8d58a9d2ad68a` |

三份运行均使用逻辑回归、`metric-set-v2` 和同一 70 条测试成员。报告给出
`directlyComparable: true`；这不代表应据结果自动选择方案。三份在 0.5 阈值下均
没有预测正例，且本数据集仅一个项目、测试集很小，不能据此声明融合方案更优或可泛化。

## 最终验证

- 后端：480 passed，1 skipped（真实数据集未导入的环境条件）。
- 前端行为测试：282 passed。
- 浏览器 e2e：14 passed；测试 worker 固定为 1，避免全局模型策略与九模型分析并发污染。
- OpenSpec：20 个主规格通过严格校验。
- 受保护文件：1,132 个，验证前后无变化。

在拉取最新前端改版后，本轮重新生成了验证证据，并同步更新 e2e 对“发起分析”、
“更多操作”和记录完成状态的等待方式。此前浏览器验证曾因两个 worker 共用模型策略库，
使另一任务收到预期的 `MODEL_DISABLED`；收窄为单 worker 后消除了跨用例污染。

重建命令见仓库 `backend/README.md` 的“代码语义特征与三方案比较”一节。
