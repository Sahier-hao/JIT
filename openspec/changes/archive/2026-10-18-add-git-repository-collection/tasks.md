# Tasks — 从 Git 仓库采集提交并派生数据集

## 1. schema 注册

- [x] 1.1 在 `backend/jit_baseline/schemas.py` 增加 `kamei14-git-v1`：14 字段全部 `in_model=True`、`status=VERIFIED`，`source` 等于字段名，计数类字段 `integer=True` 并沿用 `log1p` 变换
- [x] 1.2 补 `backend/tests/test_schemas.py`：新 schema 字段数/入模数/变换/无 unavailable，且 `openstack-six-v1`、`kamei14-v1` 的既有断言不变

## 2. 仓库访问与提交遍历

- [x] 2.1 新建 `backend/jit_baseline/collect.py`：`_run(cwd, args)` 子进程封装，固定 `--no-pager`、`core.quotepath=false`，非零退出抛 `BaselineError('REPOSITORY_UNAVAILABLE', ...)`
- [x] 2.2 实现 `_entries(repo, branch)`：一次 `git log --reverse --no-merges --numstat` 解析提交标识、作者、作者时间、文件变更；`collect` 汇总排除计数（合并提交、空提交、范围外、无法解析）
- [x] 2.3 实现远程来源：`_repository` 对 HTTP(S) 来源 `git clone --bare --filter=blob:none` 到临时目录，采集后删除；克隆失败给出可重试原因，不产出半成品

## 3. 特征计算

- [x] 3.1 建立单遍历史索引 `_History`：文件最近变更、文件历史作者集合、文件变更次数、作者提交序列、目录作者集合
- [x] 3.2 按 design D3 计算 14 字段：`ns/nd/nf/entropy/la/ld/lt/fix/ndev/age/nuc/exp/rexp/sexp`，二进制文件行数记 0 并计入 `counts.binaryFiles`
- [x] 3.3 `lt` 用父提交版本统计行数（新增文件为 0）；缺父提交时记 0 并在产物标注
- [x] 3.4 字段无法计算时按 design 记 0 并在 `collection` 的计数中标注（`counts.binaryFiles`、`counts.excluded`），不静默跳过、不填占位值

## 4. 简化 SZZ 标签

- [x] 4.1 识别修复提交：提交消息正则（design D4，规则版本 `szz-simple-v1`）且至少一个文件变更
- [x] 4.2 回溯：对每个被修复文件取其此前最近一次变更提交标为 1；无回溯对象时跳过并计数
- [x] 4.3 标签 0 时记录「未观测到缺陷引入」说明；规则版本与正则写入产物

## 5. 产物、CLI 与登记

- [x] 5.1 写出 CSV：列 = `commit_id`、`author_date` + 14 字段，行序按作者时间
- [x] 5.2 复用 `datasets.build_manifest` 生成描述文件，新增 `collection` 段（仓库标识、HEAD、分支、范围、git 版本、排除计数、规则版本、两条限制）
- [x] 5.3 `backend/jit_baseline/cli.py` 增加 `collect-repository` 子命令（design D7 参数），失败退出码 1
- [x] 5.4 `--register` 采集后直接登记；同范围重跑幂等、内容不同报 `DATASET_EXISTS`

## 6. 集成与验证

- [x] 6.1 单元测试：`backend/tests/test_collect.py` 用临时 git 仓库覆盖遍历、排除计数、14 字段口径、SZZ 回溯、二进制文件
- [x] 6.2 真实仓库冒烟：对 ActiveMQ 近 3 年范围采集一次，记录提交数、耗时与产物校验值
- [x] 6.3 端到端：登记 + `import-dataset` + 用 `kamei14-git-v1` 跑一次 `run`，确认能出模型指标
- [x] 6.4 文档：`backend/README.md` 采集章节、`docs/团队分工.md` 的 C 项补「仓库采集已落地」、数据集目录说明
- [x] 6.5 全量回归：`.venv\Scripts\python.exe -m pytest -q tests --basetemp tests/.tmp` 全绿，`openspec validate add-git-repository-collection --strict` 通过
