# Proposal

## Why

当前数据清洗是采集和导入脚本里的固定规则。管理员只能看到缺失与排除统计，不能预览某条规则会影响哪些提交、生成一份可复现的派生数据、对比清洗前后的分布，或把派生数据导出给离线实验。实验选择因此留在代码里，难以复现和复核。

## What Changes

- 管理员可选择已登记数据集版本，配置或选择清洗配方：重复与无效记录、缺失字段、异常值边界、排除规则和标签处理。
- 生成前预览受影响行数、缺失、类别比例和时间范围，不写入正式数据。
- 确认后生成不可变派生版本，记录来源版本、配方内容哈希、逐条去留原因和生成时间。
- 对比原版与派生版的样本数、正例比例、字段缺失、时间范围和排除原因。
- 导出派生 CSV 及描述文件，包含哈希与规则谱系。
- 原数据集版本和文件不被修改；清洗入口只对管理员开放。
- 训练分区的类别加权或采样单独作为一个后续变更，不在本变更内实现。

## Capabilities

### New Capabilities

- `dataset-curation`: 清洗配方、预览、不可变派生版本、前后对比、导出和管理员权限。

### Modified Capabilities

- `admin-training-workspace`: 修改数据集详情，增加清洗入口、派生版本谱系和清洗结果入口。

## Impact

- 数据登记与查询：[store.py](../../../backend/jit_baseline/store.py)、[catalog_storage.py](../../../backend/jit_baseline/catalog_storage.py) 与数据集接口。
- 管理界面：[AdminDatasetDetailPage.tsx](../../../frontend/src/pages/admin/AdminDatasetDetailPage.tsx) 及管理路由。
- 派生版本沿用现有数据集登记和版本命名规则；训练执行器只读取派生版本，不改变训练分区策略。
- 原数据集、既有训练任务和模型产物保持不变。
