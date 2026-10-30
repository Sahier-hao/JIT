# 管理员训练任务后端证据

本目录冻结 `add-training-task-backend` 的数据库迁移、管理 API 契约、任务生命周期和共享执行器回归。原始数据库、模型二进制和项目提交内容不进入证据目录。

## 任务边界

- 管理员通过受保护 API 从已登记数据集和已注册方法创建训练任务。
- 相同数据集、方法和指标集已有活动任务时复用原任务。
- 单工作器使用隔离进程执行训练、完整产物校验和模型登记。
- 失败、取消或中断任务可显式重试，新任务保存 `parentTaskId`，原任务不变。
- 成功任务返回真实指标、数据集版本、`runId`、原产物运行标识、模型标识、特征 schema 和产物 key。
- 普通项目分析继续使用 `repository_sync`；管理员实验使用 `training_task`，权限、状态与结果所有权不混用。
- 管理员任务和仓库强制训练共用 `TrainingExecutor`，但各自执行器调用方负责权限、任务状态和失败语义。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/training-tasks` | 创建或复用活动训练任务 |
| GET | `/api/v1/training-tasks` | 分页查询 |
| GET | `/api/v1/training-tasks/{taskId}` | 任务详情与运行/模型谱系 |
| POST | `/api/v1/training-tasks/{taskId}/cancel` | 取消排队或运行任务 |
| POST | `/api/v1/training-tasks/{taskId}/retry` | 创建带父任务引用的重试 |

全部接口要求管理员会话并拒绝不允许的跨来源写请求。项目分析、仓库同步和公共模型选择接口没有获得训练任务访问能力。

## 数据库

迁移 `018_training_tasks.sql`：

- 新建 `training_task` 表及列表、活动任务和父任务索引。
- 保存任务参数、状态、阶段、失败、取消、父子关系、运行与模型谱系、指标。
- 重建 `registration_event` 约束，正式记录 `repository-sync` 和 `training-task` 登记渠道。
- 初始化前自动备份旧库；既有项目、分析、模型、默认模型和管理员账户不变。

## 验证

- 后端全量测试：627 项，626 通过，1 项因真实数据集未导入而跳过，0 失败、0 错误。
- 真实隔离训练：成功完成训练、产物校验和模型登记，返回非空运行与模型标识及 AP 指标。
- 排队取消、运行进程树取消、超时/进程退出路径、失败隔离、恢复和显式重试均有自动化测试。
- 匿名训练任务读写为 401；跨来源写入为 403。
- OpenAPI YAML 可解析；change 严格校验 0 issue。
- 本机目录库已通过前向迁移升级至 schema version 18，并保留升级前 SQLite 备份。

## 文件

- `018_training_tasks.sql`：冻结的迁移定义。
- `openapi.yaml`：含训练任务请求、响应和错误契约的完整接口文档。
- `verification/pytest.xml`：后端全量 JUnit。
- `verification/openspec-validation.json`：change 严格校验。
- `verification/lifecycle-scenarios.json`：成功、失败、取消、重试、恢复和权限验收项。
- `verification/shared-executor.json`：项目训练与管理任务复用边界。
- `verification.json`：验证摘要和关键源码哈希。

冻结清单在最后一步由 `freeze-evidence` 生成。
