# 内置模型包交付与冻结分区口径（2026-11-11）

本记录只写本轮实际执行的命令、产物身份与结果。没有运行的内容不写“通过”。

## 一、内置九模型包在新环境初始化失败（W1）

### 复现

```
cd backend
./.venv/Scripts/python.exe -m pytest tests/test_model_packages.py::test_catalog_init_bootstraps_repository_bundle_and_skips_second_time -x -q --basetemp=D:/tmp/pytest-jit-w1
```

结果：`first["status"]` 为 `partial`，`registeredCount=5`、`failedCount=4`。失败的四项是全部深度方法：

| 方法 | 产物 artifactRunId | 失败原因（修复前） |
| --- | --- | --- |
| `tabular-resnet-v1` | `552262abd377fd9d7fc3b73a41568fa1c33b820c183edeb6e02c2011585e938a` | 指标与完整测试风险不一致 |
| `ft-transformer-v1` | `b088f8691af44eb2e00df3deaad7bb8b18a87f7045b0fb8fa51cf322a5043ed5` | 指标与完整测试风险不一致 |
| `mlp-v1` | `8424e86fa9fe03b414b3c0d71b5409d3eb9889299223278f81c2ca141dd1145f` | 时间桶聚合无效：第 24 个桶的风险分布与重算结果不一致 |
| `wide-deep-v1` | `a316189b925d20ac584d53ceec097ba8c79ad187db5919cbf87bfa89c32e0e5c` | 时间桶聚合无效：第 26 个桶的风险分布与重算结果不一致 |

包身份：`jit-nine-models-v1.zip`，SHA-256 `3c15b7d9453291ba5c106e09b93403e234c0c1c67c0413b2d3654820f3377d76`，9 个模型、81 个文件。

### 根因

逐个模型把包解出到 `D:\tmp\w1-deep` 后重算：

```
method=mlp-v1            maxdiff=5.960e-08  atol=1e-06  n_over=0
method=tabular-resnet-v1 maxdiff=5.960e-08  atol=1e-06  n_over=0
method=ft-transformer-v1 maxdiff=7.451e-08  atol=1e-06  n_over=0
method=wide-deep-v1      maxdiff=5.960e-08  atol=1e-06  n_over=0
```

本机重算与交付参考预测的差异约 1e-7，落在方法声明的 `atol=1e-6` 内；预测比较本身通过。失败发生在随后两步**严格**比较：

- `verify_run` 用本机重算的风险重算指标，再与 `summary.json` 的指标做 JSON 身份比较。指标未取整，1e-7 的漂移会改写末位（如 ROC-AUC `0.7640496` 与 `0.7640318`）。
- 时间桶聚合用本机重算风险重建每桶中位数/分位数，再做严格相等比较。

这些聚合记录的真实来源是交付时冻结的 `reference-predictions.json`，不是本机重算结果。用重算结果做严格比较，等于要求跨 CPU/框架版本逐位一致，与方法声明的容差口径矛盾。

### 修复

`backend/jit_baseline/artifacts.py` 的 `verify_run`：

- 模型与参考预测的差异仍按方法声明的 `atol`/`rtol` 判定（`check_reference_predictions`，不变）；
- 记录的指标与时间桶聚合改为按**冻结参考预测**严格重算后比较；
- 篡改模型超过容差仍失败；改写指标或聚合使其不等于参考预测的函数仍失败。

没有跳过任何模型、没有改断言容差、没有改模型包或参考预测。新增测试
`test_recorded_aggregates_are_functions_of_the_frozen_reference_predictions`：
注入 ±5e-3 的逐条漂移（容差放大到 1e-2 以便观察）后校验通过，同时证明同样漂移会改变未取整指标、二次篡改指标仍被拒绝。

### 验证

隔离空目录（`D:\tmp\w1-cli`）：

```
./.venv/Scripts/python.exe -m jit_baseline.cli catalog-init --database D:/tmp/w1-cli/catalog.sqlite3 --artifact-root D:/tmp/w1-cli/artifacts
```

- `status=completed`、`registeredCount=9`、`failedCount=0`；
- 九个模型全部 `state=ready`，`isDefault` 恰为 1；
- 逐模型 `load_model` 并真实预测（测试成员 1853 条，openstack-six-v1）：

| 方法 | 首个测试提交风险 |
| --- | --- |
| decision-tree-v1 | 0.114286 |
| tabular-resnet-v1 | 0.132750 |
| logistic-regression-l2-v1 | 0.115753 |
| wide-deep-v1 | 0.118668 |
| gaussian-naive-bayes-v1 | 0.247180 |
| mlp-v1 | 0.127690 |
| random-forest-v1 | 0.139628 |
| ft-transformer-v1 | 0.120990 |
| gradient-boosting-v1 | 0.164290 |

- 第二次导入 `skipped=True`、`status=completed`、模型数仍为 9（幂等）；
- `tests/test_model_packages.py` 25 项全部通过（含坏模型、损坏条目、并发导入、版本不支持等失败路径）。

### 同一批历史失败中的另外三项

旧审计把 9 项失败都归为“PyTorch 重算”。逐项复跑后，只有 4 项属于上面的模型包问题；其余是独立的契约/测试漂移：

1. `test_model_policy.py::test_upgrade_from_v7_preserves_models_and_history_and_sets_initial_default`：v7 仿真没有删除迁移 033–035 新增的 `training_experiment*`、`user_*`、`dataset_owner` 与 `model_version.owner_user_id`，重放迁移时报“表已存在”。补上这些结构；升级断言改为按 v7 原有列比较既有行，并显式断言新增列补齐为空值。
2. `test_model_policy.py::test_model_policy_contract_matches_real_responses`：OpenAPI `ModelInfo`/`ModelDetail` 缺少响应里已有的 `parameters`、`parameterContract`、`ownerUserId`，`ModelChoiceList` 缺少 `mine`。补齐契约。
3. `test_catalog_api.py::test_old_model_reads_matching_frozen_diagnostic_and_benefit_without_admin_fields`：用例复制本机 `backend/artifacts/baseline`，而该目录已被重建（`artifactRunId=e06a6332…`、模型哈希 `581896…`），冻结诊断绑定的是仓库内置包里的原运行（`artifactRunId=2afd69…`、模型哈希 `d572e978…`、数据版本 `openstack-8479…`）。改用内置包中的原产物，未改冻结报告。

## 二、冻结成员与分析分区（W2）

### 实现

新增 `backend/jit_baseline/model_lineage.py`：从目录库加载模型，读其 `split.json` 成员，核对

- 模型可加载且目录身份由目录库校验；
- 摘要声明切分策略且与切分文件 `policy` 完全一致、成员摘要等于 `memberSha256`；
- 迁移 030 之前的旧运行没有策略摘要：成员文件仍由清单哈希保护，改按“每分区成员数 = 声明计数”核对，并在覆盖说明里标 `memberVerification=counts`；
- 模型数据版本必须等于分析绑定的数据版本。

`analysis_scope.build_scope` 与 `project_trends._partition_coverage` 共用这一份核对。分区语义：

| 分区 | 判定 |
| --- | --- |
| train / validation / test | 在模型运行的冻结成员里 |
| excluded | 不满足数据集纳入规则（无新增行、变更/文件超限、14 维特征缺失） |
| holdout | 成员外、且时间不早于训练截止——显式时间视图，不是测试集 |
| notIncluded | 成员外、满足纳入规则、在训练截止之前 |
| unassigned | 没有提交时间 |
| scored | 现成模型，没有本地训练分区 |
| unknown | 没有可核对的谱系 |

`partition_for` 不再把“时间落在训练区间”当作训练成员。留出数量与分区标签来自同一总体（已排除清洗排除项），避免计数口径不一致。

### 真实数据核对（本机开发库，只读）

| 仓库 | 模型 | 覆盖状态 | 训练/验证/测试 | 留出（时间视图） | 未纳入 | 总提交 |
| --- | --- | --- | --- | --- | --- | --- |
| claude-scholar | `b9b24d11-933d-497f-8a7b-ac976f0150df` | verified（counts） | 105 / 22 / 23 | 11 | 17 | 178 |
| sub2api | `8f5653b5…`（repository-sync-8f5653b5） | verified（counts） | 2748 / 582 / 585 | 1391 | 146 | 5452 |

claude-scholar 的数字与上一轮页面口径一致，但现在来自真实成员 ID，而不是时间边界推断；子总api 原先被整段标成“未分段”，现在能按成员区分。四个现成模型分析（JIT、jit-defect-prediction、cupk-navigator、cc-switch）显示 `scored`，不再显示训练分区。

### 契约与前端

- `docs/api/openapi.yaml`：`CommitPartition` 增加 `notIncluded`、`unknown`；新增 `AnalysisPartitionCoverage` 并作为 `AnalysisScope.partitionCoverage` 必填字段。
- 前端 `COMMIT_PARTITIONS`/`PARTITION_LABELS` 同步；分析口径卡在没有可核对成员时显示原因，并说明留出是时间视图而不是模型成员。

### 测试

- 新增/改写 `backend/tests/test_analysis_scope.py` 10 项：成员优先于时间、清洗排除、留出时间视图、未纳入、未知谱系、现成模型、纳入规则、真实运行端到端计数守恒、成员摘要不一致降级、数据版本不一致降级、旧运行计数核对与计数不一致降级。
- 相关后端测试 134 项通过（`test_openapi`、`test_analysis_scope`、`test_project_trends`、`test_project_partition_trends`、`test_repository_sync`、`test_catalog_api`）。
- 前端 `AnalysisScopeCard` 4 项通过，`tsc -b` 无错误。

## 三、边界

- 跨平台未验证：本轮只在本机 Windows + Python 3.14 + 当前依赖版本上运行，不声称 macOS/Linux 已通过。
- 旧模型（迁移 030 之前）无法核对成员摘要，只有清单哈希与分区计数的核对；覆盖说明里单独标注，不当作与摘要核对等价。
- 本机 `backend/artifacts/baseline` 是重建产物，和仓库内置包不是同一运行身份；开发库中登记的模型身份保持不变，本轮没有替换默认模型或重写任何模型产物。
