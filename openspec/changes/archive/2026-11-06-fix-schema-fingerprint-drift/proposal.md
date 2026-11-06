# Proposal

## Why

已登记并处于可用状态的 `logistic-regression-l2-v1` 在一次代码合并后突然被标成 `ARTIFACT_INVALID`，之后所有仓库分析都以 `MODEL_NOT_READY`（「模型不可用，请重新校验登记」）失败。根因是 schema 身份指纹把 dataclass 的**新增默认字段**也算了进去：`cc528ed` 给 `Schema` 加了 `semantic=None`、`semantic_only=False`，于是 `openstack-six-v1` 的指纹从 `259ee768…` 变成 `d136eaa…`，产物校验拿它与登记时写入的 payload 比对，判定不一致并降级模型。用户在界面上看到的是"分析失败"，真实原因却与数据、产物、环境都无关。

## What Changes

- schema 身份指纹在计算前剔除"未启用的扩展声明"：当 `semantic is None` 且 `semantic_only is False` 时，这两个键不参与指纹；带语义声明的 schema（如 `kamei14-semantic-codebert-v1`）保持原样，指纹不变。
- 新增回归测试：断言 `openstack-six-v1` 的 `schemaSha256` 恒为 `259ee768…`，且语义 schema 与非语义 schema 的指纹必须不同（防止"一律忽略"式修复）。
- 修复后重新登记即可让模型回到 `ready`（`register()` 复用同一产物，`created: false`），无需重建产物、无需手工改库。

## Capabilities

### New Capabilities

无新增能力。

### Modified Capabilities

- `feature-schema-versioning`: FSV-03 明确"运行身份"只包含实际生效的 schema 声明——新增但有默认值的扩展字段不得改变既有运行的指纹，从而保证旧运行仍按其自身声明通过校验。

## Impact

- 后端：`backend/jit_baseline/catalog_schema.py`（新增 `_identity_claims`）、`backend/tests/test_schemas.py`。
- 已登记模型的 `model_version.payload.featureSchema.schemaSha256` 在校验时恢复匹配；`state` 由 `invalid` 回到 `ready` 需要执行一次 `register-model --run-key <名称>`。
- 不影响特征计算、训练、推理与数据库结构，无需迁移。
