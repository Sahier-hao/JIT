# Proposal

## Why

前端业务逻辑集中在少数大组件和一个单文件数据层里：查询草稿由子组件经 `Map` 回写父级、搜索每敲一个键就清空表格并重新请求、计划视图每条提交各发一个详情请求、后台轮询失败一次就把已读结果清空、项目分页只要出现重复 id 就整体报错。这些在真实使用里表现为丢结果、重复请求和无法恢复的错误，用户实看后要求重构。

## What Changes

- 前端按 `api/`（传输与契约解析）、`domain/`（纯函数与类型）、`state/`（跨页状态与持久化）、`hooks/`（通用异步原语）、`pages/`、`components/` 分层；不引入路由库、状态库或样式框架。
- 查询草稿与分页偏移上提到 `App`，子组件只接收 `value` 与 `onChange`，不再通过 `Map` 从子组件写回父状态。
- 搜索输入停顿 250ms 后再发请求，请求期间保留上一页结果；计划视图按"仓库+分析+提交"缓存详情，重复进入不重复取数；后台刷新失败时保留已加载内容、改为行内提示并可重试；项目分页按 id 去重，只有总数确实对不上才报不一致；分析任务列表只在存在进行中作业且页面可见时轮询。
- 界面外观、中文文案、URL 契约、风险色阶与未校准分数边界保持不变；不新增第三方依赖，后端与 OpenAPI 不变。

## Capabilities

### New Capabilities

<!-- 无：本变更重排前端内部结构并在既有能力上补充可观察行为，不引入新子系统。 -->

### Modified Capabilities

- `focused-project-review`: FPR-02 补充轮询与失败保留语义，FPR-03 补充搜索停顿、分页一致性与计划往返的稳定性要求。
- `interface-presentation`: IP-11 错误恢复补充"已有内容时行内失败并可重试，不整页替换已读结果"。

## Impact

**前端**：新增 `src/api/`、`src/domain/`、`src/state/`、`src/hooks/`、`src/pages/`、`src/components/review/`；重写 `App.tsx`、`ReviewWorkbench.tsx`、`repositoryWorkspace.ts`（四个数据 hook）；删除 `domain.ts`、`shortlist.ts` 单文件，`requestState.ts` 去掉未使用导出。

**测试**：新增 `useAsync`、`useDebouncedValue`、`repositoryWorkspace` 去重与 `reviewDraft` 用例（24 文件 212 用例 → 28 文件 227 用例），既有行为断言不改。

**不变**：后端接口、数据库、OpenAPI、持久化格式（`jit-review:plan:v3` 与 v1/v2 迁移逐行保留）、路由地址与文案。
