# Sprint2 单元测试交付

本目录只服务 Sprint2 单次交付，不新增长期 PR 门禁，也不修改分支保护或
`continuous-regression`。

## 范围

- 后端：数据解析、完整性校验、指标、时间切分、方法参数与模型标识纯逻辑。
- 前端：演示/仓库数据投影、风险展示、时间与查询、地址种子和趋势契约纯函数。
- 明确排除：React 组件、SQLite、HTTP、真实模型训练、Playwright 与需要网络的集成测试。

机器清单是 [`core-tests.json`](core-tests.json)。每个函数必须同时登记正常、边界和
异常用例；`backend/scripts/validate_sprint2_unit_inventory.py` 会检查文件、节点、
场景和来源标记，并拒绝套件中的未分类测试。

人工复核使用 [`manual-review.json`](manual-review.json)。负责人必须逐项填写
`function`、`verdict: "reviewed"` 和实质复核结论，并在顶层填写审核人与日期。
在 34 个核心函数全部复核前，最终报告保持 `failed`，这是预期行为，不能由 AI 代签。

## 命令

后端快速单元与覆盖率：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.validate_sprint2_unit_inventory --require-sources
.\.venv\Scripts\python.exe -m pytest -c pytest.sprint2.ini tests\test_sprint2_unit_core.py
```

前端快速单元与覆盖率：

```powershell
Set-Location frontend
npm run test:unit:sprint2
```

一次运行两端、生成报告并执行全部门禁：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.run_sprint2_unit
```

在隔离副本中验证干净检出、两端耗时和报告身份：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.run_sprint2_clean_checkout
```

完成人工复核后，把交付材料、HTML/原始覆盖率、来源提示词和测试源码整理到运行工作区：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.package_sprint2_unit_evidence
.\.venv\Scripts\python.exe -m jit_baseline.cli freeze-evidence `
  ..\docs\evidence\deliver-sprint2-unit-test-report `
  --workspace ..\docs\evidence\_run\sprint2-unit-test-delivery
.\.venv\Scripts\python.exe -m jit_baseline.cli check-evidence `
  ..\docs\evidence\deliver-sprint2-unit-test-report
```

原始运行结果和覆盖率写入仓库根的 `.cache/sprint2-unit/`。该目录是可重建的运行工作区，
不是最终证据。[`generated/report.json`](generated/report.json) 与
[`generated/report.md`](generated/report.md) 由原始结果生成；HTML 覆盖率页面由
[`generated/backend-coverage.png`](generated/backend-coverage.png) 和
[`generated/frontend-coverage.png`](generated/frontend-coverage.png) 留证。

报告身份包含提交、测试清单、测试文件、依赖锁文件和测试配置。测试变更后旧报告会自动
判为陈旧；失败、无原因跳过或缺少人工复核都不能被标为通过。
