# Tasks

## 1. 采集与登记（后端）

- [x] 1.1 在 `backend/jit_baseline/collect.py` 暴露同步所需的采集入口：确认 `collect_repository` 已能接收公开 HTTP(S) 地址、分支、`since`、`until`、`limit`，返回 `records` / `csv` / `collection` / `skipped`；补齐"只接受 `http`、`https` 与本地路径以外的协议被拒绝"的校验。
- [x] 1.2 把采集结果写入 `backend/data/datasets/kamei14-git-v1/` 下的版本目录，调用 `store.register(...)` 登记为 `kamei14-git-v1` 新版本，并在描述文件中带上仓库标识、分支、窗口、SZZ 统计与限制（沿用 `RCL-05`、`RCL-06`）。（实际实现说明：数据集名取 `kamei14-git-v1-<仓库名>`，版本文件为 `<dataset>/<dataset>-<start>_<end>.csv`。版本名必须严格等于 `<dataset>-<start>_<end>`（`datasets.VERSION_PATTERN`），若所有仓库共用 `kamei14-git-v1`，同窗口的两个仓库会撞版本名；因此把仓库名并入数据集名。同一仓库再次同步若窗口与采集元数据完全相同则复用同一版本，否则版本名追加 8 位内容哈希后缀。）
- [x] 1.3 为"提交数超过上限""窗口内没有可标记提交""仓库不可达/分支不存在"三种情况实现结构化错误码，供作业层落库与前端映射（`RCL-07`）。

## 2. 打分模型（后端）

- [x] 2.1 在 `backend/jit_baseline/artifacts.py` 的 `build_run(...)` 增加可选参数 `holdout`（epoch 截止时间，默认 `None`）：传值时只用 `epoch < holdout` 的记录参与 `temporal_split` / 训练 / 评估，质量统计与文件校验仍按全量；不传时行为不变。
- [x] 2.2 实现打分模型来源的选择与判定：创建时接受 `strategy`（`auto` / `generic-model` / `force-train`，默认 `auto`）；按 `HOLDOUT_DAYS = 90` 切出训练窗口，统计训练区提交数、正例数与时间切分后测试段正例数，对照 `MIN_TRAIN_RECORDS = 200`、`MIN_TRAIN_POSITIVES = 20`、`MIN_TEST_POSITIVES = 3` 给出建议；`auto` 按建议执行，`force-train` 越过建议但必须通过时间切分的硬约束，`generic-model` 直接跳过训练。
- [x] 2.3 训练路径：用 `dataset_manifest` 驱动 `build_run` 产出 `kamei14-git-v1` 运行目录，记录所选算法版本与 `holdout`；再由 `ModelCatalog.candidates()` 以 `channel='repository-sync'` 调用 `register(...)` 完成准入与登记（`MC-02`、`MC-07`）。
- [x] 2.4 通用模型路径：从 `ModelCatalog` 中选出 `openstack-six-v1` 且可加载的模型，实现 14 维记录到 6 个入模字段的投影（`ns`、`nd`、`nf`、`ent`←`entropy`、`la`、`ld`），复用 `predict_risks` 直接打分；没有可用模型时返回 `noGenericModel` 让作业失败。
- [x] 2.5 两条路径都写入同一份 `repository_commit`，并记录用户选择 `requestedStrategy`、实际执行 `modelStrategy`、`degradeReason` 与训练区 `trainRecords` / `trainPositives`，保证结果页能回答"这次用的是哪个模型、为什么用它"。

## 3. 同步作业编排（后端）

- [x] 3.1 新增 `backend/jit_baseline/migrations/002_repository_sync.sql`，建 `repository_sync` 与 `repository_commit` 两表，加入 `catalog_storage.MIGRATIONS` 并保证重复启动幂等。（实际文件名 `003_repository_sync.sql`：`002_commit_data.sql` 已占用 002，迁移版本号必须递增且不可复用。）
- [x] 3.2 新增同步编排模块：单 worker `ThreadPoolExecutor(max_workers=1)` 依次执行 `collecting` → `registering` → `training` → `scoring`，`training` 阶段按 2.2 的判定选择训练或降级，每步更新作业的 `status` / `stage` / 产物标识；失败落 `failed` 与错误码，重启时把未结束作业标 `interrupted`。降级不算失败，仍走到 `completed`。
- [x] 3.3 `scoring` 阶段用该作业登记的模型对窗口内全部提交打分，写入 `repository_commit`（含 `features_json`、`label`、行数、文件数），并保证重复打分幂等。
- [x] 3.4 实现"同仓库同参数并发创建复用同一作业"的判断（`RCL-08`）。
- [x] 3.5 作业超时（默认 600 秒）与被取消/失败后的资源清理：临时克隆目录必须删除。

## 4. HTTP 接口（后端）

- [x] 4.1 `POST /api/v1/repository-syncs`：创建前校验地址、分支、日期区间、提交上限与 `strategy` 取值；非法输入返回 `INPUT_INVALID` 且不建作业。
- [x] 4.2 `GET /api/v1/repository-syncs` 与 `GET /api/v1/repository-syncs/{syncId}`：返回状态、阶段、失败码与失败说明、`requestedStrategy`、`modelStrategy`、`degradeReason`、训练区样本数、数据集版本、运行标识、模型标识。
- [x] 4.3 `GET /api/v1/repository-syncs/{syncId}/commits`：`limit` 1..200、`offset` 校验，按 `risk DESC, epoch DESC, commit_id ASC` 分页返回。
- [x] 4.4 `GET /api/v1/repository-syncs/{syncId}/commits/{commitId}`：返回 14 字段原始值、风险、标签与"未观测到缺陷引入"的说明。
- [x] 4.5 把新增路径加入 `team_access.py` 的成员路径，并补齐 `RequestValidationError` 统一为 `INPUT_INVALID` 的处理。

## 5. 契约与文档

- [x] 5.1 更新 `docs/api/openapi.yaml`：新增 5 个 `/api/v1/repository-syncs` 路径，并修正 `/api/v1/datasets` 与 `/api/v1/datasets/{name}/versions` 的 `x-implementation-status`（实际已实现却标 planned / 未收录）。
- [x] 5.2 更新 `README.md` 与 `docs/产品设计文档.md` 的模块与接口清单，说明新增数据来源与同步作业。
- [x] 5.3 在 `docs/产品需求文档.md` 的 5.4「首版之外」中把"Git 历史采集与自建 SZZ 管线"标记为已落地，避免文档继续与实现冲突。

## 6. 前端

- [x] 6.1 `AppShell.tsx` 增加「数据来源」入口；新增 `RepositorySourcesPage`：表单（仓库地址、分支、起始日期、提交上限、打分模型来源三选一，默认「自动」并标注推荐理由）、同步按钮、作业列表（状态、时间、失败原因与下一步）。
- [x] 6.2 作业创建后轮询 `GET /api/v1/repository-syncs/{syncId}` 直到 `completed` / `failed`；轮询在离开页面时停止。
- [x] 6.3 `useDataset.ts` 增加 `repositoryLoader`（按 `syncId` 分页拉取）；`App.tsx` 工作台增加来源徽章、数据源选择器与 `?mode=repository&sync=<id>` 的 URL 同步。
- [x] 6.4 工作台列表接后端分页：保留前端的搜索/日期/排序交互，改为服务端过滤与分页（不再整批加载）。（仓库来源已由 `useCommitPage` 调 `GET /api/v1/repository-syncs/{id}/commits` 的 `search`/`start`/`end`/`sort`/`limit`/`offset`，界面按页显示「第 x–y 条，共 n 条」并给上一页/下一页；清单视图逐条取详情。历史回放仍走 `/api/review-batch` 整包，因其是固定 1,853 条的本地快照。）
- [x] 6.5 提交详情抽屉在仓库来源下展示 14 字段原始值、风险、标签说明，并注明"最新提交没有标签，风险只是估计"。
- [x] 6.6 失败码到人话的映射表（`DATASET_INVALID`、`SPLIT_INVALID`、`STORAGE_UNAVAILABLE` 等按 `stage` 区分），每条附一个"下一步"。
- [x] 6.7 结果说明：`auto` 降级时显示"样本不足，使用通用模型（未在该仓库验证）"与实际训练区样本数；`force-train` 成功但低于建议门槛时显示"你选择了强制训练，训练区仅 X 条提交、Y 个正例，指标波动会很大"。

## 7. 测试

- [x] 7.1 后端：新增 `tests/test_repository_sync.py` 覆盖创建校验、状态流转、失败码、单 worker 串行、重复创建复用、重启标 `interrupted`、`repository_commit` 分页排序。
- [x] 7.2 后端：`tests/test_artifacts.py` 补 `holdout` 用例（默认不变、传值时只切分前缀、样本不足时报错）。
- [x] 7.3 后端：`tests/test_sync_model_strategy.py` 覆盖四个分支——`auto` 数据充足走训练、`auto` 样本不足降级并带 `degradeReason`、`force-train` 低于建议门槛仍训练且记录样本数、`force-train` 无法时间切分时失败；并覆盖 14 维到 6 维投影的字段对应（`ent`←`entropy`）。
- [x] 7.4 后端：端到端用例用本地临时 git 仓库（`test_end_to_end.py` 现成的造仓方式）跑通"采集 → 登记 → 训练 → 登记模型 → 打分 → 接口返回"，断言工作台列表排序与详情字段；再造一个提交很少的仓库跑降级路径。
- [x] 7.5 前端：`RepositorySourcesPage` 与 `repositoryLoader` 的单测/组件测试（表单校验、轮询、失败提示、降级提示、来源切换）。
- [x] 7.6 前端：e2e 覆盖"从数据来源页发起同步 → 轮询到完成 → 工作台出现仓库数据与徽章 → 打开提交详情"。
- [x] 7.7 回归：既有 25 个后端测试与 19 个前端测试保持通过，OpenStack 回放与演示模式行为不变。

## 8. 验证与证据

- [x] 8.1 用真实公开仓库跑一次完整同步，记录耗时、提交数、标签分布、训练区样本数与正例数、实际走的模型策略与非功能证据（写入 `docs/evidence/_run/`）。
- [x] 8.2 验证失败与降级路径：不可达地址、不存在分支、提交超限、样本不足降级、无兼容模型五种情况，各留一条可复现记录。
- [x] 8.3 冻结证据：`python -m jit_baseline.cli freeze-evidence docs/evidence/<change>` 后用 `check-evidence` 校验。
