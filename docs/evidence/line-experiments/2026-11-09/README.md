# 行级实验证据（2026-11-09）

本目录保存固定实验计划的实际运行报告与可移植 manifest；原始 JSONL 不入版本库。

## 文件

- `E1…E8`：跨仓库/语言实验；`E8b`、`E8c` 为同一仓库内切分的另外两个种子。
- `A1…A4`：提交特征、行位置、文本特征与仓库平衡的消融。
- `*.manifest.json`：每个报告的输入哈希/行数/采样摘要、切分成员 SHA-256、特征与模型配置、环境与复现命令。
- `*.log`：命令的原始输出，失败时保留错误。

## 获取同一份数据

数据由 `line-dataset` 从对应仓库真实提交导出：

```bash
python -m jit_baseline.cli line-dataset <dataset-manifest.json> \
  --negative-mode same-file --negatives-per-positive 1 --seed 42 \
  --output <repo>.jsonl
```

`cc-switch-same`、`JIT-same`、`claude-scholar-same`、`sub2api-same` 使用同一模式；`axios`、`pydantic`、`flask`、`httpx` 为对应仓库导出。复现前核对 manifest 中每个输入的 `sha256` 与 `rows`；不一致说明数据版本或导出参数不同，不能与报告数字直接比较。

## 复现一条实验

```bash
python -m jit_baseline.cli line-train \
  --input <cc-switch-same.jsonl> --input <JIT-same.jsonl> --input <axios.jsonl> \
  --test-repo axios --language typescript --language javascript \
  --output report.json
```

报告与 `report.manifest.json` 会一并生成。定位指标是抽样负例下的代理值，不能当作实际审查收益。
