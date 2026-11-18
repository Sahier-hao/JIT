# Design

## Context

前端已经统一到 shadcn/ui 与 React Query（项目、模型、研究页面），但活跃任务轮询仍是手写 effect/timer；Playwright 有 10 份配置，其中 7 份只是给基座配置加一个测试文件与环境标志；路由解析仍集中在 `parseHash`，`App` 用单通配符承载全部页面。页面级数据摘要区块在用户端与管理端重复实现。

## Goals / Non-Goals

**Goals**

- 用一份 Playwright 配置的 `projects` 覆盖共享服务的套件，统一证据目录与视口；专用服务套件保留独立入口。
- 用 React Query 统一活跃任务轮询、缓存键与错误处理。
- 抽出至少一个跨用户/管理端复用的纯展示区块，并通过模块边界检查。
- 记录结构化路由与类型生成的后续迁移步骤。

**Non-Goals**

- 不改变任何 hash URL、页面行为或 API 调用。
- 不在本阶段完成 `parseHash` 的完全替换；书签兼容优先。
- 不重写全部大页面组件。

## Decisions

1. **Playwright 按套件设环境变量，而不是在配置里复制服务启动。** 新增 `scripts/e2e.mjs` 读取套件名，设置 `JIT_E2E_*_MODE` 后调用 `playwright test --project=<suite>`；基座 `webServer` 继承进程环境。专用端口与专用服务（regression-pr、project-workspace、shadcn）保留独立配置。
2. **React Query 的 queryKey 集中在 `lib/queryKeys.ts`。** 活跃任务使用 `refetchInterval: 6000` 与 `retry: false`，后台标签页不轮询，卸载自动取消。
3. **共享展示组件只接收数据与只读 props。** 放在 `components/shared/`，不依赖 `features/`，满足 `check-module-boundaries.mjs`。
4. **路由与类型生成只记录边界。** 结构化路由需要同时重写页面导航与测试，作为后续独立 change；OpenAPI 类型生成依赖 Phase 2 的生成契约，先记录方案不引入新依赖。

## Risks / Trade-offs

- [Playwright 环境变量继承差异] → 用 `scripts/e2e.mjs` 显式设置并在基座 `webServer.env` 中展开 `process.env`；先跑一个代表套件验证。
- [React Query 轮询改变请求时序] → 保持 6 秒间隔与后台暂停语义，前端单测与页面测试覆盖。
- [共享组件抽取值不当] → 只抽纯展示、无业务请求的区块；模块边界检查兜底。

## Migration Plan

- 无数据迁移。配置删除前先更新 `package.json` 与 CI 调用；保留专用配置。
