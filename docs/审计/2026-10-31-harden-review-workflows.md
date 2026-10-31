# 日常审查流程加固验收：训练截止时间、PR 批量批次、管理训练页与旧证据定位

日期：2026-10-31。范围：升级实施方案第一阶段。数据库为隔离临时库，GitHub 响应受控，Git 采集、SQLite、模型推理和浏览器交互为真实执行。

## 交付行为

| 能力 | 实现与验证范围 |
| --- | --- |
| 训练数据时间范围 | 仓库同步把「窗口内最新提交往前 90 天」的截止时间同时传给样本判定与共享训练执行器；时间切分、训练和验证只使用截止时间之前的提交，近期提交仍由本次模型打分。产物记录截止时间、可训练样本数与各分区数量。管理员独立训练不传截止时间，保持原行为。 |
| PR 分析错误协议 | 单 PR 分析、批量分析、批次进度和批次重试路由纳入统一错误信封；非法参数、项目不存在、来源不可用、模型不可用和批次不存在返回对应状态码、错误码、提示与 requestId。新增路由覆盖测试，遗漏统一处理时失败。 |
| 批量 PR 分析 | 新增 `pr_batch`、`pr_batch_item` 前向迁移。批次从远端分页获取完整开放 PR 范围并固定真实兼容模型；逐条刷新快照后复用在途任务或完成结果、按需创建新分析、仅在用户主动发起时重试失败/取消/中断任务。进度返回实际入队、复用、失败、取消、中断和待处理数量；支持只重试失败项；重复点击返回同一活动批次；服务重启把未完成批次标为中断。 |
| 管理训练页 | 任务切换和返回列表时清除旧详情；加载与轮询失败提供真实重新请求；接入服务端分页与总数；离开页面取消请求和定时器。 |
| 旧证据定位 | 点击旧版本证据作为独立跳转，直接打开所属版本的文件视图并定位基准/目标侧和行号；版本或文件不可读时保留原定位并显示原因。 |

## 关键实现

- `TrainingExecutor.run` 新增可选 `holdout` 并透传给 `artifacts.build_run`；`SyncService._run` 使用与 `choose_model` 相同的 `_holdout(records)`。
- `build_run` 原有 `holdout` 记录（`summary.holdout.epoch`、`trainableRecords`）与 `split.partitions` 成为训练实际成员的核对来源；本次没有新增平行统计。
- 迁移 019 只新增 `pr_batch` 与 `pr_batch_item`，不改既有表；仓库删除时一并清理批次。
- 批次模型在创建时通过 `_generic_model` 校验并写入批次；重试沿用原模型，模型不可用时显式失败。
- 前端 PR 审查页读取最近批次并在提交或分析进行期间轮询；失败项提供「重试失败项」。
- 管理训练页以 `taskId`、页码和重试计数驱动请求，详情仅在 `task.taskId` 与地址一致时渲染。
- PR 工作单用独立 `evidenceJump` 标记区分普通版本切换；证据跳转后强制文件视图，正常切换仍回到提交列表。

## 验证结果

### 后端全量

`backend/.venv/Scripts/python.exe -m pytest -q --basetemp=.cache/final-full`：**639 passed**，1 条既有 PyTorch 警告，389.20 秒。其后新增多页发现用例，`tests/test_pr_updates.py` 单独运行 **33 passed**。

新增和更新的重点用例：

- `tests/test_sync_training_holdout.py`：完整同步编排（采集结果 → 数据集登记 → 训练执行器 → 产物 → 打分）验证近期提交不出现在训练/验证/测试分区、近期提交仍有分数、可训练样本数与 `split.json` 成员一致；全部记录都在截止时间之后时以 `SPLIT_INVALID` 失败且不生成产物，不扩大训练范围。
- `tests/test_pr_updates.py`：远端发现（含超过一页）、重复点击、部分失败、仅重试失败项、完成结果复用、取消项重试、模型失效、重启中断。
- `tests/test_api_route_coverage.py`：所有 `/api/v1` 路由进入统一错误处理；PR 分析/批次接口在参数、项目、批次和模型错误时返回结构化错误与 requestId。
- `tests/test_openapi.py`：批次状态、计数维度和 202 响应与文档一致。
- `tests/test_model_policy.py`：v7 升级夹具补充删除批次表后，旧模型、默认值和历史记录保持不变。

### 前端

- `npm run typecheck`、`npm run lint`、`npm run build` 通过。
- `npm test`：39 个文件、**322 passed**。
- 组件测试覆盖：批次进度与仅重试失败项、管理训练分页到第 3 页、列表返回清除旧详情、读取失败后重新请求、跨版本证据跳转打开旧文件并定位行号。

### 浏览器

- 管理训练工作台：`npm run test:e2e:admin-training` 通过（desktop-1280 1 passed，desktop-1440 在当前夹具下跳过）。实际完成大型仓库分析、创建训练任务、打开详情、返回列表（详情消失）、再从列表打开同一任务并看到原运行谱系。
- 项目工作台：`npx playwright test --config=playwright.project-workspace.config.ts`。修正既有选择器后，PR 清单、只读预览、工作单、旧证据跳转回原版本并显示 `value = 25` 等步骤通过；随后在趋势图断言处失败：脚本仍查找 `.trend-line`，而当前图表已切换为 ECharts。该失败属于既有浏览器脚本未随图表改造更新，与本次改动无关，未在本阶段修复。

### 隔离批次接口

在隔离预览服务上执行真实批次流程，结果：

- 发现开放 PR 1 个，`discoveryComplete=true`；
- 已完成的同快照同模型分析被复用，`submission.reused=1`，`counts.completed=1`；
- 再次发起批次仍复用既有分析，不重复入队；
- 无失败项时重试返回 409 `TASK_NOT_RETRYABLE`；
- 不存在的批次返回 404 `NOT_FOUND`；
- 批次固定模型与实际完成任务模型一致。

### OpenSpec

- `openspec validate harden-review-workflows --type change --strict`：通过。
- `openspec validate --changes --strict`：4 个变更全部通过。
- `openspec validate --specs --strict`：26 个主规格通过；`focused-project-review` 的 FPR-02 因既有正文超过 500 字符产生警告，被严格模式计为失败。该警告位于既有主规格，本次未修改其正文。

## 数据库升级与备份

- 前向迁移 `019_pr_batches.sql` 只新增表和索引，保留既有项目、分析、模型、数据集、训练任务和管理员账户。
- 本机升级仍按既有流程：升级前用 SQLite backup 备份 `backend/storage/catalog.sqlite3`，停止旧后端后执行 `catalog-init`。
- 旧版本没有批次记录，读取最近批次返回 `null`，不影响既有 PR 列表和单条分析。

## 未完成或未验证

- 第二阶段（管理区多项目实验报告）与第三阶段（模型收益评估）未开始。
- `frontend/scripts/verify.ps1` 尚未接入 `playwright.project-workspace.config.ts` 的专用入口；该套件依赖单独的预览服务和夹具。
- 项目工作台浏览器脚本的趋势图断言仍按旧 SVG 线选择器编写，需随 ECharts 改造更新。
- 管理训练页的分页和失败恢复由组件行为测试覆盖；真实浏览器已验证列表→详情→返回→再打开，未在浏览器中构造 21 条以上任务或中断后端请求。
- 批次前端进度面板由组件测试与隔离接口流程验证，尚无连接真实 GitHub 的浏览器用例。
