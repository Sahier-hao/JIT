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

## 预算复测与完整版本

两个版本首次重跑都在 `JIT_SZZ_MAX_SECONDS` 默认 120 秒处截断（`budgetHits.seconds=1`），带 `LABEL_EVIDENCE_TRUNCATED`，在 `temporal-70-15-15 + mature-only` 下不可训练。用 `JIT_SZZ_MAX_SECONDS=900` 在临时目录复测：

| 仓库 | 用时 | 结果 | 正例 |
| --- | --- | --- | --- |
| express | 253 秒 | 完整（`truncated=false`） | 808 |
| redis | 928 秒 | 仍在预算处截断 | 412 |

随后分别单独重采并登记：

- express，`JIT_SZZ_MAX_SECONDS=600`：新版本 `kamei14-git-v2-express-2009-06-26_2026-11-02-9c7d9ef4`，纳入 5,485 行、808 正例，成熟准入通过；批次 `20261119-041857-865ac6ef`。
- redis，`JIT_SZZ_MAX_SECONDS=3600`：新版本 `kamei14-git-v2-redis-2022-01-01_2026-10-30-a535fe6a`，纳入 2,514 行、570 正例，SZZ 完整（`truncated=false`），成熟准入通过；用时 19 分 29 秒；批次 `20261119-054021-4db7a53b`。
- 两个原截断版本（express 406 正例、redis 40 正例）在完整版本登记后复核：无分析、模型或构建引用，无所有者、未共享，随后删除。

目录库 `dataset_record` 94，描述文件 129，`model_version` 30、`dataset_share` 0 未变。

## 截断版本清理

删除前重新检查 `dataset_references`、所有者与共享状态（均为空），并对目录库做一致性备份 `D:/tmp/catalog-backup-20261119-delete.sqlite3`。通过 `store.delete_dataset_version` 移除两个版本的登记、提交记录、文件与描述文件；描述文件、CSV 与两个旁车文件先复制到 `D:/tmp/deleted-datasets-20261119/<version>/` 作为可恢复副本，原文件随后移除，`fileErrors` 为空。

删除时发现 `delete_dataset_version` 原先不删除描述文件，清理后会留下仍在登记目录里的 JSON；已补上 `manifestPath` 并新增回归测试，管理端 prune 路径同步受益。

清理后两个完整版本仍通过成熟准入：express 测试集 817 行/78 正例，redis 测试集 352 行/68 正例。

## 仍未解决

- 默认 `JIT_SZZ_MAX_SECONDS=120` 对长历史仓库仍会截断；本次通过单次环境变量覆盖完成重采，是否调整默认值或按仓库配置仍需单独决定。
