# Design

## Context

前端为 React 19 + TypeScript + Vite 的单页应用，使用 `#/projects/...` hash 地址。已有设计令牌（`tokens.css`，四套主题）、Radix 原语、以及 Ant Design 6。约束是继续保持离线自包含（字体本地打包、运行时不请求外部地址）、保持旧深链接、保持现有产品行为与测试语义。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 只用一套组件来源与一套样式来源，减少"同一页面两种外观"。
- 保留设计令牌与四套主题，让新组件与旧页面共用变量。
- 用真实路由管理历史、前进后退与入口恢复，并按路由拆包。
- 移除 Ant Design 及其运行时样式注入。

**Non-Goals:**

- 不重写页面信息结构与产品流程。
- 不引入 Tailwind 以外的样式方案（Sass、CSS-in-JS）。
- 不在本轮引入 TanStack Query、react-hook-form 或 OpenAPI 类型生成。

## Decisions

1. **继续使用 hash 路由。** 部署由单个后端加前端静态服务承担，没有服务端重写规则；`createHashRouter` 保持 `#/` 地址与已有书签。备选是 BrowserRouter，需要服务端 fallback 与部署改动，收益不足。
2. **解析器留在 `navigation.ts`。** 旧地址映射（reviews、repositories、legacy、retired）是产品行为，保留纯函数并继续被测试覆盖；React Router 只负责位置与导航。
3. **Tailwind 关闭 preflight。** 现有 `base.css` 已有重置与字号阶梯，开 preflight 会重复并改变既有页面；只引入 theme 与 utilities 两层。
4. **用 `@theme inline` 桥接令牌。** Tailwind 语义色全部映射到现有 CSS 变量，组件不写死色值；主题切换仍由 `data-theme` 完成，Tailwind 不保存主题状态。
5. **组件自持。** 控件源码在仓库内（shadcn 风格），可随产品调整；Radix 只提供焦点、键盘与无障碍行为。
6. **保留 `.ui-*` 锚点。** 旧页面 CSS 通过 `.ui-btn`、`.ui-select`、`.ui-disclosure-*`、`.ui-dialog` 等类做少量局部覆盖；组件同时输出锚点与 Tailwind 类，避免大规模改写页面样式。
7. **按路由懒加载。** 首包只含外壳与项目列表；趋势、PR 工作单、管理页按需下载。

## Risks / Trade-offs

- [Tailwind 工具类与旧 CSS 的层叠顺序] → utilities 在 `layer(utilities)`，未分层的旧页面规则优先；这是有意保留的覆盖点。
- [Radix Select 与原生 select 的手感差异] → 统一用 Radix，测试改为按 `combobox`/`option` 交互；纯原生 select 的表单保留原生元素。
- [移除 antd 造成视觉漂移] → 令牌未变，控件尺寸、圆角、焦点环按原规范重建；通过组件测试与构建验证。
- [懒加载导致首屏短暂占位] → `Suspense` 使用现有加载提示，不阻塞导航。
- [未移除旧页面 CSS] → 这是一次分层收敛，旧页面样式仍在；后续可在页面改版时逐步替换为工具类。

## Migration Plan

1. 安装依赖并配置 Vite、Vitest 与 TypeScript 路径别名。
2. 引入 Tailwind 与令牌桥，重写控件层，跑全量组件测试。
3. 迁移 antd 页面，逐个跑相关测试。
4. 移除 antd 依赖，清理 `.ant-*` 选择器，全量测试与构建。
5. 回退时恢复依赖与 `ui/*`，路由解析器与产品数据不受影响。
