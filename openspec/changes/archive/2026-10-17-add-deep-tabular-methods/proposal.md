## Why

经典侧已经补齐到 5 个方法并合并进 main，深度侧仍是 0。课程要求经典与深度**各 ≥4**，PDB-09 也已把覆盖目标写实、并把序列型架构排除在外；注册表在上一轮已经为深度预留了 `requires`／`reproducibility`／`explanation` 三个声明位，流水线契约也明确"深度模型以自定义估计器作为末步接入"。现在缺的正是这 4 个表格型深度方法与它们的可校验运行。

不补这一块，`classic + deep` 的 8 方法覆盖、跨方法并列比较与后续解释都无从谈起。

## What Changes

- 登记 4 个表格型深度方法：`mlp-v1`、`tabular-resnet-v1`、`ft-transformer-v1`、`wide-deep-v1`。第 4 个选 Wide&Deep（线性 + MLP 双塔），与 MLP 结构上独立，不是参数变体。
- 引入 **PyTorch（CPU）** 作为唯一新依赖并 pin 版本；4 个方法的 `requires=("torch",)`，使运行声明记录该框架版本。
- 新增一个可导入模块，提供 sklearn 兼容适配器（`fit`／`predict_proba`／`classes_`／`n_features_in_`），使深度模型作为既有 `Pipeline` 的末步接入，`Snapshot.load`／`predict_risks`／`verify_run` 的加载契约不变。
- 超参与 epoch 数在训练前冻结，**不使用早停**（验证分区只作流程检查，不参与拟合或调参）。
- 复现口径声明为**数值容差**（先实测"同输入两次训练"的风险与指标差，再按实测上界声明），**不声明独立协议**——后者在当前实现里尚未接入校验，声明了连 `build_run` 末尾的 `verify_run` 都过不了。MUST NOT 声称深度方法逐字节可复现。
- 深度方法先在 **six 字段 schema** 上训练，使测试成员与 5 个经典方法完全一致，`compare-methods` 可直接产出 9 个方法的同口径并列；kamei14 的深度运行留待后续。
- 不实现预测解释（方法条目继续如实声明 `explanation.method: None`），不改服务、前端、模型目录与预测接口。

## Capabilities

### Modified Capabilities

- `public-data-baseline`: 新增 PDB-22「深度表格方法的接入与复现声明」——同一条目格式登记、只收表格型架构、以流水线末步接入并沿用既有加载与校验、随机性由冻结种子与超参固定、复现容差必须实测后声明且不得声称逐字节一致（PDB-21 已被 main 的时间桶聚合占用）。

## Impact

- 后端代码：新增深度模块（torch 架构与适配器）；`model.ESTIMATORS` 增加 4 个实现名；`algorithms.py` 增加 4 个条目；`requirements.txt` 增加 pinned torch。
- 数据与产物：新增 4 个深度运行（six schema），不覆盖既有运行与已归档证据。
- 文档：`docs/团队分工.md` A-2 更新深度覆盖状态与 4 个方法；`backend/PROTOCOL.md` 增补深度随机性与复现容差口径。
- 测试：适配器的序列化往返、四架构的拟合/推理、容差实测与声明覆盖、9 方法并列。
- 不影响：既有 5 个经典方法、运行身份与校验口径、`GET /api/review-batch`、模型目录与预测接口、前端。
- 遗留：预测解释（A-4）、Popt／IFA（A-3）、kamei14 上的深度运行、GPU／外部产物交付（如需要）。
