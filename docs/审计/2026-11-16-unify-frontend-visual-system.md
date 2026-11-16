# 前端样式统一到 Tailwind 实施审计

- 变更：`unify-frontend-visual-system`
- 日期：2026-11-16
- 范围：`frontend/`

## 实施范围

1. **样式基座**：扩充 `src/index.css` 的 `@theme inline`，覆盖全部颜色语义键、五个色族、风险色阶、图表色、趋势序列色、字号、行高、圆角、阴影与密度间距；启用 Tailwind preflight；`src/styles` 只保留 `tokens.css`、`base.css`、`content.css`。
2. **组件层**：`src/ui` 全部改为 Radix 行为 + CVA 变体 + Tailwind，移除 Mantine、主题桥接、`postcss-preset-mantine` 与 `postcss-simple-vars`；新增 `Table`、`Card`、`PageHeader`、`TabBar`、`Progress` 等共享形状；`Icon.tsx` 成为唯一图标入口，非品牌图标统一 lucide 24 网格、1.5 描边。
3. **页面迁移**：外壳与入口、项目与分析、PR 列表/预览/工作单、趋势与报告、个人工作区、管理端全部改为共享组件与工具类；提交明细、数据集/构建对话框、模型卡、验证报告与基线记录一并迁移。
4. **内容样式**：Markdown 与模型解释收敛到 `styles/content.css`，限定在 `.md-prose` 与 `.repository-explanation` 容器内。
5. **守卫与测试**：`scripts/check-styles.mjs` 只允许四个样式表与登记导入；`theme.test.ts` 校验令牌映射；`chartTokens.test.ts`、`material.test.ts`、`typography.test.ts` 随实现更新。

## 样式规模变化

| 项目 | 重构前 | 重构后 |
|---|---:|---:|
| 样式表数量 | 24 个（另有 3 个组件级导入） | 4 个 |
| CSS 行数 | 约 7 816 行 | 716 行 |
| 页面级样式层 | 20 个按顺序覆盖的层 | 0 |
| 组件库 | Mantine + Radix 混用 | Radix + Tailwind + CVA |

重构后的 716 行为 `index.css` 162 行、`tokens.css` 362 行、`base.css` 113 行、`content.css` 79 行。

## 与设计的偏差

1. **preflight 启用时间**：按设计推迟到收尾批次，在旧样式层删除后启用，避免迁移中间态改变列表、表单与 SVG 的默认呈现。
2. **过渡期级联层**：第 4 批把旧样式统一导入 `legacy` 层，使工具类可以覆盖旧规则；收尾时随文件删除一并移除。
3. **测试钩子**：`admin-table`、`admin-model-card`、`admin-dataset-card`、`trend-*`、`wb-hunk`、`md-prose` 等类名保留为测试或浏览器验收钩子，但外观已由 Tailwind 承担；`pr-risk-line` 与 `update-status-title` 改为 `data-testid` 并更新了对应浏览器用例。
4. **图表色**：趋势序列变量从 `project-workspace.css` 移入 `tokens.css`，ECharts 颜色仍从 CSS 变量读取，回退值保留。
5. **管理端页面结构**：旧 `admin.css` 中的表格、事实列表、覆盖矩阵等形状映射为共享工具类；训练覆盖和方法支持列表补充了行分隔与栅格，避免去掉旧样式后文字粘连。

## 验证结果

- `npm run typecheck`：通过。
- `npm run lint`：通过（0 error）。
- `npm run build`：通过。
- `npm test`：59 个测试文件、433 项全部通过。
- `npm run check:styles`：4 个样式表、3 个入口导入、0 个待迁移 Mantine 引用。
- 浏览器验收：PR 续审完整旅程（两个账户、登录注册、工作单、草稿隔离）通过。
- 视觉核对：入口、项目列表/详情、分析、PR 列表/预览/工作单、趋势、站内提醒、个人工作区、管理端列表/详情/验证报告在浅色与深色下截图存档于 `docs/evidence/unify-frontend-visual-system/`。

## 未完成或未验证

1. `project-workspace.spec.ts` 与 `project-dataset.spec.ts` 在当前预览服务上没有建立用户会话，页面停在入口或登录页，未能完成这两条浏览器旅程；这与本次界面改动无关，未修改测试掩盖。
2. 管理端训练、实验登记与比较的完整浏览器配置未在本机运行；管理端 list/detail/report 页面已用真实预览数据截图核对，其余交互由单元测试覆盖。
3. 历史趋势页仅核对了概览与截图，未导入完整历史运行数据逐项比对。
4. 深色主题下管理端仅核对了模型列表；其余管理页面沿用同一套令牌与组件。
