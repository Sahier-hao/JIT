# Tasks

## 1. 单一事实源

- [x] 1.1 重写根目录 `README.md`：默认入口 `#/`、`#/login`，默认采集 `kamei14-git-v2` + `szz-full-v1` + 成熟度协议，迁移 41，本地启动与文档导航。
- [x] 1.2 精简 `docs/当前产品.md` 到 20,000 字节以内，删除重复的 `#/admin/models` 段落，修复四处未归档 change 死链。
- [x] 1.3 新增 `docs/运维与升级.md`，承接备份、迁移、回退、模型重建密码重置与数据保护命令。
- [x] 1.4 新增 `docs/离线与研究.md`，承接提交解释、PR 检查报告、行级研究与 VS Code 扩展细节。

## 2. 目录整理

- [x] 2.1 将 `docs/audits/` 两个文件并入 `docs/审计/`，删除 `docs/audits/`，更新 `backend/README.md` 与相关产品文档引用。
- [x] 2.2 删除两个空模板 `docs/产品设计文档（模板）.md`、`docs/产品需求文档（模板） .md`，改写产品需求/设计文档中的模板说明。
- [x] 2.3 新增 `docs/README.md` 文档索引，覆盖产品、架构、运行、审计、证据与归档。
- [x] 2.4 新增 `docs/evidence/README.md`，约定冻结证据与运行工作区，明确不再提交原始运行日志和大体积中间产物。

## 3. 入口与端点分层

- [x] 3.1 新增 `docs/架构/入口与端点分层清单.md`，按核心项目与 PR 审查、用户自助建模、管理员维护、离线研究四层归类页面入口与后端端点。
- [x] 3.2 记录 `#/repositories`、`#/connect`、`#/plan`、`#/legacy/sync`、`#/reports` 等兼容别名及其替代入口、依赖与退役条件。
- [x] 3.3 记录 `/api/review-batch`、`/api/v1/commits`、`/api/v1/predictions` 等历史端点保留原因；本阶段不删除仍被测试或规格依赖的入口。

## 4. 链接自检

- [x] 4.1 新增 `backend/scripts/check_docs_links.py`，只用标准库扫描 README、AGENTS 与当前 docs 的相对链接。
- [x] 4.2 默认排除冻结证据、汇报材料与历史审计/计划，支持 `--include-evidence` 全量检查。
- [x] 4.3 修复当前文档中的 11 处死链，检查脚本通过。

## 5. 验证与交付

- [x] 5.1 `python backend/scripts/check_docs_links.py` 通过（0 死链）。
- [x] 5.2 后端 `regression_scope.py --layer key` 通过（329 passed, 1 deselected）。
- [x] 5.3 前端 `typecheck`、`lint`、`check:styles`、`check:modules`、`test`（473 passed）、`build` 通过。
- [ ] 5.4 提交到 `refactor/phase1-docs-scope` 分支并创建 PR。
- [ ] 5.5 归档本 change。

## Workflow follow-up

- 下一次路由重构时按清单中的退役条件删除已完成书签迁移的兼容别名。
- 把 `check_docs_links.py` 接入持续回归的 key 层。
