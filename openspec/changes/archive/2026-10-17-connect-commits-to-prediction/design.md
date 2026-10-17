# Design

## Context

见 `proposal.md` 的 Why。实现前需要知道的现状：

- 库中已有 `dataset_record`(1) / `commit_record`(12,374) / `feature_record`(74,244)，`commit_record` 主键 `(dataset_version, commit_id)`，`feature_record` 以 `field` 竖排保存、`value_json` 为 JSON 数字。
- 现有预测链路：`POST /api/v1/predictions` → `catalog_input.prediction_input()` 严格校验 → `PredictionService.create()` 按 `schema.in_model_names()` 从 `record['features']` 取值 → `predict_risks` → 单事务写 `prediction_batch` + `prediction`。
- `GET /api/v1/commits` 直接调用 `storage.commits(version)`，无 `LIMIT`，实测 12,374 条约 3.5 MB。
- 访问控制已把 `/api/v1/commits`、`/api/v1/predictions` 列入成员路径，本变更不新增路径。

## Goals / Non-Goals

**Goals**：让列表接口能分页消费；让已落库的提交直接成为预测输入；两种输入来源在同一响应结构里可区分、可追溯。

**Non-Goals**：不做游标分页；不从源码现场提取特征（仍以库中已导入的为准）；不改表结构；不改前端；不实现解释。

## Decisions

**D1 用 `limit` + `offset`，不用游标。** 12,374 行的量级下 `LIMIT/OFFSET` 足够，且 SQLite 原生支持；游标需要稳定排序键与不透明 token，对当前前端复杂度不划算。默认 `limit=100`，上限 500，`offset` 默认 0。

**D2 列表只回摘要字段。** 列表项固定为 `commitId`、`authorTime`、`label`、`module`；特征只在 `/commits/{id}` 返回。这样默认一页约 6 KB，而不是全量 3.5 MB。响应体加 `total`、`limit`、`offset`。

**D3 计数与分页同连接。** 在同一个只读连接里先 `count(*)` 再取一页，避免两次查询之间被并发导入插行导致 `total` 与页不一致（本库单写者，风险低但成本为零）。

**D4 来源由「字段是否出现」判定，不做默认推断。**
| 请求 | 判定 |
|---|---|
| `record.features` 存在，无顶层 `datasetVersion` | client-features（现状不变，允许附带 `commitId` 作为标签来源） |
| 无 `features`，有 `commitId` + 顶层 `datasetVersion` | persisted-commit |
| 两者都有 | 422 INPUT_INVALID，`field=record` |
| 两者都无 | 422 INPUT_INVALID，`field=record` |

顶层 `datasetVersion` 显式给出，不遍历所有版本猜——与 `/commits/{id}?version=` 的既有约定一致。

**D5 库特征走同一套 schema 排序与类型检查。** 从 `feature_record` 取出的值按 `schema.in_model_names()` 重排，缺字段或非法值继续抛 `INPUT_SCHEMA_MISMATCH` / `INPUT_INVALID`。两条路径最终汇成同一个 `features` 字典，后面推理、保存、响应完全共用。

**D6 错误码沿用现有表。** 提交不存在、版本未登记都用 `NOT_FOUND`(404)；来源冲突、分页参数非法用 `INPUT_INVALID`(422)；不新增错误码。版本内没有该提交与版本不存在对调用方是同一件事：给不出这条提交的特征。

**D7 响应只在必要时扩展。** `sourceKind` 取 `client-features` 或 `persisted-commit`；persisted 模式额外带 `datasetVersion`；`limitations` 第一条改成「特征来自已导入的提交数据，尚未核验真实标签」。旧字段一个不动。

**D8 保存语义不变。** `prediction` 表仍存本次实际入模的特征值（persisted 模式下等于库中该提交的值），`prediction_batch.payload_json` 已能容纳新字段。不新增表、不加列，因此没有迁移。

**D9 分页参数越界直接报错。** `limit>500`、`limit<=0`、`offset<0`、非整数都返回 422，不静默截断——静默截断会让调用方以为拿到了完整数据。

## Risks / Trade-offs

- [深翻页随 offset 线性变慢] → 当前 12k 行、上限 500，一页最坏仍是毫秒级；真到十万级再引入游标。
- [库中特征与模型 schema 不一致（历史 schema 混用）] → 取数后按 schema 过滤，缺字段即 422，不补零。
- [持久化提交的标签被误当预测依据] → 预测链路只读特征列，标签不进入推理；`label` 仅随详情返回供评审参考。
- [两种来源的响应字段差异被前端忽略] → `sourceKind` 必现，前端可按它分支；文档与 OpenAPI 同步更新。

## Migration Plan

无数据库迁移。接口向后兼容：不带 `commitId` 的旧请求行为不变；`/commits` 不传分页参数时返回默认一页，调用方若依赖「一次拿全部」需显式改（当前无这样的调用方）。回滚即回退代码，库数据不受影响。

## Open Questions

无。
