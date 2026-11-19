# Proposal

## Why

前端仍处于新旧基础设施半迁移状态：10 份 Playwright 配置各自复制服务启动与证据路径；活跃任务轮询由手工 `useEffect + setTimeout` 维护，加载、错误与刷新语义重复；`App.tsx` 仍用单通配符路由，`navigation.ts` 保留约 200 行手工字符串解析；用户端与管理端存在心智相同但各自复制的数据摘要区块。

## What Changes

- 把共享同一隔离服务的浏览器套件收口到 `playwright.config.ts` 的 `projects`，用统一脚本按套件设置环境变量；专用端口套件保留独立配置。
- 新增统一 `queryKeys`，把用户/管理员活跃任务轮询迁移到 `@tanstack/react-query` 的 `refetchInterval`，移除手工计时器与重复加载状态。
- 把共享的数据集元数据、训练状态等纯展示区块抽到 `components/shared/` 或 `features/*/components/`，保持模块边界检查通过。
- 记录 `react-router-dom` 结构化路由与 OpenAPI 类型生成的迁移边界；不在本阶段改变既有 hash URL。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- 无。本变更不改变 URL、API 契约或产品行为。

## Impact

- 影响前端的 Playwright 配置、轮询 hook、共享展示组件与测试脚本。
- 不修改后端、数据库或数据集；不改变现有书签地址。
