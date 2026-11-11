# 多仓库真实数据批处理（2026-11-11）

本记录只写实际执行、命令与产物事实。采集运行在隔离批次目录与数据集目录中进行，未覆盖任何旧版本。

## 一、批处理实现

新增 `jit_baseline/batch_collection.py` 与 `collect-batch` 命令：

- 任务清单 JSON：`repo`、`branch`、`since`、`until`、`limit`、`szz`、`dataset`、`language`。
- 内容身份：仓库（小写、去尾斜杠）、分支、时间窗、上限、SZZ 版本与数据集名；同一清单返回同一批次。
- 状态持久化：每仓库 `pending/collecting/completed/failed/cancelled`、尝试次数、起止时间、错误码与消息、数据集版本与质量统计；每次变化原子写盘（`.tmp` + `os.replace`）。
- 恢复：再次运行只继续未完成项；`--retry-failed` 只重试失败项；`--cancel` 只把未开始项标为取消，已运行仓库完成。
- 采集与标签仍由既有 `collect.collect_repository` / SZZ 生成，不写第二套算法。

测试 `tests/test_batch_collection.py` 8 项：清单幂等、阶段落盘、失败隔离、重试只跑失败项、`max_repos` 中断后恢复、取消幂等、运行间取消检查、重复任务与未知批次拒绝。

## 二、真实采集结果

第一轮六个仓库（Windows 本机、Git 2.53、离线缓存优先），批次 `20261110-173702-20a77012`：

| 数据集 | 记录（纳入） | 正例 |
| --- | --- | --- |
| `kamei14-git-v2-flask` | 3831 | 327 |
| `kamei14-git-v2-pydantic` | 5905 | 170 |
| `kamei14-git-v2-httpx` | 1480 | 111 |
| `kamei14-git-v2-axios` | 2068 | 222 |
| `kamei14-git-v2-cc-switch-farion` | 3556 | 173 |
| `kamei14-git-v2-vite` | 9815 | 239 |

耗时 706 秒。所有仓库达到本轮“≥1000 提交、≥80 正例”。

### 发现：SZZ 时间预算与修复提交上限会截断证据

检查采集描述文件发现：默认 `JIT_SZZ_MAX_SECONDS=120`、`MAX_FIX_COMMITS=2000`，超限时只处理按时间最早的修复提交，`truncated=true` 被如实记录。后果是正例集中在早期历史：例如 vite 的 1983 个正例全部止于 2023-04，时间切分的测试段没有任何正例，无法做时间外评价。

处理：

- `MAX_FIX_COMMITS` 改为可用 `JIT_SZZ_MAX_FIX_COMMITS` 覆盖（默认仍 2000，保持既有行为）。
- 用 `until=2026-08-01`（预留 90 天成熟期）与更高的预算重采：`JIT_SZZ_MAX_SECONDS=7200`、`JIT_SZZ_MAX_FIX_COMMITS=20000`。
- 旧数据集与旧版本不覆盖，新版本另立。

重采中间结果（成熟窗口，第一轮）：

| 数据集 | 记录 | 正例 | 证据截断 |
| --- | --- | --- | --- |
| `flask-mature` | 3817 | 410 | 否 |
| `pydantic-mature` | 5596 | 1303 | 是（修复提交 1161，上限 2000 前的历史窗） |
| `httpx-mature` | 1480 | 111 | 否（缓存 HEAD 2026-02-23） |
| `axios-mature` | 1944 | 510 | 是 |
| `cc-switch-farion-mature` | 2217 | 846 | 是 |
| `vite-mature` | 9449 | 1983 | 是（修复提交恰好 2000） |

第二轮以更高修复提交上限重采 pydantic、axios、cc-switch、vite（`*-mature-v2`）。其中 vite 的历史与
修复提交规模较大，回溯在本地预算内未完成，改为同一 JS/TS 语言组的 `expressjs/express`：

- `kamei14-git-v2-express-mature`：纳入 5,673、正例 806，修复提交 951，未截断；时间切分
  3,821 / 819 / 817，测试段 76 个正例。

因此本轮 JS/TS 三个仓库为 axios、cc-switch、express；vite 的完整标签版本保留为未完成项，
不使用截断标签的 vite 版本参与时间外评价。

## 三、恢复与取消

- 真实批次重复执行：同一清单再次运行直接返回原批次，六个仓库全部 `completed`，没有重复采集（`--batch` 路径）。
- 单元测试覆盖进程中断（`max_repos=1` 后继续）、单仓库注入失败后其他仓库完成、失败项重试、取消后未开始项不执行。

## 四、证据抽样

命令行 `szz-sample` 从数据集描述的 `labelEvidence` 抽取跨仓库样本，各 10 条：

- `docs/evidence/szz-samples/flask.csv`、`pydantic.csv`（Python）
- `docs/evidence/szz-samples/axios.csv`、`vite.csv`（JS/TS）

共 40 条，字段含修复提交、候选引入提交、路径、引入/父提交行区间、修复时间、修复信号与 issue 编号。
这是自动提取的可核对样本，不是人工金标准；结论由人工复核填写，复核前不改写标签。

自动一致性检查（只核对对象存在、修复提交确实改到该路径、引入提交包含该文件）：

| 仓库 | 样本 | 通过 |
| --- | --- | --- |
| flask | 10 | 10 |
| pydantic | 10 | 10 |
| axios | 10 | 10 |
| vite | 10 | 7 |

vite 的 3 条未通过：修复提交确实改到该路径，但引入提交不包含该文件（路径在该提交时不存在）。
它们需要人工核对引入提交或路径映射，不能直接当作成立的行级证据。

## 五、边界

- 不做跨平台声明：只在本机 Windows + Python 3.14 运行。
- 成熟期以采集时固定的 `until=2026-08-01` 表达，描述文件同时记录 `observedThrough` 与 `maturityDays=90`。
- issue 元数据离线时退化为关键词识别，`issueLookup.unavailable=1` 在描述文件中如实记录。
- 未对采集数据做人工金标准复核；`szz-sample` 抽查另记。
