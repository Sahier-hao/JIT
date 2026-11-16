# Tasks

## 1. 样式基座与令牌

- [x] 1.1 把 `styles/tokens.css` 的全部颜色语义键、五个色族、风险色阶、图表色、主行动、遮罩、字号、行高、圆角、阴影映射进 `src/index.css` 的 `@theme inline`，并修正圆角档位与 `rounded-*` 的对应关系；新增 `src/theme.test.ts` 断言 `tokens.test.ts` 的必需键在主题映射中全部存在，`npm test` 通过。
- [x] 1.2 记录元素级默认值清单（标题、正文、列表、表格、表单控件、SVG 对齐），确认 preflight 推迟到收尾批次启用；当前基线用截图核对入口页与项目页无变化，清单与启用时机写入设计规范。
- [x] 1.3 在 `tokens.css` 定义舒适与紧凑两档密度变量，并通过 `@theme inline` 暴露为 `row`、`cell-x`、`card` 等间距工具类；新增测试解析两档数值与 `html[data-density="compact"]` 覆盖关系，`npm test` 通过。
- [x] 1.4 新增 `scripts/check-styles.mjs` 与对应 Vitest 用例：校验 `src` 下只允许 `index.css`、`tokens.css`、`base.css`、`content.css`；`index.css` 只导入允许的文件；页面不直接导入页面级 CSS；`@mantine` 引用在收尾前使用临时豁免清单。用一个临时违规文件验证守卫会失败，删除后通过。
- [x] 1.5 新建 `docs/界面设计规范.md`，记录字号、间距、圆角、阴影、表面、状态色、焦点、表格密度与组件使用规则，并写明四个允许的样式表与守卫命令；`frontend/README.md` 增加指向该文档的链接，按文档中的检查命令实际运行一次并记录结果。

## 2. 共享组件层

- [x] 2.1 用 Radix + CVA + `cn` 落地 `Button`、`IconButton`、`Input`、`TextArea`、`NumberInput`、`PasswordInput`、`Select`、`Checkbox`、`Switch`，保留现有 props 与导出；选择、复选与开关在页面测试中完成键盘与点选验证，`npm test` 通过且页面无需改调用方式。
- [x] 2.2 用 Radix 重写 `Dialog`、`Popconfirm`、`Drawer`、`Dropdown`、`Popover`、`Tooltip`；确认气泡沿用 Popover 定位而不新增 AlertDialog 依赖；对话框、抽屉与菜单的关闭、焦点交还和键盘选择由页面测试与浏览器用例覆盖。
- [x] 2.3 落地 `Table`、`Card`、`PageHeader`、`SectionHeader`、`Tag`、`Alert`、`Empty`、`Progress`、`Disclosure`、`Segmented` 共享形状，统一表头、行高、卡片标题与页面标题结构；新增 `layout.test.tsx` 断言密度间距类、表头语义与进度条可访问数值，`npm test` 通过。
- [x] 2.4 把 `Icon.tsx` 改为唯一图标入口，改用 lucide 图形并统一 1.5 描边，品牌标志保留自绘；11 个直接引用 lucide 的文件改为使用 `Icon`，新增 `iconSource.test.ts` 与 `Icon.test.tsx` 断言来源唯一、24 网格与描边一致。
- [x] 2.5 从 `App.tsx` 与 `test-utils.tsx` 移除 `MantineProvider`，删除 `lib/mantineTheme.ts` 与 `styles/mantine-bridge.css`；`npm test`、`npm run typecheck` 通过，`grep -r "@mantine" src` 无结果。
- [x] 2.6 移除 `@mantine/core`、`@mantine/hooks`、`postcss-preset-mantine`、`postcss-simple-vars` 与 `postcss.config.cjs`，更新 lockfile；重新安装依赖后 `npm run build` 与 `npm test` 通过，构建产物不再包含 Mantine 样式。
- [x] 2.7 更新 `frontend/README.md` 的技术栈与组件说明，删除 Mantine 版本描述，写明 Radix + Tailwind + CVA 的组件入口与新增组件规则；按 README 中的命令实际安装与构建一次，记录结果。

## 3. 外壳与入口

- [x] 3.1 用共享组件与工具类重写 `AppShell` 的侧栏、顶栏、面包屑、跳过链接与最近项目列表；导航高亮、键盘跳转与 768px 折叠由 `workspaceRoutes`、`entryFlow` 测试和 PR 续审浏览器旅程验证。
- [x] 3.2 迁移 `LandingPage`、`LoginPage`、`LineResearchPage` 的入口外壳与表单，统一品牌头、入口页脚与登录卡片，删除 `styles/entry.css`；退役/未知路由仍复用 `EmptyState`，其样式随共享反馈在收尾批次统一。
- [x] 3.3 在 `docs/evidence/unify-frontend-visual-system/03-外壳与入口/` 存档入口页、管理员登录与研究预览在双视口、双主题下的截图，核对品牌头、表单与页脚的字号、间距和表面层级。

## 4. 项目与分析

- [x] 4.1 迁移 `ProjectsPage` 的项目卡片、状态标记、管理菜单与内联改名/删除确认，`NewProjectForm` 与新建对话框统一字段结构；项目列表、改名、删除与新建旅程的既有测试通过。
- [x] 4.2 迁移 `ProjectPage` 的页头、项目标签、分析结果区、分析记录列表与分页，`AnalysisForm`、`AnalysisLauncher`、`AnalysisScopeCard` 与 `JobProgress` 改用共享组件；项目页 20 项测试通过，含切换当前结果、取消、重试与分页。
- [x] 4.3 迁移 `CommitDetail`、`ProjectDatasetDialog`、`DatasetBuildDialog` 与 `RepositoryUpdates`，统一详情、对话框与分支提醒的表面和字段结构；相关组件测试通过。
- [x] 4.4 删除已无消费者的 `styles/progress.css` 并更新守卫；`project.css`、`project-workspace.css`、`project-redesign.css`、`update-status.css` 仍被 PR、趋势与管理页面使用，保留到各自批次删除。
- [x] 4.5 把旧页面样式导入到 `legacy` 级联层，使 Tailwind 工具类可以覆盖旧样式而无需先删除文件；入口、项目列表、项目详情、分析结果、PR 标签与提交明细在双主题下截图核对，证据在 `docs/evidence/unify-frontend-visual-system/04-项目与分析/`。

## 5. PR 审查与工作单

- [x] 5.1 迁移 `ProjectPullRequests`、`PRTrackingPanel`、`PRModelClues`、`PullRequestPreview`、`ReviewWorkbench` 与代码差异容器，统一 PR 列表、追踪设置、风险线索、只读预览与提交明细的表面、表头与操作区。
- [x] 5.2 迁移审查工作单的页头、提交表、三栏阅读区、问题编辑、交付与备份抽屉；PR 续审完整浏览器旅程（两账户、登录注册、工作单、草稿）通过，1440px 下代码栏按 260/1fr/320 分配并保持独立滚动。
- [x] 5.3 将 `pr-risk-line`、`update-status-title` 等样式钩子改为 `data-testid` 并更新浏览器用例；删除已无消费者的 `workbench-modern.css`，`workbench.css`、`pr-review.css`、`claude.css` 仍被个人工作区、趋势与管理页面使用，保留到各自批次。
- [x] 5.4 在 `docs/evidence/unify-frontend-visual-system/05-PR审查/` 存档 PR 列表、只读预览、工作单文件视图与深色截图，核对代码优先表面、独立滚动与三栏层级。

## 6. 趋势、报告与内容

- [x] 6.1 迁移 `TrendPage`、`TrendPanels`、`ProjectTrends`、`ProjectActivity`、`RepositoryOverview`、`AnalysisComparison`，统一 KPI、分区覆盖、图表卡片、等价数据表、站内提醒与仓库概览的表面与表格结构。
- [x] 6.2 新建 `styles/content.css` 承载 Markdown 正文与模型解释的后代规则，删除组件级 `markdown.css` 与 `repository-explanation.css`，内容仍限定在各自容器内。
- [x] 6.3 删除 `trend.css` 与 `analysis-comparison.css`；图表 SVG 改用内联令牌色与 Tailwind，保留 `trend-*` 作为图表测试钩子并更新 `chartTokens.test.ts`。`research.css`、`dashboard.css`、`modern.css` 仍被个人工作区、管理端与共享反馈使用，保留到后续批次。
- [x] 6.4 在 `docs/evidence/unify-frontend-visual-system/06-趋势与报告/` 存档项目风险趋势与站内提醒截图，核对图表、图例、覆盖条与表格在浅色和深色下的可读性。

## 7. 个人工作区

- [x] 7.1 迁移 `MyDataPage`、`MyModelsPage`、`MyTrainingPage`、`ProfilePage`、`LineResearchPage` 与 `PersonalWorks`，统一列表、卡片、表单、状态标签与空状态；用户工作区、研究预览与个人作品相关测试通过。
- [x] 7.2 删除 `user-workspace.css` 与 `research.css` 并更新守卫；与账户隔离相关的既有测试通过，`dashboard.css`、`claude.css`、`modern.css` 仍被管理端与共享反馈使用，保留到第 8 批。
- [x] 7.3 在 `docs/evidence/unify-frontend-visual-system/07-个人工作区/` 存档我的数据、我的训练、我的模型、个人空间、我的审查与研究预览截图，核对列表、表单与统计栅格在浅色和深色下的一致性。

## 8. 管理工作区

- [x] 8.1 迁移 `AdminWorkspace` 外壳、管理导航、登录跳转与账户区，复用共享外壳形状并保留独立分区；管理登录与分区导航由 `FocusedProduct` 测试覆盖，未在预览服务上执行独立 Playwright 配置。
- [x] 8.2 迁移模型、数据、训练、实验与验证报告页面及详情，统一管理表格、卡片、状态标签、筛选与对话框；`AdminTrainingWorkspace`、`AdminExperimentsWorkspace`、`AdminModelBenefit`、`AdminTracking` 等单元测试通过，管理端列表、详情与报告在真实预览数据下截图核对。
- [x] 8.3 删除 `admin.css` 及全部旧样式层，管理端与用户端统一使用 `Table`、`Card`、`Button`、`Dialog`；`admin-table`、`admin-model-card`、`admin-dataset-card` 仅作为浏览器验收钩子保留，外观由工具类承担。
- [x] 8.4 在 `docs/evidence/unify-frontend-visual-system/08-管理端/` 存档模型、数据、实验、报告与详情页截图，核对跨工作区控件与表面层级（深色仅核对模型列表）。

## 9. 收尾与整体验证

- [x] 9.1 `src/styles` 只保留 `tokens.css`、`base.css`、`content.css`，`index.css` 只导入这三个文件；`npm run build`、`npm test`、`npm run typecheck` 通过。
- [x] 9.2 `scripts/check-styles.mjs` 的 Mantine 与旧样式豁免清单已清空，守卫只允许四个样式表与登记导入；`npm test` 与 `npm run lint` 通过。
- [x] 9.3 运行前端全部单元测试（59 个文件、433 项通过）与 PR 续审完整浏览器旅程（通过）；`project-workspace`、`project-dataset` 与管理端专用 Playwright 配置因预览服务未建立会话或本机未执行而未运行，已在审计记录中列明。
- [x] 9.4 四套主题的令牌、对比度与排版契约测试通过；入口、项目、分析、PR、趋势、个人工作区与管理端主视图在浅色/深色与 1440×900 下截图核对，1280×720 与紧凑密度按批次抽查，异常项已修复。
- [x] 9.5 更新 `frontend/README.md` 的样式与组件章节；界面文案与流程未变化，`docs/当前产品.md` 不需要改动；`docs/审计/2026-11-16-unify-frontend-visual-system.md` 记录实施范围、偏差、样式规模与验证结果。
- [x] 9.6 样式表从 24 个减到 4 个，CSS 从约 7 816 行减到 716 行；Mantine 依赖已移除，`npm ls` 与源码 import 一致。
- [x] 9.7 启用 Tailwind preflight，`base.css` 保留字体、文档底色与无障碍规则；删除全部旧样式层后重新构建并截图核对入口、项目、分析与 PR 工作单，未见布局回退。

## Workflow follow-up

- 实施与验证完成后，先同步本 change 的 `interface-presentation` delta 到主规格，再归档 change；不遗留已完成的本地 change。
- 按项目约定创建或更新 GitHub pull request，仅纳入本 change 相关文件，排除工作区中其他未提交改动。
- 归档后在项目记忆中记录最终样式边界（四个允许的样式表与守卫命令），供后续页面开发引用。
