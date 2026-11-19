# Proposal

## Why

`backend/jit_baseline/` 目前是 81 个平铺模块：`create_app()` 单函数 903 行，`sync.py` 1476 行、`collect.py` 1144 行、`pr_updates.py` 1099 行。管理员鉴权依赖 `admin.protected(path)` 的硬编码前缀表，新增端点容易漏配；请求体由 `read_object()` 手工校验，OpenAPI 契约靠 9,600 行手写 YAML 维护，路由与文档已经存在漂移风险；SQLite 连接未启用 WAL，长读与写入在高频轮询下更容易争锁。

## What Changes

- 按业务域建立 `core/`、`storage/`、`auth/`、`services/`、`ml/`、`reports/`、`research/` 子包，顶层保留薄 re-export shim，保持 `from jit_baseline.api import create_app` 等既有导入可用。
- 把 `api.py` 的 `create_app()` 收敛为依赖装配、lifespan、错误处理与 router 挂载；管理路由统一使用 `Depends(require_admin)`，并新增遍历 `app.routes` 的鉴权审计测试。
- 为高频写入与核心查询补充 Pydantic v2 请求/响应模型；`RequestValidationError` 继续映射为 `{ error: { code, message, requestId } }` 的 `INPUT_INVALID`。
- 新增 `backend/scripts/export_openapi.py` 与路径漂移检查：从 FastAPI 应用导出生成契约，并校验应用路由与 `docs/api/openapi.yaml` 的路径/方法一致。
- 在 `CatalogStorage._connect()` 启用 `journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=10000`，补充并发读写与备份升级测试。
- 新增 `backend/pyproject.toml`，统一项目元数据、pytest 与 ruff 配置，保持 `requirements.txt` 与 CI 兼容。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- 无。本变更不改变现有 URL、HTTP 状态码、错误码结构、权限边界或产品行为。

## Impact

- 影响 `backend/jit_baseline/` 的模块布局、导入路径、`create_app()`、管理员鉴权中间件与 SQLite 连接选项。
- 影响后端测试、CLI 导入路径与 OpenAPI 生成脚本；不修改数据库迁移 001–041，不改变模型包或数据集。
- 所有测试继续使用一次性目录库、模型副本与临时目录。
