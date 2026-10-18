# 变更提案：数据集注册表与提交数据落库

## Why

数据资产现在只活在运行产物里：来源、校验值、字段口径、质量统计写进每个 run 的 `data/*.json`，换一个数据集必须改 `config.py` 的 `SOURCES` / `COHORT` 再跑一次；catalog 库只有模型、预测和运行，没有提交、文件、特征和标签。于是服务无法回答"本机有哪些数据集""某次提交的六项度量与标签是什么"，趋势看板与预测也只能拿到运行产物里预先聚合好的数字。

课程后续要接更多数据集（Kamei14、其他项目）和更多模型方法，靠改代码加数据集不可维护；提交级数据不落库，任何按模块、时间、作者维度的分析都得重跑离线脚本。先把"数据集描述文件"与"提交级存储"做掉，后续接入新数据集与新特征才有稳定底座。

## What Changes

- 新增数据集描述文件规范与目录 `data/datasets/<dataset>/<dates>.json`：发布者、原始地址、不可变版本、SHA-256、引用、schema 名称、字段定义（来源列/语义/是否入模/变换）、质量统计（原始与纳入行数、排除规则计数、字段缺失）、提交时间范围与样本。描述文件是数据集的可读事实来源，不随运行重建。
- 新增 `python -m jit_baseline register-dataset`：从原始 CSV 生成描述文件；校验失败（校验值不符、schema 未知、必需列缺失、时间或标签无效）拒绝写出；同一输入重复登记得到逐字节相同的文件。
- `config.py` 的 `SOURCES` 条目新增 `datasetManifest` 字段；运行声明记录所用描述文件及其 SHA-256，PDB-01 的数据来源记录改为引用该描述文件，不再在运行内重复粘贴字段定义。
- catalog 库新增表：`dataset`（描述文件登记）、`commit`（提交身份、时间、模块与变更规模）、`feature`（每个提交的 schema 字段值）、`label`（标签与来源规则）、`import_run`（数据导入记录）。迁移版本 2；导入失败整体回滚，不留半批数据。来源不提供文件明细或模块时对应列为空，不以占位值伪造。
- 新增只读查询接口：`GET /api/v1/datasets`、`GET /api/v1/datasets/{name}/versions`、`GET /api/v1/commits?dataset=&module=`（module 仅在来源提供时可用）；服务启动时加载已登记描述文件，描述文件与运行声明不一致时拒绝。
- **BREAKING**：运行声明中的 `cohort` 与 `datasetVersion` 改为由描述文件派生，旧运行 manifest 的 `config.cohort` 不再等于当前代码常量；校验必须按运行自身声明比对，旧运行仍需通过。

## Capabilities

### New Capabilities

- `dataset-registry`: 数据集描述文件的格式、登记与校验、版本命名、与具名 schema 的绑定，以及服务如何读取与拒绝。
- `commit-persistence`: 提交、变更文件、特征与标签的持久化、导入事务与只读查询。

### Modified Capabilities

- `public-data-baseline`: PDB-01 数据来源记录改为引用已登记描述文件；PDB-07 运行声明记录描述文件校验值。

## Impact

- `backend/jit_baseline/config.py`、`data.py`、`cli.py`、`api.py`、`catalog_storage.py`、`catalog_schema.py`；`schemas.py` 只读引用。
- 新增 `backend/jit_baseline/datasets.py`（描述文件读写与登记）。
- `backend/storage/catalog.sqlite3` 迁移到 v2；`backend/data/datasets/` 新目录；`backend/tests/` 新增测试。
- `openspec/specs/public-data-baseline/spec.md` 增加 delta 需求；`openspec/specs/dataset-registry/`、`openspec/specs/commit-persistence/` 为新规格。
- 不改变训练、预测与既有 API 响应；不改动 `algorithms.py` 与深度方法。
