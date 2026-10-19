# Design: 仓库工作区后端

## Context

`add-repository-sync-and-scoring` 已经让「填地址 → 采集 → 登记 → 打分」跑通，但一次同步就是一个作业，作业之间互不相识。前端重构要以仓库为入口，所以需要先把仓库做成可查询的实体，并补齐评审台要用的三样数据：**提交标题**、**分页查询**、**风险分布**。

现状（已确认）：

- `repository_sync` 21 列，含 `repository_url`、`branch`、`status`、`dataset_version`、`run_id`、`model_id`、`model_strategy`、`degrade_reason`、`train_records`、`train_positives`。
- `repository_commit` 有 `sync_id`、`commit_id`、`epoch`、`risk`、`added_lines`、`deleted_lines`、`files`、`features_json`、`label`、`label_note`，**没有提交标题与作者**。
- `SyncStorage.commits(sync_id, limit, offset)` 只支持按作业查询，`commits()` 的搜索是 `commit_id LIKE`。
- 采集器 `collect()` 的每条记录里有 `subject`（提交标题），但落库时被丢掉了。

## Goals / Non-Goals

**Goals**

- 仓库成为一等实体：一个地址一个仓库，多次同步归入同一仓库。
- 评审台所需的查询全部在服务端完成：分页、搜索（标识或标题）、排序、总数、风险分布。
- 提交标题入库并在列表与详情里返回。
- 对已有本地数据可平滑升级（回填 `repository_id`），不需要重新同步。

**Non-Goals**

- 不做多用户与「我的仓库」：系统没有账号体系，仓库列表是全部仓库。
- 不做增量同步、定时同步、webhook。
- 不做跨仓库合并视图。
- 不改打分逻辑与模型选择策略。

## Decisions

### D1 数据模型

新增 `repository` 表（迁移 `004_repository.sql`）：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `uuid5(NAMESPACE_URL, normalized_url)`，稳定且可重算 |
| `url` | TEXT UNIQUE | 规范化后的地址 |
| `display_name` | TEXT | 由地址末段派生，去 `.git` |
| `default_branch` | TEXT | 最近一次同步使用的分支 |
| `latest_sync_id` / `latest_sync_at` | TEXT | 最近一次作业（成功或失败） |
| `view_sync_id` | TEXT | 当前提交视图来自哪次**成功**作业 |
| `head_commit` | TEXT | 最近一次成功同步的 HEAD |
| `commit_count` / `high_count` / `medium_count` / `low_count` / `unknown_count` | INTEGER | 当前视图的统计 |
| `distribution_rule` | TEXT | `repo-distribution-v1` |
| `created_at` / `updated_at` | TEXT | |

`repository_sync` 增 `repository_id TEXT`（可空，回填后填充）；`repository_commit` 增 `subject TEXT`（可空，旧数据为空）。

索引：`repository(updated_at DESC)`、`repository_sync(repository_id, created_at DESC)`。

**为什么用 `view_sync_id` 而不是每次往仓库表里搬提交**：提交明细仍按作业存（`repository_commit`），仓库视图只是「指向某一次成功作业」。这样失败作业不会污染视图，历史作业也天然可查，不需要复制数据。

### D2 地址规范化

`normalize_repository_url(url)`：

1. 去掉首尾空白
2. 协议与主机转小写，路径保留原大小写
3. 去掉末尾 `/`，去掉末尾 `.git`
4. 保留 query 与 fragment 原样（本系统不使用，但不要悄悄丢弃）

例：`Https://GitHub.com/Foo/Bar.git/` → `https://github.com/Foo/Bar`。

### D3 仓库归属时机

- 创建同步时：`normalize` → 查 `repository` → 没有则插入 → 作业写入 `repository_id`，并更新 `repository.latest_sync_id`、`latest_sync_at`、`default_branch`。
- 作业成功（`scoring` 阶段写完提交）后：同一事务外，更新 `view_sync_id`、`head_commit`、四个计数与 `distribution_rule`。
- 作业失败：只更新 `latest_sync_id` / `latest_sync_at`，**不动** `view_sync_id` 与计数；仓库继续显示上一次成功的视图。

### D4 风险分布口径

常量 `DISTRIBUTION_RULE = "repo-distribution-v1"`：

- 高：`risk >= 0.25`
- 中：`0.10 <= risk < 0.25`
- 低：`risk < 0.10`
- 未知：`risk IS NULL`（不计入低）

分布与列表使用同一份 `risk` 值；口径字符串随响应返回，前端不得自行重算分段。

### D5 查询接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/repositories` | 列表，按 `updated_at DESC`，`limit` 1..100（默认 50） |
| GET | `/api/v1/repositories/{repository_id}` | 详情：视图作业、模型来源、降级原因、限制说明 |
| GET | `/api/v1/repositories/{repository_id}/commits` | `limit` 1..200、`offset`、`search`、`sort=risk\|time` |
| GET | `/api/v1/repositories/{repository_id}/commits/{commit_id}` | 单条提交与 14 个原始度量 |
| GET | `/api/v1/repositories/{repository_id}/summary` | 总数与四段分布 |

响应统一驼峰；错误沿用 `{"error": {code, message, requestId}}`。未知仓库返回 404 `REPOSITORY_UNKNOWN`；`sort` 非 `risk|time` 返回 422 `INPUT_INVALID`。

搜索在服务端执行：`commit_id LIKE ?` 或 `subject LIKE ?`，`%`/`_`/`\` 转义，大小写不敏感（SQLite `LIKE` 默认 ASCII 不敏感）。

### D6 回填

迁移只加列，不算哈希（SQL 里没有 sha256）。启动时 `SyncService.recover()` 先执行 `backfill_repositories()`：扫描 `repository_id IS NULL` 的作业，按 `repository_url` 规范化后建仓库并回填，最后为每个仓库重算 `view_sync_id` 与计数。幂等，重复执行无副作用。

### D7 权限

`team_access.MEMBER_PATHS` 增 `/api/v1/repositories`；`managed_path` 正则增 `/api/v1/repositories(?:/[^/]+(?:/commits(?:/[^/]+)?|/summary)?)?`。管理员路径不变。

## Risks / Trade-offs

- **同一地址不同分支互相覆盖视图**：后同步的分支会把 `view_sync_id` 指向自己，前一个分支的提交从仓库视图消失（作业仍在）。这是有意选择：仓库视图只保留一份「当前待审」。代价是多分支评审需要切作业。
- **`subject` 可能为空**：旧数据回填后标题为空，列表显示「未提供标题」。可接受。
- **回填在启动时执行**：大库会慢（几千条）。用单条 `UPDATE ... WHERE` 批量处理，预计 <1s；若超过阈值记日志。

## Migration Plan

1. 上线迁移 `004_repository.sql`（加列 + 建表 + 索引），`VERSION` 变 4。
2. 启动时回填仓库与视图指针。
3. 旧接口 `/api/v1/repository-syncs/*` 保留不变，前端可继续用；新接口并行提供。
4. 回滚：新表与新列可保留，旧代码忽略它们即可；不删数据。

## Open Questions

- 仓库列表是否需要「未读/已审」计数？当前审查清单在前端 localStorage，后端不知道谁审过，暂不提供。
- 分布阈值（0.25 / 0.10）是否要随模型校准调整？先固定为 `repo-distribution-v1`，后续若校准再升版本。
