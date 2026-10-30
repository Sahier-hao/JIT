# 前端技术栈现代化验收

日期：2026-10-30。范围：React Router 7、Tailwind CSS 4、shadcn 风格控件层、移除 Ant Design、路由级代码分割。对应变更 `modernize-frontend-stack`。

## 交付行为

| 项目 | 实现与验证范围 |
| --- | --- |
| 路由 | `createHashRouter` + `RouterProvider` 接管历史与导航；`#/projects/...` 地址和旧链接映射保持不变；`parseHash`/`hashFor` 继续作为领域解析器并被 `workspaceRoutes.test.ts` 覆盖。 |
| 样式方案 | Tailwind 4 只引入 theme 与 utilities（关闭 preflight）；`@theme inline` 把 `tokens.css` 的语义变量映射为 `background/foreground/card/primary/...`，四套主题仍由 `html[data-theme]` 切换。 |
| 控件层 | `ui/controls.tsx`、`ui/dialog.tsx`、`ui/popover.tsx` 重写；新增 Segmented、Dropdown、Drawer、Tooltip、Alert、Tag、Empty、Space。Radix 负责焦点与键盘行为，Tailwind 负责外观。 |
| antd 退役 | 13 个页面与组件迁移完成；`antd`、`@ant-design/icons`、`ui/AntdProvider.tsx` 删除；图标统一为 lucide 与自绘 SVG。 |
| 样式清理 | 删除 `styles/ui.css`，更新面板样式移入 `styles/update-status.css`；旧 CSS 中的 `.ant-*` 选择器改为 `.ui-*` 锚点。 |
| 代码分割 | 页面按路由 `lazy` 加载；首包 JS 从 1,329 kB（gzip 429 kB）降到 345 kB（gzip 110 kB），PR 工作单等独立成块。 |

## 验证

- 前端全量：**38 个文件、306 项通过**（`npm test -- --maxWorkers=1 --no-file-parallelism`）。
- `npm run typecheck` 通过；`npm run build` 通过，CSS 150 kB（gzip 27 kB）。
- `npm run lint`：25 条 `set-state-in-effect` / `only-export-components` 警告，无错误；均为数据加载与状态同步的既有写法。
- 迁移后修正的测试：Radix Select 的指针捕获 stub、模型选择保持原生 select、PR 工作单先进入提交列表、趋势筛选展开后再断言。

## 真实浏览器检查

使用隔离预览 API（真实 Git 夹具、SQLite 与模型副本）与独立 Vite 端口，在 Chromium 中检查：

- 项目列表、项目概览、分析（分析结果）、风险趋势、PR 审查、管理区登录页均正常渲染，控制台无错误。
- 浅色与深色主题各检查一次：主按钮在深色主题下反转为浅底深字，文字对比正常。
- 检查中发现并修复两处问题：
  - `base.css` 的全局 `button { color: inherit }` 是未分层规则，覆盖了 Tailwind 的 `text-primary-foreground`，导致主按钮文字与背景同色。已声明 `@layer theme, base, components, utilities` 并把该重置放入 `@layer base`。
  - 深色主题下品牌方块使用 `--btn`（浅色）而图标继承 `--fg`，对比不足。已让 `.brand-glyph` 使用 `--btn-fg`。

## 第二轮收敛

在首轮迁移之后继续完成：

- **四套主题全部可达**：外观偏好从「浅色/深色」两个按钮改为 `THEMES` 的四个主题按钮（冷灰、钢青、炭黑、纸墨），选择后写入 `jit.theme`；`tokens.css` 的默认块同时匹配 `:root` 与 `html[data-theme="concrete"]`，消除"值存在但没有选择器"的隐式回退。外观弹层改用 Radix Popover，点击外部可关闭。
- **拆分大文件**：`pages/PullRequestJourney.tsx` 从 557 行降到 458 行，备份、反馈、交付与问题编辑移入 `components/pr/WorkPanels.tsx`；`TrendPage.tsx` 从 647 行降到 298 行，图表、分区带与等价表格移入 `components/report/TrendPanels.tsx`。
- **页面级错误边界**：新增 `components/ErrorBoundary.tsx` 包住路由内容，渲染异常时保留外壳、显示原因并提供重试与返回项目列表入口。
- **样式守卫随结构调整**：`tokens.test.ts`、`contrast.test.ts` 改为识别新的根选择器；`chartTokens.test.ts` 增加 `TrendPanels.tsx` 作为图表令牌的引用来源。
- **验证**：前端全量 **38 个文件、306 项通过**；类型检查、构建通过；浏览器确认四个主题按钮存在且 `steel`、`paper`、`concrete` 切换后背景色与 `data-theme` 一致，无控制台错误。

## 未验证与边界

- 未在本轮重跑隔离浏览器 E2E（桌面 1440 与手机 390）；需要在本机启动后端后执行。
- 未做视觉回归截图对比；控件尺寸、圆角与焦点环按原令牌重建，但未逐页比对像素。
- 未迁移旧页面 CSS 到 Tailwind；当前是"新控件层 + 旧页面样式"的分层收敛，旧页面在后续改版时再逐步替换。
- 未引入 TanStack Query、react-hook-form、OpenAPI 类型生成；这些留在后续变更。
