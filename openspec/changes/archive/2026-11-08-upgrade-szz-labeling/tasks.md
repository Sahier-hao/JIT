# 任务

## 1. 完整 SZZ 实现

- [x] 1.1 `backend/jit_baseline/szz.py` 支持 `szz-full-v1`：issue/PR 关联优先、关键词兜底、回滚/重构/格式化/纯空白排除。
- [x] 1.2 issue 快照查询（标题、状态、标签、类型、URL、抓取时间），限时并在 403/429 后停止；无 token 或离线时记录降级。
- [x] 1.3 删除/修改行用 `git diff -M -C` + `git blame -M -C` 回溯，保存引入提交原始行号与父提交行号；完整模式支持删除文件。
- [x] 1.4 证据保存修复信号、issue 引用、issue 快照；`collection.fixSignals` 保存提交级信号。
- [x] 1.5 上限：单修复 50 段/2000 行、最多 2000 个修复提交、整次 120 秒；截断、未回溯与跳过分别计数。

## 2. 兼容与训练

- [x] 2.1 `collect()`/`collect_repository()` 默认 `szz-full-v1`；`--szz line` 与 `--szz simple` 保留。
- [x] 2.2 `suite.label_semantics` 与多项目训练识别 `szz-full`。
- [x] 2.3 旧 `szz-line-v1`/`szz-simple-v1` 数据集、模型、分析与指标不迁移、不覆盖。

## 3. 人工复核

- [x] 3.1 `szz-sample` 从数据集描述导出复核 CSV（verdict/note 留空），可补提交标题。
- [x] 3.2 文档说明复核流程，不自动改标签。

## 4. 标签质量读数

- [x] 4.1 数据集列表/详情投影返回 `label`、`szz` 与 `fixSignals`。
- [x] 4.2 详情展示规则、修复信号、issue 查询、修复提交、被标为引入、证据、未回溯、跳过（排除/空白/仅文档）、窗口外、成熟期与截断；缺失显示“—”。
- [x] 4.3 构建数据集说明与运行记录限制文案改为完整 SZZ，明确离线降级与仍非完美。

## 5. 测试

- [x] 5.1 合成仓库：行号回溯、文档/测试过滤、回滚、纯新增、重命名、删除文件、纯空白、issue 关联、重构排除。
- [x] 5.2 `test_szz.py`、`test_szz_full.py`、`test_collect.py`、`test_suite.py`、`test_multi_project.py`、`test_dataset_builds.py`、`test_catalog_storage.py` 通过。
- [x] 5.3 真实仓库冒烟：claude-scholar 窗口 177 条、14 个纳入正例、29 条唯一证据；修复信号 30 个关键词、23 个排除、86 个跳过文件、8 个仅文档；已登记并导入 `kamei14-git-v2-claude-scholar-full` 数据集，正例与证据数与目录库一致。
- [x] 5.4 前端类型检查通过；全量 49 个文件 / 373 个用例通过。
- [x] 5.5 数据集读数由组件测试覆盖（管理区需登录，未做浏览器截图验收）。

## 6. 文档与规格

- [x] 6.1 更新 `docs/当前产品.md`、`backend/README.md` 的规则、参数、离线降级与复核命令。
- [x] 6.2 更新 RCL-04/RCL-06 与 AWW-12 的完整 SZZ 要求。
