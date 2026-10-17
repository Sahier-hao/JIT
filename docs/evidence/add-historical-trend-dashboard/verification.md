# 验证记录 · add-historical-trend-dashboard

本文件是本次 change 的运行验证记录，随证据一起冻结到归档目录。所有数字来自实际执行。

## 运行与产物

| 运行 | runId | 是否含聚合键 | `cli verify` |
|---|---|---|---|
| `artifacts/baseline`（既有，未重跑） | `300ace38cf8b51baff96fed4f51ca06cdaefc6532c0de5e4f49c76e1bcf2919b` | 否 | `passed: true`，退出码 0，产物未被改写 |
| `artifacts/trend-baseline`（本 change 重跑） | `3d1f1da0f08f612cb102c8d18cddbe0b136e8020643d4d1dd3e5de0a7849d2e3` | 是（28 个月桶） | `passed: true`，退出码 0 |

重跑命令（数据已在本机，无需网络）：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli run --output artifacts/trend-baseline
& .venv/Scripts/python.exe -m jit_baseline.cli verify --run artifacts/trend-baseline
& .venv/Scripts/python.exe -m jit_baseline.cli verify
```

## 真实 HTTP 断言（服务以 `JIT_RUN_DIR` 供给新运行）

- `GET /api/review-batch` → `runId` 与该运行一致，`mode=historical`，`records=1853`
- `summary.trendBuckets`：`grain=month`、`timezone=UTC+08:00`、`minSample=20`、`buckets=28`
- 各桶合计：`commits=12374`（= `quality.includedRows`）、`positives=1616`（= `quality.positiveLabels`）
- 逐条记录中含 `label`／`title`／`explanation` 的条数：**0**
- 聚合内出现 `label`／`features` 键：**否**

## 测试

| 套件 | 结果 |
|---|---|
| 后端 `pytest -q` | **226 passed / 2 failed**。两个失败均为 `tests/test_verification_guard.py`，根因 `shutil.which("pwsh") = None`（本机未安装 PowerShell 7，`backend/README.md` 与 `frontend/README.md` 写明验证链的要求），与本 change 的改动无交集 |
| 新增后端用例 | `tests/test_trends.py` 12 个；`tests/test_artifacts.py` 新增 4 个（产物结构、篡改桶、守恒不符、无聚合键仍通过）；`tests/test_api.py` 新增 1 个（`JIT_RUN_DIR` 与不退回原运行） |
| 前端 `npm run typecheck` | 通过，退出码 0 |
| 前端 `npm run lint` | Found 0 warnings and 0 errors（65 files / 116 rules） |
| 前端 `npm test` | **220 passed**（17 个测试文件） |
| 浏览器完整回归 `npx playwright test`（`JIT_FRONTEND_PORT=4373`，两视口） | **56 passed**，含新增 A11-6 与「无聚合键／含聚合键」两种契约形态用例 |

## 趋势页实测（详见 `keyboard-and-overflow.json`）

- 1280×720 与 1440×900：页面级横向溢出均为 **0**
- 文本视图可由 Tab 到达；`ArrowDown` 使容器 `scrollTop` 0→40→80；`End` 到底（1549 / 1369，`reachedBottom: true`）；`Home` 回 0
- 稀疏桶文本："样本不足：桶内提交数 5 少于最小样本 20，观测比例不足以比较" + "未提供：该桶没有测试分区记录"（不写成 0）
- 运行未提供聚合时：`role=status`，提示"该运行未提供趋势聚合……其余视图（提交工作台、详情、优先审查清单与基线摘要）不受影响"

## 敏感信息扫描

对本次证据目录扫描 `Authorization`／`Bearer`／`TOKEN`／服务端绝对路径：**未发现**。
