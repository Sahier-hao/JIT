# 任务

## 1. 行级样本导出

- [x] 1.1 新增 `backend/jit_baseline/line_dataset.py`：从 `labelEvidence` 提取正例行，读取 CSV 获取提交级特征与负例提交。
- [x] 1.2 从 `label=0` 提交解析新增行并抽样负例，固定种子、按比例、去重；过滤文档/测试/二进制路径。
- [x] 1.3 输出 `line-szz-v1` JSONL 与 `.summary.json`，记录缺失行、跳过原因、截断。
- [x] 1.4 CLI `line-dataset --manifest --repo --output --negatives-per-positive --context --seed`。

## 2. 测试与验证

- [x] 2.1 合成仓库：正例行内容与行号正确，负例来自未标缺陷提交的新增行，正负不重叠，种子可复现。
- [x] 2.2 缺行、仓库不可读、CSV 缺失时明确失败或记录，不输出伪造样本。
- [x] 2.3 在 `kamei14-git-v2-claude-scholar-full` 上导出真实样本，核对正例数、负例数、文件与摘要。

## 3. 文档与规格

- [x] 3.1 新增 RCL-25，规定正负例来源、去重、特征、摘要与不写回。
- [x] 3.2 更新 `backend/README.md` 的命令与输出说明。
