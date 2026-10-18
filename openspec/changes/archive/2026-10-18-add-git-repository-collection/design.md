# Design — 从 Git 仓库采集提交并派生数据集

## Context

当前后端只消费发布者导出的固定 CSV：`data/openstack/openstack.csv` 有 41 列提交级聚合，其中 6 列进入 `openstack-six-v1` 训练，12 列构成 `kamei14-v1` 但 `lt`、`rexp` 不可得（`backend/jit_baseline/schemas.py:68-86`）。数据登记、提交级持久化、分页查询、持久化提交预测已完成。系统没有任何 Git 访问能力：`backend/jit_baseline/` 下无仓库解析模块，`requirements.txt` 无 Git 库依赖，`backend/data/` 只有 CSV 与 R 脚本。

课程要求把「Git 仓库克隆与解析、缺陷识别、SZZ 算法、数据持久化」列为首要模块，并建议基于 Apache 项目验证。仓库里没有可提交的数据集，缺的是从真实仓库生成 Kamei 特征与标签的采集链路。

## Goals

- 能从本地或远程 Git 仓库采集指定时间范围的提交，产出与具名 schema 对齐的表格与数据集描述文件，走现有登记入口。
- 14 维 Kamei 特征在采集来源下全部可算，`lt` 与 `rexp` 不再标记不可得。
- 标签由简化 SZZ 自动生成，规则可版本化、可复核。
- 采集证据（仓库、HEAD、范围、git 版本、排除计数）随产物记录。
- 规模上能在普通开发机处理 ActiveMQ 量级仓库的 3 年范围，单次采集可重跑。

## Non-Goals

- 不实现完整 SZZ（不处理重命名、跨文件传播、issue 追踪系统关联）。
- 不做文件级样本：产物与既有 CSV 一样是提交级聚合，14 个度量在提交内跨文件聚合。
- 不引入 Git 托管平台 API（GitHub/GitLab issue、PR 关联），只用仓库自身历史。
- 不改表结构、不改预测接口、不改已有 schema 的字段语义。
- 不做增量持续采集（首版一次性全量范围）。

## Decisions

### D1 用 git CLI 子进程，不引入 GitPython

采集器通过 `git -C <path>` 子进程调用 `log`、`show`、`cat-file`，解析机器可读格式（`--format` 与 `--numstat`）。理由：GitPython 需要额外依赖且仍是包装 git 二进制；直接调用可用 `--no-pager`、`-c core.quotepath=false` 固定输出，错误信息原样上报。远程来源先 `git clone --bare --no-tags` 到临时目录，采集完删除；本地路径只读不改。

> 实施修正（2026-10-18）：最初用 `--filter=blob:none` 部分克隆，实测 `--numstat` 需要 blob 内容计算增删行，会触发 promisor fetch，在受限网络下直接失败（`could not fetch ... from promisor remote`）。改为完整 `--bare` 克隆：代价是首次克隆更慢，换取采集不再依赖二次网络请求。

### D2 提交遍历与排除

一次 `git log --reverse --no-merges --numstat --format=%H%x00%P%x00%an%x00%ae%x00%aI` 拿全量。排除规则显式且计数：合并提交（`--no-merges`）、无文件变更的提交、时间范围外、无法解析的提交。提交时间用作者时间（带时区），分区与 `age` 都按它算。

### D3 14 维口径（提交级）

| 字段 | 口径 | 无历史时 |
| --- | --- | --- |
| ns | 变更文件涉及的一级目录去重数（无目录的文件计入根） | 0 |
| nd | 变更文件所在目录全路径去重数 | 0 |
| nf | 变更文件数（新增/修改/删除都算） | ≥0 |
| entropy | 各文件变更行数占比的香农熵 | 0 |
| la | 新增行数合计（二进制文件记 0 并计数） | 0 |
| ld | 删除行数合计（同上） | 0 |
| lt | 变更前各文件行数合计（`git show <parent>:<path>` 统计；新增文件为 0） | 0 |
| fix | 提交消息命中修复关键词则为 1，否则 0（规则版本随产物） | 0 |
| ndev | 变更文件此前出现过的作者去重数（取合计，跨文件求和） | 0 |
| age | 变更文件上次变更距本提交的天数（多文件取平均） | 0 |
| nuc | 变更文件此前变更次数合计 | 0 |
| exp | 作者在本仓库此前的提交数 | 0 |
| rexp | 作者近 90 天内的提交数 | 0 |
| sexp | 作者在变更涉及的一级目录此前的提交数（多目录求和） | 0 |

`entropy` 用 `ent` 作为输出列名会与既有 `fields` 命名冲突，schema 里字段名用 `entropy`、来源列用 `entropy`（`kamei14-v1` 用 `entropy`/`ent` 也是这个原因）。所有计数为整数，`age` 为浮点天数。

### D4 简化 SZZ 标签

修复提交识别：提交消息匹配 `(?i)\b(fix|fixes|fixed|bug|defect|issue)\b` 且变更至少一个文件（规则版本 `szz-simple-v1`，正则与阈值写进产物）。回溯：对每个被修复文件，取该文件在修复提交之前的最近一次变更提交（`git log -1 --format=%H <fix>^ -- <path>`），将其标为缺陷引入；找不到则跳过并计数。标签规则写入 `commit_record.label_rule`（复用现有列，值 `szz-simple-v1`），未命中记 0 并在产物 `labelNote` 说明「未观测到缺陷引入，不等于已证实无缺陷」。

### D5 产物与登记

采集输出两件：CSV（列 = `commit_id`、`author_date`（epoch 秒）、`bugcount`（标签 0/1）+ 14 字段）和描述文件（`data/datasets/<dataset>/<version>.json`）。复用现有登记链路需要两处向后兼容的扩展：`data.parse_source` 增加可选 `cohort` 参数（现有实现硬编码 `config.COHORT` 的 OpenStack 时间窗，采集数据会被整批 `outsideWindow` 排除），`datasets.build_manifest`/`register` 增加 `cohort` 与 `provenance` 参数（现有实现硬编码 OpenStack 的发布者、revision、URL 与引用）。默认值保持原样，旧数据集与旧运行不受影响。质量统计沿用 `parse_source` 的 5 类排除计数，仓库证据写入描述文件的 `collection` 段。

### D6 新 schema `kamei14-git-v1`

14 字段全部 `in_model=True`、`status=VERIFIED`：`ns,nd,nf,entropy,la,ld,lt,fix,ndev,age,nuc,exp,rexp,sexp`。与 `kamei14-v1` 的差异只在 `lt`、`rexp` 由仓库历史计算，且 `source` 列名等于字段名。既有 `kamei14-v1`、`openstack-six-v1` 不变，`SCHEMAS` 增加一项，不影响旧运行。

### D7 CLI 与参数

新增 `python -m jit_baseline.cli collect-repository`：`--repo <路径或 URL>`、`--since`、`--until`、`--branch`（默认 HEAD）、`--limit`（安全上限，超过即拒绝而非截断）、`--dataset`（默认由仓库名派生）、`--output`（CSV 路径）、`--register`（采集后直接登记）。采集失败退出码 1，错误走 `BaselineError` 既有错误体。

### D8 规模与性能

ActiveMQ 3 年约 6,000–15,000 提交、数十万文件变更。单遍遍历 + 内存索引（文件→历史变更列表、作者→提交列表、目录→作者集合）即可；`git show` 只在算 `lt` 时对变更文件逐个取父版本，用 `--batch` 或按需 `cat-file` 降低进程数。首版允许分钟级，不引入并行；超过 5 万提交时提示缩范围而不是静默截断。

### D9 限制披露

产物与运行声明必须带两条：特征为提交级聚合（与论文文件级样本不同）、标签为简化 SZZ。`backend/README.md`、数据集描述文件 `limitations`、以及 `datasets.register` 的 `collection` 段都写。

## Migration Plan

1. 新增 schema 与字段定义（纯增，无迁移）。
2. 新增采集模块与 CLI（新文件，不碰既有路径）。
3. 真实采集一个范围，登记成数据集，`import-dataset` 入库，用 `kamei14-git-v1` 跑一次 `run` 验证端到端。
4. 文档：README 采集章节、`docs/团队分工.md` 的 C 项、数据集目录 README。

## Risks

- **特征与论文口径不完全一致**：提交级聚合、`age`/`ndev` 的跨文件求和是项目选择，必须在产物里写明，否则会被当成 Kamei 原表。
- **SZZ 精度**：简化规则会把「修 bug 顺带改格式」和「回滚」误标，样本噪声高；标签规则版本化后可在后续替换。
- **仓库规模**：超大仓库（Linux 内核）的单遍遍历会超时，首版用 ActiveMQ 级验证。
- **克隆依赖网络**：远程来源失败要给出可重试原因，不能落半成品产物。
