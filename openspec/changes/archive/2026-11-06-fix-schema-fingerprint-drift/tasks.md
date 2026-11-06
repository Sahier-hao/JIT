# Tasks

## 1. 指纹修复

- [x] 1.1 `backend/jit_baseline/catalog_schema.py` 新增 `_identity_claims(schema)`：`semantic is None` 且 `semantic_only is False` 时从 `asdict` 结果剔除这两个键，再交给 `identity()`
- [x] 1.2 计算 `openstack-six-v1` 的 `schemaSha256`，确认恢复为登记时写入的 `259ee768907e64c70f5e3c649805a000f8b20bc4597ac4b09fb08439653792b9`
- [x] 1.3 确认 `kamei14-semantic-codebert-v1` 仍保留扩展键，其指纹与 `kamei14-git-v1` 不同

## 2. 回归测试

- [x] 2.1 `backend/tests/test_schemas.py` 新增 `test_schema_identity_ignores_default_extension_declarations`：断言 `openstack-six-v1` 指纹恒定、语义 schema 与非语义 schema 指纹必须不同
- [x] 2.2 `pytest tests/test_schemas.py -q` 通过（14 passed）

## 3. 恢复与端到端验证

- [x] 3.1 重启后端后执行 `python -m jit_baseline.cli register-model --run-key baseline`（须在 `backend/` 目录下运行），输出 `created: false`，模型 `state=ready`、`enabled=true`、`isDefault=true`
- [x] 3.2 以相同参数重发同步（`POST /api/v1/repository-syncs`，`since 2026-10-27`、`until 2026-10-31`、`commitLimit 500`），90 秒内 `status=completed`、`modelStrategy=generic-model`，不再出现 `MODEL_NOT_READY`
- [x] 3.3 `GET /api/v1/repository-models` 返回 `state=ready`、`repositoryPredictionSupported=true`
- [x] 3.4 浏览器打开项目页「发起分析」弹窗，模型下拉不再标注「当前不可用于仓库分析」，并显示可用模型数量
- [x] 3.5 `pytest tests -x -q` 全量通过（384 passed / 3 skipped；另补装 `jsonschema` 后此前 1 项失败转绿）

## 4. 文档

- [x] 4.1 在 `docs/` 记录本次失败的现象、根因与恢复步骤（含 `ARTIFACT_INVALID` → `MODEL_NOT_READY` 的判别方法），供后续排查复用 → `docs/audits/2026-11-04-schema-fingerprint-model-unavailable.md`

## Workflow follow-up

- 归档本 change 后按 AGENTS.md 约定开/更新 PR
