# Proposal

## Why

只提供提交分数与分析记录，无法让评审者接手一项真实改动。用户需要从公开 GitHub 仓库或 PR 进入工作单，先看到作者目标、固定代码版本和真实变更，再决定如何审查。

## What Changes

- 增加仓库 PR 发现、直接 PR 接入与历史复盘，失败保留输入和恢复路径。
- 保存不可变的基准与目标版本、文件 Diff 和提交来源；按文件读取固定版本上下文。
- 我的审查成为默认入口，项目分析和管理员维护保留原入口。
- 提交级模型线索由用户主动生成，使用真实登记模型并绑定准确 PR HEAD；模型不可用不阻断人工阅读。

## Capabilities

### New Capabilities

- `public-pull-request-review`: 公开来源发现、固定版本与文件阅读、独立的辅助模型线索。

### Modified Capabilities

- `focused-project-review`: 普通导航以我的审查为起点，项目分析与历史书签继续可用。

## Impact

新增公开 PR 来源 API、迁移 012 的来源缓存和分析关联、我的审查与工作单界面。复用现有分析队列及模型准入。个人草稿不进入来源数据库；GitHub 限额与无法展示的内容明确显示。验收见 `docs/审计/2026-10-27-pr-review-journey.md`。
