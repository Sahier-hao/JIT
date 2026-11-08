# 任务

## 1. 训练与评估

- [x] 1.1 新增 `backend/jit_baseline/line_train.py`：读取多个 JSONL，构建文本、数值、语言与提交特征。
- [x] 1.2 按仓库留出或按提交分组切分；禁止同一提交跨训练/测试。
- [x] 1.3 训练逻辑回归基线，报告 ROC-AUC、PR-AUC、Brier、固定阈值精确率/召回率。
- [x] 1.4 CLI `line-train --input ... --test-repo --output --seed`。

## 2. 测试

- [x] 2.1 合成小样本：同提交不跨切分；指标可计算；单类测试集返回可解释空值。
- [x] 2.2 仓库字段缺失时拒绝或从版本推导，不静默混用。

## 3. 真实数据报告

- [x] 3.1 真实报告：cc-switch 仓库内按提交切分 ROC-AUC 0.982 / PR-AUC 0.987；跨仓库测试 JIT ROC-AUC 0.584 / PR-AUC 0.536，claude-scholar ROC-AUC 0.579 / PR-AUC 0.270，均接近随机。
- [x] 3.2 报告中写明样本规模、正负比例、仓库分布与限制。

## 4. 文档与规格

- [x] 4.1 新增 `line-level-prediction` 能力要求与文档命令说明。
