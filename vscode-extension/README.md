# JIT Commit Analysis（VS Code 只读扩展）

只读消费 `pr-check-analyze` 生成的 `jit-commit-analysis-v1` 报告：核对仓库提交身份，展示提交风险、静态候选与修复建议，并跳转到对应文件行。不修改源码、不执行报告内容、不发起网络请求。

## 构建

```bash
cd vscode-extension
npm install
npm run compile
npm test            # 解析、身份核对与行号边界测试
npm run package     # 生成 jit-commit-analysis-<version>.vsix
```

## 安装与使用

1. 生成报告：

```bash
cd backend
./.venv/Scripts/python.exe -m jit_baseline.cli pr-check-analyze \
  --repo ../ --base <base-sha> --head <head-sha> --model-id <已登记模型 ID> \
  --database <目录库> --artifact-root <模型产物根目录> \
  --output ../report.json --markdown ../report.md
```

2. 安装扩展：`code --install-extension vscode-extension/jit-commit-analysis-0.1.0.vsix --force`
   （开发调试也可在 VS Code 打开 `vscode-extension/` 后按 F5 启动扩展宿主。）
3. 用 VS Code 打开被分析仓库的根目录，在资源管理器「JIT 提交分析」视图点击「JIT: 导入提交分析报告」，选择 `report.json`。
4. 点提交或候选条目跳转到文件；报告目标提交与当前 `HEAD` 不一致时只读展示并拒绝定位。

## 验证范围

- `npm test`：报告格式、路径越界拒绝、身份 match/stale/unknown、行号边界。
- 扩展宿主冒烟：`node scripts/smoke.js`（需本机安装 VS Code，可设 `JIT_VSCODE_EXE`）实际加载并激活扩展，确认 5 个命令注册并执行只读命令。
- 未做：报告在真实大型仓库中的逐条跳转巡览；导入过期报告后文件内容变化的完整人工旅程。
