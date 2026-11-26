# Sprint2 单元测试反证记录

所有反证都在 `.cache/mutations/` 的隔离副本中进行；正式产品代码未保留这些改动。

## 反证 1：预测固定取第二列

- 变更：`jit_baseline/ml/model.py` 的 `predict_risks` 把 `predict_proba(matrix)[:, positive]`
  改成 `[:, -1]`。
- 触发用例：`test_predict_risks_normal_selects_label_one_column_when_classes_are_reversed`。
- 结果：失败。实际风险为 `[0.1, 0.25, 0.0]`，期望 `[0.90, 0.75, 1.00]`。
- 说明：该用例固定类别顺序为 `[1, 0]`，能抓住“误取第二列”的实现错误。

## 反证 2：切分按记录位置而不是时间戳分组

- 变更：`jit_baseline/ml/splits.py` 把 `for record in ordered` 改为按位置枚举，并用
  `position < first/second` 决定分区。
- 触发用例：`test_split_records_boundary_keeps_same_timestamp_group_in_one_partition`。
- 结果：失败。同时间戳的 `c`、`d` 被拆到训练集和验证集，训练成员缺 `d`。
- 说明：该用例把相同时间戳放在分区边界附近，专门约束“同一时间组不可跨分区”。

## 反证 3：评价预算判断 `>` 改成 `>=`

- 变更：`jit_baseline/ml/metrics.py` 把 `if used + costs[i] > budget` 改为 `>=`。
- 触发用例：`test_evaluate_boundary_includes_commit_when_budget_is_exactly_reached`。
- 结果：失败。`usedLoc` 从 1 变成 0，刚好触线的提交被错误排除。
- 说明：该用例的总工作量为 5、预算为 1，首条成本正好 1，能区分“触线可用”和“触线即停”。

## 反证 4：前端分档 `>=` 改成 `>`

- 变更：`src/features/projects/analysisScore.ts` 的 `scoreBand` 两个比较都改为 `>`。
- 触发用例：`scoreBand 边界命中 0.10 与 0.25 阈值 [AI生成]`。
- 结果：失败。`scoreBand(0.25)` 从 `high` 变成 `medium`。
- 说明：该用例同时钉住 0.25 和 0.10 两个阈值，避免边界被悄悄排除。

## 正式代码状态

以上变更只存在于 `.cache/mutations/`。正式 `backend/` 与 `frontend/` 源码没有对应修改；
`git diff --stat` 只应包含测试、配置、脚本和交付文档。
