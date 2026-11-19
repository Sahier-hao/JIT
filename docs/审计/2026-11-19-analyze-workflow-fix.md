# Commit analysis 工作流修复（2026-11-19）

## 现象

四个重构 PR 的 `key` 回归通过，但 `Commit analysis report`（analyze）全部失败，报错为固定模型包中的多个 `jit-current-v2-pooled-*` 模型导入失败：

```text
ARTIFACT_INVALID：数据集描述文件校验不匹配
```

`main` 上最近一次提交（PR #65 合并后）同样失败，说明不是本轮重构引入。

## 根因

1. 工作流先执行 `catalog-init --skip-bundled-models`，这仍会导入仓库内置的当前 schema 模型包。
2. 该包的模型声明了 `datasetManifest` 路径与文件字节的 SHA-256；包在本机 Windows 工作树（CRLF）构建，而 CI 在 Linux 检出同一描述文件为 LF，字节哈希不一致，模型导入失败。
3. 工作流真正使用的固定分析模型由下一步 `import-models` 单独导入，包内模型没有 `datasetManifest` 声明，与本问题无关。

## 修复

在 `.github/workflows/commit-analysis.yml` 的 `catalog-init` 增加 `--skip-current-schema-models`，只保留固定分析模型，避免导入与工作流目标无关的当前 schema 包：

```text
python -m jit_baseline.cli catalog-init --skip-bundled-models --skip-current-schema-models
```

该修改提交为 `8616467`，并已合并到 Phase 1、Phase 2、Phase 3 分支，使每个 PR 的 analyze 使用同一修复。

## 本地验证

使用与工作流一致的隔离目录库与产物目录：

```text
python -m jit_baseline.cli catalog-init --skip-bundled-models --skip-current-schema-models \
  --database D:/tmp/jit-analyze/run/catalog.sqlite3 --artifact-root D:/tmp/jit-analyze/run/artifacts
python -m jit_baseline.cli import-models D:/tmp/jit-analyze/model-package.zip \
  --database D:/tmp/jit-analyze/run/catalog.sqlite3 --artifact-root D:/tmp/jit-analyze/run/artifacts
python -m jit_baseline.cli pr-check-analyze --repo .. --base <base> --head <head> \
  --model-id 0aecf9d0-e33d-45c2-83e0-cc7a593a5c16 \
  --database D:/tmp/jit-analyze/run/catalog.sqlite3 --artifact-root D:/tmp/jit-analyze/run/artifacts \
  --output D:/tmp/jit-analyze/run/commit-analysis.json \
  --markdown D:/tmp/jit-analyze/run/commit-analysis.md
```

结果：固定包 1 个模型注册成功，模型 ID 与仓库变量 `JIT_MODEL_ID` 一致；分析输出 `jit-commit-analysis-v1`，退出码 0。

## 边界

- 该修复不改变模型包、数据集描述文件或分析口径，只让 CI 不导入无关包。
- 当前 schema 包在其他 Linux 场景下的描述文件哈希问题仍存在，需在重建包或统一换行后另行处理。
- PR #66 的 analyze 已通过；其余 PR 的 analyze 随分支合并后重新运行。
