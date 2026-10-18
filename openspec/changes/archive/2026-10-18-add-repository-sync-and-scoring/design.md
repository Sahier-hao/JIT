# Design

## Context

动机见 `proposal.md` - Why。这里只列影响做法的现状约束。

- 采集器已存在且可直接复用：`backend/jit_baseline/collect.py:218` `collect(repo, since=None, until=None, branch="HEAD", limit=None)` 返回 `records`、`csv`（表头 `commit_id, author_date, bugcount` + 14 个入模字段）、`collection`（仓库、HEAD、窗口、git 版本、SZZ 统计、排除计数）与 `skipped`；`cli.py` 的 `collect-repository` 已在本地跑通过。它同时支持本地路径与远程地址（内部 `git clone --bare` 到临时目录后清理）。
- 登记入口已存在：`backend/jit_baseline/store.py` 的 `register(csv_path, schema=..., dataset=..., version=..., cohort=..., provenance=...)` 产出数据集描述文件；`dataset-registry` 的 DSR-01~07 已约束其内容与版本规则。
- 训练与运行产物已存在：`backend/jit_baseline/artifacts.py:141` `build_run(source_dir, output, schema=None, algorithm=None, metric_set=None, dataset_manifest=None)`；传 `dataset_manifest` 时**改读该数据集而不是 OpenStack 快照**，内部完成 `temporal_split` → `fit_model` → `predict_risks` → `evaluate` → `build_trend_buckets` 并写出运行目录。
- 模型登记已存在：`backend/jit_baseline/catalog.py` 的 `ModelCatalog.candidates()` / `register(candidate_id, expected_hash, channel=...)` / `load_model(model_id)`；受控目录扫描 + 完整准入由 `MC-01~06` 约束。
- 前端工作台现在只有两个来源：`demo` 与 `historical`（`frontend/src/useDataset.ts` 的 `demoLoader` / `historicalLoader`），后者整批拉 `/api/review-batch`，无分页。
- 现有服务是单进程 FastAPI（`backend/jit_baseline/api.py` `create_app`），SQLite 存储，没有任务队列或外部 broker。
- **两个硬约束**：(1) 采集产物是 14 字段 `kamei14-git-v1`，与 OpenStack 的 6 字段 `openstack-six-v1` 不同，模型不能跨 schema 复用；(2) 最新提交的 SZZ 标签天然是 0（还没被人修），`temporal_split` 要求 train 与 test 各含两类标签，否则抛 `SPLIT_INVALID`。

## Goals / Non-Goals

**Goals:**

- 让成员在界面内完成一次从仓库地址到可打分提交列表的闭环，中途不需要命令行。
- 作业可观察、可重试、失败可操作；产物（数据集版本、运行、模型）沿用既有登记与准入，不绕过 `RCL` / `DSR` / `MC` 的规则。
- 工作台能在三种来源间切换，来源信息随上下文切换，清单按上下文隔离。
- 仓库视图使用后端分页，不再整批加载。

**Non-Goals:**

- 不做定时/增量/webhook 同步；每次同步是一个独立全量窗口。
- 不做跨仓库混排列表、不做多作业并行采集。
- 不做缺陷行级定位、不做代码语义特征、不做自动修复建议。
- 不改变既有 OpenStack 回放的行为、数据与指标。

## Decisions

### D1 同步是持久化作业，不是一次 HTTP 请求

克隆、采集、训练通常超过单次请求可接受的时长，且失败必须可重试与可解释。做法：新增 `repository_sync` 表记录作业（`id`、`repository_url`、`branch`、`since`、`until`、`limit`、`requested_strategy`、`status`、`stage`、`error_code`、`error_message`、`dataset_version`、`run_id`、`model_id`、`model_strategy`、`degrade_reason`、`train_records`、`train_positives`、`created_at`、`updated_at`、`request_id`），创建接口立即返回作业标识，实际执行交给单 worker 线程池（`ThreadPoolExecutor(max_workers=1)`）。

- 状态取值：`queued` → `collecting` → `registering` → `training` → `scoring` → `completed`，失败为 `failed`，服务重启时未结束的作业标为 `interrupted`（可重试）。降级到通用模型不算失败，仍然走到 `completed`。
- `train_records` 与 `train_positives` 记录判定时的实际数字，供界面解释"为什么没有训练"。
- 单 worker 的理由：并发克隆同一磁盘与并发训练会互相拖慢、也难定位失败；串行足够支撑课程场景。
- 否决方案：背景任务队列（Celery/Redis）——单机部署引入外部依赖不划算；同步在请求内完成——超时与重试都不可控。

### D2 复用既有管线，只在 `build_run` 增加一个切分参数

同步编排按固定顺序调用已有函数，不重写采集、训练或准入逻辑：

1. `collect.collect_repository(url, since=..., until=..., branch=..., limit=...)` → CSV 与采集证据。
2. 把 CSV 落到该数据集目录，`store.register(...)` 登记为 `kamei14-git-v1` 新版本。
3. 按 D3 判定训练可行性，决定这次用哪个模型打分。
4. 训练路径：`artifacts.build_run(..., dataset_manifest=<描述文件>, holdout=<见 D3>)` 产出运行目录，再由 `ModelCatalog.candidates()` / `register(...)` 完成准入。
5. 通用模型路径：从模型目录取一个 `openstack-six-v1` 且可加载的模型，把 14 维记录投影成该模型的 6 个入模字段后直接预测，不产生新的运行目录。
6. 用确定的模型对窗口内全部提交打分，写入仓库视图表，并在作业记录里写明走了哪条路径与原因。

为此 `build_run` 增加可选参数 `holdout`（epoch 截止时间，默认 `None` 表示保持现有行为）：传值时只用 `epoch < holdout` 的记录做 `temporal_split` / 训练 / 评估，质量统计与文件校验仍按全量记录。理由：既保留 `PDB-03/04` 的时间隔离与可核算指标，又不修改既有代码路径的默认语义。

### D3 训练切掉最近 90 天；用哪个模型由用户选，默认按数据量给建议

最新提交不可能已被 SZZ 标出（还没人修），直接参与 `temporal_split` 会让 test 分区缺正例并触发 `SPLIT_INVALID`。做法：以窗口内最新提交时间 `T` 为基准，`holdout = T - 90 天`；`[since, holdout)` 用于训练与评估，`[holdout, T]` 只用于打分。`HOLDOUT_DAYS = 90` 首版固定，不暴露给界面。

创建作业时由用户选择打分模型的来源，表单提供三选一，默认选「自动」：

| 选项 | 行为 |
|---|---|
| `auto`（默认，推荐） | 采集完成后按下面的建议门槛判定：达标则训练，不达标则降级用通用模型 |
| `generic-model` | 跳过训练，直接用通用模型打分 |
| `force-train` | 无视建议门槛，只要物理上切得动就训练 |

建议门槛（软约束，只用于 `auto` 与提示）：

- `MIN_TRAIN_RECORDS = 200`：`[since, holdout)` 至少 200 条提交。
- `MIN_TRAIN_POSITIVES = 20`：其中至少 20 条正例。
- `MIN_TEST_POSITIVES = 3`：时间切分后测试段（约后 15%）至少 3 条正例。

物理底线（硬约束，`force-train` 也不能越过）：`temporal_split` 要求训练集与测试集各含两类标签，切不出来就无法训练。此时作业失败并提示"数据太少，无法完成时间切分，请改用现成模型"。

各路径的结果记录：

- 通用模型取自 `ModelCatalog` 中 schema 为 `openstack-six-v1` 且可加载的条目，把 14 维记录投影成该模型的 6 个入模字段（`ns`、`nd`、`nf`、`ent`、`la`、`ld`，其中 `ent` 取自采集器的 `entropy`）后直接预测。
- 作业记录用户的选择 `requestedStrategy`、实际执行的 `modelStrategy`（`repository-trained` / `generic-model`）与 `degradeReason`（`fewRecords` / `fewPositives` / `noTestPositive` / `noGenericModel`）。
- `force-train` 越过建议门槛但仍训练成功时，结果页必须标注"你选择了强制训练，训练区仅 X 条提交、Y 个正例，指标波动会很大"。
- `auto` 降级时必须注明"这个仓库的样本不足以训练，当前使用通用模型，效果未在该仓库验证"。
- 模型目录里没有可用的通用模型且用户选了 `generic-model` / `auto` 降级时，作业才失败，提示先用公开数据跑一次基线。
- 界面还要说明：最近的提交没有标签，风险只是估计；两条限制（提交级聚合、简化 SZZ）沿用 `RCL-06`。

理由：小仓库的真实困境是"提交少 + 没人修过"，直接失败会让功能对它完全不可用；而全自动替用户决定又会掩盖"我到底用了什么模型"。把选择权给用户、把建议和后果说清楚，比替用户拍板更诚实。

### D4 仓库视图预计算并落表，不做查询时实时打分

风险值需要参与排序与分页，SQLite 无法在 SQL 里跑模型。做法：同步最后一步用该作业登记的模型对窗口内全部提交打分，写入 `repository_commit` 表（`sync_id`、`commit_id`、`epoch`、`risk`、`added_lines`、`deleted_lines`、`files`、`features_json`、`label`），列表查询按 `risk DESC, epoch DESC, commit_id ASC` 分页。

- 理由：`CRR-06` 的排序规则需要稳定且可在 SQL 中复现；每个同步绑定自己的模型，不存在"模型换了视图不刷新"的问题。
- 否决方案：查询时实时算——无法分页排序、每次请求重复推理、模型加载被放大。

### D5 新增的接口与前端入口

接口（`docs/api/openapi.yaml` 同步补充，camelCase 与现有约定一致）：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v1/repository-syncs` | 创建同步作业，接受 `strategy`（`auto` / `generic-model` / `force-train`，缺省 `auto`），返回 `syncId` 与初始状态 |
| GET | `/api/v1/repository-syncs` | 列出作业（含已完成与失败） |
| GET | `/api/v1/repository-syncs/{syncId}` | 作业状态、阶段、失败原因、产物标识、`requestedStrategy`、`modelStrategy` 与 `degradeReason`、`trainRecords` / `trainPositives` |
| GET | `/api/v1/repository-syncs/{syncId}/commits` | 仓库视图分页列表（`limit` 1..200、`offset`） |
| GET | `/api/v1/repository-syncs/{syncId}/commits/{commitId}` | 单条提交详情（14 字段 + 风险 + 标签说明） |

前端：`AppShell.tsx` 增加「数据来源」入口；新增页面负责表单（含模型来源三选一）、作业列表与状态轮询；`App.tsx` 工作台增加来源徽章与数据源选择器，URL 用 `?mode=repository&sync=<id>`；`useDataset.ts` 增加 `repositoryLoader`（分页拉取）。

### D6 权限沿用成员身份，模型标注来源

同步创建、查询、仓库视图都归成员身份（`team_access.py` 的 `MEMBER_PATHS`），与"成员发起预测"同级；不做管理员门槛，否则评审员无法自助接入自己的仓库。同步产出的模型以 `channel='repository-sync'` 登记，列表在 `MC-04` 的来源字段中标明，不改变既有模型的任何状态。

- 防滥用：单 worker 串行 + 提交上限 + 仓库地址仅允许公开地址（拒绝 `file://`、内网地址与非 HTTP(S) 协议以外的形式）。
- 否决方案：创建归管理员——与 `MC-01` 的"候选登记需管理员"一致，但目标用户是评审员，会直接卡住主流程。

### D7 失败按阶段给出可操作提示，错误码集中映射

后端保留既有错误码风格（`DATASET_INVALID`、`INPUT_INVALID`、`STORAGE_UNAVAILABLE` 等），作业表额外记录 `stage`；前端按 `stage + errorCode` 映射为一句人话加一条下一步（例如"范围内提交数 3241 超过上限 500 → 缩小起始日期或调大上限"）。`RCL-08` 要求失败必须说明阶段与下一步，因此映射表作为前端常量维护，不用后端拼装中文长句。

## Risks / Trade-offs

- **大仓库克隆慢或占满磁盘** → 提交上限、起始日期、单作业超时（600 秒）与失败回收；不做仓库体量预估。
- **小仓库样本不足，训不出有意义的模型** → 采集后按 D3 门槛判定；`auto` 自动降级，用户强制训练时按硬约束兜底并在结果页标注样本量与波动风险。
- **用户强制训练拿到看起来能用的坏模型** → 结果页强制显示训练区样本数与正例数，指标只在 `[since, holdout)` 上计算，不给该来源任何"在线准确率"式表述。
- **通用模型跨项目套用效果未知** → 降级路径必须标注"未在该仓库验证"，且不再为这种来源展示公开数据集的测试指标。
- **标签偏差无法彻底消除** → 界面与运行产物披露"最新提交无标签"，不宣称在线准确率。
- **服务重启时作业中断** → 作业标 `interrupted` 并保留已登记的数据集版本，可重新创建作业；不做断点续跑。
- **14 字段与 6 字段模型不通用** → 通用模型路径必须经显式字段投影，投影缺字段或类型不符时按 `MC-04` 标为不可预测，不做隐式补齐。
- **SQLite 并发写** → 单 worker 与短事务，作业状态更新使用独立事务；沿用 `MC-06` 的 `STORAGE_UNAVAILABLE` 语义。

## Migration Plan

1. 新增迁移 `backend/jit_baseline/migrations/002_repository_sync.sql`（`repository_sync`、`repository_commit` 两张表），加入 `catalog_storage.MIGRATIONS`，启动时幂等执行。
2. 新接口与前端入口在有同步记录前返回空列表，工作台保持现有 `demo` / `historical` 两模式不变。
3. 首次真实同步产生 `kamei14-git-v1` 数据集版本与运行目录；OpenStack 既有数据集、运行与模型不受影响。
4. 回滚：隐藏前端入口并移除新路由；两张新表可保留（不参与既有查询），已产生的数据集与模型目录条目按 `MC-05` 单独标记不可用，不删除既有产物。

## Open Questions

- 同步超时初值取 600 秒是否足够覆盖中等仓库，需要在首次真实同步时实测后调整。
- 是否需要在作业列表里提供"删除/重试"按钮，或只保留"重新创建"，留到首版验证后再定。
- `HOLDOUT_DAYS = 90` 对提交密度低的仓库是否偏长，等真实仓库数据出来再评估。
- 训练门槛（200 条 / 20 正例 / 测试段 3 正例）是经验值，需要用两三个真实仓库校准后再固定。
- `auto` 模式下用户看到"建议"的时机：首版只在作业完成后展示实际选择了哪条路，不做"采集完暂停等用户确认"的两阶段交互；如果使用中觉得需要再补。

