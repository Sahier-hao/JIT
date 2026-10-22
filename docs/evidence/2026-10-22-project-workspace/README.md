# 2026-10-22 项目与分析两层 · 验证证据

对应 change：`add-project-management`（后端接口）、`rebuild-project-workspace`（前端流程与规格）。

## 范围

- 新建项目只登记仓库地址；分析在项目页发起，每次提交产生一条记录。
- 项目页展示当前分析结果、发起分析与分析记录；记录可打开结果、原参数重试、删除。
- 项目可重命名、硬删（有在途分析时返回冲突）。
- 没有成功结果时区分「上次失败」与「从未分析」；删除当前结果记录后回到无结果，不回退旧结果。
- 路由：`#/projects`、`#/projects/new`、`#/projects/:id`、`#/projects/:id/analyses/:syncId/(commits|plan)`；旧地址继续映射。

## 截图

| 文件 | 内容 | 数据 |
| --- | --- | --- |
| `screenshots/01-projects.png` | 项目列表（有结果 / 无结果两张卡） | route.fulfill 夹具 |
| `screenshots/02-new-project.png` | 新建项目页（只收仓库地址） | 夹具 |
| `screenshots/03-project.png` | 项目页：当前结果、发起分析、记录 | 夹具 |
| `screenshots/03b-project-options.png` | 项目页展开「分析选项」 | 夹具 |
| `screenshots/04-project-failed.png` | 无结果项目：上次失败 + 失败记录 | 夹具 |
| `screenshots/05-projects-real.png` | 真实后端项目列表 | 真实库 |
| `screenshots/06-project-real.png` | 真实后端项目页：39 提交、34 高风险、5 条记录 | 真实库 |
| `screenshots/07-project-mobile.png` | 项目页 390×844 | 夹具 |
| `screenshots/08-projects-mobile.png` | 项目列表 390×844 | 夹具 |

## 命令与结果

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_repository_management.py -q   # 11 passed
backend/.venv/Scripts/python.exe -m pytest backend/tests -q                                  # 338 passed, 10 failed（既有环境问题）
Push-Location frontend
npm run typecheck   # 通过
npm test            # 26 文件 / 223 用例通过
npm run lint        # 0 error, 8 warnings
npm run build       # 通过
Pop-Location
openspec validate --specs --strict   # 14 passed / 0 failed
```

真实后端冒烟：8000 提供 API，4173 提供前端；项目页读取到 39 个已分析提交、34 高 / 1 中 / 4 低、5 条分析记录（completed / interrupted / failed）。

## 限制

- 没有跑 Playwright e2e：浏览器内核未装齐。
- 夹具截图只用于核对布局与状态，不代表模型效果。
- 验证报告页本轮只统一了页头，未重做结构。
