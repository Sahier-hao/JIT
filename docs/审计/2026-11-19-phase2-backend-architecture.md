# Phase 2 后端分层、鉴权契约与存储加固验收（2026-11-19）

## 范围

- 按业务域建立 `core/`、`storage/`、`auth/`、`reports/`、`research/`、`ml/`、`services/` 子包，顶层保留兼容代理。
- 把 `api.py` 迁入 `api/app.py`，管理员路由迁入 `api/routers/admin.py` 并统一使用 `Depends(require_admin)`。
- 管理员边界中间件删除硬编码管理员鉴权前缀，只保留 Origin/CSRF 与 `Cache-Control` 防护。
- 新增管理员路由鉴权审计测试，遍历包含 FastAPI 延迟包含 router 在内的全部路由。
- 新增 Pydantic v2 共享开关/健康检查模型，校验错误继续使用既有错误信封。
- 新增 OpenAPI 导出与路径漂移检查，记录人工严格契约尚未覆盖的 47 个操作。
- SQLite 连接启用 WAL、`synchronous=NORMAL`、`busy_timeout=10000`，补充并发与备份测试。
- 新增 `backend/pyproject.toml`。

## 关键实现

- 顶层兼容代理只转发属性读写到规范模块，`from jit_baseline.catalog import ModelCatalog`、测试中的 `monkeypatch.setattr(module, ...)` 以及旧模型 pickle 的模块路径继续可用。
- 运行时源码指纹改为按模块导入路径解析，`TRAINING_CODE` 与 `SOURCE_FILES` 不再依赖相对文件路径。
- `api/app.py` 的 `create_app()` 保留依赖装配、lifespan、错误处理与路由挂载；管理员路由由 `api/routers/admin.py` 注册。
- 管理员共享与清理路由继续在请求时重新加载数据集描述目录，新建或重建的数据集无需重启即可被管理员看到。
- `api_errors` 继续把 `BaselineError` 映射为 `{ error: { code, message, requestId } }`；Pydantic 校验错误由既有 `RequestValidationError` 处理器映射为 `INPUT_INVALID`。

## 数据与兼容

- 未修改迁移 001–041。
- 未删除顶层导入；MIGRATIONS 随 `catalog_storage.py` 移入 `storage/migrations/`，路径仍相对模块文件解析。
- 旧模型 pickle 的 `jit_baseline.model` 等模块路径由代理模块解析，未重写模型文件。
- WAL 是数据库级持久设置；备份仍使用 `sqlite3.Connection.backup`，测试验证 WAL 下副本完整。

## 指标

| 指标 | 变更前 | 变更后 |
| --- | --- | --- |
| 规范顶层模块 | 81 个平铺模块 | 11 个（含 `__init__.py`、`cli.py` 与少量待归位模块）+ 69 个代理 shim |
| 领域子包 | 0 | 7 个（core/storage/auth/reports/research/ml/services）+ api 包 |
| `create_app()` 所在文件 | `api.py` 903 行 | `api/app.py` 803 行 |
| 管理员鉴权 | `protected(path)` 前缀白名单 | `api/routers/admin.py` 统一 `Depends(require_admin)` + 鉴权审计测试 |
| Pydantic v2 模型 | 0 | 3 个（SharingUpdate/SharingResponse/HealthResponse） |
| OpenAPI | 9,600 行人工 YAML | 人工严格契约 + 90 KB 生成契约 + 路径漂移检查 |
| SQLite | 默认 journal | WAL + synchronous=NORMAL + busy_timeout=10000 |

## 验证

- 后端 key 层（分层移动后）：329 passed, 1 deselected（305.15s）。
- 后端 key 层（路由/WAL/契约后）：334 passed, 1 deselected（323.06s）。
- 管理员路由鉴权测试：通过。
- WAL 并发写入与备份测试：通过。
- OpenAPI 路径检查：133 个操作均在人工契约或已知缺口清单中。
- CLI 冒烟：`catalog-init`、`serve`（health 200、未登录模型端点 401）、`run`、`register-model`、`collect-repository`/`pr-check-report` 帮助入口通过。
- 后端全量回归：922 passed（1091.76s）。
- 前端 typecheck/lint/styles/modules、473 个单测与生产构建：通过。

## 未完成与边界

- `sync.py`、`pr_updates.py`、`collect.py` 仅按域移动，尚未拆分为更细文件；列为后续独立小步。
- Pydantic 覆盖仍限于共享开关与健康检查；其余端点保持既有解析。
- 人工严格契约仍有 47 个操作未收录 schema，已写入 `docs/api/openapi-undocumented.txt` 并纳入漂移检查。
- 管理员中间件仍保留 `/api/v1/models`、训练、数据集、提交等历史管理前缀，待这些域迁移到 router 后继续收紧。
