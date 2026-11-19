# Tasks

## 1. 修正多行交互容器与响应式边界

- [x] 1.1 修正项目卡片、数据版本、训练实验、待处理 PR、文件项和审查工作区中把多行内容放入固定高度 Button 的用法，使内容按自身高度显示且焦点区域覆盖完整内容；通过对应页面测试或真实 DOM 检查确认相邻条目不重叠。
- [x] 1.2 为项目 PR 双栏、用户/管理员工作区主列、代码预览和表格容器补齐 `min-width`、长标识折行/截断与内部滚动边界，使长标题和状态不会撑破页面；在 1280px、1440px 和 390px 视口检查 `scrollWidth <= innerWidth`。
- [x] 1.3 保持现有 shadcn/ui 组件、主题、密度和业务动作语义不变，移除因布局修正产生的重复或不可见操作；运行 `npm.cmd run typecheck` 和受影响的前端单元测试确认类型与交互不回归。

## 2. 布局回归与审计记录

- [x] 2.1 扩展现有 shadcn 工作区浏览器旅程，覆盖项目列表、数据版本、训练实验和 PR 待处理列表的多行内容边界、关键操作可见性及桌面/窄屏页面级溢出；运行该 Playwright 配置并记录通过数量。
- [x] 2.2 创建 `docs/审计/2026-11-17-frontend-layout-stabilization.md`，记录复现页面、根因、修改范围、真实浏览器视口结果、构建/lint 警告和未解决的非阻断项；逐项对照本 change 的 IP-08、IP-10、IP-16、IP-30。
- [x] 2.3 运行 `npm.cmd run check:styles`、`npm.cmd run check:modules`、完整前端单元测试、`npm.cmd run lint` 和 `npm.cmd run build`，保存实际输出并确认 OpenSpec 严格校验通过。

## Workflow follow-up

- 归档完成的 change，并将 delta spec 同步到主规格。
- 归档后按项目约定创建或更新对应 GitHub pull request，确保与本 change 无关的工作树文件不进入提交。
