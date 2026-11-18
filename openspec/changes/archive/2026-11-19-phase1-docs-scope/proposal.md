# Proposal

## Why

产品文档已经出现多头维护：`docs/当前产品.md` 超过 50 KB，`#/admin/models` 段落逐字重复，文末指向未归档 OpenSpec 路径的死链；根目录 README 仍描述旧入口与旧采集口径；`docs/audits/` 与 `docs/审计/` 并存；两个空模板文件、缺失的文档索引与证据提交规则让维护者难以判断哪份是事实来源。同时仓库没有入口、端点与兼容别名的分层清单，无法区分核心项目审查、用户自助建模、管理员维护与离线研究四层边界。

## What Changes

- 重写根目录 `README.md` 为一页入口：默认入口、默认采集口径、迁移版本、本地启动与文档导航。
- 把 `docs/当前产品.md` 精简到 20 KB 以内并消除重复段落；修复全部指向未归档 change 的死链。
- 将本机升级、备份、回退、模型重建与故障处置抽离到 `docs/运维与升级.md`。
- 把离线报告、行级研究与 VS Code 扩展细节抽离到 `docs/离线与研究.md`。
- 将 `docs/audits/` 两个文件并入 `docs/审计/` 并删除旧目录；删除两个空模板；更新代码与文档引用。
- 新增 `docs/README.md` 文档索引与 `docs/evidence/README.md` 证据提交规则。
- 新增 `backend/scripts/check_docs_links.py`，校验 README、AGENTS 与当前 docs 的相对链接。
- 新增 `docs/架构/入口与端点分层清单.md`，按四层归类现有页面入口、后端端点与兼容别名，并记录退役条件。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- 无。本变更只调整文档组织与校验工具，不改变任何外部可观察的产品行为、路由或 API 契约。

## Impact

- 影响 README、docs 目录结构与若干文档链接；不修改运行期代码、数据库、模型包或数据集。
- 新增一个 Python 文档检查脚本，无第三方依赖。
- 历史审计与冻结证据中的当时代码路径保持不变，不作为当前文档死链处理；当前文档检查范围与例外在 `docs/README.md` 和脚本中说明。
