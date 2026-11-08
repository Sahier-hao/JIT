# 设计：完整 SZZ 与标签质量读数

## Context

采集管线原先用 `_History.file_last` 做文件级回溯，无法回答“哪一行被引入”。本变更先实现行级回溯，再补上完整 SZZ 的修复确认与噪声过滤：issue/PR 关联优先、关键词兜底，issue 元数据冻结为快照；排除回滚/合并/重构/格式化/纯空白/文档测试；支持删除文件；并提供人工抽样复核表。旧规则保留，新标签只用于新采集。

## Goals / Non-Goals

**Goals**

- 修复提交优先由 issue/PR 关联确认，关键词兜底；无网络时明确降级。
- 从删除/修改行回溯到引入提交，保留引入提交原始行号与父提交行号。
- 排除已知噪声（回滚、重构、格式化、纯空白、文档/测试、二进制）。
- 每个标签有可复核证据与信号来源；无法回溯、被过滤、降级、截断均如实计数。
- 提供 `szz-sample` 复核表；不自动替人下结论。

**Non-Goals**

- 不穷举所有 issue tracker、不处理跨仓库搬运、不自动判定人工结论。
- 不自动重训现有模型，不替换默认模型，不迁移旧数据集。
- 不改动特征口径（仍为提交级 Kamei 14 维）。

## Decisions

1. **修复信号**：`szz-full-v1` 优先识别 `fixes/closes/resolves #N` 与 GitHub issue/PR URL；有强引用时即使标题是 `update` 也视为修复，并用 issue 快照判断 `issue` 或 `issueRef`。无强引用时，标题关键词兜底；`revert/merge/chore/docs/style/format/refactor/test/build/ci` 不作为修复，`typo/whitespace/format/lint` 也不作为修复。`szz-line-v1` 仍只用标题关键词，保持兼容。
2. **issue 快照**：通过 `JIT_GITHUB_TOKEN` 查询 `/repos/{owner}/{repo}/issues/{n}`，保存标题、状态、标签、issue/PR 类型、URL 与抓取时间；限时 5 秒，403/429 后停止查询。快照进证据与 `collection.fixSignals`，不依赖未来 API 状态。
3. **行级回溯**：对唯一父提交做 `git diff --unified=0 -M -C`，只取 `-` 侧区间；`git blame --line-porcelain -M -C -L` 回溯，保留原始行号与父提交行号。完整模式包含删除文件；行级模式只含新增/修改/重命名，保持旧行为。
4. **噪声过滤**：完整模式先用 `git diff --quiet --ignore-all-space --ignore-blank-lines` 排除纯空白；再过滤文档、示例、测试、fixture、二进制与锁文件；被过滤数量分别计数。
5. **重命名与复制**：diff 与 blame 均启用 `-M -C`；证据保存当前路径与旧路径，合成仓库覆盖重命名场景。
6. **边界与上限**：单个修复最多 50 个行区间、2000 行；最多处理 2000 个修复提交；整次回溯最多 120 秒；超限置 `truncated`。单区间失败记 `unresolvedRanges`，不伪造引入提交。
7. **标签语义**：只有落在采集窗口内的引入提交标 1；窗口外引入单独计数；未命中为“未观测”，未成熟仍按 90 天判断。多修复/多文件/多区间分别保存证据。
8. **兼容与版本**：`szz-full-v1` 为新默认；`szz-line-v1` 与 `szz-simple-v1` 通过 `--szz` 保留。数据集记录 `label.kind`（`szz-full` / `szz-line` / `simplified-szz`）、规则版本、修复信号与查询统计。旧数据集不变。
9. **质量读数**：数据集投影增加 `label`、`szz` 与 `fixSignals`；详情展示规则、修复信号、issue 查询、修复提交、被标为引入、证据、未回溯、跳过（排除/空白/仅文档）、窗口外、成熟期、截断。缺失字段显示“—”，不补 0。
10. **人工复核**：`szz-sample` 从数据集描述导出 CSV，列为修复/引入提交、路径、行区间、信号来源、issue 引用、提交标题与空的 verdict/note；不写回标签，不改变模型。
11. **训练兼容**：`suite.label_semantics` 识别 `szz-full`；多项目训练接受三种标签种类，仍要求 Git 仓库采集。

## Risks / Trade-offs

- issue 查询依赖网络与 token；离线时只能关键词识别，误报仍存在，限制中披露。
- issue 标签/标题会随时间变化；已冻结快照，但可能和当前 issue 状态不同。
- 纯新增式修复不产生引入行，仍可能漏标；完整 SZZ 也不能保证召回。
- 排除重构/格式化可能误伤真实修复；通过信号统计与抽样复核发现，而不是静默。
- blame 与 issue 查询带来额外耗时；通过 120 秒、行数与修复数上限约束，并记录截断。
- 新标签改变“真值”，新模型指标不能与旧数据集直接比较；比较时必须注明规则版本。
