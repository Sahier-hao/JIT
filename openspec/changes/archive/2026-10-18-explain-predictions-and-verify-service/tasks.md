# Tasks

## 1. 归因内核

- [x] 1.1 新增 `backend/jit_baseline/attribution.py`：`explain(predict_fn, features, baseline, names, top_k=5)` 用遮挡法返回按贡献绝对值降序的归因列表与可读摘要；由 `backend/tests/test_attribution.py` 断言排序、方向、零贡献不列出、不足 5 条不补位
- [x] 1.2 在 `attribution.py` 增加 `feature_baseline(storage, dataset_version, names)`，用一次 `GROUP BY field` 的 `AVG` 查询取字段均值，并在缺字段时返回部分结果；测试覆盖正常、缺列、数据集不存在三种情况
- [x] 1.3 在 `backend/jit_baseline/store.py` 增加按数据集版本查字段均值的方法，复用 `feature_record` 的 `feature_field` 索引；测试断言与手算均值一致

## 2. 方法登记与预测组装

- [x] 2.1 把 `backend/jit_baseline/algorithms.py` 九个方法的 `explanation` 改为 `{"method": "occlusion-mean-v1", "reason": None}`；测试断言每个方法都登记了方法名
- [x] 2.2 在 `backend/jit_baseline/prediction.py` 取基线、调用归因、组装 `explanation`/`explanationMethod`/`explanationStatus`，并在基线降级时追加局限说明；测试断言带解释的响应结构与 `supported` 状态
- [x] 2.3 让解释在归因失败时降级为未支持而不影响风险与保存（PEX-05）；测试用注入异常的归因函数断言仍返回 201 与风险
- [x] 2.4 断言历史批次重开行为不变（PEX-04）：构造一条无解释的 payload，`get` 返回原样 `not-supported` 且不触发推理；测试置于 `backend/tests/test_json_prediction.py`

## 3. 接口文档

- [x] 3.1 在 `docs/api/openapi.yaml` 为预测响应补充 `explanation` 数组项、`explanationMethod` 与 `explanationStatus` 枚举；由 `backend/tests/test_openapi.py`（若已有契约校验则扩展）断言文档可解析且示例与新响应一致
- [x] 3.2 在 `backend/README.md` 增加「预测解释」小节，说明遮挡法口径、基线来源与降级行为，并给出一次真实调用示例；示例命令按文档执行可复现

## 4. 前端呈现

- [x] 4.1 在 `frontend/src/predictionContract.ts` 把 `explanation` 与 `explanationMethod` 解析为可选字段，缺失或未支持时不报错；`frontend/src/predictionContract.test.ts` 覆盖带解释与不带解释两条
- [x] 4.2 在 `frontend/src/PredictionsPage.tsx` 渲染已支持的归因列表（特征、输入值、基线、方向）并保留未支持原因；`frontend/src/PredictPage.test.tsx` 覆盖两种状态
- [x] 4.3 运行前端单元测试与类型检查，确认既有用例全绿

## 5. 端到端链路

- [x] 5.1 新增 `backend/tests/test_end_to_end.py`：在 `tmp_path` 用 git 造小仓库 → 采集 → 登记 → 导入 → 训练 → 预测，断言风险、解释与来源齐全；无 git 时 skip，全程离线
- [x] 5.2 为端到端链路补一条失败路径：对未登记数据集版本预测返回 404，断言不会静默使用其它版本

## 6. 非功能证据

- [x] 6.1 新增 `backend/tests/test_performance.py`：对已训练模型重复预测 100 次，断言 P95 小于 250 ms 并输出 P50/P95；阈值可由环境变量放宽
- [x] 6.2 在 `backend/tests/test_api.py` 补鉴权三例：无凭据 401、越权 403、跨用户查询 404，断言错误体不泄露资源是否存在
- [x] 6.3 在 `backend/README.md` 记录性能与安全的测量方法、实测数值与复现命令，作为课程要求的非功能证据

## 7. 深度方法证据（可选）

- [x] 7.1 在具备 torch 的环境中把四种深度方法各训练一次并记录指标；装不上则记录环境限制并跳过，不把跳过写成通过

## 8. 集成校验

- [x] 8.1 全量后端测试与前端测试通过，且与采集、登记、训练相关的既有 260 项用例无一回退
- [x] 8.2 `openspec validate explain-predictions-and-verify-service --strict` 通过

## Workflow follow-up

- 评审通过后归档 change，并确认主规格与产品一致
- 用真实模型做一次演示，确认结果页展示真实归因而非占位文案
