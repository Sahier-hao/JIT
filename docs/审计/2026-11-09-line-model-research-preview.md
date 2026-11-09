# 行级模型研究预览（2026-11-09）

本记录说明如何把已完成的离线行级实验以一个**明确标注、与主流程隔离**的研究预览接入产品。预览不改变提交级风险、默认模型、模型目录或 PR 审查结果。

## 决策

- 预览只展示固定实验配置的排序分数，不提供“逐行缺陷概率”。
- 模型以可审计的系数 JSON 保存，不使用 pickle，不登记目录库，不进入模型选择。
- 页面固定标注：弱标签抽样、未校准、不是缺陷概率、不参与项目分析。
- 只接受模型评估覆盖的 TypeScript / JavaScript；不静默套用到其他语言。

## 模型与数据

- 产物：`backend/research/line-model-v1.json`，`artifactSha256 = 271a6c6b590796660fe350580c20ec886f3f29a6b0f1af8cc83752add5598123`。
- 配置：逻辑回归（`liblinear`、`class_weight=balanced`、2000 次迭代、种子 42）、仓库平衡；关闭字符 n-gram、文件位置与提交级特征。
- 训练：JIT + cc-switch，6,102 行、249 提交、2,435 正例；语言特征只在 TypeScript 上拟合。
- 留出：axios，2,152 行、120 提交、1,125 正例。
- 指标：ROC-AUC 0.658、PR-AUC 0.659（随机基线 0.523）、Brier 0.233；Top-5 命中 93.3%、20% 行预算召回 26.0%，均为 1:1 抽样下的上限代理。
- 报告与 manifest：`docs/evidence/line-experiments/2026-11-09/P1-compact.json` 与 `.manifest.json`。

为什么关闭位置特征：启用文件长度与行位置的 A3 配置在留出集更高（ROC-AUC 0.695、PR-AUC 0.706），但预览接收的是粘贴片段，片段内位置不等于真实文件位置；保留位置特征会让排序随粘贴范围变化，因此预览使用只依赖行内文本与结构的 P1 配置，并如实报告较低指标。

## 复现

原始 JSONL 不入版本库；报告与 manifest 记录了输入 SHA-256、行数、采样摘要与完整命令。当前数据位于 `D:/tmp/measure/`（`cc-switch-same.jsonl`、`JIT-same.jsonl`、`axios.jsonl`）。重新生成：

```
backend/.venv/Scripts/python.exe -m jit_baseline.cli line-train \
  --input D:/tmp/measure/cc-switch-same.jsonl \
  --input D:/tmp/measure/JIT-same.jsonl \
  --input D:/tmp/measure/axios.jsonl \
  --test-repo axios --language typescript --language javascript \
  --no-text --no-position-features \
  --output docs/evidence/line-experiments/2026-11-09/P1-compact.json \
  --preview-model-output backend/research/line-model-v1.json
```

`line-train` 会校验系数数量与特征名一致；预览服务加载时重算 `artifactSha256`，不匹配即返回 `LINE_PREVIEW_UNAVAILABLE`，不回退其他模型。

## 接口与页面

- `GET /api/v1/research/line-model`：训练/留出摘要、指标、特征口径、限制、产物校验值。
- `POST /api/v1/research/line-model/score`：`{language, code}`，请求内按行打分，按分数降序返回；跳过空行；单次上限 2,000 行 / 200,000 字符；不写数据库、不记录代码正文。
- `#/research/line-model`：公开独立页面，产品介绍页提供入口；展示模型口径、限制与逐行排序。
- 隔离：研究路由使用独立命名空间；不进入模型目录、默认模型、项目模型选择、训练参数契约或 PR 分析。

## 验证

- 后端：`tests/test_line_train.py`（含导出与校验）、`tests/test_line_preview.py`（产物、语言拒绝、空行、上限、接口错误信封）、`tests/test_api_route_coverage.py` 通过。
- 前端：新增页面单测、产品入口与路由测试通过；全量 389 项通过。
- 真实浏览器：从产品页进入 `#/research/line-model`，页面读取真实产物，粘贴 TypeScript 代码后返回 8 行排序（最高 `return JSON.parse(input)` 0.673），控制台无错误。
- 全量后端：814 项通过；9 项既有模型包校验失败（`partial`）由本机 PyTorch 重算导致，与本变更无关（见既有环境记录）。

## 未做

- 不提供完整文件/PR 候选集定位、人工确认标签或概率校准。
- 不支持 Python/Go/Rust 等未覆盖语言。
- 不把预览结果写回项目分析、PR 工作单或个人草稿。
