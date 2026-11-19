# Phase 1 文档与入口边界收敛验收（2026-11-19）

## 范围

- 重建 README 与 docs 导航，收敛文档事实源。
- 精简 `docs/当前产品.md`，修复重复段落与死链，抽离运维、离线研究细节。
- 合并审计目录、删除空模板、补充证据提交规则。
- 新增入口与端点四层清单、文档相对链接检查脚本。

## 变更

- `README.md`：一页入口，补齐默认采集口径、迁移 41、本地启动、文档导航与验证命令。
- `docs/当前产品.md`：19,996 字节（原 50,333）；删除重复的 `#/admin/models` 段落；修复四处未归档 change 死链。
- `docs/运维与升级.md`：备份、迁移、回退、模型重建、管理员密码与数据保护。
- `docs/离线与研究.md`：提交解释、`pr-check-*`、`line-train`、研究预览与 VS Code 扩展。
- `docs/架构/入口与端点分层清单.md`：四层入口、后端端点、兼容别名与退役条件。
- `docs/README.md`、`docs/evidence/README.md`：文档索引与证据提交规则。
- `docs/审计/`：接收原 `docs/audits/` 两个文件；删除 `docs/audits/` 与两个空模板。
- `backend/scripts/check_docs_links.py`：标准库链接检查，默认覆盖当前文档，`--include-evidence` 可全量检查。
- 修复 `docs/产品需求文档.md`、`docs/全局错误码表.md`、`docs/团队分工.md`、`docs/缺陷记录.md` 中的相对路径。

## 验证

- `PYTHONIOENCODING=utf-8 backend/.venv/Scripts/python.exe backend/scripts/check_docs_links.py`：通过（0 死链）。
- 后端 `regression_scope.py --layer key`：329 passed, 1 deselected（333.51s）。
- 前端 `typecheck`、`lint`、`check:styles`、`check:modules`：通过。
- 前端 `test`：63 个文件、473 个测试全部通过；`build`：通过。
- `userWorkspace.test.tsx` 的构建进度深链用例在并发负载下先找到对话框、后到达任务列表，同步断言会偶发失败；改为等待“取消任务”按钮出现后重跑。

## 边界

- 历史审计、冻结证据与汇报材料中的当时路径保持不变；默认链接检查排除这些目录，避免把历史记录当作当前导航。
- 未删除任何仍被测试、规格或离线脚本依赖的路由与端点；兼容别名的退役条件写入清单。
- 不改变运行期代码、数据库、模型包或数据集。
