# JIT Commit Analysis（VS Code 扩展）

提交后在本地运行 JIT 提交检查：状态栏显示**提交级预测分数**，Problems 和侧栏标出**可疑代码行**；也可以从提交节点只读查看提交解释。扩展只读代码和报告，不修改源码、不自动提交、不访问网络执行远端内容。

## 提交后检查

1. 用 VS Code 打开 Git 仓库根目录，运行 `JIT: 配置提交后检查`。
2. 选择 Python、目录库和产物根目录后，从 QuickPick 中选择真实模型；候选来自 `pr-check-models`，只包含已启用、ready 且提交采集字段兼容的模型。
3. 之后每次提交，扩展对 `HEAD~1..HEAD` 运行 `pr-check-analyze`。达到阈值时状态栏标黄并提醒，不阻断提交。
4. 手动检查用 `JIT: 检查最近一次提交`；自动检查可用 `JIT: 开启/关闭提交后自动检查` 控制。
5. 独立换模型用 `JIT: 选择模型`。模型列表命令不可用时，扩展才回退到手工输入真实 `modelId`，不会编造或静默替换模型。

配置项：

- `jitCommitAnalysis.modelId`：真实已登记模型 ID。
- `jitCommitAnalysis.pythonPath`：默认使用后端 `.venv` 或系统 `python`。
- `jitCommitAnalysis.backendPath`、`databasePath`、`artifactRoot`：JIT 后端、目录库和模型产物目录。
- `jitCommitAnalysis.riskThreshold`：状态栏提醒阈值，默认 0.5。
- `jitCommitAnalysis.showCandidates`：是否把可疑代码行写入 Problems。

## 模型列表 CLI

```powershell
cd backend
.\.venv\Scripts\python.exe -m jit_baseline.cli pr-check-models `
  --database storage\catalog.sqlite3 `
  --artifact-root artifacts --json
```

当前本机目录库实测返回 13 个可用模型（kamei14-git-v2 10 个、kamei14-git-v1 3 个），未混入离线六字段或 2013 模型。

## 提交解释

`pr-check-analyze` 会为评分提交附带 `explanation`：

- `status=supported` 时包含 `method`、Top 特征贡献和中文摘要；
- 归因失败时为 `not-supported`，不改分数；
- 报告仍是 `jit-commit-analysis-v1`，旧报告可继续导入。

扩展从侧栏提交节点、通知和命令面板打开 `JIT: 查看提交解释`，使用只读虚拟 Markdown 文档展示提交 SHA、模型身份、提交级预测分数、中文摘要和 Top 特征贡献。报告文本只作数据展示，不注入 HTML 或执行命令。

## 构建与验证

```powershell
cd vscode-extension
npm install
npm test
npm run package
```

2026-11-28 实测：

- `npm test`：25 项通过。
- `npm run package`：生成 `jit-commit-analysis-0.4.0.vsix`，23 个文件、41.06 KB。
- 隔离扩展目录安装后 `--list-extensions --show-versions` 显示 `local.jit-commit-analysis@0.4.0`。
- 扩展宿主冒烟被本机 VS Code 安装目录 ACL 阻止，Electron 在加载扩展前退出；错误原文与复现命令见 `docs/审计/2026-11-28-ide-plugin-0.4.0.md`。未把该尝试记作宿主通过。

## 真实临时仓库实测

用两个提交的真实临时 Git 仓库，第二次提交引入 `eval` 与裸 `except`，运行：

```powershell
python -m jit_baseline.cli pr-check-analyze `
  --repo <temp-repo> --base <base> --head <head> `
  --model-id cbc89403-33a8-4643-90ab-40f9938e2dcd `
  --database storage\catalog.sqlite3 --artifact-root artifacts `
  --output report.json
```

实测模型为「逻辑回归 · kamei14-git-v2」，提交级预测分数 `0.1659685471`；解释为 `supported / occlusion-mean-v1`、5 条贡献；可疑代码行：

- `app.py:3` `py-eval-exec`，证据 `return eval(items)`
- `app.py:4` `py-bare-except`，证据 `except:`

原始摘要、报告和完整命令见 `docs/evidence/deliver-user-prediction-and-ide-workflows/`。

## 现场演示

1. 打开一个真实 Git 仓库，执行 `JIT: 选择模型`，确认 QuickPick 显示真实模型。
2. 修改一个有明确问题的文件并提交，不点「分析」，等待状态栏出现**提交级预测分数**。
3. 打开 Problems，指出可疑代码行的规则 ID、命中证据和说明，点击跳到文件和行号。
4. 在侧栏提交节点打开「查看提交解释」，核对 SHA、模型、分数、中文摘要和 Top 贡献。
5. 声明边界：分数是模型估计，不是已确认缺陷；解释是模型敏感度，不是缺陷原因；静态规则不是行级概率。

## 边界

- 合并提交不评分；首个提交没有父提交，无法计算历史特征。
- 工作树中已修改的文件不标旧报告行号。
- 自动检查只读本地 Git、目录库和模型产物，不访问网络。
- 提交解释只使用报告保存的归因；缺失时明确显示不可用。
