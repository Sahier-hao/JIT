# Design

## Context

`jit_baseline` 的模块布局是长期增量堆叠的结果：核心配置、存储、鉴权、同步、训练、采集、报告和研究模块都平铺在同一层。`create_app()` 在 903 行内闭包式注册约 149 个路由，管理员鉴权靠 `protected(path)` 前缀白名单，容易漏配。OpenAPI 是人工维护的严格契约，测试会按它校验响应，但路由新增无法自动同步。SQLite 默认 journal 模式在并发轮询与写入下更容易遇到 `database is locked`。

## Goals / Non-Goals

**Goals**

- 把 81 个顶层模块收敛到少量领域包，同时保持所有既有导入路径可用。
- 让 `create_app()` 只做装配；管理路由由统一依赖保护，并可用测试遍历验证。
- 为高频写入/核心查询补齐 Pydantic v2 模型，校验错误继续走既有错误信封。
- 自动导出 FastAPI 契约并检查路径漂移，减少手写 YAML 与代码不一致。
- 启用 WAL、合理 busy timeout，并用测试覆盖并发读写与备份升级。
- 提供 `pyproject.toml`，不破坏现有 CI 与 `requirements.txt`。

**Non-Goals**

- 不改变任何 URL、状态码、错误码、权限边界、模型身份或数据语义。
- 不一次性重写 `sync.py`、`pr_updates.py`、`collect.py` 的全部业务逻辑；先完成分层与 router 化，再按测试驱动拆分。
- 不删除仍被 CLI、测试或外部脚本依赖的顶层导入。
- 不替换人工维护的严格响应契约；生成契约用于路径漂移检查与后续迁移。

## Decisions

1. **移动模块 + 顶层 shim。** 用 `git mv` 把领域模块移入子包，并在原路径保留 `from .pkg.mod import *` shim。这样 CLI、测试、脚本与 `from jit_baseline.catalog import ModelCatalog` 等既有导入全部继续可用，迁移可分批进行，每批跑 key 层。
2. **包内相对导入显式指向新位置。** 被移动模块内部的 `from .x` 改为 `from ..x`（跨包）或保持 `.x`（同包），避免依赖 shim 造成循环。
3. **`create_app()` 只装配。** 路由工厂接收构造好的服务对象，按域注册 `APIRouter`；`app.include_router()` 在装配阶段完成。管理 router 统一声明 `dependencies=[Depends(require_admin)]`，中间件只保留 Origin/CSRF 与 `Cache-Control` 防护。
4. **鉴权审计测试遍历 `app.routes`。** 对每条 `/api/admin/*` 与既定管理端点断言其依赖链包含 `require_admin`；新增管理路由若漏声明会直接失败。
5. **Pydantic 只覆盖高频写入与核心查询。** 登录/注册、共享开关、仓库同步创建、训练任务创建、数据集构建等优先；其余端点保持既有解析，逐步迁移。`RequestValidationError` 统一映射为 `INPUT_INVALID`，字段错误进入 `details`。
6. **生成契约与严格契约并存。** `export_openapi.py` 从应用生成 `docs/api/openapi.generated.yaml`；漂移检查断言应用的路径/方法与 `docs/api/openapi.yaml` 一致。严格响应 schema 仍由人工契约维护，避免一次性替换导致前端与契约测试失效。
7. **WAL 在连接处统一设置。** `_connect()` 设置 `journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=10000`；迁移与备份仍使用 `sqlite3.Connection.backup`，测试覆盖 WAL 下的副本与升级。

## Risks / Trade-offs

- [移动模块导致导入或循环依赖断裂] → 每批只移动少量模块，保留 shim，移动后立即跑 key 层；失败可单独回退该批。
- [WAL 副本遗漏 `-wal`] → 备份与测试统一使用 `Connection.backup` 或关闭连接后 checkpoint；不直接拷贝运行中的数据库文件。
- [Pydantic 模型改变错误响应] → 统一异常处理保留既有 `error.code/message/requestId`，只把字段详情放进 `details`，并补契约测试。
- [生成契约与人工契约结构不同] → 生成文件只用于路径/方法漂移检查，不替换人工严格 schema；在审计记录中说明边界。
- [拆分 `sync.py`/`pr_updates.py` 风险高] → 先完成包分层与 router 化，拆分作为后续独立小步，每步跑 key 层。

## Migration Plan

- 无数据库迁移；迁移 001–041 保持不变。
- 移动后顶层 shim 保证旧导入可用；CLI 与测试不需要同时改动。
- SQLite WAL 是连接级设置，对既有数据库透明；升级前仍按 `_backup_before_upgrade` 生成一致副本。

## Open Questions

- 无。
