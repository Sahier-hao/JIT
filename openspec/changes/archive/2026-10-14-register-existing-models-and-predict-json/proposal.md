# Proposal

## Why

截至本地 `a871eba`，系统已有五个具名经典方法、产物校验和多方法比较，但成员仍只能读取一个固定历史批次，无法选择已交付模型预测新特征。需要把现有运行登记为可追踪的公共模型，并完成有权限控制、可重开的单条 JSON 预测链路。

## What Changes

- 使用 SQLite 保存数据版本元信息、原运行与新 UUID 的映射、模型、产物位置、登记记录和预测结果；模型与实验文件继续使用现有产物格式。
- CLI 与管理员 HTTP 入口共用登记服务：从服务主机受控目录发现候选，调用现有完整校验，成功后登记；重复或并发登记同一运行复用身份。
- 新接口采用成员／管理员两类 Bearer 凭据；成员可查询和预测，管理员还可发现候选和登记。
- 提供模型列表、schema 查询、六字段单条 JSON 预测及保存批次重开接口；消费原始特征，使用已拟合流水线，不训练或读标签生成风险。
- 保存模型／运行／schema／输入 hash 等来源，明确 `feature-input` 模式及 `not-supported` 解释状态；同步新接口的 OpenAPI、错误码和启动说明。
- 保留五种经典方法、`compare`、新合并的 `compare-methods`、12 字段 schema、历史 GET 契约与冻结证据；登记不按测试指标选“最优模型”。

本轮范围是后端 Web 可调用的登记与预测 API。CSV、12 字段新输入预测、训练 Web 任务、解释计算、前端新页面、账户登录及 LAN 部署分别留给后续 change。

## Capabilities

### New Capabilities

- `model-catalog`: 经校验的既有运行与模型登记、版本去重、来源查询、运行时可用性和持久化。
- `feature-input-prediction`: 按所选模型接收原始 JSON 特征、真实推理、原子保存及不可变结果重开。
- `team-api-access`: 新接口的成员／管理员凭据、权限矩阵与不包含秘密的诊断。

### Modified Capabilities

无。`public-data-baseline` 继续约束原历史服务、运行校验及多方法比较；`feature-schema-versioning` 仍是 schema 声明的权威；`commit-risk-review` 和 `verification-evidence` 的现有行为不变。

## Impact

- 后端：扩展 `api.py`、`cli.py`；新增目录登记、SQLite 存储／迁移、权限及新输入应用服务，复用 `artifacts.py`、`schemas.py`、`model.py`、`errors.py`。
- HTTP：新增六个 `/api/v1` 操作，其中候选发现与登记仅管理员可用；原 `GET /api/review-batch` 保留原无鉴权行为。
- 依赖：首版使用 Python 标准库 `sqlite3` 和版本化 SQL 迁移，不新增数据库服务器、ORM 或队列依赖。
- 文档／测试：实施时更新 `docs/api/openapi.yaml`、错误码表、产品设计／需求状态、团队分工和后端说明；补登记并发、权限、输入、真实推理、持久化恢复及既有链路回归检查。
- 交付：先完成登记／权限，再完成预测／持久化；每个交付点保留可复验记录，正式效果与临时夹具分开。
