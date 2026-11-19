# Proposal

## Why

前端现有的视觉实现由 24 个手写 CSS 文件、约 7 800 行样式和近 3 000 条选择器叠加而成：`claude.css`、`modern.css`、`dashboard.css`、`project-redesign.css`、`workbench-modern.css` 等分层按加载顺序互相覆盖，同一张卡片、同一个表头在不同页面呈现不同形状与间距；Tailwind 4 与 `src/ui` 组件层已经存在，却只有少数文件使用工具类。结果是每个页面都在重新发明按钮、表格和卡片，样式越改越乱，视觉也难以统一。

## What Changes

- 以 Tailwind 工具类、`styles/tokens.css` 设计令牌和一套共享组件层作为界面样式的唯一来源；页面级样式不再新增覆盖层。
- 采用 shadcn/ui 的组件形态（Radix 行为层 + CVA 变体 + `cn` 合并 + Tailwind 工具类），在 `src/ui` 内落地按钮、输入、选择、复选、开关、对话框、抽屉、菜单、弹出、提示、分段、表格、卡片、标签、警报与进度等共享组件；组件 API 保持现有调用方式，页面不因换实现而改写业务流程。
- 移除 Mantine：删除 `@mantine/core`、`@mantine/hooks`、`postcss-preset-mantine`、`mantine-bridge.css` 与 `lib/mantineTheme.ts`，主题、圆角与字体全部由设计令牌与 Tailwind 语义映射承担。
- 重设统一视觉基线：字号层级、间距节奏、圆角与阴影档位、表面层级（页面底、下沉区、卡片、强调面）、表头与行高、状态色与焦点反馈在各页面一致；四套主题与列表密度偏好继续生效。
- 按页面族分批迁移并删除对应的手写 CSS：入口与登录、项目与提交、PR 审查工作单、趋势与报告、个人工作区、管理工作区；每批在最后一个消费者迁移后删除该层样式文件，`index.css` 的导入列表单调收缩。
- 测试与验收同步调整：既有令牌、对比度与排版契约测试保留；浏览器验收改用角色或稳定的 `data-testid` 定位，不再依赖样式类名；新增样式来源守卫检查，阻止页面级 CSS 重新回流；关键页面在浅色与深色主题下截图核对并存档证据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `interface-presentation`: 新增“界面样式的单一来源”“统一视觉基线与表面层级”“管理工作区共享用户工作区控件语言”三条要求，约束全部页面的字号、间距、表面、控件形态与样式实现边界。

## Impact

- 前端全部页面与共享组件：`frontend/src/ui/**`、`frontend/src/components/**`、`frontend/src/pages/**`、`frontend/src/AppShell.tsx`、`frontend/src/App.tsx`、`frontend/src/index.css`。
- 删除 `frontend/src/styles/` 下 20 个页面样式层与 `components/*.css`、`trend.css`、`pages/analysis-comparison.css`（约 7 800 行），保留并扩充 `styles/tokens.css` 与基础层。
- 依赖变化：新增 shadcn/ui 组件源码（复制进仓库）与既有 Radix 包；移除 `@mantine/core`、`@mantine/hooks`、`postcss-preset-mantine`、`postcss-simple-vars` 及 `postcss.config.cjs` 中的相关预设。
- 测试与文档：Vitest 组件测试、Playwright 验收选择器、`docs/当前产品.md`、`frontend/README.md` 与新增的界面规范说明；后端接口、数据分析与模型契约不变。
- 实施审计与验证证据置于 `docs/审计/` 与 `docs/evidence/unify-frontend-visual-system/`。
