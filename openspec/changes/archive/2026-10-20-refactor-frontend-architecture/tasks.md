# Tasks

## 1. 领域层抽取

- [x] 1.1 新建 `src/domain/{types,risk,commit,query,dataset,index}.ts`，把风险分档、日期与查询、提交转换、数据集解析从 `domain.ts` 与组件内拷贝移出；`npm run typecheck` 通过，`risk.test.ts` 覆盖 null、非法值与 0.25/0.10 三档。
- [x] 1.2 把 `shortlist.ts` 迁到 `state/planStorage.ts`，`sourceContext`/`storageKey`/`restoreShortlist`/`saveShortlist`/`previewLegacyPlan`/`migrateLegacyPlan` 与 v3 schema、v1/v2 迁移保持不变；`planStorage.test.ts` 与由 `shortlist.test.ts` 改名的 `planStorageLegacy.test.ts` 通过。
- [x] 1.3 删除 `contextKey`、`fieldReasons` 等无引用导出；全仓 grep 无引用后 `npm run typecheck` 与 `npm test` 通过。

## 2. 请求层与行为修复

- [x] 2.1 新建 `hooks/useAsync.ts`（`key`/`run`/`keepPrevious`/`resetKey`/`pollMs`/`retry`），并补 6 条用例：key 为 null 不发请求、同身份只请求一次、身份变化中止、刷新失败保留旧数据、resetKey 丢弃旧数据、轮询仅在可见时触发；`npx vitest run src/hooks/useAsync.test.tsx` 通过。
- [x] 2.2 新建 `hooks/useDebouncedValue.ts`，补 3 条用例覆盖立即值、延迟生效与卸载清理；`npx vitest run src/hooks/useDebouncedValue.test.tsx` 通过。
- [x] 2.3 重写 `repositoryWorkspace.ts` 四个数据 hook：搜索 250ms 防抖且保留上一页、计划详情按 `repositoryId|viewSyncId|commitId` 缓存、分页按 id 去重且仅在总数不符时提示、后台刷新失败保留数据；`repositoryWorkspace.test.tsx` 2 条与 `ProductWorkspace.test.tsx` 7 条通过。
- [x] 2.4 分析任务列表改为仅当存在进行中作业且页面可见时轮询；`RepositorySourcesPage.test.tsx` 5 条通过，`npm run lint` 报告 0 error。

## 3. 状态归属与页面拆分

- [x] 3.1 新建 `state/reviewDraft.ts`（`initialDraft`/`patchQuery`/`resetQuery`），`App.tsx` 用 `Record<string, ReviewDraft>` 持有草稿；`reviewDraft.test.ts` 4 条通过。
- [x] 3.2 `ReviewWorkbench` 改为受控 `value` + `onChange`，删除 `Map` 写回、`useLayoutEffect` 恢复与本地查询状态；`npm test` 全绿且列表/详情/计划往返断言不变。
- [x] 3.3 抽出 `pages/ProjectsPage.tsx` 与 `components/review/{RepositoryHead,ReviewTable}.tsx`，类名与文案逐字保留；`App.tsx` 收敛到 55 行，`npm run build` 通过。

## 4. 结构收口与验证

- [x] 4.1 把 `apiClient.ts`、`apiContract.ts`、`repositoryContract.ts`、`historicalContract.ts` 迁到 `src/api/{client,primitives,repositories,historical}.ts` 并修正全部导入；`npm run typecheck` 通过。
- [x] 4.2 执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`：28 文件 227 用例通过，lint 0 error（4 warning 为 `set-state-in-effect`），构建成功且产物哈希与重构前一致。
- [x] 4.3 本地启动后端 8000 与前端 4173，冒烟项目列表、`#/projects` 路由与 `/src/main.tsx` 转译均返回 200；记录代理与后端 clone 的配置差异。

## Workflow follow-up

- 本变更实施与验证已完成，按项目评审要求确认后归档；归档时把 delta 同步进 `openspec/specs/focused-project-review` 与 `openspec/specs/interface-presentation`。
- `docs/产品设计文档.md` 的前端结构一节仍描述旧文件布局，归档前一并更新并核对与代码一致。
- Playwright 浏览器内核未安装，e2e 回归待环境补齐后补跑并记录结果。
