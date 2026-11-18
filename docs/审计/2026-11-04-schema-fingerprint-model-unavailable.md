#审计：`ARTIFACT_INVALID` → 模型不可用的判别与恢复（2026-11-04）

## 现象

用户在项目页看到「分析失败 · 10-30 19:02」，原因行「模型不可用，请重新校验登记」；「发起分析」弹窗里的 `logistic-regression-l2-v1` 标注「当前不可用于仓库分析」。同步记录（`repository_sync`）显示 `status=failed`、`stage=training`、`error_code=MODEL_NOT_READY`，即采集与数据集阶段都成功，卡在选模型。

## 判别：`MODEL_NOT_READY` 的真实原因在 `model_version.state`

1. 查 `backend/storage/catalog.sqlite3`：

   ```sql
   SELECT id, name, state, error_code FROM model_version;
   -- 83b9df92-… | logistic-regression-l2-v1 | invalid | ARTIFACT_INVALID
   ```

2. `MODEL_NOT_READY` 是结果，不是原因：`load_model` 在 `state != 'ready'` 时直接拒绝（`backend/jit_baseline/catalog.py:209`，文案见 `backend/jit_baseline/api_errors.py:41`）；`MODEL_NOT_READY` 只表示"没有可用模型"，真正的降级原因写在 `model_version.error_code` 里。
3. 对照判别：
   - `error_code=ARTIFACT_INVALID` → 产物/账户指纹校验未过，走"恢复重新登记"（本文档）。
   - `error_code` 为空且 `state='missing'` → 产物文件缺失，先 `register-model --run-key <key>` 重建。
   - 多行 `ready` 但前台仍不可用 → 看 `repositoryPredictionSupported`（`backend/jit_baseline/api.py:242`，要求 `enabled and state=='ready' and featureSchemaVersion in REPOSITORY_SCHEMAS`）。

## 根因：schema 指纹随"带默认值的扩展字段"漂移

`backend/jit_baseline/catalog_schema.py:11` 用 `identity(asdict(schema))` 计算 `featureSchema` 指纹。远端提交 `cc528ed`（增加代码语义特征）给 `Schema` dataclass 加了两个带默认值的字段：`semantic: object = None`、`semantic_only: bool = False`（`backend/jit_baseline/schemas.py`）。`asdict` 的形状因此改变，`openstack-six-v1` 的 `schemaSha256` 从登记时的

```
259ee768907e64c70f5e3c649805a000f8b20bc4597ac4b09fb08439653792b9
```

漂移成

```
d136eaa2189403f1f94906e01b5458db012c3fbfb977e6fce305d6482edc6a29
```

`register` 的三项比对（`backend/jit_baseline/catalog.py:218-221`）里 runId、modelSha256 都一致，只有 `schema_info(...) != payload['featureSchema']` 触发 `RequestError('ARTIFACT_INVALID')`，`:224-225` 随即把该 `model_version` 行改写成 `state='invalid'`。也就是说：**代码升级本身把旧模型"踩"成了不可用，产物文件没有任何问题。**

## 修复

`_identity_claims(schema)`（`backend/jit_baseline/catalog_schema.py`）：当 `semantic is None` 且 `semantic_only is False` 时，把这两个键从 `asdict` 结果中剔除再交给 `identity()`。理由：字段默认值不是身份的一部分；带语义声明的 schema（`kamei14-semantic-codebert-v1`）仍保留原键，指纹不变。回归测试在 `backend/tests/test_schemas.py::test_schema_identity_ignores_default_extension_declarations`（14 passed）。

## 恢复步骤（无需重训）

1. 装上修复后重启后端（改的是 Python 代码）。
2. 在 `backend/` 目录下重新登记（必须在 `backend/` 运行，否则 `ModuleNotFoundError: jit_baseline`）：

   ```
   .\.venv\Scripts\python.exe -m jit_baseline.cli register-model --run-key baseline
   ```

   输出 `created: false` 即复用产物；`register()`（`catalog.py:174`）会把 state 置回 `ready` 并重写 payload，不需要手工改库。
3. 用原参数重发同步验证：`POST /api/v1/repository-syncs`（`{repositoryUrl, strategy:'auto', since, until, commitLimit:500}`）→ 数十秒内 `status=completed`、`modelStrategy=generic-model`；`GET /api/v1/repository-models` 返回 `state=ready`、`repositoryPredictionSupported=true`。
4. 页面确认：项目页「发起分析」弹窗不再有「（当前不可用于仓库分析）」。

## 经验

- "模型不可用"文案只指向表层（`MODEL_NOT_READY`），排障必须落库看 `model_version.state/error_code`。
- 凡是"指纹 = asdict 全量"的校验，新增带默认值的字段都是一次隐式破坏性变更；扩展字段必须在参与身份前先判断是否被启用。
- 校验失败会把模型写成 `invalid`，但产物与登记事件都在——恢复正常做法是"重新登记"而不是重建产物或手工 UPDATE。

（对应 change：`openspec/changes/fix-schema-fingerprint-drift/`）
