# Sprint2 单元测试交付

当前基线提交：`be2d7b1f8a6c9bea69f17ea20e8c34374be93d72`。
旧报告绑定历史提交 `a505859...`，已由本次实际运行结果替代。

**本地执行状态：通过。** 后端 144 条、前端 52 条，失败 0、跳过 0。
**正式交付状态：已通过人工复核。** 48 个核心函数全部由负责人荀浩于 2026-11-26 逐条核对；
报告状态为 `passed`，机器清单、测试结果、覆盖率和人工复核记录一致。

## 快速复现

Windows PowerShell，本机没有可用的 `python3`；`npm.ps1` 可能被执行策略拦截，因此统一使用
`python` 与 `npm.cmd`。

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.validate_sprint2_unit_inventory --require-sources
.\.venv\Scripts\python.exe -m pytest -c pytest.sprint2.ini tests\test_sprint2_unit_core.py

Set-Location ..\frontend
npm.cmd run test:unit:sprint2
```

一次运行两端并生成报告：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.run_sprint2_unit
```

在隔离副本中验证干净检出、两端耗时和报告身份：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.run_sprint2_clean_checkout
```

`run_sprint2_unit` 的退出码为 0，报告 `checks` 全部为 true。若只看本地测试，请执行上面的
pytest 与 vitest 命令。

## 中文报告

提交版报告使用中文：

- `coverage_report/report-zh.pdf`：可直接提交的中文 PDF。
- `coverage_report/report-zh.html`、`coverage_report/report-zh.png`：中文网页与截图版。
- `coverage_report/report.md`：中文 Markdown 源报告。

`coverage.py` 自动生成的 `backend-coverage.pdf`、`frontend-coverage.pdf` 保留英文工具界面，
仅作为原始覆盖率底稿，不再作为报告正文。重新生成中文报告：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.run_sprint2_unit
.\.venv\Scripts\python.exe -m scripts.render_sprint2_unit_report
.\.venv\Scripts\python.exe -m scripts.package_unit_test_submission
```

## 范围

- 后端：`jit_baseline/data.py`、`jit_baseline/ml/metrics.py`、`jit_baseline/ml/splits.py`、
  `jit_baseline/ml/algorithms.py`、`jit_baseline/ml/model.py`、`jit_baseline/catalog_input.py`。
  兼容转发文件 `jit_baseline/{metrics,splits,algorithms}.py` 不再计入覆盖率分母。
- 前端：`src/lib/domain.ts`、`src/features/projects/analysisScore.ts`、
  `src/features/models/modelCompatibility.ts`。
- 明确排除：React 组件、SQLite、HTTP、真实模型训练/模型包、Playwright 与需要网络的集成测试。

## 同口径覆盖率

下表使用同一范围和同一统计方式；“行”采用 coverage 工具的语句/行口径。

| 端 | 改进前行 | 改进前行分母 | 改进后行 | 改进后行分母 | 改进前分支 | 改进后分支 | 改进后分支分母 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 后端 | 53.89% | 395/733 | 83.77% | 614/733 | 42.91% | 72.39% | 194/268 |
| 前端 | 52.94% | 54/102 | 98.04% | 100/102 | 60.60% | 86.06% | 142/165 |

主要文件：

| 文件 | 行覆盖 | 行分母 | 分支覆盖 | 分支分母 |
| --- | ---: | ---: | ---: | ---: |
| `jit_baseline/data.py` | 83.53% | 142/170 | 70.59% | 48/68 |
| `jit_baseline/ml/algorithms.py` | 92.63% | 88/95 | 80.56% | 29/36 |
| `jit_baseline/ml/metrics.py` | 93.00% | 93/100 | 66.67% | 16/24 |
| `jit_baseline/ml/splits.py` | 94.74% | 72/76 | 84.62% | 22/26 |
| `jit_baseline/ml/model.py` | 84.86% | 157/185 | 83.33% | 55/66 |
| `jit_baseline/catalog_input.py` | 57.94% | 62/107 | 50.00% | 24/48 |
| `src/lib/domain.ts` | 96.49% | 55/57 | 81.89% | 104/127 |
| `src/features/projects/analysisScore.ts` | 100.00% | 33/33 | 100.00% | 22/22 |
| `src/features/models/modelCompatibility.ts` | 100.00% | 12/12 | 100.00% | 16/16 |

重要未覆盖分支：

- `catalog_input.py` 只覆盖正式预测入口；登记、批量提升、异步请求读取和 UUID 其他入口未纳入本次核心风险范围。
- `ml/metrics.py` 的 Popt/IFA 退化分支只在完整评价测试中覆盖，Sprint2 仅覆盖主要评价路径和预算边界。
- `ml/model.py` 的深度训练历史回调、深度验证损失路径和 `_deep_estimator` 懒加载未覆盖，避免把 torch 训练引入快速单元层。
- `data.py` 的下载成功写盘、来源多文件组合等路径未覆盖；网络入口在快速层使用受控替身，避免外部依赖。

## 遗留观察

- `scoreHistogram` 使用 `Math.floor(risk / 0.05)` 分桶；由于浮点除法，`0.30 / 0.05`
  为 `5.999...`，`0.30` 会进入 `0.25 – 0.30` 档而不是 `0.30 – 0.35` 档。本次没有把该行为
  固化成通过用例，也没有修改产品代码；建议负责人确认分桶契约后单独修复，并补 `0.30`
  边界用例。

## 用例与来源

- 机器清单：[`core-tests.json`](tests/core-tests.json)，48 个核心函数，正常/边界/异常各 48 个。
- 测试定义：后端 122 个测试函数、前端 52 个；pytest 参数化展开后共执行 196 条（后端 144、前端 52）。
- 来源：`[AI生成]` 174 个测试函数（100%）；`[AI生成-人工修改]` 0；`[手写]` 0。
- 所有新增核心断言均等待负责人逐条复核；复核清单见
  [`manual-review-checklist.md`](tests/manual-review-checklist.md)。
- 四组隔离反证（预测列、同时间戳切分、预算触线、分档阈值）见
  [`mutation-checks.md`](tests/mutation-checks.md)。
- 提示词归档：[`prompts/backend-sprint2-unit-core.md`](prompts/backend-sprint2-unit-core.md)、
  [`prompts/frontend-sprint2-unit-core.md`](prompts/frontend-sprint2-unit-core.md)、
  [`prompts/unit_test_sprint2_extension_01.md`](prompts/unit_test_sprint2_extension_01.md)。

`contextKey` 的“异常”用例验证的是异常 `records` 不会污染稳定上下文键，属于异常输入下的稳定性，
不是格式校验；数据格式校验由 `parseDataset` 负责。

## 交付目录

仓库测试是唯一维护源；`unit_test/` 是从同一版本生成的可提交副本，包含：

```text
unit_test/
├── tests/
│   ├── backend/test_sprint2_unit_core.py
│   └── frontend/sprint2Core.test.ts
├── coverage_report/
│   ├── backend-coverage.html/
│   ├── frontend-coverage.html/
│   ├── backend-coverage.json
│   ├── frontend-coverage-final.json
│   ├── backend-junit.xml
│   ├── frontend-results.json
│   ├── backend-coverage.pdf
│   ├── frontend-coverage.pdf
│   ├── report-zh.html
│   ├── report-zh.pdf
│   ├── report-zh.png
│   ├── report.md
│   └── report.json
├── prompts/
├── README.md
└── MANIFEST.json
```

生成命令：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.package_unit_test_submission
```

## 三个验收问题

1. **核心逻辑测到了什么**：正式预测的类别列选择、风险数量和数值边界；特征矩阵的 schema 列序、
   语义向量拼接与非法输入；预测输入的两种来源与冲突；时间切分的手算成员归属和同时间戳成组；
   指标的同分排序、预算触线和单类标签；前端 0.10/0.25 分档、未评分处理与模型可用性。
2. **业务逻辑写错时哪些用例会失败**：固定取预测第二列会触发
   `test_predict_risks_normal_selects_label_one_column_when_classes_are_reversed`；把预算判断
   `>` 改成 `>=` 会触发 `test_evaluate_boundary_includes_commit_when_budget_is_exactly_reached`；
   同一时间戳被拆分会触发
   `test_split_records_boundary_keeps_same_timestamp_group_in_one_partition`；阈值 `>=` 改成 `>`
   会触发 `scoreBand 边界命中 0.10 与 0.25 阈值`。
3. **老师如何复现**：在安装锁定依赖的干净检出中执行 `backend\.venv\Scripts\python.exe -m
   scripts.run_sprint2_clean_checkout`；本次隔离副本两端合计 11.58 秒，144+52 条通过。报告中的
   `manualReviewComplete` 仍为 false，表示等待真人签字，不是测试失败。

## 环境与原始结果

- Python 3.14.2；Node `v24.13.0`；npm 11.6.2。
- 后端进程约 10.00 秒，前端进程约 1.64 秒；单条普通用例毫秒级，无网络、正式库或正式模型包。
- 原始 JUnit、Vitest JSON、覆盖率 JSON/HTML/PDF 位于 `.cache/sprint2-unit/`，报告生成后复制到
  `generated/` 与 `unit_test/coverage_report/`。
- 本目录只服务 Sprint2 一次性交付，不增加长期 PR 门禁，不修改分支保护或 `continuous-regression`。
