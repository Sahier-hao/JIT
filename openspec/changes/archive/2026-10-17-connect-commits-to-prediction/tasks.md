# Tasks

## 1. 存储层分页查询

- [x] 1.1 给 `catalog_storage` 的提交查询加分页与计数：`commits(version, limit, offset)`、`count_commits(version)`、`commits_by_entity(entity_type, value, limit, offset)` 及对应计数；验证：`test_catalog_storage.py` 新增用例，插入 3 条提交后 `limit=2` 返回 2 条且 `count=3`
- [x] 1.2 保持 `commit(version, commit_id)` 与 `_features` 的现有返回结构不变；验证：现有 `test_catalog_storage.py` 全过

## 2. 提交列表接口

- [x] 2.1 `GET /api/v1/commits` 接受 `limit`（默认 100、上限 500）与 `offset`（默认 0），返回 `datasetVersion`、`total`、`limit`、`offset` 与摘要项（`commitId`、`authorTime`、`label`、`module`），列表项不含 `features`；验证：`test_catalog_api.py` 断言页大小、`total` 与字段集合
- [x] 2.2 非法分页参数（`limit=0`、`limit=501`、`limit=-1`、非整数）返回 422 `INPUT_INVALID` 并定位字段，不静默截断；验证：`test_catalog_api.py` 四个越界用例
- [x] 2.3 详情 `GET /api/v1/commits/{commit_id}` 仍返回完整特征；未知版本与未知提交返回 404；验证：`test_catalog_api.py` 详情用例与两个 404 用例
- [x] 2.4 更新 `backend/README.md` 的接口表与 `docs/api/openapi.yaml` 的 `/commits` 条目（分页参数、响应结构）；验证：按文档示例发请求，返回字段与文档一致

## 3. 预测输入来源

- [x] 3.1 `catalog_input.prediction_input` 放宽 `record.features` 必填，新增可选顶层 `datasetVersion`，并实现来源判定：仅 features → client；无 features 且有 commitId 与 datasetVersion → persisted；两者同给或都缺 → 422；验证：`test_json_prediction.py` 覆盖四种判定
- [x] 3.2 `prediction.py` 增加 persisted 分支：按 `datasetVersion` + `commitId` 从库读取特征、按 `schema.in_model_names()` 重排、缺字段报 `INPUT_SCHEMA_MISMATCH`；提交不存在或版本未登记返回 404；验证：`test_json_prediction.py` 用夹具模型断言风险与库中特征一致、来源标注为 `persisted-commit`
- [x] 3.3 持久化预测的响应带 `sourceKind=persisted-commit` 与 `datasetVersion`，`limitations` 首条改为「特征来自已导入的提交数据」；保存后按 batchId 重开仍返回同样来源与特征；验证：`test_json_prediction.py` 重开用例
- [x] 3.4 更新 `backend/README.md` 预测章节，说明两种来源与互斥规则；验证：文档描述与 3.1–3.3 的行为逐条对应

## 4. 集成验证

- [x] 4.1 用 TestClient 对已导入的真实库请求 `GET /api/v1/commits`，确认 `total=12374`、默认页 100 条、响应体小于 50 KB；验证：`test_catalog_api.py` 的真实库用例（库文件不存在时跳过）
- [x] 4.2 全量后端测试通过：`python -m pytest backend/tests -q --basetemp backend/tests/.tmp`；验证：0 failed
- [x] 4.3 `openspec validate connect-commits-to-prediction --strict` 通过；验证：命令输出 `is valid`

## Workflow follow-up

- 归档前确认前端未依赖「一次拿全部提交」的旧行为。
- 归档本变更并同步 `commit-persistence`、`feature-input-prediction` 主规格。
