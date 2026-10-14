# 固定公开数据基线

本目录离线处理发布者 OpenStack 数据，按具名方法训练模型，并通过本机只读 HTTP 提供冻结测试批次。它是回顾性历史评价，六字段尚非完整 Kamei14，没有预测解释或逐条 SZZ 复核；完整课程要求仍需后续 change。来源与标签依据见 [DATA.md](DATA.md)，计算规则见 [PROTOCOL.md](PROTOCOL.md)，方法清单与按声明校验见 [PROTOCOL.md](PROTOCOL.md) 的「方法清单与按声明校验」一节。

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

已登记的方法见 [PROTOCOL.md](PROTOCOL.md)：`logistic-regression-l2-v1`（经典）、`decision-tree-v1`（经典）与 `random-forest-v1`（经典，首个声明所需依赖的方法）。方法以具名条目声明类别、冻结超参、所需依赖、复现口径与解释口径；校验按每个运行**自身声明**的方法、依赖与指标集进行，因此新增方法、新增依赖或新增指标都不会作废既有运行。未注册的方法名以 `ALGORITHM_UNKNOWN` 拒绝，不退回默认方法。

`artifacts/baseline` 是服务的固定运行（六字段逻辑回归）；`artifacts/reproduction*` 是独立重跑；`artifacts/decision-tree-v1` 与 `artifacts/decision-tree-reproduction` 是第二个方法（决策树）的独立运行与其复现，**不替换服务所用的运行**；`artifacts/external/` 放**经仓库交付的外部运行**（见下一节）；`artifacts/development`、`.cache/` 和测试临时目录是技术与行为检查，不能作为正式效果。`data/openstack` 保存原始三文件。manifest 包含环境、训练代码哈希、核心文件、固定协议、方法声明、指标集、模型参数与运行身份，生成时间不影响身份。模型、数据或协议变化会形成其他上下文。

## 跨机器交付的运行

在别的机器上产生、经仓库交付的运行（例如在有加速设备的机器上训练的方法）放在 `artifacts/external/`。它是 `artifacts/` 下**唯一纳入版本控制**的路径：其余运行由 `cli run` 在本机现场重训而得，可随环境重建，故被 `.gitignore` 忽略；外部产物在本机**无法重算**，只能随仓库交付，否则无处可取、也无法进入 PR 评审。

交付与校验只走仓库既有流程，**不另造打包或收包协议**：产方开 `feature/` 分支，把整个产物目录提交到该路径，在 PR 中说明方法与产方环境，并由至少一位非作者席位审阅；校验方（算法与实验席位）用与本机运行**同一个** `verify` 入口校验。方法条目由校验方登记——产方只提供方法与冻结超参，避免同一件事在两处各自登记而漂移。产方的完整交付约定见 [artifacts/external/README.md](artifacts/external/README.md)。

跨机器时环境声明的含义见 [PROTOCOL.md](PROTOCOL.md) 的「环境声明与跨机器语义」一节：`trainingEnvironment` 是产方的产出环境（溯源），本机平台或 Python 与之不同**不是失败理由**；校验**实际加载**模型并用交付的无标签输入重算，输出中的 `origin` 标明该运行是外部产生、`verificationEnvironment` 记录本次校验时的本机环境。校验不重训、不覆盖产方声明，任一席位在任一台机器上得到一致判定。

## 本机 HTTP

在 backend 执行：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli serve
```

仅监听 `127.0.0.1:8000`，单个工作进程。`GET /api/review-batch` 返回契约版本 1，mode=`historical`、项目、datasetVersion/version、runId、model 的 id/name/sha256、完整 records 和同运行 summary。records 包含 id/time/risk/lines/files/原始 metrics；没有逐条标签、标题或解释。summary 含固定发布者引用和三文件校验、六字段、纳入条件、分区统计、模型关联、两类指标与限制。指标对象为 `{value, reason}`，未定义时 value 为 null、reason 为原因。

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
