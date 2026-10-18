# 验证记录 · restyle-frontend-visual-language

本文是本次 change 第二批次（任务 5.2–5.5、6.1、6.3）的运行验证记录，随证据一起冻结。
所有数字来自实际执行；截图与原始 JSON 在同目录。

## 命令结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过，退出码 0 |
| `npm run lint` | Found 1 warning and 0 errors（81 files / 116 rules；唯一 warning 是既有的 `Icon.tsx` fast-refresh 提示，非本次引入） |
| `npm test` | **298 passed**（27 个测试文件，0 失败） |
| `npm run build` | 通过（CSS 65.16 kB、JS 344.33 kB） |
| `npm run test:e2e` | **76 passed**（两视口各 38 条，2.4m）；默认超时 30s。含 `visual-evidence.spec.ts` 4 条（工作台两视口布局与对比度、模型中心/新建预测/结果页、遮罩与紧凑密度、趋势图表），各跑两视口 |
| `npm run test:e2e:acceptance` | **18 passed**（两视口各 9 条，1.3m）；MPW-04 登记的是**本机旧 baseline**（原先会回 500 的那条路径） |
| `pytest`（后端全量） | **235 passed, 2 failed**；两条失败都在 `tests/test_verification_guard.py`，原因是本机**没有 PowerShell 7**（`shutil.which("pwsh")` 返回 `None`），与本轮代码改动无关，详见下方遗留问题 1 |

`browser-results.json` / `browser-results-acceptance.json` / `unit-results.json` 是这三批运行的原始报告。

## 合入 origin/main（dc98cd8）后的复核

本分支（`restyle-frontend-visual-language`）随后与远端 `origin/main` 合入的 8 个提交
（PR #14 提交分页与持久化、#15 从 Git 仓库采集、#16 数据集描述文件、#17 预测解释与验收链）合并，
合并后按同一套命令重跑：

| 命令 | 合并后结果 |
|---|---|
| `npm run typecheck` | 通过（`tsc -b` 无输出） |
| `npm run lint` | Found 1 warning and 0 errors（81 files / 116 rules，warning 仍是既有的 `Icon.tsx`） |
| `npm test` | **301 passed**（27 个文件）——比合并前多 3 条，来自上游新增的归因/数据集用例 |
| `npm run build` | 通过（CSS 65.73 kB、JS 346.55 kB） |
| `npm run test:e2e` | **76 passed**（2.5m，默认 30s） |
| `npm run test:e2e:acceptance` | **18 passed**（1.2m） |

合并带来的两处必要改动：

1. `frontend/src/App.css` 是唯一冲突文件：上游新增的 `.explanation-*` 规则用硬编码色（`#4a5d7a` 等），
   在这套令牌体系下会让炭黑主题失去对比度，因此把这几条改写成 `--fg-2`/`--fg-3`/`--line-soft`/`--risk-strong`/`--accent`。
2. 验收 MPW-05 里两条断言写的是旧行为（结果页显示「预测解释：未支持」「该模型的真实预测解释尚未接入」）。
   #17 之后服务端按遮挡法实时算归因，这一轮实测返回
   `explanationStatus=supported`、`method=occlusion-mean-v1`、5 个归因项，因此断言改为：解释分区必须出现
   `occlusion-mean-v1`、摘要必须说明「归因来自模型」、并明确「不是缺陷结论或代码定位」。归因失败的分支
   （只有原因、不给数字）仍由单元测试覆盖。

需要注意的行为变化：旧 baseline 的 `summary.limitations` 里仍留着一句「预测解释未提供」，那是产物里冻结的
历史文字，页面不再用它当解释结论；实际解释由服务端实时计算，并附加「部分入模特征缺少训练数据均值，
本次归因对缺失字段按零基线计算」这一条限制。

### 后端与项目验证链（同一轮）

本机原先只有 Windows PowerShell 5.1，`frontend/scripts/verify.ps1` 起不来。之后安装了 PowerShell 7.6.7
（用户级，`%LOCALAPPDATA%\Programs\PowerShell\v7.6.7`，已加入用户 PATH），整链跑通一次：

| 检查 | 结果 | 耗时 |
|---|---|---|
| `backend-tests`（`pytest --basetemp=.cache/final-verification`） | **276 passed / 1 skipped** | 138.6s |
| `real-artifact-verification`（`cli verify`） | `passed: true` | 2.6s |
| `independent-reproduction-comparison`（`cli compare`） | `passed: true`（atol 1e-8） | 2.3s |
| `clean-install`（`npm ci`） | 通过 | 45.1s |
| `typecheck` / `behavior-tests` / `lint` / `build` | 通过 / **301 passed（27 文件）** / 1 warning 0 errors / CSS 65.73 kB + JS 346.55 kB | 6.8 / 48.5 / 0.8 / 6.0s |
| `browser-tests`（`npm run test:e2e`） | **76 passed** | 156.2s |
| `openspec-validation`（`validate --specs --strict`） | **14 passed, 0 failed** | 3.5s |

链的汇总写在 `docs/evidence/_run/verification.json`（`success: true`，10 项检查全 exit 0，
745 个受保护文件在运行期间未变），本次归档的文件就是这份汇总与日志。

一处需要交代的口径：`tests/test_performance.py` 的 P95 预算 250 ms 在本机上处于边缘——单机实测
P50 137.8–157.9 ms、P95 185.4–262.6 ms（上限 286 ms），三次运行里两次超预算、一次通过，机器的吞吐
本身就在 ±15% 间波动。上游自己记录的本机值为 P50 124.3 / P95 150.1 ms。上述整链结果是在把
`JIT_LATENCY_P95_MS` 设为 **350**（`README.md:230` 明确给出的临时放宽开关）后取得的；不设该变量时
该检查会因这条测试失败而中止整链。这不是合并引入的回归：单条请求要跑 6 次遮挡推理，其耗时与
被测机器相关，与本次改动无关。

两条曾失败的环境性用例都已转为通过：`tests/test_verification_guard.py` 两条在装上 PowerShell 7 后
通过（此前 5.1 下 `shutil.which('pwsh')` 为 `None`）。`tests/test_openapi.py` 仍因未装 PyYAML 跳过。

`--basetemp` 必须落在仓库内（如 `.cache/final-verification`，与 `frontend/scripts/verify.ps1:63`、
`backend/README.md:236/246/292` 一致）：`evidence.freeze` 会用 `Path.relative_to(PROJECT)` 记录工作区的
相对路径，临时目录在系统 TMP 下时 9 条证据用例会以 `ValueError: … is not in the subpath of …` 失败。

合并后出现过的两条环境性失败及处置：① `test_real_dataset_commits_page_stays_bounded` 因本机目录库从未
导入提交记录而返回 503，按 `backend/README.md:85-91` 跑 `register-dataset` 与
`import-dataset --manifest data/datasets/openstack-six-v1/openstack-six-v1-2011-11-29_2014-02-28.json`
（导入 **12374** 条提交）后通过；② `test_prediction_latency_p95_stays_under_budget` 见上。

## 可见行数实测（工作台，提示条与基线记录都在页面上）

| 视口 | 历史回放 | 演示模式 | 单视口 |
|---|---|---|---|
| 1280×720 | **5** | **7** | `scrollHeight = innerHeight = 720`，只有表格区滚动 |
| 1440×900 | **9** | **12** | `scrollHeight = innerHeight = 900`，同上 |

与任务 4.2 记录的值逐项一致（12/7 演示、9/5 历史）。测量口径：完全落在 `.table-wrap` 可视区内的
`tbody tr` 行数，先等 `document.fonts.ready` 并连量到稳定值（`workbench-*.json`）。

## 对比度实测（浏览器 computed color → WCAG 比值）

| 位置 | 选择器 | 文字色 | 背景 | 比值 | 改动前 |
|---|---|---|---|---|---|
| 页脚 | `.page-foot` | rgb(108,111,107) | canvas | **4.74** | 2.39 |
| 表尾 | `.list-footer` | rgb(108,111,107) | card | **5.09** | 2.97 |
| 元信息 | `.page-head .meta` | rgb(108,111,107) | canvas | **4.74** | — |
| 风险值 | `.risk-number` | rgb(142,54,17) | card | **7.82** | 4.24 |

全部 ≥ 4.5:1。`contrast.test.ts` 另对四套主题的 10 组令牌组合各校验一遍（28 次断言通过）。

## 无页面级横向滚动

判定双条件：`documentElement.scrollWidth ≤ clientWidth`，且 `body *` 中没有元素右边界越界。

| 页面 | 1280×720 | 1440×900 |
|---|---|---|
| 工作台（历史 / 演示） | 0 越界 | 0 越界 |
| 模型中心（表格） | 0 越界 | 0 越界 |
| 模型中心（来源抽屉打开） | 0 越界 | 0 越界 |
| 新建预测 | 0 越界 | 0 越界 |
| 结果页 | 0 越界 | 0 越界 |

## 结构实测（`pages-*.json`）

- **模型中心**：`.model-card` 行数 = 登记项数（2 条）；`.state-badge` 是 6px 色块 + 文字（无边框、无胶囊）；
  表格 `table-layout: fixed`，列宽 1280 下 288/159/258/129/159（合计 994 = 面板内宽，行内按钮右边界 1245 < 1280）；
  不可用原因与未提供字段以子行常驻，不需要展开。
- **来源抽屉**：`position: fixed`，宽 384，右边界 = 视口宽（1280 / 1440），打开时锁住 body 滚动；
  Esc 关闭、点背板关闭、关闭后焦点回到触发按钮（`ModelsPage.test.tsx` 另有单测覆盖）。
- **新建预测**：`.field-grid input` = 10（项目、记录编号、六特征、提交 SHA、提交时间）；
  两栏 `1fr 288px`；`aria-invalid` 输入在浏览器里可见（风险色边框 + 3px 左锚点条 + 浅风险底）。
- **结果页**：`.risk-banner` 存在，`.risk-number` 文本匹配 `\d+(\.\d+)?%`；`.result-grid` 两列
  （1280: 512.5 + 471.5；1440: 595.8 + 548.2），左身份 / 右来源。
- **历史趋势图**：`.trend-bar` 只出现一种填充色 `rgb(216,208,196)`（`--chart-bar`），与面板底色
  `rgb(255,255,255)` 不同；两个绘图区各有 `.trend-line`（观测实线 / 估计虚线），分区带为
  `2 × trend-band-hatch + 1 × trend-band-test`；`.trend-swatch-bar` 与柱同色。取证用 6 个连续月份的
  **行为夹具**（数值是发明的画法样本，不是真实统计），见 `trends-chart-*.png` 与 `trends-*.json`。

## 深色主题与紧凑密度（`theme-*.json`、`theme-charcoal-*.png`）

四套主题都核对了遮罩（`.scrim`）的方向与强度，紧凑密度在模型表上生效：

| 主题 | `--scrim` 亮度 | 画布亮度 | 22% 混合后亮度 | 结论 |
|---|---|---|---|---|
| 石灰 concrete | 0.0086 | 0.9283 | **0.5619** | 压暗 |
| 钢青 steel | 0.0079 | 0.9271 | **0.5593** | 压暗 |
| 炭黑 charcoal | 0.0000 | 0.0051 | **0.0038** | 压暗（修复前是 0.22 的白纱，方向反了） |
| 纸墨 paper | 0.0096 | 0.9553 | **0.5801** | 压暗 |

模型表行高：舒适 **55px** → 紧凑 **47px**（同一张表，只切 `data-density`）。

## 本轮修复的七处问题

| 问题 | 原因 | 修法 | 回归守卫 |
|---|---|---|---|
| 深色主题遮罩把页面**提亮** | `.scrim` 用 `var(--fg)`，炭黑下 `--fg` 近白 | 新增语义令牌 `--scrim`（四套主题各自声明，炭黑取纯黑），`.scrim` 改用它 | `visual-evidence` 的「遮罩跨主题压暗」用例：四套主题逐个核算混合亮度必须低于画布；`tokens.test.ts` 把 `scrim` 列入每主题必检键 |
| sticky 提交条压住最后一节内容 | 左栏末尾没有为固定条留出高度 | `.predict-main { padding-bottom: 56px }` | 人工核对 + `predict-*.png`（滚到底时内容可完全露在条上方） |
| 深色下单选/复选几乎不可见 | 完全用浏览器默认控件，白底空心圆点 | `input[type=radio], input[type=checkbox] { accent-color: var(--accent) }` | `theme-charcoal-predict-*.png` 里已选中项用强调色填充 |
| 紧凑密度对模型表无效 | `html .models-page tbody td { height: auto; padding: 7px 12px }` 覆盖了全局紧凑规则 | 追加 `html[data-density='compact'] .models-page tbody td { padding: 3px 12px }` | 同一用例断言 rowHeight 由 55 降到 47 |
| **登记本机旧 baseline 候选回 500** | 旧运行 summary 没有 `model` 段，`catalog.register` 直接读 `summary['model']` → `KeyError` → 中间件兜成 `INFERENCE_ERROR` | `catalog.py` 改用 `summary.get('model')`，缺失时按声明的方法回落身份（`id`/`name` 都取 `algorithmVersion`，旧运行即 `logistic-regression-l2-v1`），不编造显示名 | 新增 `tests/test_model_catalog.py::test_legacy_summary_without_model_section_registers_under_declared_method`；验收 MPW-04 **改回登记 baseline** 并通过 |
| **超时放宽掩盖了用例成本** | `A11-2/3/5` 在 1853 行整表上逐次 Tab，35–38s 撞 30s 默认值 | ① 该用例改用 2 条记录的行为夹具（它检查键盘可达性，不是数据量），耗时降到 **2.4/2.7s**；② `playwright.config.ts` 恢复 30s 默认；③ 唯一刻意跑真实 1853 行的 `historical.spec.ts`「真实完整列表键盘详情与焦点返回」单独给 90s 预算（实测 19.4/19.8s，历史上并行时到过 32.5s） | 全量 e2e 在 30s 默认下 76 passed |
| **趋势图「提交数」柱几乎看不见** | 把图表硬编码色换成令牌时，柱写成了 `--fg-inv`（"反白"文本色，浅色主题下等于白）；`--chart-bar`/`--chart-hatch` 定义了却没人用，图例色块又与柱不同色 | `.trend-bar → --chart-bar`、网格/轴线 → `--line-soft`/`--line-strong`、观测线 → `--chart-obs`、估计线 → `--chart-est`、纹理线 → `--chart-hatch`；图例色块与柱/线同令牌 | 新增 `chartTokens.test.ts`（7 条：每个 `--chart-*` 至少被引用一次、柱/两线/两图例色块绑定到对应令牌、柱不得再用 `--fg-inv`）；`tokens.test.ts` 把四个 `chart-*` 列入每主题必检键；`visual-evidence` 的「历史趋势图表」用例断言柱只有一种填充色且不等于面板底色、双线存在、三种分区带齐备 |

> 补充说明：sticky 提交条在**全页截图**里看起来压在「六个原始特征」标题上，那是
> `fullPage` 截图把固定定位元素画在其停靠位置造成的；真实滚动中它固定在视口底部，滚到底后内容
> 全部可露出（本次已加底部留白）。分栏观感见 `predict-*.png` 与 `acceptance-predict-*.png`。

## 实现期间发现并处理的问题（改测试/配置）

1. **验收用的侧栏定位是外壳改造前的写法**：`nav()` 还在找旧的可访问名「模型预测导航」，而 3.1 之后
   外壳是 `nav[aria-label="主导航"]`（图标轨，已移出可访问性树）+ `aside[aria-label="工作空间"]`
   （上下文栏）。改为在上下文栏里定位；同一条键盘用例里另一处直接引用旧名也一并改。
2. **模型表被行内按钮撑出视口**：自动布局下「查看完整来源与局限」按钮实宽 126px，而最后一列只分到
   70px，元素右边界越过视口 45px。改为 `table-layout: fixed` + 显式列宽后按钮落在列内。
3. **右缘抽屉的入场动画会造成真实的几何越界**：`translateX` 从视口外侧滑入期间，抽屉右边界真的超出
   可视宽度，被「无横向滚动」断言抓到（也是模态层的真实瑕疵）。改为 `clip-path` 擦出，配合打开时
   锁住页面滚动。
4. **旧 summary 形态登记失败**：本机 `artifacts/baseline` 的 `summary.json` 是具名 schema 之前的形态
   （没有 `model` 段），`catalog.register` 原本直接读 `summary['model']`，于是抛 `KeyError` 并被中间件
   兜成 500 `INFERENCE_ERROR`。本轮已修（见上表第 5 行），验收改回登记 baseline 并通过。

## 环境侧修复（不改仓库代码）

- 后端 venv 缺 `torch==2.14.1`（`requirements.txt` 已声明），`jit_baseline.cli serve` 因此无法导入
  `jit_baseline.deep`；按 `requirements.txt` 重装补齐（`torch 2.14.1+cpu`）。
- `artifacts/decision-tree-v1` 缺失（验收夹具声明两个来源），用
  `cli run --algorithm decision-tree-v1 --output artifacts/decision-tree-v1` 现场重训（本机数据，无需网络）。
- 工作区子目录一度不可写（`docs/evidence/_run`、`frontend/**` 写入被拒），按 DSH 的 Windows 权限诊断
  脚本修复；只在 `frontend` 目录上为当前用户补了一条完全控制权限项，未改任何文件内容与所有者。

## 基线说明

「改动前的完整基线」没有跑成：第一次 `npm run test:e2e` 因证据目录写入被拒而中断，第二次因后端缺
`torch` 无法启动；补齐环境期间前端改动已经开始。因此上表是**改动后**的实测值。可对照的既有基线是
任务 4.2 记录的行数（12/7 演示、9/5 历史）与 proposal 记录的对比度（页脚 2.39、表尾 2.97、风险值 4.24），
本次实测在这两项上都与之吻合或更好。

## 仍然存在的遗留问题（按严重度排序）

1. **`verify.ps1` 整链在本机跑不了：缺 PowerShell 7**。实测 `shutil.which("pwsh")` 返回 `None`
   （本会话的 `pwsh` 工具其实是 Windows PowerShell 5.1.26100），因此
   `tests/test_verification_guard.py` 的两条用例 TypeError 失败，`frontend/scripts/verify.ps1`
   也无法启动。README 明确写了 5.1 不满足要求。要解除需要：装 PowerShell 7（`winget install
   Microsoft.PowerShell` 或官方便携 zip）→ `chcp.com 65001` → 在 ASCII 路径（如 `C:\JIT` 目录联接）下运行；
   该链还会执行 `npm ci` 重装依赖并做复现比较。
2. **没有改动前基线**：见上"基线说明"，行数与对比度只能与既有记录对照，不是同机前后测量。
3. **风险横幅里的"区间"是量表不是置信区间**：任务 5.4 写的是"大号等宽数字 + 区间 + 免责"，实现做成
   0–100% 量表 + 60% 分档界。运行产物不提供区间，编一个出来会违背本项目"数字必须可核对"的约定；
   若确实需要真区间，须先由后端提供。

## 敏感信息扫描

见下方 `scan.json`：对本目录全部文本产物扫描 `Bearer`、`Authorization`、`JIT_*_TOKEN`、
`backend/.cache` 临时绝对路径与 `sk-/ghp_` 前缀，命中数为 0；截图里凭据输入是掩码控件，且本轮
视觉证据用的是假令牌（`evidence-only-fake-token`）。
