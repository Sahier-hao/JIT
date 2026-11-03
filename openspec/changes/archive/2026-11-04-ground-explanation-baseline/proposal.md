# Proposal

## Why

现有提交解释用整个数据集版本的字段均值作基线，可能包含验证、测试和近期提交，不是严格的训练段背景。解释也没有背景哈希或稳定性信息，重开时无法核对背景是否变化。训练运行的 `split.json` 已经保存分区成员标识，因此不需要新增持久化就能改用训练分区均值。

## What Changes

- 解释基线改为模型绑定运行的训练分区均值，不再使用整个数据集版本均值。
- 保存训练分区身份与背景哈希；重开时可核对背景未变。
- 训练分区成员或字段均值不可用时退回零基线并说明，不静默使用其他来源。
- 增加合法扰动下的稳定性检查，报告稳定、部分稳定或不稳定；不稳定时不把主要特征表述为稳健原因。
- 旧解释保留原内容并标注背景未知，不按当前数据重算。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `prediction-explanation`: 修改归因基线为训练分区背景，增加背景哈希和稳定性检查。

## Impact

- 解释：[attribution.py](../../../backend/jit_baseline/attribution.py)、[catalog_storage.py](../../../backend/jit_baseline/catalog_storage.py) 的背景均值读取。
- 训练运行产物：[artifacts.py](../../../backend/jit_baseline/artifacts.py) 的 `split.json` 分区成员。
- 既有解释结果和模型分数不被改写；旧解释明确标注背景未知。
