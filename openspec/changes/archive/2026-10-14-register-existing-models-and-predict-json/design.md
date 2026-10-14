# Design

## Context

动机与范围见 [proposal](proposal.md)，行为见三个增量规格。2026-10-14 重新探索的本地 HEAD 为 `a871eba`，工作区在创建 change 前干净；没有其他活动 change。

新合并的 `add-classic-methods-and-comparison` 已将 `ALGORITHMS`／`ESTIMATORS` 扩展至五个经典方法，并新增 `compare_methods()`、`compare-methods` 和 PDB-20。`trainingSeconds` 在摘要中，不在运行身份中。本机目录仍主要是旧六字段基线、决策树及各自复现；方法已注册不表示本机有对应训练产物。

`create_app(directory=DEFAULT_RUN)` 仍只有历史 GET，启动加载一个 `Snapshot`；`verify_run()` 完整校验并重算风险和评价，`Snapshot.load()` 只读服务必要文件、不读取测试标签，`predict_risks()` 消费已按 schema 排列的原始向量并使用已拟合流水线。`feature_matrix()` 只检查矩阵宽度、有限非负值，不能替代 JSON 的字段名、整数和布尔校验。`log_counts()` 是旧模型反序列化兼容入口，须保留。

当前 OpenAPI 仍是目标草案：UUID 模型来源、完整十四字段请求、解释 pending/ready/failed 和候选 TeamToken。它与当前十二字段 schema 有差异，实施时仅把本轮接口收敛为可实现的六字段契约，不改变 `kamei14-v1` 的十二项入模声明。

## Goals / Non-Goals

**Goals:**

- 登记与预测分为应用服务，CLI／HTTP 共用准入规则，SQLite 保存身份和成功结果。
- 登记来源与文件位置分离，容纳新旧方法、旧模型入口和相同运行的多个复现目录。
- 错误、权限、存储失败和恢复均有明确可测试的行为。

**Non-Goals:**

- 不把方法清单复制成另一套训练注册机制，不按测试表现自动选择模型。
- 不落地完整产品的十三张表、任务队列或账户系统；数据层仅为本轮目录与预测服务。
- 本轮 Web 入口指管理员可调用的 HTTP API；前端管理／预测页面和历史工作台接入 `feature-input` 另行实施。

## Decisions

### D1. SQLite 与可控初始化

用户已选 SQLite。使用标准库 `sqlite3`、版本化 SQL 文件和 `schema_migration` 记录，不追加 ORM／Alembic 依赖。每个连接启用并检查外键，设置有限 busy timeout（首版 5 秒），连接不跨请求共享。校验、加载、推理在写事务之外；成功发布使用短事务与唯一约束，锁超时映射 `STORAGE_UNAVAILABLE`。

新增受维护者权限控制的 `catalog-init` CLI，显式初始化／迁移数据库；HTTP 启动只检查版本，不自动改表。默认库为 `backend/storage/catalog.sqlite3`，该运行数据目录实施时加入 `.gitignore`；测试用临时独立数据库。启动时不初始化或要求目录数据库才能使用原历史 GET。新目录／预测接口遇到缺库、未知版本或不可读库返回 503。

备选：PostgreSQL 需另维护数据库服务；ORM 增加依赖与迁移工具；零版本号直接建表无法判断升级兼容性。均不作为首版实现。

### D2. 数据模型与不可变身份

采用以下最小结构，复用产品设计实体含义，但不一次建立其全部候选表：

| 表 | 关键内容／约束 |
|---|---|
| `schema_migration` | 迁移版本与应用时刻 |
| `dataset_version` | UUID、原 datasetVersion 唯一、发布者来源／规则／质量快照 |
| `experiment_run` | UUID、原 artifactRunId 唯一、数据版本 FK、声明 config／schema 快照、产方环境；标明登记已有成功运行 |
| `model_version` | UUID、run FK 唯一、原方法模型标识、方法名、模型 hash、schema、当前校验状态、首选位置 FK、局限 |
| `run_location` | UUID、run FK、root id＋相对 key 唯一、本位置完整 manifest／hash、摘要／训练耗时、校验环境与时刻 |
| `registration_event` | requestId、候选标识、HTTP-admin 或 local-cli、成功／复用／失败、错误码、可空 run/model FK |
| `prediction_batch` | UUID、模型 FK、project、schema、规范化输入 JSON／hash、当时模型来源快照、UTC 创建时刻 |
| `prediction` | UUID、batch FK 唯一、recordId、可空真实 SHA／时间、原始 features、有限 [0,1] 风险、解释未支持原因 |

schema 权威仍在 `schemas.py`；数据库保存登记时快照及 hash 用于核对，不提供数据库编辑 schema 的入口。成功批次恰一条记录，由应用事务与 unique(batch_id) 保证；UUID 以文本、UTC 时间以带 Z 的 ISO 字符串保存。

原 runId 是 config 内容身份，不等于目录位置或完整 manifest hash。同身份的两个复现目录可以有不同 generatedAt、summary.trainingSeconds，因而 summary／manifest hash 不同：先各自完整 verify，再按原 runId 复用业务 UUID，将位置快照分别写入 `run_location`。不得跨位置混用 manifest 和 summary；不得因这些辅助 hash 不同否认同一运行。不同原 runId 即使同模型 hash 仍分别登记。

成功重新登记一个位置，将其设为该模型首选位置；位置切换只由明确登记触发，不自动故障转移。并发靠原 runId 唯一、模型 run FK 唯一及事务保证；同位置幂等 upsert。登记成功事件与目录一起提交，正常准入失败单独记录失败事件；存储本身失败时只返回脱敏诊断，不能承诺写入失败事件。

备选：只按模型 hash 去重会合并不同实验；只按目录去重会把复现当新版本；单个 manifest hash 无法表达相同运行的辅助摘要差异。

### D3. 受控候选与两个登记入口

默认扫描 `backend/artifacts/` 的直接运行子目录及 `artifacts/external/` 的直接交付子目录，排除 `development`、缓存与测试目录。不递归扫描整个仓库；只发现含 manifest 的目录。候选标识由 root id 和规范相对 key 形成不透明标识，列表返回显示名称、可解析的原运行／方法／schema、manifestSha256 及候选诊断，不返回绝对路径。发现阶段只读有上限的 manifest JSON，不反序列化模型。

Web 请求为 `{candidateId, expectedManifestSha256}`，禁止 path、URL、模型上传和任意附加字段。提交前重新解析候选并核对 manifest hash，已变化返回 409 CONTEXT_MISMATCH。CLI `register-model --run-key <相对产物key>` 也解析同一受控根；两个入口调用同一登记服务。所有路径在加载前解析到实际路径，拒绝越界、junction／symlink 指向根外及未授权位置。

登记在 HTTP 请求中同步完成完整 `verify_run()`，不引入后台训练任务。比较结果只作既有实验来源，登记不调用 `compare-methods` 挑选方法。校验结束再次核对文件集合与 hash，稳定后在短事务提交；失败不发布 ready。登记不移动、覆盖或改写产物，也不把深度／经典声明之外的方法悄悄换成默认方法。

备选：HTTP 上传模型需要另立交付协议；只登记 manifest 缺乏实际加载／重算证据；后台队列扩大本轮恢复与状态范围。

### D4. 两类凭据和六个 API

环境配置建议名为 `JIT_MEMBER_TOKEN` 与 `JIT_ADMIN_TOKEN`，两者必须非空且不同；配置仅进入服务器内存，不入库，不输出值。用固定时间比较判定角色，所有新接口在业务解析、目录发现或加载前完成认证。配置无效为 503 ACCESS_CONFIG_INVALID；否则无效认证为 401 AUTH_REQUIRED，权限不足为 403 ACCESS_DENIED。管理员拥有成员能力。CLI 依赖主机维护权限，不要求 HTTP token。

| 操作 | 角色 | 成功与主要失败 |
|---|---|---|
| GET `/api/v1/model-candidates` | admin | 200 候选列表；503 配置错误 |
| POST `/api/v1/models/register` | admin | 201 新登记、200 复用身份；404 候选不存在，409 上下文改变，422 请求错误，503 产物／模型／存储错误 |
| GET `/api/v1/models` | member/admin | 200 模型列表，可用 state=ready/invalid 过滤；503 存储错误 |
| GET `/api/v1/feature-schemas/{version}` | member/admin | 200 schema 及入模／不可得字段、jsonPredictionSupported；404 未知 schema |
| POST `/api/v1/predictions` | member/admin | 201 单记录批次；404 模型不存在，422 输入或 schema 错误，413 超限，503 模型／存储错误，500 推理错误 |
| GET `/api/v1/prediction-batches/{batchId}` | member/admin | 200 保存结果；404 不存在，503 存储错误 |

每个新 HTTP 响应返回 X-Request-Id，错误结构为 `error:{code,message,requestId,details?}`；异常信息归类后再公开。成功响应 Cache-Control:no-store。日志仅含操作、角色／通道、requestId、业务身份和结果。凭据共享意味着没有个人隔离与个人审计，这点写入部署说明。

原历史 GET 不经过新路由权限依赖，仍是现有本机无鉴权接口；serve 保留 `127.0.0.1:8000` 单进程。账户登录、浏览器持久 token 存储和扩大监听不在本轮。

备选：统一共享 token 无法隔离登记权限；完整账户／JWT 超出用户确认的角色凭据范围。

### D5. 严格 JSON 边界与原始特征推理

首版请求恰含 modelId、featureSchemaVersion、project、record；modelId 为 UUID，project／recordId 长度 1～128，record 允许 commitId（真实 40 位 SHA）和 time（带时区，规范为 UTC）。首版 JSON 体上限 64 KiB，由读取实际正文大小保证，不只信任 Content-Length。非法 JSON、重复属性、未知属性、NaN／Infinity 和错误类型返回 422；超限返回 413。

仅 openstack-six-v1 可创建新预测。计数字段使用严格整数语义，拒绝 bool、数值字符串和小数；ent 接受有限非负数但拒绝 bool。字段必须恰为六项；模型声明 schema 必须匹配。数据库可登记合法十二字段运行，但列表与 schema 响应标明 jsonPredictionSupported=false；请求该 schema 返回 INPUT_SCHEMA_MISMATCH 并注明未支持，不改其定义或猜 ent/entropy 别名。

字段按 `schema.in_model_names()` 组装原始向量，调用已有 `predict_risks()`；不重复 log1p／scale，不调用 fit，不调用历史 `batch()` 填充新记录。登记的全量 verify 可读评价标签；创建预测的路径只用 `Snapshot.load()` 服务文件与新输入，禁止读取 test-labels/reference-predictions。单条推理与交付参考值的比较只在验收中进行。

规范输入 hash 对 `{project,featureSchemaVersion,record}` 计算：校验后的数值及 UTC 时间规范化，JSON key 排序，禁止非有限值；模型身份不混入 inputSha256，而由批次的模型 FK／来源快照绑定。重复合法 POST 产生新 batchId，不引入未讨论的幂等键或 recordId 全局唯一约束。

备选：直接把请求 dict 转为数组会忽略字段名、接受布尔和字符串；强制调用方预处理会导致重复变换与训练／预测漂移。

### D6. 可用性、原子保存与历史结果分离

新预测使用首选位置，在每次使用前按登记的位置快照核验服务必要文件、实际解析路径、原 runId、model hash、schema 与环境，再加载匹配模型。首版不提供可绕过核验的长期模型缓存。新请求不读取 labels 或 reference 文件；全量登记校验和服务必要文件核验的职责保持分离。

发现不可用时，模型列表显示 invalid 及稳定原因，模型当前状态记录为 invalid，后续请求不自动因文件恢复变 ready；管理员重新完整登记才恢复。这里状态更新是当前可用性诊断，不改原运行 config 和已保存预测。若诊断无法保存，返回存储错误并禁止新预测。

推理完成后一个短事务保存 batch 与唯一 prediction；任何一步失败回滚，返回 STORAGE_UNAVAILABLE，不返回风险或 201。服务若在提交前中断，不存在半个成功批次；提交后但响应前中断，数据库仍有完整结果，再 POST 按创建语义产生另一个批次。

重开只读数据库成功结果，不加载当前模型。批次中的 model 是预测当时 ready 的来源快照，包含 UUID runId／modelId／datasetVersion 和额外 artifactRunId／artifactDatasetVersion／artifactModelId、model hash、method、schema 及来源环境；当前文件 invalid 不改写过去快照。结果单记录包含原特征、可空 SHA／时间、risk、predictionId、explanationStatus=not-supported 和 explanationReason。没有任务就不显示 pending。

备选：只相信登记时 ready 会在文件被换后继续使用旧缓存；重开时再次推理会随模型升级改变旧结果；将当前可用状态写入旧响应会与其预测当时来源混淆。

### D7. 兼容与验证安排

实施时把本轮六接口写入 `docs/api/openapi.yaml`，新登记接口追加独立 API ID，现有 API-05／08／09／11 按本轮契约落地。十四字段结构可继续作为将来候选，但本轮 PredictionCreate/PredictionRecord 只引用六字段；schema 查询仍可如实描述十二字段与 unavailable。新增两个稳定码 ACCESS_CONFIG_INVALID、STORAGE_UNAVAILABLE，候选非法时复用 INPUT_INVALID；新增 not-supported 及解释原因、原产物身份和 requestId 字段。未实现的比较 HTTP、CSV、解释等保持 planned。

测试以临时库和运行副本为主，保留非作者评审所需的角色矩阵、并发登记、SQL 失败注入、新输入与真实模型一致性、标签不可读时仍可预测、文件篡改及重启恢复证据。复用现有五种方法实现，至少以两个不同已训练方法验证无单模型硬编码；所有方法工厂的回归沿用既有测试。保留 test_method_comparison.py，专门验证训练耗时差异不导致登记重复。

运行证据按既有 VEV 规则写 `docs/evidence/_run/`，本轮 proposal 不运行产品验收、训练或冻结正式证据。实施完成后才执行测试与完整验证，冻结另作显式步骤。在线 JSON 性能至少对验收两模型各测 200 次合法请求，记录环境、原始计时、错误与最近秩 P95，建议目标 ≤2 秒；不声称完成四个 LAN 客户端或所有未来模型验收。

## Risks / Trade-offs

- [共享角色凭据不能识别个人] → 审计只声称角色／通道，账户与个人追踪留后续。
- [SQLite 写入竞争] → 加载／推理不持写事务，唯一约束消解登记竞争，有限等待并显式报错；不声称可无成本迁移 PostgreSQL。
- [文件和 DB 不能跨介质原子提交] → 登记仅引用已交付文件，保存位置快照、提交前后核对；备份包含数据库与引用文件，恢复后重新校验。
- [本机或外部可信产物位置可能被改变] → 解析实际路径、候选 hash 冲突检查、使用前核验，不接受浏览器上传模型；本机文件系统仍是运维信任边界。
- [同步完整登记与每次加载存在耗时] → 登记与预测耗时分开测量；先实测，后续缓存只能在保留相同核验语义下引入。
- [README、设计部分计数落后于五方法源码] → 文档更新以方法清单和实际运行清单分别记录，不从 README 推断模型可用数。

## Migration Plan

1. 先实现存储迁移、权限配置及公共登记服务，维护者执行 catalog-init，在临时库验证约束和恢复。
2. 增加 CLI／管理员 HTTP 登记与查询；在合法运行副本上登记旧六字段逻辑回归及另一种方法，保持原文件不变。
3. 增加严格单条预测、原子提交与重开；同步机器可读契约、错误码、说明与待建状态。
4. 运行权限、并发、失败、恢复、单条模型一致性及旧 HTTP／比较回归，测量性能，保存运行证据。
5. 非作者审阅两个交付点；按既有流程显式冻结与校验后才归档。

回滚：停用新 `/api/v1` 路由并恢复旧服务配置，保留数据库和产物用于恢复；不执行 DROP、不删除成功结果或原训练产物。若迁移失败，恢复迁移前数据库备份，旧历史 GET 仍能独立运行。
