# 设计

## Context

当前目录库只有 `admin_account` / `admin_session`；数据集登记在 `dataset_record`，训练任务在 `training_task`，模型在 `model_version`，都没有所有者。管理路由通过 `admin.protected` 统一要求管理员会话；项目分析、数据集构建和 PR 预览是公开路径。

## Goals / Non-Goals

- Goal：用户能注册登录、看到自己的数据集、预览切分、训练多方法实验、登记自己的模型并在自己的项目里使用。
- Goal：服务端强制归属校验，用户之间不可见、不可操作对方的数据与模型。
- Goal：保留管理员全局维护、默认模型和验证边界；旧数据默认共享。
- Non-Goal：任意 CSV 上传、用户互相共享数据集、项目归属隔离（留待后续）。

## Decisions

### D1 账户与会话独立于管理员

新增 `user_account` / `user_session`，cookie 名 `jit_user_session`，PBKDF2 加盐、8 小时、HttpOnly/SameSite=Strict，退出撤销。管理员与用户身份分别解析；需要二者之一的接口显式取 `user_or_admin`，不把管理员会话当作普通用户。

### D2 归属用列和关联表，空表示共享

`dataset_owner(dataset_version, username)` 记录用户对数据集版本的可见所有权；`training_experiment.owner_user_id`、`training_task.owner_user_id`、`dataset_build_task.owner_user_id`、`model_version.owner_user_id` 记录其余归属。空值表示全局共享，旧记录迁移后继续可用。数据集版本可能被多个用户拥有，因此用关联表而不是单列。

### D3 用户 API 与管理员 API 分离

新增 `/api/user/*`（会话）与 `/api/v1/user/*`（数据、训练、模型）。管理员原有 `/api/v1/training-*`、`/api/v1/datasets` 保持管理员保护；用户接口在服务端按 cookie 解析用户，并按归属过滤。项目构建数据集、项目模型选择、PR 预览候选等公开入口在存在用户会话时附带用户身份。

### D4 训练复用现有执行链

用户实验复用 `TrainingTaskService`、`TrainingExecutor`、参数契约、历史、比较与显式登记；只新增所有者参数和配额。用户任务仍进同一单 worker 队列，超时 30 分钟。模型登记走现有 `promote_experiments`，传入所有者。

### D5 配额在服务端

同一用户同时最多一个活动实验（任一子任务排队/运行），一次最多四个方法，每人最多五个数据版本，参数额外限制（epochs≤50、树数≤300、max_iter≤3000）。用户不能设默认模型或停用全局模型。

### D6 候选分析前移到只读预览

候选来自快照共享事实，预览页可对 Python 文件直接分析并展示建议，不需要工作单。确认/驳回/暂缓/加入问题/结论写入个人草稿；首次写操作时创建当前快照的工作单。

## Migration Plan

迁移 034：新建 `user_account`、`user_session`、`dataset_owner`；为训练实验/任务、数据集构建任务、模型版本增加 `owner_user_id` 列与索引。前向增量，旧记录为空即共享；`catalog-init` 先备份再迁移。
