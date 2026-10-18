# Proposal

## Why

课程要求的第一模块是「数据采集与仓库解析（Git 仓库克隆与解析、缺陷识别、SZZ 算法实现、数据持久化）」，Kamei 14 维特征也应从真实仓库的变更中计算。当前系统完全依赖发布者预先算好的 CSV：特征和标签都是别人给的，`lt`、`rexp` 两个字段因「固定快照不含」被标为不可得。补上仓库采集链路后，系统才能对任意真实仓库产出训练数据与预测输入，也才能回答「这个提交的 14 维是怎么来的」。

## What Changes

- 新增 `backend/jit_baseline/collect.py`：读取本地或公开 Git 仓库，遍历提交，计算 Kamei 14 维代码变更度量，生成简化 SZZ 标签，产出可登记的数据集。
- 新增具名 schema `kamei14-git-v1`：14 个字段全部入模，`lt` 与 `rexp` 由仓库历史计算，不再标为不可得。
- 新增 CLI `collect` 子命令，支持 `--repo`、`--since`、`--until`、`--limit`、`--output`。
- 采集产物复用现有 `register-dataset` / `import-dataset` / 训练链路，不新增存储表，不修改既有表结构。
- 同步三处文档边界，撤销「不自建 Git 采集」的旧决定：`docs/产品需求文档.md` §5.2／§5.4、`docs/团队分工.md` 的数据来源行、`docs/产品设计文档.md` §5.3。

**BREAKING**：无。既有数据集、运行、模型与接口行为不变；`kamei14-v1` 保持 12 维可用状态，新 schema 与它并存。

## Capabilities

### New Capabilities

- `repository-collection`: 从 Git 仓库采集提交数据、计算 Kamei 14 维特征、生成简化 SZZ 标签，并产出可登记数据集的能力。

### Modified Capabilities

- `public-data-baseline`: PDB-01 的数据来源从「固定公开文件」扩展到「仓库采集产出的派生数据集」；PDB-02 的标签规则增加 SZZ 规则，并明确采集来源下 14 维的可用性。

## Impact

- 新增 `backend/jit_baseline/collect.py`、`backend/tests/test_collect.py`
- 修改 `backend/jit_baseline/schemas.py`（新增 `kamei14-git-v1`）、`backend/jit_baseline/cli.py`（新增 `collect` 子命令）
- 修改 `docs/产品需求文档.md`、`docs/团队分工.md`、`docs/产品设计文档.md`
- 依赖：调用系统 `git`，不新增 Python 包
- 验证：用 ActiveMQ 近三年提交跑通采集 → 登记 → 训练一个经典方法
