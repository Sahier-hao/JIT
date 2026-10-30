# Proposal

## Why

前端已经同时存在三套组件与样式来源：Ant Design 6（运行时注入样式）、Radix 原语加手写 CSS、以及散落在页面里的裸 HTML 控件。结果是同一页面混用两套外观、样式靠 import 顺序与级联覆盖、首包约 1.3 MB，且没有真正的路由与代码分割。2026-10-30 用户要求大胆重构，统一到一套可维护的技术栈。

## What Changes

- 路由改用 React Router 7 的 `createHashRouter`；继续使用 `#/projects/...` 地址与旧链接映射，`parseHash`/`hashFor` 作为领域解析器保留。
- 引入 Tailwind CSS 4（关闭 preflight，避免覆盖现有 reset），并用 `@theme inline` 把 `tokens.css` 的语义变量映射为 `background/foreground/card/primary/...`，四套主题继续由 `html[data-theme]` 驱动。
- `ui/controls.tsx`、`ui/dialog.tsx`、`ui/popover.tsx` 重写为 shadcn 风格的自持组件：Radix 负责行为，Tailwind 负责外观；新增 Segmented、Dropdown、Drawer、Tooltip、Alert、Tag、Empty、Space。
- 迁移全部 13 个 Ant Design 页面与组件，移除 `antd` 与 `@ant-design/icons`；图标统一为 lucide 与自绘 SVG。
- 页面按路由懒加载（`lazy` + `Suspense`），首包只保留外壳与项目列表。
- 删除 `styles/ui.css` 的死规则，保留的更新面板样式移入 `styles/update-status.css`；旧 `.ant-*` 选择器改为 `.ui-*` 锚点。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- 无。本轮是技术栈重构：组件外观、键盘与无障碍行为、主题与接口契约保持现有规格，不新增或改写产品需求。

## Impact

- 前端：`package.json` 依赖、`vite.config.ts`、`vitest.config.ts`、`tsconfig.app.json`、`index.css`、`ui/*`、13 个 antd 页面与组件、`navigation.ts`、`App.tsx`。
- 构建：首包 JS 由约 1,329 kB（gzip 429 kB）降到约 345 kB（gzip 110 kB）；PR 工作单等大页面单独成块。
- 文档：`frontend/README.md` 技术栈说明、`docs/审计/2026-10-30-frontend-modernization.md`。
- 不做：不改变产品页面结构、接口契约、数据与模型；不引入客户端状态库或表单库（本轮）。
