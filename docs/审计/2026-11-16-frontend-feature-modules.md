# 前端业务模块整理审计

日期：2026-11-17

对应 OpenSpec change：`organize-frontend-feature-modules`

## 实施范围

- 入口与应用编排集中到 `frontend/src/app/`：`App.tsx`、`main.tsx`、路由和入口/工作区测试。
- 全局外壳集中到 `frontend/src/components/layout/`；跨业务反馈、品牌、密码输入、风险、基线和材料测试集中到 `frontend/src/components/shared/`。
- 项目分析、仓库概览、项目数据和项目页面归入 `features/projects/`；PR 预览、审查工作单、个人审查状态和 Diff 归入 `features/reviews/`。
- 用户数据、训练、模型、账户、管理和研究分别归入 `features/datasets/`、`features/training/`、`features/models/`、`features/account/`、`features/admin/` 和 `features/research/`。各目录同时保存页面、请求、契约、夹具和相邻测试。
- 请求基础设施、领域工具和测试工具归入 `frontend/src/lib/`；官方 `components/ui`、hooks、样式和静态夹具保持独立。
- 项目页的分析记录区抽为 `features/projects/components/ProjectAnalysisHistory.tsx`，页面保留状态编排、key、请求和草稿身份。PR 工作流继续由页面编排，并复用已经归位的 `PullRequestPreview`、`WorkPanels`、`CodeDiff` 和模型线索组件。
- 删除空的旧 `src/pages` 目录和旧根目录业务路径；没有添加转发文件。`index.html` 和 Vitest setup 已更新到新入口/工具路径。
- 新增 `npm run check:modules`，验证只有一处 `createHashRouter`、官方基础组件不反向依赖 feature、共享组合不反向依赖 feature，并阻止 `src/pages`/`src/ui` 目录回流。

## 验证结果

以下命令均在当前工作树执行并以退出码确认：

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过，退出码 0 |
| `npm.cmd run check:modules` | 通过，202 个源码文件、1 个应用入口、基础层无业务反向依赖 |
| `npm.cmd run check:styles` | 通过，4 个样式表、3 个入口导入、0 个待迁移 Mantine 引用 |
| `npm.cmd test -- --maxWorkers=1 --no-file-parallelism` | 60 个测试文件、436 个测试全部通过，退出码 0 |
| `npm.cmd run lint` | 通过，退出码 0；保留既有 React effect、Fast Refresh、ref 和依赖数组 warning |
| `npm.cmd run build` | 通过，退出码 0 |
| `npm.cmd exec -- playwright test --config=playwright.shadcn.config.ts` | 2 个隔离浏览器旅程全部通过：双账户 PR 续审隔离；四主题、390px 窄屏、分析草稿、用户区、PR 预览和管理区 |

浏览器验收使用独立后端端口 18860、前端端口 18861，以及临时数据库、Git 仓库、数据集和模型副本。测试夹具发布 CSV 需要 Windows hard link，受限沙箱第一次运行返回 `WinError 5`；使用提升权限仅完成该次隔离验证后通过，未修改正式数据或服务。

## 已知 warning 与边界

- 生产构建仍报告 ECharts 相关 chunk 大于 500 kB。
- 生产构建仍报告 `ProjectActivity.tsx` 同时被静态和动态导入，动态导入不会形成独立 chunk。
- lint warning 来自既有页面状态 effect、Fast Refresh 同文件导出、渲染期 ref、依赖数组和少量表达式检查；本 change 没有把模块整理扩大为行为重构。
- 本 change 未改变路由格式、旧地址解析、API、会话、权限、模型身份、浏览器存储键或后端行为；未产生规格 delta。
