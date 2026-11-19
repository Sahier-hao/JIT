# 采集批次失败复核与重跑（2026-11-19）

## 现象

批次 `20261117-135630-79116af6` 中 `expressjs/express`（index 10）与 `redis/redis`（index 12）在 2026-11-17 以 `TypeError: '<' not supported between instances of 'NoneType' and 'str'` 失败，`errorCode=UNEXPECTED`，未产生数据集版本。批次其余 13 个仓库正常完成。

## 根因

失败发生在 SZZ 证据汇总：`commit_evidence` 对 `(引入提交, 路径, 旧路径)` 三元组直接 `sorted(pairs.items())`。文件重命名时旧路径可能为空，元组比较在“引入提交与路径相同、旧路径一边缺失”时退化为 `None < str`。该排序当时没有显式键。

当前实现已改为显式键，旧路径缺失按空串排序，并抽出 `_evidence_order`、新增回归测试 `tests/test_szz_evidence_order.py` 防止再次退化。

## 复核

- 直接对本地缓存裸克隆执行 `express` 完整采集：5,701 条记录，无异常。
- 完整登记路径（`register=True` + 独立数据集目录与临时目录库）：成功生成描述文件。
- 因此 2026-11-17 的失败属于旧排序实现，当前代码不再复现。

## 重跑

重跑前对目录库做 SQLite 一致性备份（`D:/tmp/catalog-backup-20261119-retry.sqlite3`，`integrity_check=ok`）。执行：

```bash
backend/.venv/Scripts/python.exe -m jit_baseline.cli collect-batch --batch 20261117-135630-79116af6 --retry-failed
```

结果（批次 15/15 completed）：

| 数据集 | 纳入行 | 正例 | 原始行 |
| --- | --- | --- | --- |
| `kamei14-git-v2-express-2009-06-26_2026-11-02` | 5,485 | 406 | 5,485 |
| `kamei14-git-v2-redis-2022-01-01_2026-10-30` | 2,514 | 40 | 2,514 |

目录库 `dataset_record` 92 → 94；描述文件 127 → 129；`model_version` 30、`dataset_share` 0、`dataset_owner` 2 不变。

## 预算复测与 express 完整版本

两个版本首次重跑都在 `JIT_SZZ_MAX_SECONDS` 默认 120 秒处截断（`budgetHits.seconds=1`），带 `LABEL_EVIDENCE_TRUNCATED`，在 `temporal-70-15-15 + mature-only` 下不可训练。用 `JIT_SZZ_MAX_SECONDS=900` 在临时目录复测：

| 仓库 | 用时 | 结果 | 正例 |
| --- | --- | --- | --- |
| express | 253 秒 | 完整（`truncated=false`） | 808 |
| redis | 928 秒 | 仍在预算处截断 | 412 |

随后以 `JIT_SZZ_MAX_SECONDS=600` 单独重采 express 并登记：

- 新版本 `kamei14-git-v2-express-2009-06-26_2026-11-02-9c7d9ef4`，纳入 5,485 行、808 正例；
- 成熟准入（`temporal-70-15-15 + mature-only`）通过，可用于训练；
- 原截断版本 `kamei14-git-v2-express-2009-06-26_2026-11-02`（406 正例）保留在登记表中，无分析、模型或构建引用，未删除；
- `20261119-041857-865ac6ef` 批次只有这 1 个任务。

## 仍未解决

`redis` 完整 SZZ 超过 900 秒预算，仍未完成；当前版本 `kamei14-git-v2-redis-2022-01-01_2026-10-30` 带 `LABEL_EVIDENCE_TRUNCATED`，不可训练。需要单独用更高预算（例如 2400 秒）离线重采，或在 SZZ 回溯上做性能优化。未通过降低成熟期标准让截断版本进入训练。
