# Proposal

## Why

上一个变更把 12,374 条提交的特征与标签落进了目录库，但预测入口仍然只接受调用方手填的六个特征值——刚建好的数据层没有一处被产品用上。同时 `GET /api/v1/commits` 一次返回全部 12,374 条、约 3.5 MB JSON，任何前端页面都无法直接消费。

这两个缺口是同一件事：数据已经在了，却没有一条从「库里的提交」到「缺陷概率」的通路。

## What Changes

- `GET /api/v1/commits` 增加 `limit` / `offset` 分页与 `total` 计数；列表项只返回摘要字段（提交标识、时间、标签、模块），完整特征走详情接口。
- `POST /api/v1/predictions` 新增「持久化提交」输入模式：请求体给出 `datasetVersion` 与 `record.commitId`、省略 `record.features` 时，后端从已导入的提交数据取特征，其余校验、推理、保存语义与现有模式完全一致。
- 两种来源互斥：同时给出 `commitId` 与 `features` 必须被拒绝，不静默择一。
- 预测响应以 `sourceKind` 区分来源（`client-features` / `persisted-commit`），并记录所用的数据集版本；保存的预测记录保留本次实际入模的特征值。
- 未知提交标识、未登记的数据集版本、版本内不存在的提交，分别返回明确错误，不返回空成功。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `commit-persistence`: CMP-05 从「按版本与标识查询」扩展为「分页列表 + 单条详情」，列表必须有上限、必须返回总数，且不得在列表响应中携带全部特征。
- `feature-input-prediction`: FIP-01 的输入从「必须携带原始特征」改为「原始特征或持久化提交标识二选一」；FIP-04 的响应来源标注需覆盖新的持久化来源；新增 FIP-07 规定持久化来源的一致性、可追踪性与失败语义。

## Impact

- 后端：`backend/jit_baseline/api.py`（commits 路由分页参数）、`prediction.py`（来源分支与响应）、`catalog_input.py`（请求体校验放宽与互斥规则）、`catalog_storage.py`（带 LIMIT/OFFSET 的查询与计数）、`store.py`（提交视图）。
- 数据：只读使用已落库的 `commit_record` / `feature_record` / `dataset_record`，不改表结构。
- 测试：`backend/tests/test_catalog_api.py`、`test_catalog_storage.py`、`test_predictions.py`（若存在）需覆盖分页边界与两种输入来源。
- 文档：`backend/README.md` 的接口说明；`docs/api/openapi.yaml` 的 `/commits` 与 `/predictions` 条目。
- 前端（不在本变更范围）：后续由 C 接分页列表与「选提交预测」入口。
