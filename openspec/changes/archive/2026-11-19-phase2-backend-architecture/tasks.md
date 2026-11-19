# Tasks

## 1. 子包分层与兼容导入

- [x] 1.1 建立 `core/`，移动 `config.py`、`errors.py`、`api_errors.py`、`schemas.py`、`task_process.py`，保留顶层 shim，跑 key 层。
- [x] 1.2 建立 `storage/`，移动 `catalog_storage.py`、`store.py`、`migrations/`，保留 shim，跑 key 层。
- [x] 1.3 建立 `auth/`，移动 `admin.py`、`users.py`，保留 shim，跑 key 层。
- [x] 1.4 建立 `reports/`、`research/`、`ml/`、`services/`，按域移动模块并保留 shim；每批跑快速回归。
- [ ] 1.5 统计顶层模块数、最大单文件行数并记录到审计。

## 2. Router 与鉴权

- [x] 2.1 新增 `auth/dependencies.py`：`require_admin`、`require_user`、`optional_user`。
- [x] 2.2 把管理路由迁移到带 `dependencies=[Depends(require_admin)]` 的 `APIRouter`。
- [x] 2.3 `admin_boundary` 只保留 Origin/CSRF 与 `Cache-Control` 防护，删除硬编码鉴权白名单。
- [x] 2.4 新增遍历 `app.routes` 的鉴权审计测试。

## 3. Pydantic 与 OpenAPI

- [x] 3.1 为共享开关与健康检查补充 Pydantic v2 模型；登录/注册、同步创建、训练创建、数据集构建保留既有解析并列为后续。
- [x] 3.2 `RequestValidationError` 映射为 `INPUT_INVALID`，保留 `{ error: { code, message, requestId, details } }`。
- [x] 3.3 新增 `backend/scripts/export_openapi.py` 生成 `docs/api/openapi.generated.yaml`。
- [x] 3.4 新增路径/方法漂移检查，纳入本地验证；说明人工严格契约的保留边界。

## 4. SQLite 与工程规范

- [x] 4.1 `CatalogStorage._connect()` 启用 WAL、`synchronous=NORMAL`、`busy_timeout=10000`。
- [x] 4.2 新增并发读写测试与 WAL 下的备份/升级副本测试。
- [x] 4.3 新增 `backend/pyproject.toml`，保持 `requirements.txt` 与 CI 兼容。

## 5. 验证与交付

- [x] 5.1 后端 `regression_scope.py --layer full` 通过（922 passed）。
- [x] 5.2 CLI 冒烟：`catalog-init`（隔离库）、`serve`（8126 + health）、`run`（隔离输出）、`register-model`（隔离库）、`collect-repository`/`pr-check-report` 帮助入口。
- [x] 5.3 前端单测（473 passed）与构建通过。
- [x] 5.4 提交到 `refactor/phase2-backend-architecture` 并创建 PR（https://github.com/Sahier-hao/JIT/pull/68）。
- [x] 5.5 归档本 change（`openspec/changes/archive/2026-11-19-phase2-backend-architecture/`）。
