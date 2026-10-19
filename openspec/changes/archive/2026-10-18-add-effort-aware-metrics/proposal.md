## Why

方法侧已经有 9 个方法（5 经典 + 4 深度）、多方法并列比较与预测解释，但 **effort-aware 一族仍只有 `Recall@20%LOC`**：团队分工 A-3 明确要求补 **Popt** 与 **IFA**，产品需求 US-07 也要求"两种指标"。只给一个 20% 预算点，看不出方法在整个审查预算区间上的表现，也无法与 Kamei 系列的 Popt 口径对齐。

Popt 的候选定义已经冻结在产品设计文档 §5.1.2（全成本范围、density-ranked、梯形面积、按 oracle/worst 归一化），但代码里没有任何实现；IFA 则连定义都还没有。

另外有一处文档口径漂移：团队分工 A-4 仍写"SHAP 为主（TreeSHAP/DeepSHAP）"，而实际实现是 `attribution.py` 的**遮挡法**（`occlusion-mean-v1`，归档 change 已说明取舍）。不修正会让验收说不清按哪个口径完成。

## What Changes

- 新增 **`metric-set-v2`**，在 v1 全部指标之外增加 `popt`、`ifa` 与 `poptEffort` 明细；**`metric-set-v1` 原样保留**，既有运行与比较不受影响。
- 定义并实现 **Popt**：全成本范围（x=累计 `la+ld` 占比，y=累计正例占比），模型按 **`risk/(la+ld)` 密度**降序，oracle 按 `label/(la+ld)` 降序、worst 取 oracle 反向；梯形面积归一化 `(A_model−A_worst)/(A_oracle−A_worst)`；总成本为 0、无正例或 oracle==worst 时返回 null 与原因。
- 定义并实现 **IFA**：按既有风险序（risk-desc, time-desc, id-asc）扫描，首个正标签之前出现的负标签条数；没有正标签时返回 null 与原因。
- CLI 增加 `--metric-set`（默认仍为 `metric-set-v1`），使新指标集可显式选择而不改变既有默认行为。
- 用 v2 重建 9 个方法运行（`metricSet` 计入运行身份），并只用同一指标集做并列比较；跨指标集不声称可直接排名。
- `PROTOCOL.md` 写入两个指标的定义与手算预言；`docs/团队分工.md` 更新 A-3 状态，并把 A-4 从 SHAP 改为实际使用的遮挡法口径。
- 不改 v1 的指标语义，不据新指标挑选或淘汰方法，不改服务与前端。

## Capabilities

### Modified Capabilities

- `public-data-baseline`: 新增 **PDB-23**「effort-aware 指标 Popt 与 IFA」——定义、手算可核算、与 `Recall@20%LOC` 的口径区分、未定义时的 null＋原因，以及指标集版本隔离。

## Impact

- 后端代码：`metrics.py`（新增指标集与两个指标）、`cli.py`（`--metric-set`）、测试。
- 产物：用 `metric-set-v2` 重建 9 个方法运行；v1 运行保持不变，跨指标集比较必须声明不可直接排名。
- 文档：`backend/PROTOCOL.md`、`docs/团队分工.md`（A-3 完成状态、A-4 口径修正）。
- 不影响：既有 v1 指标、运行身份规则、服务与前端、已归档证据。
