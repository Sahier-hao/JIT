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

- [ ] 3.1 用共享组件与工具类重写 `AppShell` 的侧栏、顶栏、面包屑、跳过链接与最近项目列表；验证导航高亮、键盘跳转与 768px 折叠，运行 `workspaceRoutes`、`FocusedProduct` 相关测试及受影响 Playwright 用例。
- [ ] 3.2 迁移 `LandingPage`、`LoginPage`、账户菜单、外观控件与退役/未知路由提示，删除 `styles/entry.css`；运行 `entryFlow`、账户切换与登录 Playwright 用例，确认四套主题下入口页无横向滚动。
- [ ] 3.3 在 `docs/evidence/unify-frontend-visual-system/02-外壳与入口/` 存档 1280×720 与 1440×900、浅色与深色主题截图，核对侧栏、顶栏与入口页字号、间距和表面层级与设计规范一致。

## 4. 项目与分析

- [ ] 4.1 迁移 `ProjectsPage`、`NewProjectDialog`、`NewProjectForm`、项目重命名与删除流程；验证新建、重命名、删除后的列表与侧栏同步，`ProjectsPage` 测试与项目旅程 Playwright 用例通过。
- [ ] 4.2 迁移 `ProjectPage` 的分析选项、`AnalysisForm`、`AnalysisScopeCard`、`AnalysisLauncher`、分析记录列表与当前结果选择；验证发起、重试、设为当前结果与分页旅程，`ProjectPage`、`AnalysisScopeCard` 测试通过。
- [ ] 4.3 迁移提交明细、`CommitDetail`、`ModelCardDialog`、`ProjectDatasetDialog`、`DatasetBuildDialog`、`JobProgress`，把进度与状态的实现收敛到共享 `Progress` 与状态标签；运行提交明细、模型卡与数据集对话框测试，确认两档密度下表格行高与分页可用。
- [ ] 4.4 删除 `styles/product.css`、`styles/project.css`、`styles/project-workspace.css`、`styles/project-redesign.css`、`styles/update-status.css`、`styles/progress.css` 中已无消费者的文件，更新 `index.css` 导入；用 `scripts/check-styles.mjs` 与 `grep` 证明无引用，运行 `npm test` 与项目详情 Playwright 用例。
- [ ] 4.5 在 `docs/evidence/unify-frontend-visual-system/03-项目与分析/` 存档项目列表、项目详情、提交明细在双视口、双主题与紧凑密度下的截图，记录与旧外观的差异和保留项。

## 5. PR 审查与工作单

- [ ] 5.1 迁移 `ReviewWorkbench`、`PullRequestJourney`、`PullRequestPreview`、`PRModelClues`、`PRTrackingPanel` 与 `CodeDiff` 容器，把代码差异覆盖规则集中到 `styles/content.css` 并限定在容器内；运行 PR 审查、工作单与预览相关 Vitest 与 Playwright 用例。
- [ ] 5.2 验证工作单在 1440px 下代码栏不少于 780px、全局导航收起、统一/并排视图切换、行号固定证据与移动后返回列表的焦点恢复；为 `.wb-hunk`、`.pr-risk-line`、`.pr-fixed-preview` 等钩子加 `data-testid` 并更新 Playwright 定位。
- [ ] 5.3 删除 `styles/workbench.css`、`styles/workbench-modern.css`、`styles/claude.css`、`styles/pr-review.css` 中已无消费者的文件，更新 `index.css`；运行 `project-workspace` 与 PR 旅程配置，确认无样式类定位残留。
- [ ] 5.4 在 `docs/evidence/unify-frontend-visual-system/04-PR审查/` 存档工作单、文件列表、问题栏与预览页截图，核对代码优先表面、焦点反馈与窄屏重排在四套主题下一致。

## 6. 趋势、报告与内容

- [ ] 6.1 迁移 `TrendPage`、`TrendPanels`、`ProjectTrends`、`ProjectActivity`、`RepositoryOverview`、`RepositoryUpdates`、`AnalysisComparison`、`RepositoryExplanation`，保留图表工具类与下钻行为；运行趋势、覆盖度、下钻与通知相关测试。
- [ ] 6.2 把 Markdown 与 `repository-explanation` 的样式收敛到 `styles/content.css`，删除 `components/markdown.css` 与 `components/repository-explanation.css`；运行 `Markdown`、`RepositoryExplanation` 测试并确认表格、代码块、长链接不破坏容器布局。
- [ ] 6.3 删除 `trend.css`、`styles/dashboard.css`、`styles/research.css`、`pages/analysis-comparison.css`、`styles/modern.css` 中已无消费者的文件，更新 `index.css`；运行趋势与报告 Playwright 用例，`trend-tooltip`、`trend-drilldown`、`ui-chart` 改用 `data-testid`。
- [ ] 6.4 在 `docs/evidence/unify-frontend-visual-system/05-趋势与报告/` 存档趋势、覆盖度、对比与仓库概览截图，核对图表刻度、浮层、图例与表格在四套主题下的可读性。

## 7. 个人工作区

- [ ] 7.1 迁移 `MyDataPage`、`MyModelsPage`、`MyTrainingPage`、`ProfilePage`、`LineResearchPage` 与 `PersonalWorks`，统一列表、空状态与操作区；运行 `userWorkspace`、`lineResearch` 与个人作品相关测试。
- [ ] 7.2 删除 `styles/user-workspace.css` 与 `styles/research.css` 中已无消费者的文件，更新 `index.css`；运行个人工作区与账户隔离 Playwright 用例，确认无横向滚动与权限提示缺失。
- [ ] 7.3 在 `docs/evidence/unify-frontend-visual-system/06-个人工作区/` 存档四个页面在双主题、两档密度与 768px 窄屏下的截图，核对与项目页同一套表格、卡片与空状态。

## 8. 管理工作区

- [ ] 8.1 迁移 `AdminWorkspace` 外壳、管理导航与登录/权限提示，复用共享外壳形状但保留独立分区；运行管理登录、退出与分区切换 Playwright 用例。
- [ ] 8.2 迁移模型、数据、训练、实验与验证报告页面及详情，统一管理表格、卡片、状态标签与对话框；运行 `AdminTrainingWorkspace`、`AdminExperimentsWorkspace`、`AdminModelBenefit`、`AdminTracking` 相关测试与 `test:e2e:admin-training` 配置。
- [ ] 8.3 删除 `styles/admin.css`，更新 `index.css`；确认管理端与用户端使用同一 `Table`、`Card`、`Button`、`Dialog` 实现，`grep` 无 `admin-` 样式类残留于 CSS，运行管理端 Playwright 配置。
- [ ] 8.4 在 `docs/evidence/unify-frontend-visual-system/07-管理端/` 存档模型、数据、训练、实验与报告页截图，核对跨工作区控件形态、表格密度与表面层级一致。

## 9. 收尾与整体验证

- [ ] 9.1 删除剩余页面级样式文件与所有不再被引用的类名，`index.css` 最终只导入 `tokens.css`、`base.css`、`content.css`；`src/styles` 只保留这三个文件，`npm run build`、`npm test`、`npm run typecheck` 通过。
- [ ] 9.2 把 `scripts/check-styles.mjs` 的 Mantine 与旧样式豁免清单清空，新增探针确认守卫在出现新页面 CSS、`@mantine` 引用或未登记图标库时会失败；`npm test` 与 `npm run lint` 通过。
- [ ] 9.3 运行全部前端单元测试与可用的 Playwright 配置，记录实际执行范围、通过项与未运行项；未运行项写明原因，不用旧结果冒充本轮通过。
- [ ] 9.4 在四套主题、两档密度、1280×720 / 1440×900 / 768px 下逐页核对主要视图，确认无横向滚动、文字对比度与字号下限满足 IP-01/IP-02；`tokens.test.ts`、`contrast.test.ts`、`typography.test.ts` 通过，截图按批次归档。
- [ ] 9.5 更新 `docs/当前产品.md` 的界面描述与 `frontend/README.md` 的样式/组件章节，删除 Mantine 与旧样式层描述；在 `docs/审计/2026-11-16-unify-frontend-visual-system.md` 记录实施范围、与设计的偏差、样式文件与行数变化、构建产物大小与实际验证结果。
- [ ] 9.6 对比重构前后的前端 CSS 体积与首屏样式请求，把数字写入审计记录；确认删除 Mantine 后没有未使用的依赖残留，`npm ls` 与实际 import 一致。
- [ ] 9.7 启用 Tailwind preflight，删除 `base.css` 中被其覆盖的规则，逐页核对 1280×720、1440×900 与 768px 下列表、段落、表单控件与 SVG 对齐无回退；`npm run build`、`npm test` 与受影响的 Playwright 配置通过，异常时按设计回退到最小重置并记录。

## Workflow follow-up

- 实施与验证完成后，先同步本 change 的 `interface-presentation` delta 到主规格，再归档 change；不遗留已完成的本地 change。
- 按项目约定创建或更新 GitHub pull request，仅纳入本 change 相关文件，排除工作区中其他未提交改动。
- 归档后在项目记忆中记录最终样式边界（四个允许的样式表与守卫命令），供后续页面开发引用。
