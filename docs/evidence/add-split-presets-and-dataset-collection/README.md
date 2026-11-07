# 切分预设、数据集构建与趋势分区证据

本目录冻结 `add-split-presets-and-dataset-collection` 的可复核行为：三个时间切分预设、训练运行谱系、只构建数据集的独立任务，以及项目风险趋势中受来源约束的分区标注。原始仓库、数据库、模型二进制和运行期夹具不进入证据目录。

## 实现边界

- 注册 `temporal-70-15-15`、`temporal-80-10-10`、`temporal-60-20-20` 三个时间预设；未提交预设的既有调用继续使用 `temporal-70-15-15`。
- 同一时间戳的提交只进入一个分区；训练、验证、测试成员摘要和时区写入训练任务及运行身份。
- 管理员预览接口只读取数据集并返回边界、计数、正例数、时区和不可用原因，不创建任务、运行或模型。
- 数据集构建任务独立于项目分析，复用公开仓库采集、Kamei 14 维特征、简化 SZZ、登记和幂等版本流程；成功后只返回数据集版本，不训练、不评分、不修改项目当前结果。
- 趋势图只在所选模型由当前项目数据训练且切分谱系完整时显示 train、validation、test 和近期未训练提交；外部模型显示无本项目切分，旧模型或冲突来源显示未知。
- 前端通过文字图例、等价表格和提交下钻共同表达分区，不依赖颜色，也不改变风险分。

## 验证

- 后端全量：766 通过，1 跳过，0 失败，0 错误。
- 前端单元：48 个文件、364 项通过。
- 前端 typecheck：通过。
- 前端 lint：退出码 0，保留既有警告。
- 前端生产构建：通过；Vite 仅报告既有大 chunk 警告。
- 默认 Playwright：19 通过，3 跳过，0 失败。
- 专用数据集/趋势 Playwright：1 通过，1 跳过，0 失败。
- OpenSpec 严格校验：通过。
- `git diff --check`：通过。

## 截图

- `screenshots/dataset-build-complete-1280.png`：大型公开仓库数据构建完成，展示数据集版本和显式后续入口。
- `screenshots/trend-partitions-1280.png`：同项目训练模型的三档分区、近期未训练区间和文字图例。
- `screenshots/trend-partitions-merged-1280.png`：合并固定分析来源后的分区与来源核对。
- `screenshots/trend-external-1280.png`：外部预训练模型不显示当前项目分区。
- `screenshots/trend-legacy-unknown-1280.png`：缺少切分谱系的旧模型显示分区未知。

`browser-results.json` 与 `unit-results.json` 是本次默认 Playwright 和前端单元测试的机器可读结果。冻结清单由 `freeze-evidence` 在最后一步生成，记录文件 SHA-256、冻结时刻和来源运行标识。
