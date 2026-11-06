# expose-project-datasets 证据

本目录记录项目成功分析的数据集只读摘要与两种导出格式的最终验证结果。

## 功能范围

- 项目页从当前成功分支分析打开“数据来源”，显示绑定版本、时间范围、样本与正例数、
  schema、CSV 哈希、标签规则和限制。
- 服务端只接受项目和同步分析身份，并从成功分析记录解析 `datasetVersion`；不开放全局
  数据集枚举，也不接受客户端指定其他版本或文件路径。
- ZIP 包包含 CSV、manifest 和 `SHA256SUMS`，作为完整性核对的权威副本。
- XLSX 包含数据与元数据工作表，作为便于查看的派生副本。
- 缺失文件、哈希不符、失败分析、跨项目分析和超出导出上限都会明确失败，不生成部分下载。

## 验证

`verification/frontend-vitest.json` 是最终前端单元测试报告，46 个测试文件、358 项全部通过。
`verification/browser-results.json` 是最终默认 Playwright 报告，17 项通过、1 项按项目配置跳过、
0 项意外失败。项目数据集用例覆盖打开摘要、核对接口数据、下载 ZIP/XLSX、错误重试、键盘操作、
切换分析后清理旧内容及各视口无横向溢出。

`verification/backend-tests.txt` 记录后端全量回归：741 项通过、1 项因真实源码数据集未配置而跳过。
`verification/checks.json` 汇总 typecheck、lint、build、OpenSpec strict 和 Git diff 检查结果。

## 截图

- `screenshots/project-dataset-1280.png`
- `screenshots/project-dataset-1440.png`
- `screenshots/project-dataset-390.png`

截图来自最终浏览器回归的真实本地测试项目。数据摘要中的 SHA-256 和版本直接来自服务端响应，
不使用示例数据替代不可用版本。

## 回归修正

浏览器回归发现：后续分析复用已登记数据结构时，服务端曾错误地要求 manifest 的原始
`sourceSyncId` 等于当前 `syncId`，导致 409。最终实现改为通过成功分析绑定的
`datasetVersion` 解析数据集，并增加复用同一版本的回归测试；原始来源仍保留在摘要中供追溯。

在合并最新 `main` 的视觉层后，最终浏览器回归又发现窄屏项目页会被不可断行的仓库绝对路径撑宽。
页头、项目路径和结果操作区已改为可收缩并允许路径换行；最终 390px 视口无横向溢出。
