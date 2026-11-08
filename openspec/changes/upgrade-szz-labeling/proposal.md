# 升级缺陷引入标签为完整 SZZ

## Why

后续要推进到代码行级的缺陷预测，标签必须能追到“引入缺陷的具体行”，只到提交级的文件回溯不够。同时，完整 SZZ 还需要用 issue/PR 关联确认修复、排除重构/格式化/纯空白/文档测试等噪声，并留下可人工复核的证据。当前默认的 `szz-simple-v1` 只有文件级最近变更，无法支撑这两点。

## What Changes

- 新增 `szz-full-v1` 并设为仓库采集默认规则：修复提交优先用 issue/PR 关联确认，关键词兜底；删除/修改行用 `git blame -M -C` 回溯到引入提交。
- issue 元数据以采集时快照写入证据（标题、状态、标签、issue/PR 类型、抓取时间）；离线或无 token 时退化为关键词识别并如实记录。
- 排除回滚、合并、重构、格式化、纯空白、文档/测试与二进制路径；支持删除文件的行级回溯。
- 证据保存修复提交、引入提交、路径、引入提交原始行号区间、父提交行区间、修复信号、issue 引用与 issue 快照。
- 新增 `szz-sample`：从数据集描述导出人工复核表（verdict/note 留空），复核结论不自动改标签。
- 数据集详情新增标签与 SZZ 读数：修复信号分布、issue 查询结果、修复提交、被标为引入、证据、未回溯、跳过、窗口外、成熟期与截断。
- 保留 `--szz line`（行级兼容）与 `--szz simple`（文件级兼容）；旧数据集与旧模型不迁移、不覆盖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `repository-collection`：RCL-04 支持完整 SZZ 的 issue 关联、噪声过滤、行号证据与降级记录；RCL-06 按实际规则披露标签、issue 快照与限制。
- `admin-training-workspace`：数据集详情展示标签质量、修复信号、issue 查询与跳过原因，不能只显示规则名称。

## Impact

- 后端：新增/扩展 `backend/jit_baseline/szz.py`；`collect.py`、`cli.py`、`store.py`、`suite.py`、`multi_project.py`；`szz-sample` 命令。
- 前端：数据集详情、构建数据集说明、运行记录限制文案。
- 数据：新采集默认生成 `szz-full` 数据集；旧 `szz-line-v1`/`szz-simple-v1` 数据集、模型、分析与指标保持不变。
- 训练：新标签需要重新训练才能进入模型；本次不自动重训、不替换默认模型。
- 网络：完整模式在配置 `JIT_GITHUB_TOKEN` 时查询 issue/PR；无 token 或查询失败时降级，不阻断采集。
