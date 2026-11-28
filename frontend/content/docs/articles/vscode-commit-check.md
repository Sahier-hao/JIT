VS Code 扩展在本地仓库提交后运行 JIT 提交分析，状态栏显示提交级预测分数，Problems 与侧栏显示可疑代码行和规则证据。完整配置以 [IDE 插件页面](#/plugins/vscode) 为准，本页说明操作路径和边界，避免维护两套配置步骤。

## 安装前提 {#install}

- VS Code 已安装，能打开 Git 仓库根目录。
- 本机有可运行 JIT CLI 的 Python。默认可使用后端 `.venv`，或系统 `python`。
- 能访问真实目录库和模型产物目录。
- 已安装项目提供的 VSIX。安装后在扩展列表中确认名称与版本，再重新加载窗口。

扩展不会修改源码、自动提交或评论 PR。它只读本地 Git、目录库、模型和报告。

## 配置提交后检查 {#configure}

1. 打开目标 Git 仓库，命令面板运行 `JIT: 配置提交后检查`。
2. 选择 Python、目录库和产物根目录。
3. 在模型 QuickPick 中选择真实模型。候选来自 `pr-check-models`，只包含已启用、ready 且提交采集字段兼容的模型。
4. 保存设置。
5. 用 `JIT: 开启/关闭提交后自动检查` 控制是否在提交后自动运行。

配置项包括 `jitCommitAnalysis.modelId`、`pythonPath`、`backendPath`、`databasePath`、`artifactRoot`、`riskThreshold` 和 `showCandidates`。

```json
{
  "jitCommitAnalysis.modelId": "<真实已登记模型 ID>",
  "jitCommitAnalysis.pythonPath": "backend/.venv/Scripts/python.exe",
  "jitCommitAnalysis.databasePath": "backend/storage/catalog.sqlite3",
  "jitCommitAnalysis.artifactRoot": "backend/artifacts",
  "jitCommitAnalysis.riskThreshold": 0.5,
  "jitCommitAnalysis.showCandidates": true
}
```

模型列表命令不可用时，扩展才回退到手工输入真实 `modelId`。它不会编造模型，也不会静默换成别的模型。模型为空时回浏览器训练并登记，或请管理员开放兼容模型。

## 提交后会发生什么 {#commit-check}

自动检查开启时，每次提交会对 `HEAD~1..HEAD` 运行 `pr-check-analyze`。分析使用明确的 base、head 和固定模型：

- 状态栏显示提交级预测分数。
- 分数达到提醒阈值时状态栏标黄，不阻止提交。
- `showCandidates` 开启时，可疑代码行写入 Problems 并标到对应行号。
- 报告同时保存提交身份、模型身份、覆盖和解释。

合并提交没有可用的单父范围，首个提交没有父提交，因此不会被当作普通提交检查。工作树中尚未提交的修改也不会被标成旧报告行号。

## 从哪里看分数和代码候选 {#where-to-look}

| 位置 | 内容 |
| --- | --- |
| 状态栏 | 最近一次提交的提交级预测分数和提醒状态 |
| Problems | 规则候选的路径、行号、规则 ID、证据和说明 |
| 扩展侧栏 | 提交节点、报告身份和候选入口 |
| `JIT: 查看提交解释` | 只读 SHA、模型、分数、中文摘要和 Top 特征贡献 |

点击代码候选会跳到文件和行号。报告中的路径与文本按不可信数据处理，不执行报告中的命令。分数是模型估计，不是已确认缺陷；行级候选是静态规则结果，不是逐行概率。

## 手动检查 {#manual-check}

- 运行 `JIT: 检查最近一次提交` 可手动检查当前 `HEAD~1..HEAD`。
- 运行 `JIT: 选择模型` 可单独换模型；新检查仍记录真实模型身份。
- 运行 `JIT: 复制报告生成命令` 只复制 CLI 命令，不执行命令。

扩展宿主或模型不可用时，先在普通终端运行 `pr-check-models` 或 `pr-check-analyze` 核对环境。插件页面提供当前命令与验证结果。

## 提交后检查与报告导入的区别 {#report-import}

| 方式 | 输入 | 用途 |
| --- | --- | --- |
| 提交后检查 | 本地真实 Git base/head、目录库和模型 | 对新提交实际采集、推理并生成报告 |
| 导入已有报告 | 已生成的 `jit-commit-analysis-v1` 报告 | 只读查看，核对仓库和提交身份 |

导入时会核对报告仓库、提交和当前 HEAD。身份不一致或行号已过期时拒绝定位，不会把旧报告行号贴到新代码。

## 常见失败 {#failures}

- **模型列表为空**：检查目录库、artifact 根目录和模型兼容性。
- **CLI 找不到**：核对 Python、后端路径和当前工作目录。
- **扩展未加载**：确认 VSIX 已安装并重新加载窗口。
- **报告导入被拒绝**：报告不属于当前仓库或 HEAD，重新生成报告。
- **模型解释不可用**：报告中的归因状态不是 `supported`；分数仍保留。

更多安装和命令细节见[IDE 插件页面](#/plugins/vscode)与[常见问题](#/docs/faq?section=empty-models)。
