# 设计：预测解释与服务可验证性

## Context

现状约束（详见 `proposal.md - Why`）：

- 九种方法在 `backend/jit_baseline/algorithms.py` 中登记，每个方法的 `explanation` 字段目前固定为 `{"method": None, "reason": "未实现"}`；预测响应在 `prediction.py` 中硬编码 `explanationStatus=not-supported`。
- 训练产物有一份固定的文件清单 `CORE_FILES`（`artifacts.py:24`），`verify_run` 按清单逐文件校验哈希；给产物新增文件会让**历史运行**在重新校验时因缺文件失败。
- 整个预测结果以 JSON 存在 `prediction_batch.payload_json`，`PredictionService.get` 直接返回该 payload，`prediction` 表只存 `risk` 与 `features_json`。因此「保存解释」不需要新增列。
- 持久化特征以 EAV 长表存放：`feature_record(dataset_version, commit_id, field, value_json)`，`dataset_version` 是描述文件版本名；模型 payload 同时带内部 `datasetVersion` 与 `artifactDatasetVersion`。
- 前端 `predictionContract.ts` 已把 `explanationStatus` / `explanationReason` 作为必填字段解析，`PredictionsPage.tsx:196` 只在未支持时显示警示。

## Goals / Non-Goals

**Goals**

- 一条预测给出模型无关、可复现、可解释的特征贡献。
- 解释随批次保存并在重开时原样返回；历史批次行为不变。
- 一条离线端到端测试覆盖采集→登记→入库→训练→预测。
- 性能与鉴权各有可重复执行的测量/测试。

**Non-Goals**

- 不做代码行级定位、缺陷类型分类或修复建议。
- 不引入 SHAP、LIME 或其他归因依赖。
- 不修改训练产物文件清单，不要求重跑既有基线。
- 不在本 change 内接入 CI 流水线。

## Decisions

### D1 用遮挡法计算归因

对每个入模特征，把它替换为基线值后重新推理，取「基线风险 − 本次风险」作为贡献；按绝对值取前 5。选它而不是 SHAP/LIME：九种方法（含四种深度表格模型）共用同一口径，无新依赖，无采样不稳定性；单条预测只多 1+N 次前向，N≤14，耗时为毫秒级。树模型的 `feature_importances_` 只是全局重要性，无法解释单条记录，排除。

### D2 基线取训练数据集的字段均值，预测时查询

基线用该模型训练数据集（`model['artifactDatasetVersion']`）在 `feature_record` 中对应字段的均值，通过一次 `GROUP BY field` 聚合取得，按数据集版本加进程内小缓存。选它而不是把基线写进训练产物：产物文件清单是全量哈希校验的，新增文件会让历史运行永久校验失败；而重启一个基线文件又意味着所有既有运行都要重算。降级路径：数据集记录或字段缺失时用零基线，并在响应的局限中说明。

### D3 归因计算独立成模块

新增 `backend/jit_baseline/attribution.py`，暴露两个纯函数：`feature_baseline(storage, dataset_version, names)` 返回 `{field: mean}`，`explain(predict_fn, features, baseline, names, top_k=5)` 返回归因列表与摘要。`prediction.py` 只负责取基线、调用、组装响应。这样归因可单测，不依赖 HTTP 与数据库。

### D4 契约：解释进 records，方法名进响应

`records[0]` 增加 `explanation` 数组（每项 `feature`/`value`/`baseline`/`delta`/`direction`）与 `explanationMethod`；`explanationStatus` 允许 `supported`/`not-supported` 两态；未支持时保留 `explanationReason` 且不返回 `explanation`。因为 payload 整体落库，重开自动带回解释，不需要迁移。历史批次的 payload 里本来就是 `not-supported`，重开行为不变。

### D5 方法登记改为声明口径

`algorithms.py` 中九个方法的 `explanation` 改为 `{"method": "occlusion-mean-v1", "reason": None}`；响应里的 `explanationMethod` 取自该登记，未登记的方法返回未支持。这样「某方法能不能解释」是数据而非分支。

### D6 前端把解释当可选字段

`predictionContract.ts` 把 `explanation` 解析为可选数组，缺省不报错；`PredictionsPage.tsx` 在 `supported` 时渲染列表、在 `not-supported` 时保留现有警示；`CommitDetail.tsx` 的历史回放不改（历史记录没有解释）。契约测试补两条：带解释与不带解释。

### D7 端到端测试用真实 git 与真实训练

新增 `backend/tests/test_end_to_end.py`：`tmp_path` 下用 `git` 命令造 3–5 个提交的小仓库 → `collect_repository` 采集 → 登记描述文件 → 导入 SQLite → `run` 训练一个逻辑回归 → `POST /predictions` 预测 → 断言风险与解释齐全。全程离线，`shutil.which('git')` 缺失时 `skip`。一个用例覆盖课程要求的「核心端到端链路」。

### D8 非功能证据用测试固化

- 性能：`backend/tests/test_performance.py` 对已训练模型重复预测 100 次，记录 P50/P95 并断言 P95 小于 250 ms；机器过慢时可用环境变量放宽，不让它变成假失败。
- 安全：在 `test_api.py` 补无凭据 401、越权 403、跨用户不存在 404 三条，作为「鉴权有效」的证据。
- 两项都写进 `backend/README.md` 的验证小节，作为可复现证据。

### D9 深度方法证据可选

装 torch 后把四种深度方法各跑一次并把指标写入文档；装不上就在文档中注明环境限制，不阻塞其它任务，也不把跳过写成通过。

## Risks / Trade-offs

- [相关特征之间贡献会被摊薄] → 遮挡法在特征强相关时会把影响分散到多个特征；文档明确说明归因是「模型对单特征的敏感度」，不是因果分解。
- [每次预测多一次聚合查询] → 12k–74k 行的 `AVG` 在毫秒级；按数据集版本做进程内缓存，缓存失效以数据集版本为键，不随请求增长。
- [前端按严格契约解析旧响应] → 解析器把 `explanation` 设为可选，缺失时按未支持渲染，避免旧响应导致整页失败。
- [端到端测试依赖本机 git] → 用 `which('git')` 跳过而不是伪造仓库；测试不联网。
- [历史运行产物不含基线] → 基线从数据集库取，与产物版本解耦；数据集被清理时降到零基线并披露。

## Migration Plan

无数据库迁移：解释随 `prediction_batch.payload_json` 保存。部署即生效；回滚只需回退代码，旧批次 payload 仍可读。前端与后端契约向后兼容（新增字段，未删除字段）。

## Open Questions

- 性能阈值 250 ms 是否适合答辩机器，待实测后按真实 P95 调整一次。
