# 固定公开数据基线

本目录离线处理发布者 OpenStack 数据，训练一个固定逻辑回归，并通过本机只读 HTTP 提供冻结测试批次。它是回顾性历史评价，六字段尚非完整 Kamei14，没有预测解释或逐条 SZZ 复核；完整课程要求仍需后续 change。来源与标签依据见 [DATA.md](DATA.md)，计算规则见 [PROTOCOL.md](PROTOCOL.md)。

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
& .venv/Scripts/python.exe -m jit_baseline.cli compare artifacts/baseline artifacts/reproduction --report ../docs/evidence/connect-public-data-baseline-review/reproduction-comparison.json
```

`fetch` 只访问三份固定发布者文件，全部通过 SHA-256 后才保存；已有文件必须重新核验。`run` 按固定方案处理、训练和评价，不接受参数或字段选择。已存在的运行目录会拒绝覆盖；再次独立复现可指定新的输出目录，例如 `artifacts/reproduction-2`。正式模型和源文件不入 Git，使用命令重新取得。`verify` 检查所有文件哈希、关联、真实模型风险与指标。验证集不参与重拟合；测试不用于选阈值、参数或字段。

`artifacts/baseline` 是服务的固定运行；`artifacts/reproduction*` 是独立重跑；`artifacts/development`、`.cache/` 和测试临时目录是技术与行为检查，不能作为正式效果。`data/openstack` 保存原始三文件。manifest 包含环境、训练代码哈希、核心文件、固定协议、模型参数与运行身份，生成时间不影响身份。模型、数据或协议变化会形成其他上下文。

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

HTTP 测试在本机运行；受限制的执行环境必须允许本机 socket。测试使用明确标识的临时真实模型夹具及独立小样例；正式结果见 [本轮报告](../docs/evidence/connect-public-data-baseline-review/baseline-report.md)。测试日志中的预期 RED 失败与开发故障记录保留，不代表最终验收失败或已通过。
