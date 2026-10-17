# Tasks

## 1. 数据集描述文件

- [x] 1.1 新增 `backend/jit_baseline/datasets.py`：描述文件读写、字段定义生成、版本名校验与幂等登记；验证：`backend/tests/test_datasets.py` 覆盖登记幂等、缺字段拒绝与未知 schema 拒绝并通过。
- [x] 1.2 在 `backend/jit_baseline/cli.py` 增加 `register-dataset` 子命令（`--csv`、`--schema`、`--dataset`、`--version`、`--output`）；验证：在临时目录连续执行两次，生成文件逐字节相同，输出含数据集名与版本名。
- [x] 1.3 复用 `data.parse_source` 的质量统计并写入描述文件；验证：测试断言描述文件中的 `quality` 与 `parse_source` 返回值一致。
- [x] 1.4 新增 `backend/data/datasets/README.md` 说明描述文件格式与登记流程；验证：README 中的命令可直接执行成功。

## 2. 运行声明接入描述文件

- [x] 2.1 `backend/jit_baseline/config.py` 的 `SOURCES` 条目增加可选键 `datasetManifest`（默认 `None`）；验证：测试断言既有条目仍能解析且新键可读。
- [x] 2.2 `backend/jit_baseline/artifacts.py` 的 `verify_run` 按 `config.datasetManifest` 分流校验描述文件；验证：测试中带该键的运行按描述文件校验通过，不带该键的旧运行仍按 `cohort` 校验通过。
- [x] 2.3 `build_run` 在运行 `config` 中记录描述文件路径与 SHA-256；验证：构建测试断言两字段存在且与描述文件一致。

## 3. 存储迁移 v2

- [x] 3.1 新增 `backend/jit_baseline/migrations/002_commit_data.sql`，建 `dataset_record`、`commit_record`、`feature_record`、`modified_entity`、`import_run` 五表（全部 `IF NOT EXISTS`）；验证：执行 `catalog-init` 后 `sqlite_master` 含五表。
- [x] 3.2 `backend/jit_baseline/catalog_storage.py` 改为 `MIGRATIONS` 元组与 `VERSION = MIGRATIONS[-1][0]`，`initialize()` 支持 v1 库升级；验证：从 001 库升级后 `schema_migration` 为 2 且旧表数据保留。
- [x] 3.3 在 `backend/README.md` 增补迁移说明；验证：按文档命令从 v1 库升级成功。

## 4. 提交数据导入

- [x] 4.1 新增 `import-dataset` 命令：读描述文件与 CSV，在单个事务内写 `dataset_record`、`commit_record`、`feature_record`、`import_run`；验证：导入后 `commit_record` 行数等于 CSV 纳入行数（12,374）。
- [x] 4.2 导入失败整体回滚；验证：注入无效行后库中无该批数据，`import_run` 记录 `failed` 与错误码。
- [x] 4.3 重复导入幂等；验证：同一批导入两次后 `commit_record` 行数不变。
- [x] 4.4 按 schema 写入特征并拒绝不可用字段；验证：`feature_record` 只含 schema 声明为入模的字段，写入不可用字段被拒绝。

## 5. 只读 API

- [x] 5.1 新增 `GET /api/v1/datasets` 与 `GET /api/v1/datasets/{name}/versions`；验证：测试返回已登记条目，未知数据集返回 404。
- [x] 5.2 新增 `GET /api/v1/commits` 与 `GET /api/v1/commits/{commit_id}`；验证：按版本查询返回提交与特征，未知提交标识返回 404。
- [x] 5.3 启动时加载描述文件，缺失或校验失败即启动失败；验证：测试中删除描述文件后启动抛出可定位错误。
- [x] 5.4 在 `backend/README.md` 增加接口说明；验证：文档示例与实际响应一致。

## 6. 集成验证

- [x] 6.1 运行全量测试：`pytest --basetemp backend/tests/.tmp`；验证：0 failed。
- [x] 6.2 运行 `openspec validate add-dataset-registry-and-commit-persistence --strict`；验证：输出 valid。
- [x] 6.3 登记并导入真实 `openstack-six-v1` 数据集，抽查一条提交；验证：`GET /api/v1/commits/{commit_id}` 返回该提交的特征与标签。

## Workflow follow-up

- 归档变更前按项目评审要求检查提案、规格与实现的一致性。
- 归档后确认 `dataset-registry` 与 `commit-persistence` 合并进主规格。
