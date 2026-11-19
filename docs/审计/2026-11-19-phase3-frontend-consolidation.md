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
- 拆分三个大页面，导入路径与行为不变：
  - `MyDataPage` 620 → 287 行；`mydata/format.ts`（常量与格式化）、`mydata/DatasetLists.tsx`（数据版本与构建任务列表）、`mydata/DatasetDetail.tsx`（详情面板与派生指标）。
  - `ProjectPage` 575 → 362 行；`components/AnalysisRecords.tsx`（记录行、详情、操作菜单与时间/失败文案）、`components/PriorityCommits.tsx`（分区切换后的分数分布与前三名）。
  - `PullRequestJourney` 571 → 446 行；`pages/FixedPRSnapshot.tsx`、`pages/reviewShared.ts`（路径拆分、来源校验、备份）、`components/ReviewCommitTable.tsx`、`components/ReviewCandidates.tsx`；页面模块继续导出 `FixedPRSnapshot` 与 `PullRequestWork`。
- `playwright.shadcn.config.ts` 并入 `playwright.regression-pr.config.ts` 的 `shadcn` project：两套旅程共用 18860/18861 隔离服务，Playwright 配置 4 → 3 份；CI 用 `--project=pr-account` 保持完整层原范围。
- 管理数据集列表改为批量读取元数据：`CatalogStorage.dataset_metadata(versions)` 一次连接取回分析/构建/模型引用、所有者与共享状态，`/api/v1/datasets` 与 `/api/v1/datasets/{name}/versions` 不再为每个版本各开三次连接。隔离预览中该接口从 2.27–2.36 秒降到 0.92–1.40 秒，`shadcn` 旅程的管理数据集页不再停在骨架屏。

## 验证

- `npm run typecheck`、`npm run lint`、`npm run check:styles`、`npm run check:modules`：通过（240 个源码文件、1 个应用入口）。
- `npx playwright test --list --project=model-package`：识别 1 个测试，配置可加载。
- `npx playwright test --list --config=playwright.regression-pr.config.ts`：识别 `pr-account` 与 `shadcn` 两个 project、2 个测试。
- 后端数据集相关：`test_catalog_api.py`、`test_user_workspace.py`、`test_datasets.py`、`test_catalog_storage_wal.py` 共 40 passed（含新增的批量元数据等价性用例）。
- 隔离预览中 `GET /api/v1/datasets` 实测 1.29/1.40/0.92 秒（修复前 2.27/2.28/2.36 秒）。
- VS Code 扩展测试：5 passed。
- 前端单测：64 个文件、518 个测试全部通过（新增 45 个路由表检查）。
- 前端生产构建：通过（共享组件抽取与结构化路由后重跑）。
- 代表 E2E：`pr-account-continuation.spec.ts` 1 passed（45.7s）；拆分后 `pr-account` 与 `shadcn` 在合并配置下分别通过，`shadcn` 1 passed（25.9s）。
- E2E 使用 `JIT_PYTHON=backend/.venv/Scripts/python.exe` 与 `JIT_PREVIEW_BASELINE` 指向本地构建的基线，避免系统 Python 的 fastapi 版本与冻结产物不一致。
- `pr-account-continuation.spec.ts` 的退出登录步骤改为打开账户菜单后选择“退出登录”，与 2026-11-17 的个人中心对话框一致。

## 未完成与边界

- `react-router-dom` 已接管规范路径匹配；`parseHash` 仅保留为兼容别名、退役/未知地址的回退，未完全删除。
- 已抽取 `TrainingLossChart`、`formatMethodParams`、`labelMaturityText/Items`；三个大页面已按列表/详情/记录/候选拆分，`PullRequestJourney` 仍保留 446 行的三栏阅读器与三个抽屉。
- `adminContracts.ts`（910 行）已拆为 `adminContracts/` 下 5 个域模块（common 28、datasets 87、models 297、training 317、experiments 201）+ barrel；最大单文件 317 行。
- OpenAPI 类型生成已落地；复杂响应字段仍由手写解析器校验，逐步迁移。
- 专用服务套件保留 2 份配置：`regression-pr`（`pr-account`、`shadcn`）与 `project-workspace`（只连手工启动的 18770 外部预览，不托管服务）。
- 列表接口已批量读取数据集元数据；`store.dataset_references` 仍保留给清理与单版本判断，未改成全表扫描。
