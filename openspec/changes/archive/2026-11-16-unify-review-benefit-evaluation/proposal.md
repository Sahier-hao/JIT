# Proposal

## Why

多仓库矩阵与模型收益报告对 20% LOC 预算采用不同选择规则，矩阵缺少已有的成本感知比较和配对不确定性，现有指标难以共同回答审查是否省力。需要在相同成员、标签与预算下形成一致且可复现的收益结论。

## What Changes

- 为新评价协议统一整提交预算、成本、排序并列规则和零成本处理，保留旧指标与旧报告的原始语义。
- 在矩阵与收益报告中并列模型分数、风险/成本密度、改动量升序、时间顺序和固定随机顺序，给出实际预算使用量及逐基线配对差值。
- 固定随机重复、时间块重采样和协议身份；不利结果、条件不足与失败格均保留。
- 使用 `separate-label-observation-window` 提供的合格数据生成新版本真实报告及可核对案例；没有收益时明确报告尚无稳定优势。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `multi-dataset-evaluation`: 新版多仓库矩阵与模型收益报告采用相同预算协议，记录基线、不确定性及数据准入状态。

## Impact

涉及 `backend/jit_baseline/metrics.py`、`benefit.py`、`evaluation_matrix.py`、`evaluation_evidence.py`、CLI、模型卡和管理实验报告展示及测试。正式真实复评依赖 `separate-label-observation-window` 的样本准入契约；预算工具可先在隔离夹具上实现。保留既有模型、默认选择、旧指标集、旧报告和只读管理边界。
