# Tasks

## 1. 基础设施

- [x] 1.1 安装 React Router 7、Tailwind CSS 4、CVA、tailwind-merge 与 Radix Tooltip；配置 Vite/Vitest 的 `@` 别名与 tsconfig paths；验证：`npm run typecheck` 通过。
- [x] 1.2 `index.css` 引入 Tailwind theme/utilities（关闭 preflight）并用 `@theme inline` 映射令牌；验证：构建后四套主题仍由 `data-theme` 切换。
- [x] 1.3 重写 `ui/controls.tsx`、`ui/dialog.tsx`、`ui/popover.tsx`，新增 Segmented、Dropdown、Drawer、Tooltip、Alert、Tag、Empty、Space；保留 `.ui-*` 锚点；验证：38 个测试文件、306 项通过。

## 2. 路由

- [x] 2.1 `navigation.ts` 的 `useRoute` 改用 `useLocation`/`useNavigate`，`parseHash`/`hashFor` 保持不变；验证：`workspaceRoutes.test.ts` 30 项与 `ProductWorkspace.test.tsx` 8 项通过。
- [x] 2.2 `App.tsx` 使用 `createHashRouter` + `RouterProvider`；验证：默认入口 `#/projects`、旧链接映射与报告返回路径通过现有测试。
- [x] 2.3 页面按路由 `lazy` 加载并用 `Suspense` 兜底；验证：构建产物首包约 345 kB，PR 工作单等独立分块。

## 3. 组件迁移

- [x] 3.1 迁移 CommitDetail、ReviewWorkbench、TrendPage、PRModelClues、RepositoryExplanation、ModelPolicyCards 的 Button；验证：相关组件测试通过。
- [x] 3.2 迁移 AnalysisComparison、VerificationReport、ProjectsPage、AdminWorkspace、ProjectPullRequests、PullRequestPreview、PullRequestJourney；验证：对应测试与全量测试通过。
- [x] 3.3 移除 `antd`、`@ant-design/icons` 与 `ui/AntdProvider.tsx`；图标统一 lucide 或自绘；验证：`grep` 无 antd 引用，类型检查与构建通过。
- [x] 3.4 删除 `styles/ui.css`，更新面板样式移入 `styles/update-status.css`；旧 `.ant-*` 选择器改为 `.ui-*`；验证：构建 CSS 无 `.ant-` 选择器。

## 4. 验证与文档

- [x] 4.1 前端全量：38 个文件、306 项通过；类型检查、构建通过；lint 仅既有与新增的 `set-state-in-effect` 警告。
- [x] 4.2 更新 `frontend/README.md` 技术栈说明与 `docs/审计/2026-10-30-frontend-modernization.md`；验证：文档与依赖清单一致。
- [x] 4.3 记录构建体积：JS 1,329 kB（gzip 429）→ 首包 345 kB（gzip 110）；CSS 150 kB（gzip 27）。

## Workflow follow-up

- 用户复核后归档本变更。
- 浏览器 E2E 与真实后端联调由用户在本机执行。
