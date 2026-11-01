# 审查入口统一验收：分析参数、模型来源、进度与站内提醒

日期：2026-11-01。范围：项目工作台实际使用后的五项反馈。数据库为本地开发库，模型目录使用真实登记产物，GitHub PR 清单与分析任务为真实执行。

## 交付行为

| 能力 | 实现与验证范围 |
| --- | --- |
| 风险概览 | PR 只读详情与工作单顶部压成一行：分数覆盖、最高分、模型名与「打开分析」。不再重复列出分析记录、任务标识与提交排序；旧版 HEAD 绑定保留折叠说明。 |
| 发起分析 | 对话框只保留分支与模型来源；不再提交起始日期、结束日期和提交上限。重试只恢复分支与模型策略，不隐藏旧日期窗口。 |
| 全量历史 | 服务端未指定起点时采集全部历史，终点默认今天；提交上限默认与最大值统一为 50,000，仅作为执行保护。记录以「全部历史」显示。 |
| 批量模型来源 | 「分析全部 PR」默认选中项目当前结果所用模型，另列管理员默认模型与其他已登记兼容模型；批次创建时固定模型身份。 |
| 进度 | 项目页显示五阶段轨道（排队、采集、登记、训练、评分）、排队位置与已用时间；进行中的分析记录显示紧凑进度；批量 PR 以已发现数量为分母推进；PR 读取、远端检查与新建项目使用不确定进度条。 |
| 站内提醒 | 分支分析完成或失败写入 `project_event`；提醒页显示未读数量、事件类型、固定来源入口，窗口重新获得焦点时刷新。取消、中断与 PR 分析不重复写。 |
| 文案 | 删除项目列表、发起分析、新建项目、PR 预览、自动分析设置、分支提醒与分析概览中只解释、不改变操作的小字；保留失败原因、不可撤销后果、旧版本绑定与数据范围说明。 |

## 关键实现

- [sync.py](../backend/jit_baseline/sync.py)：`_window` 未指定起点时返回全量窗口；`DEFAULT_LIMIT`/`MAX_LIMIT` 调整；`_event` 在分支分析终态写入 `project_event`，并在超时、进程退出、失败与完成路径调用。
- [JobProgress.tsx](../frontend/src/components/JobProgress.tsx)、[progress.css](../frontend/src/styles/progress.css)：阶段轨道、节点状态、扫光与不确定进度。
- [AnalysisForm.tsx](../frontend/src/components/AnalysisForm.tsx)：移除日期、结束日期、高级选项与提交上限。
- [ProjectPage.tsx](../frontend/src/pages/ProjectPage.tsx)：批量模型选项以当前项目模型优先；页头与记录行接入进度；重试参数与「全部历史」显示。
- [PRModelClues.tsx](../frontend/src/components/PRModelClues.tsx)：风险概览压缩为一行，保留文件与提交风险回调。
- [ProjectActivity.tsx](../frontend/src/components/ProjectActivity.tsx)：事件类型、未读统计、焦点刷新与精简文案。

## 验证结果

### 后端

`backend/.venv/Scripts/python.exe -m pytest -q --basetemp=.cache/stream-full`：**650 passed**，1 条既有 PyTorch 警告。

更新用例：

- `tests/test_repository_sync.py`：提交上限边界改为 50,001。
- `tests/test_repository_updates.py`：真实同步完成后断言存在 `analysis-completed` 提醒，并把分支检查事件过滤后计数。

### 前端

`npm run typecheck`、`npm run lint`、`npm run build` 通过；`npm test`：**333 passed**。

更新用例覆盖：简化后的分析表单、重试不携带日期窗口、风险概览一行、旧版绑定折叠说明、PR 预览入口与提醒页。

### 浏览器

默认浏览器套件在隔离端口 4273/8123 运行：**16 passed**（约 5.4 分钟）。覆盖项目列表、新建项目、简化后的分析对话框、九种模型实际分析、模型默认与停用策略、PR 只读详情与工作单入口。

管理训练浏览器套件在同组隔离端口运行：**1 passed / 1 skipped**。桌面 1440 在当前夹具下按既有规则跳过；桌面 1280 完成大型仓库的现成模型、自动训练、强制训练与管理员指标回看。

预览浏览器套件（`scripts/verify-preview.ps1`，端口 18769/18770）：**4 passed / 2 skipped**。桌面 1440 与手机 390 均通过项目持续审查、固定提醒、趋势刷新与 PR 只读详情的风险概览；管理区报告用例在手机视口按既有规则跳过。

真实预览服务上实际观察：

- 发起分析对话框只剩分支与模型来源，无日期、结束日期、高级选项与提交上限。
- 分析全部 PR 的模型下拉默认显示「当前项目模型 · 逻辑回归 · kamei14-git-v1」。
- cc-switch 全量历史分析在 25 秒内完成 3,386 个提交；页头进度条显示当前阶段与已用时间，阶段节点随服务端状态推进。
- 分析完成后站内提醒出现「分析完成 · main · 3386 个提交已评分」，头部未读计数为 1。
- PR 只读详情的风险概览显示「模型分数 2/2 有分数 · 最高 0.176 · 逻辑回归 · 六字段 · 打开分析」。

### 本地模型目录修复

本机九份模型产物的 `featureSchema` 元数据早于当前 schema 定义，读取时被判为 `ARTIFACT_INVALID`。升级前备份 `backend/storage/catalog.sqlite3` 为 `catalog.sqlite3.before-model-repair-20261101.sqlite3`，随后按原运行键重新登记；模型 ID、运行 ID 与产物不变，九个模型恢复可用。

### OpenSpec

- `openspec validate streamline-review-flows --type change --strict`：通过。
- 变更已归档为 `2026-11-01-streamline-review-flows`，同步 `repository-collection`（修改 RCL-07、RCL-08，新增 RCL-22）与 `project-pr-tracking`（修改 PPT-02）。
- `openspec validate --specs --strict`：**27 passed**；未归档变更 3 个全部通过。

## 未完成或未验证

- 全量历史采集可能触及 600 秒执行时限；超时后保留已登记数据集并给出可重试原因，不静默缩小范围。
- 站内提醒的已读状态仍只保存在当前浏览器，不跨设备同步。
- 批量 PR 的进度条逻辑由组件与接口测试覆盖，尚未对真实 GitHub 开放 PR 发起完整批次。
