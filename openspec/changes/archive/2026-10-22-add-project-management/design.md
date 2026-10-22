# Design

## Context

项目实体已存在：`repository` 表记录规范化地址、显示名、当前结果（`view_sync_id`）、最近请求（`latest_sync_id` / `latest_sync_at`）与提交分布；`repository_sync` 记录每次分析。前端需要「先建项目、再在项目内发起分析、查看与清理记录」，而当前只有 `POST /repository-syncs` 一条入口。

## Goals / Non-Goals

- 目标：补齐项目与记录的管理接口，语义与前端页面一一对应；不破坏既有分析流程。
- 非目标：不提供取消正在运行的分析；不改分析执行与模型行为；不做未接入管理入口的批量操作。

## Decisions

- **建项目与跑分析分离**：`POST /repositories` 只写 `repository` 行，`latest_sync_*` 为空；分析仍由 `POST /repository-syncs` 发起。理由：前端「新建项目」页不应偷偷跑一次克隆与训练。
- **同址幂等**：以 `normalize_repository_url` 后的地址查重，已存在返回 200 与既有项目，新建返回 201。理由：重复点击不应产生重复项目。
- **硬删项目**：先删 `repository_commit`，再删 `repository_sync`，最后删 `repository`，保留 `model_runs` / `datasets` 等历史产物（无外键关联）。理由：项目删除只承诺项目域数据不可再读，避免误删共享模型资产。
- **在途保护**：项目或记录存在进行中状态（`queued/collecting/registering/training/scoring`）时返回 409 `CONFLICT_ACTIVE_SYNC`，不提供取消。理由：后台单 worker 正在写这些行，硬删会与写入竞争。
- **删除当前结果不回退**：记录是项目当前结果时把 `view_sync_id`、计数与 head 清空，不回退到更早的记录。理由：用户明确选择「无结果」，静默回退会让界面显示用户没选过的旧结果。
- **最近请求重算**：删除后按创建时间取剩余最新记录重算 `latest_sync_id/at`；没有记录则置空。理由：项目卡片需要真实反映「最近一次请求」。
- **不改既有入口**：`POST /repository-syncs` 仍会在项目不存在时登记项目，兼容旧客户端与历史数据。

## Risks / Trade-offs

- 无数据库迁移：列表查询依赖既有 `repository_sync_by_repository(repository_id, created_at DESC)` 索引；记录量大时 offset 分页仍是线性扫描，可接受。
- 硬删发生在分析结束后，若分析进程仍持有内存态，重启后不会复活已删行；在途保护已覆盖主要竞争。

## Migration Plan

无迁移。旧客户端继续走 `POST /repository-syncs`；新接口向前兼容。

## Open Questions

- 是否需要在删除项目时一并清理 `model_runs`（当前保留），留待需要时单独变更。
