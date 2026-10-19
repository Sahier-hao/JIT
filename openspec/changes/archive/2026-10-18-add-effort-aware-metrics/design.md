# Design

## Context

动机见 [proposal](proposal.md)；行为约定见 [public-data-baseline](specs/public-data-baseline/spec.md) 的 PDB-23。

现有评价机制：

- `metrics.METRIC_SETS` 只注册了 `metric-set-v1`；`evaluate(records, risks, metric_set)` 先算出完整结果，再按声明集合过滤键，声明里出现未定义指标会以 `METRIC_SET_INVALID` 拒绝。
- `metricSet` 计入运行身份（`config`），`compare_methods` 把它作为可比性的一项；既有 9 个方法运行都是 v1。
- CLI 目前没有 `--metric-set`，`build_run` 的 `metric_set` 参数只走默认值。
- `PROTOCOL.md` 已有一条手算预言（标签 `[1,0,1,0]`、风险 `[.9,.8,.2,.1]`、LOC `[1,1,4,4]`），可扩展为 Popt/IFA 的验收基线。
- 产品设计文档 §5.1.2 已冻结 Popt 的候选口径：全成本范围、模型按风险／正 LOC 密度、oracle 按标签／LOC、worst 反向、梯形面积归一化；退化时 null＋原因。

## Goals / Non-Goals

**Goals:**

- 以新增指标集的方式补齐 Popt 与 IFA，保持 v1 与既有运行完全不变。
- 把两个指标定义到"可手算复核"的程度，并让未定义情形有明确原因。
- 用同一指标集重建 9 个方法运行并重新并列。

**Non-Goals:**

- 不改 v1 指标语义，不据新指标挑选、淘汰或重排方法。
- 不做 LOC 加权的 Popt 变体、不做阈值优化、不改服务与前端。

## Decisions

### D1. 新增 `metric-set-v2`，v1 原样保留

`metric-set-v2` = v1 的全部键 + `popt`、`ifa`、`poptEffort`。`evaluate` 始终计算新指标，由声明集合过滤——因此 v1 运行的结果字典与既有记录逐键一致。

**备选与否决理由**：直接改 v1——会让所有既有运行的重算结果变化、`runId` 语义漂移，并使已冻结证据无法按原声明复核。

### D2. Popt 的精确定义

1. 成本 `c_i = la + ld`；总成本 `C = Σc_i`；正例数 `P`。
2. 模型顺序：按 `risk_i / c_i` 降序；同分按 `epoch` 降序、`id` 升序。
3. oracle 顺序：按 `label_i / c_i` 降序（正例按成本升序在前，其余为 0）；同分按 `epoch` 降序、`id` 升序。
4. worst 顺序：oracle 顺序的反向。
5. 对任一顺序，逐条累计：`x_k = 累计成本 / C`，`y_k = 累计正例数 / P`，从 `(0,0)` 起按梯形求面积。
6. `Popt = (A_model − A_worst) / (A_oracle − A_worst)`。
7. 记录 `poptEffort = {name, ordering, totalLoc, areaModel, areaOracle, areaWorst, policy}`，其中 `name` 必须标为 density-ranked／full-range，与 risk-ranked 的 `Recall@20%LOC` 区分。

未定义：`C == 0`、`P == 0`、或 `A_oracle == A_worst` → `null` + 原因。

**备选与否决理由**：按风险单独排序（不看成本）——那就退化成另一条风险曲线，失去 effort-aware 的意义；用 `max(1, la+ld)` 作为成本——产品设计文档已明确那是旧候选、不能与当前方案合并。

### D3. IFA 的精确定义

按既有风险序（`risk` 降序、`epoch` 降序、`id` 升序）扫描，`IFA` = 首个正标签之前出现的负标签条数；首个即正例时为 0；没有正标签 → `null` + 原因。

### D4. CLI 增加 `--metric-set`，默认 v1

显式选择指标集；默认保持 `metric-set-v1`，使"不写参数"的行为与既有命令完全一致。指标集进入运行声明，不同集合的运行不因指标不同而共享身份。

### D5. 用 v2 重建 9 个方法运行，只在同一集合内比较

`compare_methods` 已把 `metricSet` 作为可比性键：v1 与 v2 运行并列时会声明不可直接排名。重建后只用 v2 的 9 个运行做并列；v1 运行与其证据保持不变。

### D6. 文档口径同步

- `PROTOCOL.md` 写入两个指标的定义与手算预言：样例 `[1,0,1,0]` 的 IFA=0（最高风险条目即正例）、Popt=12/13（面积 0.775／0.825／0.175）；另以标签 `[0,1,1,0]` 验证 IFA=1。
- `docs/团队分工.md` 更新 A-3 为已完成；把 A-4 的"SHAP 为主"改为实际实现（遮挡法 `occlusion-mean-v1`），并注明归档 change 的取舍理由。

## Risks / Trade-offs

- [Popt 的定义容易漂移（density vs risk、按条数 vs 按 LOC 召回）] → 把步骤写死并用固定手算样例守住；命名强制标注 density-ranked／full-range。
- [同分与零成本边界] → 明确 tie-break 与 null 条件；测试覆盖。
- [重建 9 个运行会改变 runId] → 这是 `metricSet` 计入身份的预期结果；v1 运行不动，跨集合比较声明不可排名。
- [Popt 为 O(n log n) 排序] → 1,853 条测试集开销可忽略；仍记录该指标的中间量以便复核。
- [文档与实际实现再次漂移] → 本次同时修正 A-4，并在条目里维持"解释口径"字段的单一来源。

## Migration Plan

1. 注册 `metric-set-v2` 并实现 Popt／IFA，用手算样例与退化用例验证；确认 v1 输出逐键不变。
2. 增加 `--metric-set`（默认 v1），验证运行身份随集合变化。
3. 在 v2 下重建 9 个方法运行并并列比较。
4. 更新 PROTOCOL 与团队分工。
5. 回退方式：移除 v2 注册与 `--metric-set` 的使用即回到 v1 行为；v2 运行目录独立，删除不影响既有运行。

## Open Questions

- 是否需要 LOC 加权的 Popt 变体（或按正 LOC 召回）——本轮不做，作为后续可选口径。
