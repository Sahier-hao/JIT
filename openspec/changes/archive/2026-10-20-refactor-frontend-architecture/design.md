# Design

## Context

动机见 `proposal.md`。当前前端只有 69 个源文件却集中在少数大文件：`TrendPage.tsx` 619 行、`ReviewWorkbench.tsx` 362 行、`repositoryWorkspace.ts` 309 行；契约解析分散在 `apiContract.ts` / `repositoryContract.ts` / `historicalContract.ts` / `domain.ts`。数据层四个 hook 各自实现取消、错误与刷新，缺陷相同：搜索每键重置、轮询失败清空、分页重复整体报错、计划逐条取详情。页面状态由子组件经 `Map` 回写父组件，恢复依赖 `useLayoutEffect`。

约束：不新增路由库/状态库/样式框架；保持 URL、文案、视觉与风险色阶不变；后端与持久化格式不变；每一步 typecheck、lint、测试全绿。

## Goals / Non-Goals

**Goals:** 把"传输/契约、领域纯函数、跨页状态、通用异步、页面与展示"分开；让同一类数据缺陷只修一次；让页面状态有唯一所有者；保持既有 227 条行为断言。

**Non-Goals:** 不重写 `TrendPage`（619 行手写 SVG 图表）、不引入路由/状态库、不改后端契约、不做视觉改版、不把 `useDataset` 的 settled 三元组一并重写。

## Decisions

1. **按职责分层，而不是按页面分层。** `src/api/` 只放请求与契约解析（`client.ts`、`primitives.ts`、`repositories.ts`、`historical.ts`）；`src/domain/` 放纯函数与类型（`risk`、`query`、`commit`、`dataset`、`types`），并以 `index.ts` barrel 保持既有 `from './domain'` 导入不变；`src/state/` 放跨页草稿与计划存储；`src/hooks/` 放通用异步原语；`src/pages/` 放路由级页面；`src/components/review/` 放展示组件。选分层而非"每页一个大文件"，因为缺陷集中在共享数据层，按页拆无法消除重复实现。

2. **页面状态上推到 `App`。** 草稿从 `Map<string, ReviewDraft>` 改为 `Record`，`ReviewWorkbench` 改收 `value` + `onChange`，删除子组件写回父状态的副作用和 `useLayoutEffect` 恢复。理由：`Map` 原地变更不会触发 React 更新，恢复只能靠 effect 补丁；受控 `value` 让"筛选/页码/详情返回视图"成为普通状态迁移，可用 `state/reviewDraft.ts` 的纯函数单测覆盖。

3. **一个 `useAsync` 原语承载四种数据 hook。** 接口 `{key, run, keepPrevious?, resetKey?, pollMs?}`：`key` 编码请求身份（`null` 表示不发请求），`run` 存 ref 避免身份漂移，卸载与身份变化时 `abort()`，`keepPrevious` 在刷新期间保留旧数据，`resetKey` 变化才丢弃数据，`pollMs` 只在页面可见时轮询，失败统一走 `describeFailure`。替代原先四个 hook 各自手写的 `settled` 状态机；选通用原语而非逐 hook 打补丁，是因为六类缺陷在四个 hook 中重复出现。

4. **搜索防抖 250ms + 保留上一页。** `useDebouncedValue` 只对进入请求路径的搜索词生效，URL 与输入框仍然即时更新；`keepPrevious` 让请求期间表格不闪空。选"防抖后请求"而不是"请求全部取消"，因为取消仍会清空 UI 且无法避免每键一次往返。

5. **计划详情按分析身份缓存。** 模块级 `Map`，键 `repositoryId|viewSyncId|commitId`，上限 2000 条，只请求缺失 id；失败 id 记入 `failed` 且不缓存，允许下次重试。选模块级缓存而非 React Query 类依赖，因为项目禁止新增依赖且只需要"同一分析内不重复取数"。

6. **分页按 id 去重，总数仍校验。** 逐页读取时用 `seen` Map 合并重复提交，`cursor` 按已接收条数推进；只有 `seen.size !== total` 才提示"项目分页不一致"。这样后端分页边界抖动不再让整个列表不可用，同时保留真正的数据缺失检测。

7. **轮询有前置条件。** 仓库详情只在固定分析下每 15s 刷新；分析任务列表只在存在 `queued/collecting/registering/training/scoring` 作业且页面可见时续排 4s，隐藏时暂停、可见后继续。

8. **失败分层呈现。** 无数据时整页错误；已有数据时保留内容，用 `role="status"` 行内提示 + 重试。与 IP-11 的"错误恢复"一致，避免一次后台抖动把已读结果清空。

## Risks / Trade-offs

- **模块级缓存可能跨分析泄漏** → 键包含 `repositoryId` 与 `viewSyncId`，上限 2000 条按插入顺序淘汰；身份不符的响应仍被现有 postcondition 拒绝。
- **防抖使请求与地址短暂不同步** → 请求路径使用防抖后的搜索词，地址即时更新；刷新后以地址为准重新查询，行为一致。
- **去重可能掩盖真实分页缺陷** → 保留 `seen.size !== total` 校验与分页不一致提示，列表总数仍来自服务端。
- **状态上推后 `App` 膨胀** → 项目页抽成 `pages/ProjectsPage.tsx`，`App.tsx` 保持 55 行；审查页组件抽到 `components/review/`。
- **行为断言需随实现调整** → 227 条既有断言不改语义，只改导入路径；新增 15 条只覆盖新增行为。

## Migration Plan

纯前端内部重构，无数据迁移：`jit-review:plan:v3` 键、v1/v2 迁移与 `?start/end` 播种保持不变；后端、OpenAPI、数据库不动。回滚为整体 revert 本次提交（前端无外部状态）。构建产物哈希在重构前后一致，部署只需重新构建 `frontend`。

## Open Questions

- `useDataset` 的 settled 三元组与 `TrendPage` 的拆分留待后续独立变更，不影响本变更的规格与任务拆分。
- Playwright 浏览器内核未安装，e2e 回归在环境补齐前以单元与手工冒烟代替。
