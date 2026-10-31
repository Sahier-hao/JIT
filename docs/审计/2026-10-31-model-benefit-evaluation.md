# 模型审查收益评估验收

日期：2026-10-31。范围：升级实施方案第三阶段「用实验回答模型到底有没有帮助」。使用九个已交付模型产物的冻结测试分区；不重新训练、不在测试分区调参、不修改默认模型。

## 交付行为

| 能力 | 实现与验证范围 |
| --- | --- |
| 评估数据 | 读取一个产物已校验的 `test-input.json`、`test-labels.json`、`reference-predictions.json`；核对测试身份、标签、风险与工作量。 |
| 三种检查顺序 | 模型分数（risk 降序）、时间顺序（提交时间降序）、固定种子随机顺序；三者共用同一测试分区、同一标签和同一 20% 总 LOC 预算。 |
| 指标 | 复用 Recall@20%LOC、IFA 和既有 Popt 归一化成本-召回面积公式；Popt 记录本次排序，既有密度排序指标另列。 |
| 随机重复 | 默认 200 次、种子 2026；记录均值、总体标准差、最小值、最大值和有效次数；相同产物、次数和种子产生相同结果。 |
| 报告内容 | 模型/数据/运行身份、测试样本、正例、预算、策略指标、覆盖正例、选中提交、使用行数、既有指标对照、文件哈希、评估环境和限制。 |
| 条件不足 | 无正例、总工作量为零或零成本提交时返回未定义与原因，不写 0。 |
| 管理员读取 | `GET /api/v1/models/{modelId}/benefit` 按原产物运行标识匹配报告；必须管理员会话；无报告返回 `available=false` 与原因；无效报告返回 `REPORT_INVALID`。 |
| 模型详情 | 「审查收益」区域显示结论句、三种策略、样本与正例、随机重复/种子、既有指标对照和标签限制；不提供训练、调参或修改默认模型操作。 |
| 边界 | 只读回顾性评估；风险分数不是缺陷概率；不据此宣布最佳模型或改变默认模型。 |

## 关键实现

- [benefit.py](../backend/jit_baseline/benefit.py)：加载冻结测试分区、重算模型预测并按产物声明的复现口径核对 `reference-predictions.json`、三种排序、Recall/IFA/Popt、随机重复、报告与限制。
- [metrics.py](../backend/jit_baseline/metrics.py)：抽出 `normalized_effort_area`，既有 Popt 仍使用密度排序，收益评估按各自策略排序复用同一面积公式。
- [benefit_reports.py](../backend/jit_baseline/benefit_reports.py)：固定根目录发现、按 artifact run identity 匹配、无效报告原因。
- [cli.py](../backend/jit_baseline/cli.py)：`evaluate-benefit --run --output --random-runs --seed`。
- [AdminModelDetailPage.tsx](../frontend/src/pages/admin/AdminModelDetailPage.tsx)：模型详情内的只读收益区域。
- 新增 `docs/evidence/benefit-evaluation/` 下九个真实产物的报告与说明。

## 验证结果

### 后端全量

`backend/.venv/Scripts/python.exe -m pytest -q --basetemp=.cache/p3-full`：**650 passed**，1 条既有 PyTorch 警告，约 6 分钟。

新增用例：

- `tests/test_benefit.py`：固定种子策略/结论/样本可复现；基线模型清楚显示低于时间与随机顺序；未定义指标与零成本返回原因；`run_benefit` 拒绝覆盖；管理员 401、无报告 `available=false`、无效报告 422、读取前后默认模型不变。
- `tests/test_openapi.py`：模型收益接口 401/422 契约和报告必需字段。

### 前端全量

`npm run typecheck`、`npm run lint`、`npm run build` 通过；`npm test`：**333 passed**。

新增用例：

- `src/benefitContracts.test.ts`：直接解析真实 baseline 收益报告，核对策略值、随机 200 次/种子 2026、结论、限制和既有 AP。
- `src/pages/AdminModelBenefit.test.tsx`：模型/时间/随机三行、结论句、样本与正例、缺失指标原因、无报告原因、只读边界提示。

### 浏览器

`npx playwright test e2e/admin-experiments.spec.ts --config=playwright.project-workspace.config.ts --project=desktop-1440`：**2 passed**（多项目报告 + 模型收益）。模型详情实际显示：

- 结论：同样检查 20% 代码改动量，模型排序覆盖 4.2%，时间顺序 17.1%，随机平均 20.0%；
- 表内模型/时间/随机三行的 Recall@20%LOC、Popt、IFA、覆盖正例、选中提交和使用行数；
- 既有运行指标对照、标签与口径限制、只读边界提示。

截图：`docs/evidence/_run/admin-experiments-browser/model-benefit.png`。

### 真实实验结果

九个已交付模型产物使用同一 OpenStack 冻结测试分区（1,853 条提交、286 个历史正标记、210,242 行、预算 42,048.4 行）。同样检查 20% 代码改动量：

- 模型 Recall@20%LOC 为 4.2%–12.6%；
- 时间顺序为 17.1%；
- 固定种子随机平均为 20.0%（标准差约 2.8%）；
- 模型 Popt 为 0.277–0.349，时间顺序为 0.463，随机均值约 0.500。

结论：在这批冻结测试数据上，按原始模型分数检查并没有比时间顺序或随机顺序覆盖更多历史标记，模型未显示出节省代码检查时间的效果。主要原因是原始分数排序不感知工作量，模型选中的提交平均更大，预算内只能检查更少提交。报告和界面如实保留这一不利结果。完整表见 `docs/evidence/benefit-evaluation/README.md`。

### OpenSpec

`openspec validate expose-model-benefit-evaluation --type change --strict`：通过。

## 未完成或未验证

- 仅评估冻结测试分区，不代表在线效果；随机均值和波动不是置信区间。
- 模型策略按原始风险排序，不按风险/成本密度；既有密度 Popt 仅在报告中另列，不能与收益表混读。
- 没有收益报告的模型显示原因，不生成替代指标。
- 未把项目工作台专用 E2E 和收益浏览器用例接入 `verify.ps1`/CI；自动化测试由 pytest/vitest 全量覆盖，收益浏览器用例使用隔离预览服务单独执行。
- 无数据库迁移；既有数据库、模型、训练任务、默认模型和产物不变。
