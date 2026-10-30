# Design

## Context

PR 分析由 `PullRequestReview.analyze` 为固定快照创建 `repository_sync` 任务，任务完成后分数按提交保存。前端此前在只读详情（`PRModelClues`）和工作单内都提供生成入口，列表行也有逐行分析按钮；分支分析记录接口 `repository_syncs` 未区分任务用途，导致 PR 任务出现在项目「分析记录」。用户要求把分析收敛到列表批量入口，详情只读。约束是保持单分析 worker、固定来源与模型身份，不删除既有结果。

## Goals / Non-Goals

**Goals:**

- 一个入口批量分析所有开放 PR，并允许选择模型。
- PR 分析记录与分支分析记录分开展示，状态如实。
- 只读详情只展示结果，不再产生新的分析。
- 删除解释性小字，界面只保留状态、数据和操作。

**Non-Goals:**

- 不改变 PR 分析的采集与模型推理链路（每个 PR 仍需固定快照与独立任务）。
- 不新增数据库迁移，不删除既有 PR 分析结果。
- 不把 PR 任务合并进分支任务或项目当前结果。

## Decisions

1. **批量入口放在项目页头部。** 与「发起分析」并列，先弹出模型选择；确认后调用 `POST /repositories/{id}/pull-requests/analyze`，后台线程逐个 `analyze_pr`。已有完成分析的快照跳过，避免重复消耗。
2. **PR 分析记录独立。** API `GET /repositories/{id}/syncs` 排除 `source_kind='pr'` 的任务；内部服务保留完整查询供后台与测试使用。PR 页右栏由 PR 清单的 `analysisStatus`/`maxRisk`/`modelId` 渲染。
3. **只读详情不再提供分析入口。** `PRModelClues` 移除模型选择、生成、重试与取消，只展示已保存任务与分数；分析动作统一在列表发起。
4. **状态如实映射。** `interrupted`/`cancelled`/`failed` 不映射为 `running`；进行中的手动任务从 `repository_sync` 状态映射为 `queued`/`running`，完成才计算最高分。
5. **模型名来自实际任务。** 手动分析任务的 `model_id`/`resolved_model_id`/`requested_model_id` 回填到清单，前端用模型目录显示名称而非 ID。
6. **文案克制成为产品规则。** 删除说明性段落与重复汇总；保留状态、模型、分数、时间与操作名称。

## Risks / Trade-offs

- [批量任务占用单 worker，分支分析排队] → 批量入口明确在后台执行，PR 记录显示排队状态；不引入并发 worker，保持单机约束。
- [列表记录只反映当前页] → 记录卡标题与分页沿用 PR 清单；跨页状态由分页查看。
- [移除详情生成入口会减少临时分析能力] → 用户可回到列表点「分析全部 PR」；单 PR 分析接口仍保留给自动化与后续入口。
- [文案删减过度导致操作不明] → 只删除解释性文字，保留按钮名称、状态与错误原因。

## Migration Plan

无数据库迁移。部署后既有 PR 分析结果仍在，项目分析记录不再显示 PR 任务；PR 清单回退读取手动快照的分析状态并展示模型与分数。
