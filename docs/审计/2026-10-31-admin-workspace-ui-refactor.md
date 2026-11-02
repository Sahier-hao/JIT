# 管理工作区界面重构与验证报告呈现

日期：2026-10-31。范围：管理工作区独立外壳、管理员登录弹窗、管理页面呈现与文案、验证报告概览与时间趋势呈现。前端类型检查、单元测试和生产构建为真实执行；浏览器核对使用模拟管理员会话与固定历史运行夹具，未使用真实管理员密码。

## 交付行为

| 能力 | 实现与验证范围 |
| --- | --- |
| 管理工作区外壳 | `admin` 与 `report` 路由直接渲染管理工作区，不再经过用户项目外壳；左侧五分区导航、当前分区高亮、管理员账户、退出管理和返回用户工作区。 |
| 管理员登录 | 登录与首次设置改为居中弹窗；账户名、密码、确认密码、提交中、错误和关闭入口保留；关闭、Esc 与遮罩关闭返回用户工作区。 |
| 管理页面呈现 | 统一页头（标题、可选元信息、操作）；模型卡、数据集卡、训练任务表、模型比较表统一为卡片与表格；移除各页 intro 与 form-hint；外观偏好控件在用户与管理外壳共用。 |
| 验证报告概览 | 页头保留项目、模型与公开历史来源；页头下方固定「模型分数未经概率校准，不代表已确认缺陷」；测试提交与 AP、ROC-AUC、Recall@20%LOC 改为卡片；基线记录改为可展开面板。 |
| 时间趋势 | 提示条改为标准信息条；删除重复标题与粒度行；图例压缩为提交数、观测正标签比例、模型风险中位数；脚注压缩为一句边界；相邻时间桶横轴标签按像素距离避让；趋势面板、文本视图与来源面板统一卡片。 |
| 不变部分 | 管理员会话、密码、权限、登录限流、模型策略、训练任务接口、报告解析、聚合缺失/不合法状态与下钻参数均未修改。 |

## 变更文件

- 外壳与路由：`frontend/src/App.tsx`、`frontend/src/AppShell.tsx`、`frontend/src/pages/AdminWorkspace.tsx`
- 管理页面：`frontend/src/pages/admin/*`、`frontend/src/pages/ModelPolicyCards.tsx`、`frontend/src/pages/admin/AdminShared.tsx`
- 共享控件：`frontend/src/components/AppearanceControl.tsx`、`frontend/src/ui/controls.tsx`
- 报告与趋势：`frontend/src/VerificationReport.tsx`、`frontend/src/TrendPage.tsx`、`frontend/src/components/report/TrendPanels.tsx`
- 样式：`frontend/src/styles/admin.css`、`frontend/src/trend.css`
- 测试：`frontend/src/FocusedProduct.test.tsx`、`frontend/src/ProductWorkspace.test.tsx`、`frontend/src/TrendPage.test.tsx`

## 自动化检查

- 前端类型检查：`npm run typecheck`，退出码 0。
- 前端单元测试：`npx vitest run`，39 个测试文件、317 项通过。
- 生产构建：`npm run build`，退出码 0；保留既有 chunk 体积提示与 `ProjectActivity` 动态/静态导入提示，本次未新增构建错误。

## 浏览器核对

使用 Playwright 无头 Chromium，拦截 `/api/admin/session` 返回已登录或未登录状态，管理数据接口与 `/api/review-batch` 使用固定夹具。目标为实际 Vite 开发服务器 `127.0.0.1:4173`。

- 已登录：模型管理、数据集、训练任务、模型比较、验证报告概览、时间趋势、提交记录逐页截图，控制台无错误。
- 未登录：打开 `#/admin` 显示「管理员登录」弹窗；点击关闭后地址回到 `#/projects`。
- 窄屏：768×900 视口下模型管理、数据集、训练任务、验证报告四个地址的 `documentElement.scrollWidth` 均等于 `clientWidth`（768），无页面级横向滚动。
- 截图：`docs/evidence/refactor-admin-workspace-shell/` 下的 `admin-login.png`、`admin-models.png`、`admin-datasets.png`、`admin-training.png`、`admin-comparisons.png`、`admin-report-overview.png`、`admin-report-trends.png`、`admin-report-commits.png`。

## 未覆盖与边界

- 未使用真实管理员密码登录本机服务；浏览器核对只覆盖模拟会话下的呈现与导航，真实登录、会话到期与权限拒绝沿用既有实现和既有测试。
- 未重跑后端测试与 Playwright 项目端到端套件；本次未修改后端、数据库或用户项目工作区行为。
- 截图中的管理数据来自固定夹具，不是本机真实模型目录；界面呈现与真实接口字段由既有契约测试覆盖。
