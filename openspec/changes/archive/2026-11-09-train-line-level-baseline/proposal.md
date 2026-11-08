# 行级缺陷预测基线

## Why

行级样本已经能导出，但还没有模型验证“这些标签和特征能不能学到东西”。在接入产品前，需要一个可复现的基线：明确特征、切分、指标和报告，避免用同一提交的行同时训练和测试造成虚高。

## What Changes

- 新增 `line-train` 命令：读取一个或多个 `line-szz-v1` JSONL，训练逻辑回归基线，输出指标报告。
- 特征：行文本与前后文的字符 n-gram、行级数值特征、语言 one-hot、提交级 Kamei 特征。
- 切分：按仓库留出或按提交分组切分，禁止同一提交的行跨训练/测试；报告实际切分方式。
- 指标：ROC-AUC、PR-AUC、Brier、固定阈值精确率/召回率、正负例数；缺失或单类时如实说明。
- 只训练与评估，不登记模型、不改默认模型、不接产品。

## Capabilities

### New Capabilities

- `line-level-prediction`：行级样本训练、切分、指标与报告的最低要求。

### Modified Capabilities

无。

## Impact

- 后端：新增 `backend/jit_baseline/line_train.py` 与 CLI 命令；依赖现有 scikit-learn/scipy。
- 数据：读取 JSONL，不修改数据集、目录库或模型。
- 前端：本期无变化。
