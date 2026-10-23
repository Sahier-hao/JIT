# 管理员工作区与九模型接入实施验证

项目审查、管理员权限与九模型接入。

日期：2026-10-23。基线：`792b5ab`。

## 变更摘要

- 新增独立管理员工作区，包含首次设置、登录、退出、会话到期和本机密码恢复。模型维护、数据记录、验证报告及相关 API 由服务端校验管理员会话。
- 普通项目继续无需管理员登录。旧报告链接进入受保护的管理区，模型/预测等旧工具地址继续明确退役；桌面和窄屏均可进入管理区。
- 接通九种真实模型的选择与推理：5 种经典、4 种深度。指定 modelId 贯穿请求、去重、任务、重试和结果，不静默替换。
- 管理页区分算法支持、已交付产物和可用模型，登记执行完整准入校验。
- 补齐项目/侧栏状态同步、运行阶段刷新、历史分页、失败参数恢复和删除确认；新项目兼容尚未知默认分支。
- 迁移 007 增加管理员账户、会话及 requested_model_id。更新 API 契约、运行说明和产品文档，清理失效 change 及文档引用。

## 模型交付

| 类别 | 模型 | 产物处理 |
| --- | --- | --- |
| 经典 | 逻辑回归、决策树 | 保留既有产物和模型身份，核对登记 |
| 经典 | 随机森林、高斯朴素贝叶斯、梯度提升树 | 按既有固定数据和参数在 CPU 生成新正式运行，校验登记 |
| 深度 | MLP、表格 ResNet、FT-Transformer、Wide & Deep | 校验既有训练产物，原样复制并登记，源文件哈希不变 |

本机 9 个模型均为 ready。复现和测试副本不重复计为模型种类，历史报告不等于对应权重仍然存在。详细来源见 [模型盘点](../evidence/2026-10-23-project-admin-model-workflow/models.md)，模型身份、runId 和哈希见 [models.json](../evidence/2026-10-23-project-admin-model-workflow/models.json)。

## 数据保护与迁移

- 应用迁移 007 前创建 SQLite backup：`.cache/delivery-backups/catalog-before-007-20261022T171334309810.sqlite3`。
- 迁移核对既有 16 个业务表、88,041 行共用列数据及 36 个受保护产物文件保持不变；登记深度和新增经典模型前另有数据库备份。
- 四个深度源产物逐文件哈希不变，没有重训；新增经典训练写入新目录。
- 原模型、业务数据和预存数据集保留。测试使用独立数据库、模型副本、Git 夹具和端口。

## 验证结果

验证日期：2026-10-23。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 后端全量 | 354 passed，2 warnings | `.cache/delivery-backend-verified.log` |
| 前端单元测试 | 28 文件 / 232 passed | `.cache/delivery-frontend-final2.log` |
| 浏览器流程 | 12 passed | `.cache/delivery-browser-complete.log` |
| typecheck / build / lint | 通过；lint 0 error / 9 warnings | `.cache/delivery-lint-final.log` |
| 模型校验 | 九个模型文件与参考推理校验通过 | [models.json](../evidence/2026-10-23-project-admin-model-workflow/models.json) |
| 规格校验 | 严格校验通过，0 errors / 0 warnings | [校验报告](../evidence/2026-10-23-project-admin-model-workflow/spec-validation.json) |

浏览器在 1280/1440 两个桌面尺寸逐个选择九种真实模型执行仓库分析并核对 requestedModelId/modelId，同时覆盖 390px 窄屏、管理员登录/退出、匿名维护请求拒绝、产物登记、报告隔离、新建项目和详情/计划刷新。截图位于 `docs/evidence/_run/screenshots/`。

## 使用与边界

- 用户入口：`#/projects`；管理入口：`#/admin/models`、`#/admin/datasets`、`#/admin/reports`。首次使用由维护者设置管理员密码，无默认密码。
- 本机验证预览使用 4173 代理独立后端 18423，未改动既有 8000 服务。
- 普通项目仍公开访问；本变更不包含团队邀请、多租户或公网部署。
- 权重与运行数据库遵循忽略规则，其他机器需要取得或重新生成并登记产物。
- 功能验证不代表新仓库模型效果、在线概率校准或真实缺陷确认；未改变既有标签、阈值或训练协议，没有 GPU 训练。

## 变更文件

- [proposal.md](../../openspec/changes/archive/2026-10-23-project-admin-model-workflow/proposal.md)：变更范围与影响。
- [design.md](../../openspec/changes/archive/2026-10-23-project-admin-model-workflow/design.md)：设计决策、取舍与迁移。
- [tasks.md](../../openspec/changes/archive/2026-10-23-project-admin-model-workflow/tasks.md)：实施与验证任务。
- `specs/`：admin-workspace、focused-project-review、model-catalog、repository-collection、workspace-navigation。
- `docs/evidence/2026-10-23-project-admin-model-workflow/`：模型盘点、身份及规格校验记录。

## 提交前复核

- 五个能力的 delta 已同步到主规格；15 份主规格严格校验通过，归档 26/26 项任务完成。
- 后端全量复测为 351 passed / 3 failed：真实库快照带入管理员账户、服务启动超时及并发负载下 P95 超预算。快照测试改为只清理其独立副本中的账户和会话；三个失败项独立复测全部通过，P95 为 242.2ms，仍按原 250ms 阈值验收。日志见 `.cache/precommit-backend.log` 和 `.cache/precommit-backend-recheck.log`。
- 前端独立全量复测 28 文件 / 232 passed，typecheck、build 和 lint 通过；日志见 `.cache/precommit-frontend-serial.log`、`.cache/precommit-lint.log`。
- 浏览器为真实模型目录的异步读取保留 30 秒等待；独立完整复测 12 passed，覆盖两种桌面尺寸的九模型分析及窄屏和管理权限。日志见 `.cache/precommit-browser-serial.log`。
- 提交排除本机数据库、模型权重、缓存及预存的采集数据集。
