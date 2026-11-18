# Tasks

## 1. Playwright 配置收口

- [x] 1.1 在 `playwright.config.ts` 中用 `projects` 覆盖共享服务的套件。
- [x] 1.2 新增 `scripts/e2e.mjs` 统一设置套件环境变量。
- [x] 1.3 删除对应的包装配置并更新 `package.json` 与 `.github/workflows/regression.yml`。
- [x] 1.4 至少跑通一个代表套件：`pr-account-continuation.spec.ts` 1 passed（45.7s）。

## 2. React Query 数据层

- [x] 2.1 新增 `lib/queryKeys.ts`。
- [x] 2.2 用户与管理员活跃任务轮询迁移到 `useQuery`。
- [x] 2.3 移除手工计时器与重复加载状态。

## 3. 组件复用

- [ ] 3.1 抽取一个跨用户/管理端复用的只读展示区块。
- [ ] 3.2 `check:modules` 通过。

## 4. 路由与契约边界

- [x] 4.1 在审计中记录结构化路由迁移步骤与不改变 URL 的约束。
- [x] 4.2 记录 OpenAPI 类型生成的后续方案。

## 5. 验证与交付

- [x] 5.1 前端 `typecheck`、`lint`、`check:styles`、`check:modules`、`test`、`build` 通过。
- [x] 5.2 代表 E2E 套件通过（1 passed, 45.7s）。
- [x] 5.3 提交到 `refactor/phase3-frontend-consolidation` 并创建 PR（https://github.com/Sahier-hao/JIT/pull/69）。
- [x] 5.4 归档本 change（`openspec/changes/archive/2026-11-19-phase3-frontend-consolidation/`）。
