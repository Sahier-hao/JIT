# 固定公开数据基线

> 当前产品操作与管理员权限以 [当前产品](../docs/当前产品.md) 为准；下文保留离线实验协议与交付说明。

本目录离线处理发布者 OpenStack 数据，按具名方法训练模型，并通过本机只读 HTTP 提供冻结测试批次。它是回顾性历史评价，六字段尚非完整 Kamei14，历史回放没有逐条解释或逐条 SZZ 复核；手工预测按方法声明保留支持的真实归因；完整课程要求仍需后续 change。来源与标签依据见 [DATA.md](DATA.md)，计算规则见 [PROTOCOL.md](PROTOCOL.md)，方法清单与按声明校验见 [PROTOCOL.md](PROTOCOL.md) 的「方法清单与按声明校验」一节。

## 建立环境和真实运行

在项目根目录使用 PowerShell（已验证 Python 3.14.2；依赖完整版本见 requirements.txt）：

```powershell
uv venv backend/.venv --python C:/Python314/python.exe
uv pip install --python backend/.venv/Scripts/python.exe --index-url https://pypi.org/simple -r backend/requirements.txt
Set-Location backend
$env:PYTHONIOENCODING='utf-8'
& .venv/Scripts/python.exe -m jit_baseline.cli fetch
& .venv/Scripts/python.exe -m jit_baseline.cli run
& .venv/Scripts/python.exe -m jit_baseline.cli verify
& .venv/Scripts/python.exe -m jit_baseline.cli run --output artifacts/reproduction
& .venv/Scripts/python.exe -m jit_baseline.cli compare artifacts/baseline artifacts/reproduction --report ../docs/evidence/_run/reproduction-comparison.json
```

`fetch` 只访问三份固定发布者文件，全部通过 SHA-256 后才保存；已有文件必须重新核验。`run` 按选定方案处理、训练和评价，接受 `--schema`（具名特征 schema，默认 `openstack-six-v1`）与 `--algorithm`（具名方法，默认 `logistic-regression-l2-v1`）两个参数；不带参数时仍产出六字段逻辑回归运行。已存在的运行目录会拒绝覆盖；再次独立复现可指定新的输出目录，例如 `artifacts/reproduction-2`。正式模型和源文件不入 Git，使用命令重新取得。`verify` 检查所有文件哈希、关联、真实模型风险与指标。验证集不参与重拟合；测试不用于选阈值、参数或字段。

已登记的方法见 [PROTOCOL.md](PROTOCOL.md)：`logistic-regression-l2-v1`、`decision-tree-v1`、`random-forest-v1`、`gaussian-naive-bayes-v1`、`gradient-boosting-v1` 五种经典方法，以及 `mlp-v1`、`tabular-resnet-v1`、`ft-transformer-v1`、`wide-deep-v1` 四种深度方法。方法以具名条目声明类别、冻结超参、所需依赖、复现口径与解释口径；校验按每个运行**自身声明**的方法、依赖与指标集进行，因此新增方法、新增依赖或新增指标都不会作废既有运行。未注册的方法名以 `ALGORITHM_UNKNOWN` 拒绝，不退回默认方法。

`artifacts/baseline` 是服务的固定运行（六字段逻辑回归）；`artifacts/reproduction*` 是独立重跑；`artifacts/trend-baseline` 是带时间桶聚合的重跑（由 `JIT_RUN_DIR` 供给，见「本机 HTTP」）；`artifacts/decision-tree-v1` 与 `artifacts/decision-tree-reproduction` 是第二个方法（决策树）的独立运行与其复现，**不替换服务所用的运行**；`artifacts/external/` 放**经仓库交付的外部运行**（见下一节）；`artifacts/development`、`.cache/` 和测试临时目录是技术与行为检查，不能作为正式效果。`data/openstack` 保存原始三文件。manifest 包含环境、训练代码哈希、核心文件、固定协议、方法声明、指标集、模型参数与运行身份，生成时间不影响身份。模型、数据或协议变化会形成其他上下文。

## 跨机器交付的运行

在别的机器上产生、经仓库交付的运行（例如在有加速设备的机器上训练的方法）放在 `artifacts/external/`。它是 `artifacts/` 下**唯一纳入版本控制**的路径：其余运行由 `cli run` 在本机现场重训而得，可随环境重建，故被 `.gitignore` 忽略；外部产物在本机**无法重算**，只能随仓库交付，否则无处可取、也无法进入 PR 评审。

交付与校验只走仓库既有流程，**不另造打包或收包协议**：产方开 `feature/` 分支，把整个产物目录提交到该路径，在 PR 中说明方法与产方环境，并由至少一位非作者席位审阅；校验方（算法与实验席位）用与本机运行**同一个** `verify` 入口校验。方法条目由校验方登记——产方只提供方法与冻结超参，避免同一件事在两处各自登记而漂移。产方的完整交付约定见 [artifacts/external/README.md](artifacts/external/README.md)。

跨机器时环境声明的含义见 [PROTOCOL.md](PROTOCOL.md) 的「环境声明与跨机器语义」一节：`trainingEnvironment` 是产方的产出环境（溯源），本机平台或 Python 与之不同**不是失败理由**；校验**实际加载**模型并用交付的无标签输入重算，输出中的 `origin` 标明该运行是外部产生、`verificationEnvironment` 记录本次校验时的本机环境。校验不重训、不覆盖产方声明，任一席位在任一台机器上得到一致判定。

## 本机 HTTP

仓库审查的新接口可用 `viewSyncId` 固定成功分析：仓库详情、提交列表、提交详情和分布四个 GET 均支持；省略仍取最新成功分析。`viewContext` 的成功分支、真实采集 HEAD、数据/模型身份独立于 `latestSync`，失败换分支不会改写成功来源。未知/不归属分析为 404，未成功为 409。migration 005 增加可空作者名、真实 HEAD、完成时间与解析引用；旧记录不猜完成时间。迁移仍由显式 `catalog-init` 执行，测试只升级开发库的副本。验证入口与服务端口隔离见 [开发验证](../docs/开发验证.md)。

### 时间桶观测聚合（add-historical-trend-dashboard）

`run` 在生成产物时按固定粒度（`month`，边界取固定 UTC+08:00）聚合**全部纳入记录**，写入
`summary.json` 的可选键 `trendBuckets`：每桶给出总体与按分区拆分的样本数、观测正标签数，以及只
覆盖该桶内测试记录的风险分布（中位数与 p90，最近秩定义）。聚合**只含计数与风险分布**，不含逐条
标签、提交身份或特征，因此服务仍不读取 `test-labels.json`。桶内样本数少于声明的最小样本
（默认 20）时，比例与风险分布以空值加原因呈现，不写成 0；首尾之间逐月连续，空月保留为 0 样本桶。

`verify` 按该运行自身的声明重算**测试分区**的桶并做守恒核对（各桶样本数之和等于纳入行数、正标签
数之和等于观测正例数、按分区归并后与分区统计一致）。训练与验证分区没有逐条标签，因此只受守恒关系
约束，这一点如实记录、不宣称「完全可重算」。未声明该键的既有运行仍按自身声明通过校验，产物不被
改写；改动训练代码会产生新的 `runId`，这是既有语义。

```powershell
# 生成带聚合的新运行（数据已在本机，不需要网络），并核验新旧两个运行
& .venv/Scripts/python.exe -m jit_baseline.cli run --output artifacts/trend-baseline
& .venv/Scripts/python.exe -m jit_baseline.cli verify --run artifacts/trend-baseline
& .venv/Scripts/python.exe -m jit_baseline.cli verify
```

### 模型目录存储（register-existing-models-and-predict-json）

目录使用标准库 SQLite；默认运行库 `storage/catalog.sqlite3` 及其伴随文件被 Git 忽略。
初始化／迁移是维护者的显式操作，HTTP 启动不自动建表：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli catalog-init
# 独立验收库可指定 --database .cache/catalog-check.sqlite3
```

重复初始化同版本保留已有数据。版本不兼容、缺库、不可写或锁等待超过 5 秒返回
`STORAGE_UNAVAILABLE`，不产生部分成功目录或预测；原历史 GET 不依赖目录库。
备份时停止服务，保存数据库及所有被引用的运行目录；恢复后先核对版本，并重新校验登记的产物。
回滚停用新接口并保留数据库与产物，禁止以删除成功结果代替回滚。

2026-10-19 精简重构后，所有本机业务接口直接访问，不需要团队凭证、成员/管理员角色或认证头。服务仅监听 `127.0.0.1`；模型、输入、来源和持久化校验照常执行，错误带 requestId。HTTP 登记与 CLI 使用同一模型准入规则。历史登记事件中的 `http-admin` 是保留的旧记录，新 HTTP 事件记录为 `http-local`，不表示角色。

迁移 006 在保留旧登记事件的基础上支持本机 HTTP 通道。升级前用 SQLite backup 保存目录库；显式运行 `catalog-init`，服务启动不会偷偷清库或迁移。已保存预测和原模型不删除，独立手工预测页面已撤下，相关业务 API/CLI 继续用于维护与验证。

### 数据集描述与提交级数据（add-dataset-registry-and-commit-persistence）

数据集描述文件是登记事实，放在 `data/datasets/<数据集>/<版本>.json`，随仓库提交（`.gitignore`
只忽略原始 CSV 与运行目录）。登记时从真实 CSV 重算校验值、字段定义、质量统计与时间范围：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli register-dataset
& .venv/Scripts/python.exe -m jit_baseline.cli import-dataset --manifest data/datasets/openstack-six-v1/openstack-six-v1-2011-11-29_2014-02-28.json
```

`register-dataset` 同内容重复登记幂等；同一版本内容不同以 `DATASET_EXISTS` 拒绝覆盖。
`import-dataset` 在一个事务里写提交、变更规模与入模特征，并记录 `import_run`（先 pending 后
success；失败写 failed 与错误码，库内容不变）。重复导入同一版本幂等，返回 `created: false`。

目录库升到版本 2：`catalog-init` 把旧库按序升级；`dataset_record`、`commit_record`、
`modified_entity`、`feature_record`、`import_run` 只增不改，旧表与既有模型接口不变。

只读查询接口（需团队 Bearer 凭据，成员即可）：

| 路径 | 说明 |
| --- | --- |
| `GET /api/v1/datasets` | 已登记数据集与版本摘要（来自描述文件，不含逐条内容） |
| `GET /api/v1/datasets/{name}/versions` | 某数据集的版本；未知数据集 404 |
| `GET /api/v1/commits?version=<版本>&limit=<1-500>&offset=<0+>` | 该版本的提交摘要（`commitId`、`authorTime`、`label`、`module`），默认 `limit=100`，响应带 `total`/`limit`/`offset`；越界或非整数 422 `INPUT_INVALID` |
| `GET /api/v1/commits/{commitId}?version=<版本>` | 单条提交的完整特征；未知版本或提交 404 |

`module` 查询参数只在来源提供模块引用时可用；OpenStack 数据没有文件路径列，因此不推导模块，
按模块查不到记录属于数据事实，不是缺陷。

### 从 Git 仓库采集提交（add-git-repository-collection）

`collect-repository` 直接把一个 Git 仓库转换成 `kamei14-git-v1` 数据集：遍历提交、计算
Kamei 14 维特征、用简化 SZZ 打标签，再走既有的登记与入库链路。

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli collect-repository --repo https://github.com/apache/activemq `
  --since 2023-10-18 --until 2026-10-18 --dataset activemq-3y --output ..\.dsh-tmp\activemq.csv `
  --register --limit 20000
```

| 参数 | 说明 |
| --- | --- |
| `--repo` | 本地路径直接读；`http(s)` 地址会 `git clone --bare` 到临时目录，采集后删除 |
| `--since` / `--until` | 提交作者时间窗口，`YYYY-MM-DD` 或 ISO；范围外提交只用于回溯，不进样本 |
| `--branch` | 分支或提交；默认 `HEAD` |
| `--limit` | 窗口内提交数上限；超过直接拒绝，避免一次拉爆内存 |
| `--dataset` / `--output` | 数据集名与 CSV 输出位置；数据集名默认由仓库名派生 |
| `--register` / `--root` | 采集后立即登记；默认写入 `data/datasets/<数据集>/` |

克隆子进程显式带代理与停滞阈值：代理优先取 `JIT_GIT_PROXY`，其次 `HTTPS_PROXY` / `HTTP_PROXY`，
都未设置时读取当前用户的 Windows 系统代理。git 自己不读系统代理，浏览器能打开 GitHub 时克隆
仍可能直连卡死。配了代理仍失败时自动回退直连再试一次——系统代理可能残留失效
（`ProxyEnable=1` 但端口已无人监听），此时直连往往仍然可用；仓库不存在、地址写错或
需要凭证时不回退（换通道不会成功，直连被墙时只会多等一次连接超时）。两次都失败才
报错，并分别带上每条通道的最后一行输出。完全没有代理时提示设置 `JIT_GIT_PROXY`。
传输速度持续低于 1 KiB/s 达 60 秒即按停滞失败，可用 `JIT_GIT_STALL_SECONDS` 调整秒数；
慢速但存活的链路设 `0` 关闭判定。

产物是 CSV（`commit_id`、`author_date`、14 维特征）与描述文件；描述文件多一个 `collection`
段，记录仓库路径、HEAD、分支、窗口、git 版本、合并/空提交/范围外/二进制计数、SZZ 规则版本
与两条限制。同一范围重跑幂等，内容不同以 `DATASET_EXISTS` 拒绝覆盖。

两条限制随产物记录，不被静默忽略：特征是**提交级聚合**（Kamei 论文的样本单位是文件级）；
标签是**简化 SZZ**（只看修复提交消息里的关键词并回溯最近一次变更，不处理重命名、跨文件传播
与 issue 关联）。采到的数据集可以直接训练，训练时用描述文件指定它：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli run --output ..\.dsh-tmp\run-activemq `
  --schema kamei14-git-v1 --dataset-manifest ..\.dsh-tmp\registry\activemq-3y\activemq-3y-2023-10-18_2026-10-17.json
```

运行目录的 `source.json` 记录采集来源（`publisher` 为 `collected`、`revision` 为采集时的 HEAD、
仓库地址与 git 版本），`datasetVersion` 等于数据集版本名，产物因此能追溯到具体仓库与时间窗口。

### 已有模型登记

维护者运行 `cli register-model --run-key baseline`（完整命令为
`& .venv/Scripts/python.exe -m jit_baseline.cli register-model --run-key baseline`）。
可用 `--database`、`--artifact-root` 指定独立验收环境；服务对应环境配置为
`JIT_CATALOG_DATABASE`、`JIT_ARTIFACT_ROOT`，默认仍为本机 storage 与 artifacts。

管理员通过 `GET /api/v1/model-candidates` 选择已有运行，再向
`POST /api/v1/models/register` 提交 `{candidateId, expectedManifestSha256}`。
不接受绝对路径、下载 URL 或浏览器模型上传。默认只扫描 artifacts 的直接运行目录及 external 的直接交付目录，
排除 development／隐藏目录，不在发现候选时加载模型；候选不代表已可用。
CLI 与 HTTP 复用完整 verify 准入，失败不登记模型，正常失败写脱敏登记诊断。
新登记返回 201，相同原 runId 复用身份返回 200；复现目录的生成时刻／训练耗时可不同，位置快照分别保存。
重新登记合法位置明确切换首选位置并恢复可用性，不自动切换其他位置。
成员用 `GET /api/v1/models` 读取实际登记版本；五种方法条目不代表已有五个可用模型。
模型目录可保存十二字段运行，但 `jsonPredictionSupported=false`，本轮新输入仅支持六字段。

### 单条 JSON 预测与结果重开

预测输入有两种来源，一次请求必须恰好给出一种。

**客户端特征**：提交 `modelId`、`featureSchemaVersion=openstack-six-v1`、`project` 和
`record:{recordId,features}`，可选真实 commitId／带时区 time。features 恰含原始
ns、nd、nf、ent、la、ld；不需要预先 log1p／标准化，也不接受标签、缺失／额外字段、布尔计数、
小数计数、数值字符串或非有限值。

**已导入提交**：提交 `modelId`、`featureSchemaVersion`、`project`、`datasetVersion` 和
`record:{recordId,commitId}`，不给 features。服务按 `datasetVersion` 与 `commitId` 读取导入时
保存的特征、按 schema 顺序重排后推理；版本或提交未登记返回 404，字段数与 schema 不一致返回 422
`INPUT_SCHEMA_MISMATCH`。结果的 `sourceKind` 为 `persisted-commit` 并带 `datasetVersion`，
`limitations` 首条说明特征来自已导入的提交数据、尚未核验真实标签。

两层来源同时给出（features 加 datasetVersion）或缺任一半时返回 422 `INPUT_INVALID` 并定位字段。
实际请求体上限 64 KiB，任一输入错误不发布结果。

成功完成真实推理并原子保存后返回 201，含 batchId、predictionId、业务 UUID、原产物身份、模型 hash、
schema、输入 hash、UTC 创建时刻及恰一条风险；同一记录里给出该次预测的特征归因（见下节）。
风险仍是模型估计，调用方特征尚未核验源码／标签，不代表在线仓库效果或已确认缺陷。
`GET /api/v1/prediction-batches/{batchId}` 重开保存结果，不重新计算；模型删除或更新不改写过去来源快照。
重复合法 POST 创建独立批次；存储失败 503 不返回已算风险，模型不存在 404、不可用 503、推理失败 500。

### 预测解释（explain-predictions-and-verify-service）

成功预测的记录带 `explanationStatus=supported`、`explanationMethod=occlusion-mean-v1`、
至多 5 条 `explanation` 和一句 `explanationSummary`。口径是**遮挡法**：把单个入模特征替换成
该数据集版本该字段的均值（一次 `AVG(CAST(value_json AS REAL)) ... GROUP BY field` 查询，不训练、
不读标签），重新推理，用风险变化量 `delta` 衡量该特征当前取值对本次预测的推动——正值推高、
负值拉低，按绝对值降序，零贡献不列出、不足 5 条不补位。它描述模型对单特征的敏感度，不是
因果分解，也不是缺陷定位。

宁可降级也不编造：归因函数异常时该条仍返回 201，但 `explanationStatus=not-supported` 并给出
`explanationReason`，风险与保存不受影响；数据集版本未知或部分字段没有均值时仍给出解释，同时在
`limitations` 说明缺失字段按零基线计算。历史批次没有解释字段，`GET` 重开时原样返回、不重算、
不触发推理。单条请求（含 6 次遮挡推理）在本机实测 P95 约 147 ms，证据与复现脚本见
`docs/evidence/explain-predictions-and-verify-service/prediction-latency.json` 与
`scripts/prediction_latency.py`。

一次真实调用（服务已启动、已登记模型，无需凭证）：

```powershell
$headers = @{ 'Content-Type' = 'application/json' }
$model = (Invoke-RestMethod -Headers $headers -Uri http://127.0.0.1:8000/api/v1/models).models[0].modelId
$body = @{
  modelId = $model; featureSchemaVersion = 'openstack-six-v1'; project = 'demo'
  record = @{ recordId = 'demo-1'; features = @{ ns = 1; nd = 2; nf = 3; ent = 0.8; la = 10; ld = 2 } }
} | ConvertTo-Json -Depth 6
$saved = Invoke-RestMethod -Method Post -Headers $headers -Uri http://127.0.0.1:8000/api/v1/predictions -Body $body
$saved.records[0].explanationStatus, $saved.records[0].explanationSummary
$saved.records[0].explanation | Format-Table feature, value, baseline, delta, direction
```

OpenAPI 与实际响应检查使用独立工具环境，不改变应用 requirements：

```powershell
uv venv .cache/contract-tools --python .venv/Scripts/python.exe
uv pip install --python .cache/contract-tools/Scripts/python.exe jsonschema==4.25.1 PyYAML==6.0.3
& .venv/Scripts/python.exe scripts/catalog_system_evidence.py
& .cache/contract-tools/Scripts/python.exe scripts/check_catalog_contract.py
```

系统脚本只启动独立临时本机服务和数据库，不触碰既有服务，运行两种现有模型各 200 次计时，并输出
`docs/evidence/_run/catalog-system.json`、服务日志与 `catalog-contract.json`；不自动冻结归档。

### 预测时延与本机 API 错误

**性能**：`tests/test_performance.py` 用真实应用与已登记模型连续发出 100 次单条预测（含保存与
归因），先预热 5 次，按最近秩取 P95，默认预算 250 ms，可用 `JIT_LATENCY_P95_MS` 临时放宽。
本机实测（Windows 11、Python 3.14.2、2026-10-18）：P50 124.3 ms、P95 150.1 ms、最大 176.8 ms。
更细的对比（含解释/不含解释分组、服务真实 HTTP）见
`scripts/prediction_latency.py` 与 `docs/evidence/explain-predictions-and-verify-service/prediction-latency.json`。

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_performance.py -q -s --basetemp=.pytest-tmp
```

**本机访问与错误**：`tests/test_local_api.py` 验证未配置凭证、没有认证头时即可读取和提交业务请求，
旧认证头也不会参与授权。`tests/test_api.py` 验证不存在的批次与数据集版本返回 404 `NOT_FOUND`，
错误信封保留 `code`、`message`、`requestId`，不返回部分业务数据。角色鉴权及其旧用例已经退役。

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_local_api.py tests/test_api.py tests/test_performance.py -q --basetemp=.pytest-tmp
```

### 隔离验证环境

前端隔离浏览器入口需要一个**可写的自有后端**：它把已验证模型复制到临时产物根、显式初始化独立
SQLite，并只监听本机端口。当前浏览器主线由 `frontend/e2e/repository-setup.ts` 准备独立目录和固定
日期的本地 Git 仓库，再由 Playwright 启动真实 API。维护脚本
`backend/scripts/acceptance_environment.py` 也可单独准备/核验/清理隔离模型环境：

```powershell
$base = '.cache/acceptance-workbench'
& .venv/Scripts/python.exe scripts/acceptance_environment.py prepare --base $base
$environment = Get-Content "$base/environment.json" | ConvertFrom-Json
& .venv/Scripts/python.exe scripts/acceptance_environment.py serve `
  --run $environment.run --database $environment.database --artifact-root $environment.artifactRoot --port 8123
& .venv/Scripts/python.exe scripts/acceptance_environment.py inspect --base $base
& .venv/Scripts/python.exe scripts/acceptance_environment.py cleanup --base $base
```

`prepare` 只做三件事且都可复核：复制 `artifacts/baseline`（及脚本声明的已校验运行）到
`<base>/artifacts/`、在该临时根下初始化 `catalog.sqlite3`、把复制出来的运行写进
`<base>/environment.json`。
它**不使用** `storage/catalog.sqlite3`，也**不修改** `artifacts/` 下的原文件；`inspect` 会核对临时库
路径不等于默认库、原模型文件哈希未变，并输出各表行数；`cleanup` 只删除带 `environment.json` 的
临时根。`serve` 用 `JIT_CATALOG_DATABASE`／`JIT_ARTIFACT_ROOT` 指向临时根，无需配置凭证。
`invalidate --base <base> --key baseline` 把某个副本的 `model.joblib` 改名，用来验证「模型不可用」
路径；`restore` 改回。默认开发服务仍用 `cli serve`（端口 8000），两者互不影响，可同时运行。

在 backend 执行：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli serve
```

仅监听 `127.0.0.1:8000`，单个工作进程。默认供给 `artifacts/baseline`；环境变量 `JIT_RUN_DIR` 可指向另一个已通过校验的运行目录（例如重跑得到的 `artifacts/trend-baseline`），被指定的目录走**同一**准入校验，未通过时返回明确不可用原因，**不退回**原运行冒充成功。

`GET /api/review-batch` 返回契约版本 1，mode=`historical`、项目、datasetVersion/version、runId、model 的 id/name/sha256、完整 records 和同运行 summary。summary 在运行声明提供时含时间桶聚合 `trendBuckets`（结构与最小样本规则见上文「时间桶观测聚合」），未声明的运行不含该键。records 包含 id/time/risk/lines/files/原始 metrics；没有逐条标签、标题或解释。summary 含固定发布者引用和三文件校验、六字段、纳入条件、分区统计、模型关联、两类指标与限制。指标对象为 `{value, reason}`，未定义时 value 为 null、reason 为原因。

服务启动核验必要文件后只保留该运行快照；每次批次请求都调用已加载模型，服务不读取 test-labels.json 或 reference-predictions.json，不训练、不写文件。缺少必要文件返回 503 `ARTIFACT_UNAVAILABLE`，哈希错误为 503 `INTEGRITY_ERROR`，其他结构和环境错误为 503 `ARTIFACT_INVALID`，无法加载模型为 503 `MODEL_INVALID`。推理异常、非法风险或数量不符返回 500 `INFERENCE_ERROR`。错误响应仅含 `error: {code, message}`，不带部分或旧批次。

修复产物后先执行 verify，再结束本项目服务并重新启动，前端点击“重新加载”。启动时失效的快照不会自动刷新。只提供该 GET 产品接口，其他路径不启动任务；POST 同路径为 405。前端 dev/preview 用 `/api` 代理，无需扩大监听范围。

## 检查

```powershell
& .venv/Scripts/python.exe -m pytest --basetemp=.cache/verification-tests
```

完整验证链 `frontend/scripts/verify.ps1` 的环境前置（PowerShell 7、UTF-8 控制台、ASCII 路径、浏览器来源）见 [前端说明](../frontend/README.md) 的「验证环境说明」。

HTTP 测试在本机运行；受限制的执行环境必须允许本机 socket。测试使用明确标识的临时真实模型夹具及独立小样例；正式结果见 [本轮报告](../docs/evidence/connect-public-data-baseline-review/baseline-report.md)。测试与验证的输出写入运行工作区 `../docs/evidence/_run/`，该目录可被后续运行覆盖、不进入版本控制；归档证据由显式冻结从运行工作区产生，测试不写任何已归档目录。测试日志中的预期 RED 失败与开发故障记录保留，不代表最终验收失败或已通过。

## 验证证据的冻结

验证运行与归档证据分开存放。测试与验证脚本把输出写进**运行工作区** `docs/evidence/_run/`；该目录可被后续运行覆盖，也不进入版本控制。**归档目录 `docs/evidence/<change>/` 只由显式冻结写入**，测试、构建和验证脚本都不会写它，也不会自动触发冻结。

在 backend 执行：

```powershell
$frozenEvidence = '../docs/evidence/separate-run-evidence-from-archive'
& .venv/Scripts/python.exe -m jit_baseline.cli freeze-evidence $frozenEvidence
& .venv/Scripts/python.exe -m jit_baseline.cli check-evidence $frozenEvidence
```

将目标目录替换为本次 change 的名称；不要使用已有历史归档目录。只演练冻结与校验时，可把 `$frozenEvidence` 设为 `.cache/evidence-freeze-check`，在临时目标检查结果。命令会列出复制的条目、排除项、来源运行标识；校验通过时输出 `passed: true` 并以退出码 0 结束。

`freeze-evidence` 把运行工作区中除 `fixtures/` 外的证据复制到目标目录，并写入 `冻结清单.json`：每个证据文件的相对路径与 SHA256、冻结时刻、来源运行标识（由证据集合内容派生，时间不影响身份）。它只新增或覆盖纳入的条目，**不删除目标目录中未纳入的文件**。内容不变时重复冻结的条目、哈希与来源运行标识相同，冻结时刻按本次执行更新。运行期夹具留在运行工作区，不进入归档。

`check-evidence` 按清单重新校验，报告被修改、被删除和未登记新增的文件，以及缺少冻结时刻或来源运行标识的清单；发现问题时以非零码退出。冻结是**归档前的显式步骤**：完成一次验证运行、确认结果后先冻结，再归档 change。
