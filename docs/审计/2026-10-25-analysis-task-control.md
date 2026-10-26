# 项目分析任务控制与采集文件保护验收

## 交付范围

- `control-project-analysis-tasks`：排队和运行取消、进程树终止、执行时限、队列信息、退出恢复、迁移 009、项目页取消与原范围重试。
- `preserve-sync-dataset-files`：同名原始 CSV 不覆盖、完整文件原子发布、保留描述和导入版本冲突恢复。

普通项目保持公开使用；管理员维护权限、所选模型身份和已有成功结果继续沿用现有边界。

两项变更已分别归档：[任务控制](../../openspec/changes/archive/2026-10-25-control-project-analysis-tasks/proposal.md)（14/14 项）与 [采集文件保护](../../openspec/changes/archive/2026-10-25-preserve-sync-dataset-files/proposal.md)（6/6 项），对应主规格同步新增 4 项要求、修改 RCL-05 一项要求。

## 自动检查

| 检查 | 命令或入口 | 实际结果 |
| --- | --- | --- |
| 后端全量 | 在 backend 运行 `.venv/Scripts/python.exe -m pytest tests -q --basetemp=.pytest-tmp/task-control-delivery` | 386 passed，2 warnings |
| 最终任务控制专项 | `pytest tests/test_sync_control.py -q`，独立临时目录 | 13 passed，1 warning；含运行取消 202、重复取消、排队创建复用位置及进行中删除拒绝；OpenAPI 回归包含在全量中 |
| 前端全量 | 在 frontend 运行 `npm test` | 29 文件，244 passed |
| 类型与构建 | `npm run typecheck`、`npm run build` | 均 exit 0 |
| lint | `npm run lint` | exit 0，9 warnings |
| change 严格校验 | `openspec validate <change> --strict --no-interactive --json` | 两份 change 均 valid，无 issues |
| 归档后主规格 | `openspec validate --all --strict --no-interactive --json` | 15/15 通过；逐块核对两份 delta 已在主规格中，活动 change 为空 |
| 全量归档任务检查 | `openspec validate --archived --strict --no-interactive --json` | 31/33 通过；本轮两项通过，两份 2026-10-19 历史部分完成归档继续报告原未完成任务 |
| 空白检查 | `git diff --check` | exit 0，存在 Git 的 LF/CRLF 提示 |

后端警告为 Starlette/httpx 弃用提示和 FT-Transformer 的 nested tensor 提示；不记录为零警告。原始输出位于运行目录：

- `docs/evidence/_run/task-control-backend-delivery.log`
- `docs/evidence/_run/task-control-frontend-final.log`
- `docs/evidence/_run/task-control-lint.log`

任务控制回归使用真实自有 Python 父子进程，验证取消后进程不存活、下一任务得到执行以及超时释放；另覆盖取消/完成竞争、迟到失败、过期成功发布、服务退出、关闭后拒绝创建和重启取消意图。数据库、模型副本和产物目录均为一次性夹具。

## 真实浏览器与 Git 集成

隔离服务为 `127.0.0.1:18461`，前端为 `127.0.0.1:18462`，Git HTTP 夹具为 `127.0.0.1:18463`。通过独立后端进程的 Git URL 映射，把 `https://task-control.example/repo.git` 指向本地固定 Git 仓库；并非公网仓库实测。浏览器使用 agent-browser 操作真实界面与真实 API，没有拦截 API 响应。

| 用户流程 | 观察结果 |
| --- | --- |
| 首次分析 | 固定七提交仓库完成分析，保存模型、时间窗口及成功结果 |
| 运行采集并新增排队项 | HTTP 夹具暂停响应，确认 Git 已开始；下一记录显示排队第 1 位 |
| 取消排队项 | 页面先确认，取消后保留记录并出现原参数重试，执行中的另一项仍存在 |
| 取消采集项 | 接受请求后出现禁用的正在取消按钮，随后成为已取消；两项取消均未改变原成功视图 |
| 恢复日期与模型 | 日期控件为 `2024-01-01` 至 `2024-01-08`，原模型仍被选择 |
| 重新分析 | 实际保存窗口仍为 `2024-01-01T00:00:00+00:00` 至 `2024-01-09T00:00:00+00:00`，模型与原成功分析一致；新成功结果成为当前结果，原取消记录保留 |
| 桌面及窄屏 | 1440px 和 390px 均无页面横向溢出，取消及重试入口可见 |

重试初次遇到本地 HTTP 夹具仅提供 `.git` 地址、未提供规范化地址别名的 404；补齐同一仓库别名后完成上述成功路径。该失败记录保留，最终项目有两项成功、两项取消和一项夹具失败，共五条分析记录。

运行状态、夹具与截图保存在 `docs/evidence/_run/task-control-20261025/`，包括 `state.json`、`queue-desktop.png`、`cancelled-desktop.png`、`cancelled-mobile.png`、`retry-mobile-success.png` 和 `retry-desktop-success.png`。截图不是冻结证据，也不表示模型在新仓库上效果得到验证。

验收后已关闭本次浏览器会话及 18461/18462/18463 的自有测试服务，记录和截图保留。

## 升级与既有数据保护

使用 SQLite 只读连接将本机目录库 backup 为一次性副本，再在副本上执行迁移 009 两次。对旧表全部共享列排序后进行哈希比较：**19 张表、88,788 行保留一致，外键检查无错误**。详见运行目录的 `upgrade-check.json`。

本机原目录库未执行升级，其他会话服务未停止；实际升级须按 [当前产品](../当前产品.md) 先备份和停止对应部署，再执行 `catalog-init`。模型与数据产物继续保留。

## 验收边界

- 单实例、单 worker；未实现分布式领取或多服务实例共享调度。
- Windows Job Object 的进程树终止已通过父子进程及真实 Git 流程验证；未把 POSIX 强制父进程退出后的清理作为已验收结论。
- 已完成数据/模型登记不会因取消而回滚删除；不完整产物不会成为成功分析结果。
- 未新增 GPU 运行、概率校准或模型效果实验；本次验收结论限于任务控制、数据保护和前端操作。
