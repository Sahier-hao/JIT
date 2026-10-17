# Design

## Context

现状事实（决定实现方式的关键）：

- `backend/jit_baseline/config.py`：`SOURCES` 是「文件名 → 声明」映射（`path`/`sha256`/可选 `datasetManifest`），`COHORT` 是 epoch 窗口与 churn/files 上限；两者都是代码常量。
- `backend/jit_baseline/data.py:parse_source(blob, schema)` 解析 CSV 并返回 `quality`：rawRows、includedRows、positiveLabels、blankLabels、featureMissing、excluded（outsideWindow/noAddedLines/tooMuchChurn/tooManyFiles/missingRequiredField）。
- `backend/jit_baseline/artifacts.py:build_run` 把 `sources`、`cohort`、`features` 写进 run 产物；声明了 `datasetManifest` 时改用描述文件的版本名，否则保留 `identity({...})` 派生（`artifacts.py:154-168`）。`verify_run` 经 `datasets.check_run` 按运行声明分流（`datasets.py:208`）。
- `backend/jit_baseline/schemas.py` 是唯一的 schema 注册表（`SCHEMAS`、`resolve`、`in_model_fields`）。
- `backend/jit_baseline/catalog_storage.py`：`MIGRATIONS = ((1, 001_catalog.sql), (2, 002_commit_data.sql))`，`VERSION` 取最后一项；`initialize(migrations=..., version=...)` 建表并写 `schema_migration`；`connection(write=True)` 用 `BEGIN IMMEDIATE`。
- `backend/data/openstack/openstack.csv` 是提交级聚合：`commit_id,author_date,bugcount,fixcount,la,ld,nf,nd,ns,ent,...`，没有文件路径列，也没有模块列。
- 既有测试在本机基线为 219 passed；pytest 的 `tmp_path` 在本机沙箱下不可写，验证时需把 basetemp 指到 workspace 内。

## Goals / Non-Goals

**Goals:**

- 描述文件可重算、幂等、不可覆盖，登记失败不留半成品。
- 提交级数据按数据集版本隔离，导入事务整体提交，旧运行按自身声明校验不受影响。
- 只读 API 不改变既有响应结构。

**Non-Goals:**

- 不做文件级明细与模块推导（来源没有，不伪造）。
- 不把 schema 目录文件化（仍用 `schemas.py` 内建注册表）。
- 不做前端、趋势/预测按模块聚合、多数据集自动同步。
- 不改变训练与预测路径。

## Decisions

**D1 描述文件用 JSON，放 `backend/data/datasets/<dataset>/<version>.json`，版本名 `<dataset>-<startDate>_<endDate>`。**
与 run manifest 同格式，便于 diff、哈希与审计；替代 YAML（多一个解析依赖）与 SQLite（不可读、与迁移耦合）。

**D2 登记直接复用 `parse_source` 与 `schemas.resolve`。**
质量统计只允许一套规则：`register-dataset` 调用 `parse_source` 得到 quality，字段定义从 `resolve(schema).fields` 生成（name/source/in_model/transform/blank/status/reason）。替代方案是复制字段表，必然漂移。

**D3 `config.SOURCES` 每项增加可选键 `datasetManifest`；校验按运行声明分流。**
`verify_run` 在 `config` 含 `datasetManifest` 时校验描述文件 SHA-256 与版本名；缺失时保留现有 `config["cohort"] == COHORT` 路径。旧运行（无该键）行为不变，新运行可追踪到描述文件。

**D4 表结构（v2）：`dataset_record`、`commit_record`、`feature_record`、`modified_entity`、`import_run`。**
- `dataset_record(dataset_version PK, dataset_name, manifest_json, manifest_sha256, source_sha256, row_count, created_at)`。
- `commit_record(dataset_version, commit_id, author_time, label, label_rule)`，PK `(dataset_version, commit_id)`；标签并入提交行（一提交一标签），不单独建表。
- `feature_record(dataset_version, commit_id, field, value_json)`，PK `(dataset_version, commit_id, field)`；变更规模（nf/la/ld/nd/ns/ent）本身就是入模字段，随特征竖表持久化，不重复建列。
- `modified_entity(id, dataset_version, commit_id, entity_type, entity_value)`，`entity_type` 限 `file`/`module`；OpenStack 来源没有路径列，本数据集不写入该表，接口按模块查询返回空。
- `import_run(id PK, dataset_version, status, row_count, error_code, started_at, finished_at)`，`status` 限 `success`/`failed`。

`feature_record` 用竖表以容纳 schema 演进；列表查询按 `dataset_version` 一次取特征再拼装，避免逐行查询。

**D5 迁移文件 `backend/jit_baseline/migrations/002_commit_data.sql`，`catalog_storage.py` 改为 `MIGRATIONS = ((1, ...), (2, ...))`、`VERSION = MIGRATIONS[-1][0]`，`initialize()` 对 v1 库按序执行 002 并更新 `schema_migration`。**
迁移语句全部 `IF NOT EXISTS`，重复执行安全；不删改 v1 表。

**D6 导入在单个 `connection(write=True)` 事务内完成，`import_run` 先 pending 后 success，异常回滚并记录 error。**
`sqlite3` 的 `BEGIN IMMEDIATE` 已由 `CatalogStorage` 提供；不引入新存储层。

**D7 只读路由：`GET /api/v1/datasets`、`GET /api/v1/datasets/{name}/versions`、`GET /api/v1/commits?version=&module=`、`GET /api/v1/commits/{commit_id}?version=`。**
沿用现有 `{"error": code, "message": ...}` 与 404 语义；只新增路由，不改既有路由。版本参数统一叫 `version`，与响应里的 `datasetVersion` 对应。

**D8 模块列：来源没有模块信息时写 NULL，不推导。**
`openstack.csv` 没有路径，`module` 列对本次数据集为空；查询接口的 `module` 过滤只对提供了该列的数据集生效。

**D9 服务启动时加载描述文件，失败即启动失败。**
`api.py` 启动阶段调用 `datasets.load_all()`，缺失或校验失败抛 `BaselineError`，与 `Snapshot.load` 的失败语义一致。

## Risks / Trade-offs

- 旧运行兼容 → D3 双路径 + 新增回归测试覆盖「无 `datasetManifest` 的旧运行仍通过」。
- 迁移不可逆 → 002 只加表；升级前备份 `storage/catalog.sqlite3`，回滚用备份恢复。
- 描述文件与 CSV 漂移 → 登记时重算 SHA-256 与 quality，写前比对，不符拒绝。
- 新路由影响前端 → 只新增路由，不改既有 JSON 结构。
- pytest 临时目录受限 → 验证命令使用 `--basetemp backend/tests/.tmp`。

## Migration Plan

1. 新增 002 迁移并在 `catalog_storage.py` 注册 v2；`catalog-init` 对 v1 库自动升级。
2. 实现 `datasets.py` 与 `register-dataset`，先登记 `openstack-six-v1-2011-11-29_2014-02-28`。
3. 实现导入命令与只读路由。
4. 回归：`pytest --basetemp backend/tests/.tmp`、`openspec validate --strict`。
5. 回滚：恢复备份库并回退代码；已登记描述文件保留，不影响旧运行。

## Open Questions

无。模块与文件明细已按来源能力定为非目标。
