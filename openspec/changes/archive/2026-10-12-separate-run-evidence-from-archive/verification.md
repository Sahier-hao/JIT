# Apply 核验记录

日期：2026-10-12。Change：`separate-run-evidence-from-archive`，schema：`spec-driven`。

本轮从 9/14 项继续执行，完成剩余 5 项；最终为 14/14 项。运行期证据与归档证据分离、冻结工具及路径迁移的既有实现经本轮完整复验确认。补充了冻结命令的可复制示例与临时目标说明，并修复验证脚本提前失败时跳过结束哈希比对的分支。

## 最终完整验证

在项目根目录执行 `pwsh -NoProfile -File frontend/scripts/verify.ps1`，退出码 0。最终运行时间为 UTC `2026-10-12T14:01:21.5640293Z` 至 `2026-10-12T14:04:30.8362869Z`。全部 10 项检查退出码均为 0；命令、环境、依赖版本、源码哈希与耗时见 [verification.json](../../../../docs/evidence/separate-run-evidence-from-archive/verification.json)，原始输出见 [verification.log](../../../../docs/evidence/separate-run-evidence-from-archive/verification.log)。

| 检查 | 最终结果 |
| --- | --- |
| 后端 pytest（含 TCP 生命周期、冻结清单和验证脚本保护回归） | 84 passed |
| 固定产物核验 | 1,853 条记录，通过 |
| 独立复现比较 | 分区完全一致；风险及指标差值为 0 |
| npm 干净安装 | 退出码 0 |
| 前端类型检查 | 退出码 0 |
| 前端行为测试 | 69 passed |
| lint、构建 | 均退出码 0 |
| 两视口浏览器回归 | 42 passed，0 skipped / unexpected / flaky |
| OpenSpec 主规格严格校验 | 2 passed，0 failed |

两次完整验证均通过；上表对应包含新增保护回归测试的最终代码。较早一轮的记录保存在运行工作区的 `fixtures/initial-verification/`，不纳入冻结。

## 就绪与保护回归

后端就绪检查在真实本机 TCP 上覆盖空正文、不可解析正文之后转为就绪，以及始终不就绪时按端口报告超时。临时副本移除 JSON 解析异常重试后出现预期失败，当前代码 3 项通过，见 [readiness-red-green.json](../../../../docs/evidence/separate-run-evidence-from-archive/readiness-red-green.json)。临时副本未覆盖原测试文件。

浏览器上下文隔离用例执行 `npm run test:e2e -- historical.spec.ts --grep TCP产物行为夹具 --repeat-each=10 --reporter=line,json`，两个视口各重复 10 次，退出码 0，20 passed，0 skipped / unexpected / flaky。见 [browser-repeat.json](../../../../docs/evidence/separate-run-evidence-from-archive/browser-repeat.json) 与 [日志](../../../../docs/evidence/separate-run-evidence-from-archive/browser-repeat.log)。重复检查不替代最终全量 42 项回归。

新增 `backend/tests/test_verification_guard.py` 在临时项目中实际执行验证脚本，替换外部耗时检查，并在运行中新增、修改、删除受保护文件。原逻辑在前置检查失败时漏报差异（RED：1 failed / 1 passed）；将结束比对移入 `finally` 后两分支均通过（GREEN：2 passed）。失败检查的原因保存在 `failure` 字段，文件变化仍逐项报告。见 [guard-red-green.json](../../../../docs/evidence/separate-run-evidence-from-archive/guard-red-green.json)。测试不改真实归档文件。

初次受限执行环境阻止本机 socket，报 `WinError 10013`；中止该次运行后，在允许本机连接的执行环境重验。最终通过记录来自后者，不将受限环境中的超时当作产品缺陷或通过证据。现有 FastAPI/Starlette 弃用提示及终端颜色提示保留，不影响最终退出码。

## 历史证据与受保护位置

本轮开始时实际状态的 131 个受保护文件路径／SHA256 集合，与最终验证及临时冻结后的集合完全一致。验证脚本自身也记录 `protectedFileCount: 131`、`protectedFilesUnchanged: true`、空差异列表。

- `docs/evidence/build-desktop-review-workbench-prototype/`：28 个文件，前后完全一致。
- `docs/evidence/connect-public-data-baseline-review/`：79 个现存文件，前后完全一致。
- 主规格、已归档 change、OpenSpec 配置及前端静态数据均未在运行期间改变。

两个已废手工快照文件在本轮开始时已删除，属于 proposal/design D4 明确允许的既有删除；本轮未恢复、重写或再次删除其他历史证据。后端测试、前端 e2e、验证脚本与配置的输出路径审计未发现这两个历史 change 名。逐文件哈希及比对结果见 [archived-evidence-integrity.json](../../../../docs/evidence/separate-run-evidence-from-archive/archived-evidence-integrity.json)。

## 显式临时冻结

按 [后端操作说明](../../../../backend/README.md#验证证据的冻结) 执行 `freeze-evidence` 与 `check-evidence`，目标为真实临时目录 [冻结清单](../../../../backend/.cache/evidence-freeze-check-20261012T140507148762/冻结清单.json)。四次 CLI 调用（冻结、校验、重复冻结、再次校验）退出码均为 0。

快照纳入 37 个证据文件，全部路径及 SHA256 与冻结瞬间的运行工作区一致；`fixtures/` 未纳入。重复冻结的文件集合、哈希与来源运行标识一致，冻结时刻按执行更新。两次清单校验均 `passed: true`、空问题列表。冻结报告在快照检查后写回运行工作区，避免报告自身成为自引用输入。命令、退出码、原始 JSON 输出及快照核对结果见 [freeze-validation.json](../../../../docs/evidence/separate-run-evidence-from-archive/freeze-validation.json)、[freeze-report.json](../../../../docs/evidence/separate-run-evidence-from-archive/freeze-report.json) 与 [freeze-check.json](../../../../docs/evidence/separate-run-evidence-from-archive/freeze-check.json)。

冻结与检查由本轮显式命令触发；测试、构建和验证脚本没有自动冻结。未向已有历史归档目录写入证据，也未将本次临时快照作为正式归档。

## OpenSpec 状态

每个剩余任务在证据确认后单独勾选并刷新 apply instructions；最终返回 `state: all_done`、14 complete / 0 remaining。当前 change 严格校验通过，`git diff --check` 通过。本轮只执行 apply，未同步增量规格、未归档该 change、未提交或推送 Git。

## 归档衔接（2026-10-12）

用户已选择同步后归档。新增 [verification-evidence 主规格](../../../../openspec/specs/verification-evidence/spec.md)，Purpose 与增量规格一致，包含全部 6 条要求和 17 个场景；原有两份主规格未改，3 份主规格严格校验通过。

归档前已向本 change 的证据目录显式冻结 40 个证据文件，排除运行期夹具；清单校验通过。来源运行标识为 `22d06eed60a5e4b184fe92997e576dc648f47a6117ac05f86c6ecd7b580980bd`，冻结时刻为 UTC `2026-10-12T14:13:00.770993+00:00`。上述验证证据链接现指向冻结目录，避免后续运行工作区覆盖报告；apply 阶段的临时冻结记录仍为当时的操作历史。正式快照的路径、哈希与来源见 [冻结清单](../../../../docs/evidence/separate-run-evidence-from-archive/冻结清单.json)。
