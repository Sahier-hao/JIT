# Phase 3 前端数据层与 E2E 配置收敛验收（2026-11-19）

## 范围

- 用统一 `queryKeys` 收敛项目列表/详情与活跃任务缓存键。
- 用户端与管理员端活跃任务轮询迁移到 `@tanstack/react-query` 的 `refetchInterval`，删除手工计时器与重复加载状态。
- 把共享同一隔离服务的 6 个 Playwright 包装配置合并到 `playwright.config.ts` 的 `projects`，新增统一运行脚本。
- 更新 `package.json`、CI 与 tsconfig 引用。

## 关键实现

- `frontend/src/lib/queryKeys.ts`：项目列表、项目详情、用户/管理员活跃任务、用户会话的键。
- `features/account/activeJobs.ts` 与 `features/admin/activeJobs.ts`：`useQuery` + 6 秒 `refetchInterval`，后台标签页暂停，卸载自动取消；管理员 hook 通过 `enabled` 控制。
- `playwright.config.ts`：`acceptance`、`acceptance-wide`、`admin-training`、`experiments`、`model-package`、`current-schema`、`bundled-models`、`multi-method` 八个 project；专用服务的 `regression-pr`、`project-workspace`、`shadcn` 保留独立配置。
- `scripts/e2e.mjs`：按套件设置 `JIT_E2E_*_MODE` 或专用端口，再调用 `playwright test --project=<suite>`。
- 删除 `playwright.admin-training.config.ts`、`bundled-models`、`current-schema`、`experiment-models`、`model-package`、`multi-method` 六份包装配置；Playwright 配置从 10 份降到 4 份（基座 + 3 个专用服务）。
- 新增 `components/shared/TrainingLossChart.tsx`：用户端与管理端复用同一逐 epoch 损失曲线；无历史时不渲染。
- 新增 `lib/methodParams.ts` 与 `lib/datasetMaturity.ts`：统一受控参数展示与标签成熟摘要，消除两端重复映射。
- 新增 `app/routeTable.ts`：`createHashRouter` 改为一个无路径布局 + 45 条结构化路径；`useRoute` 优先从 `matchRoutes` 构建类型化 `Route`，`parseHash` 只保留给兼容别名、退役/未知地址与旧测试。
- 新增 `app/routeTable.test.ts`：36 个规范路由与 8 个兼容/未知地址的等价性检查。
- 新增 `lib/api-generated/types.gen.ts`（5,953 行，由 `@hey-api/openapi-ts` 从 `docs/api/openapi.yaml` 生成）与 `npm run types:api`、`npm run check:api-types`；生成类型与人工契约不一致时检查失败。
- 新增 `modelCardContractCheck.ts`：编译期校验手写模型卡的标量字段仍与生成契约兼容；复杂分区字段保留手写解析。

## 验证

- `npm run typecheck`、`npm run lint`、`npm run check:styles`、`npm run check:modules`：通过（231 个源码文件、1 个应用入口）。
- `npx playwright test --list --project=model-package`：识别 1 个测试，配置可加载。
- VS Code 扩展测试：5 passed。
- 前端单测：64 个文件、518 个测试全部通过（新增 45 个路由表检查）。
- 前端生产构建：通过（共享组件抽取与结构化路由后重跑）。
- 代表 E2E：`pr-account-continuation.spec.ts` 1 passed（45.7s）。
- E2E 使用 `JIT_PYTHON=backend/.venv/Scripts/python.exe` 与 `JIT_PREVIEW_BASELINE` 指向本地构建的基线，避免系统 Python 的 fastapi 版本与冻结产物不一致。
- `pr-account-continuation.spec.ts` 的退出登录步骤改为打开账户菜单后选择“退出登录”，与 2026-11-17 的个人中心对话框一致。

## 未完成与边界

- `react-router-dom` 已接管规范路径匹配；`parseHash` 仅保留为兼容别名、退役/未知地址的回退，未完全删除。
- 已抽取 `TrainingLossChart`、`formatMethodParams`、`labelMaturityText/Items`；`MyDataPage`、`PullRequestJourney`、`ProjectPage` 等大页面仍未拆分。
- `adminContracts.ts`（910 行）已拆为 `adminContracts/` 下 5 个域模块（common 28、datasets 87、models 297、training 317、experiments 201）+ barrel；最大单文件 317 行。
- OpenAPI 类型生成已落地；复杂响应字段仍由手写解析器校验，逐步迁移。
- 专用服务套件仍保留 3 份配置；统一 `projects` 只覆盖共享服务。
