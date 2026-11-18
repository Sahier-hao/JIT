# Phase 0 工作树收口与工作区卫生验收（2026-11-19）

## 范围

- 收口 2026-11-17 未提交的用户数据、训练、模型与管理共享改动。
- 修复侧栏“项目”在用户自助工作区误高亮。
- 修复管理数据集详情在数据集/版本切换时残留旧状态。
- 清理误生成目录、缓存与运行垃圾，收紧 Git 准入。
- 在隔离环境中完成管理员共享开关的真实 UI/API 闭环。

## 实现

- `frontend/src/components/layout/navActive.ts`：项目导航高亮的纯函数；`AppShell` 改用该函数。
- `frontend/src/features/admin/AdminDatasetsPage.tsx`：详情组件以 `key={dataset:version}` 绑定地址，切换数据集/版本时重挂载。
- `backend/jit_baseline/user_api.py`：`_timestamps` 在目录库无记录时回退描述文件写入时间；`_manifest_integrity` 在无登记记录时计算描述文件 SHA-256。
- `.gitignore`：排除本机 `kamei14-git-v2-*/`、`kamei14-git-v1-cc-switch` 新版本、助手日志与图表工具产物。
- `backend/data/datasets/README.md`：说明冻结基线与本机批次缓存的提交边界。

## 隔离验收环境

- 目录库副本：`D:/tmp/jit-phase0-acceptance/catalog.sqlite3`（由 `sqlite3.Connection.backup` 生成，391,823,360 字节）。
- 后端：`127.0.0.1:8124`，`JIT_FRONTEND_PORT=4274`，`JIT_DATASET_ROOT` 指向真实只读数据集目录，`JIT_ARTIFACT_ROOT` 指向真实产物目录。
- 前端：`127.0.0.1:4274`，代理到 8124。
- 账户：管理员 `admin`、普通用户 `client`，密码只在副本中重置；真实目录库未修改。

## 验证

### API 闭环

| 步骤 | 结果 |
| --- | --- |
| 管理员登录 | 200，`authenticated=true` |
| 开启 `kamei14-git-v2-flask-...-9eb509da` 共享 | 200，`shared=true` |
| 普通用户共享列表 | 该版本出现 |
| 关闭共享 | 200，`shared=false` |
| 普通用户共享列表 | 该版本消失 |
| 开放用户自有版本 `...claude-scholar-...-a70244ae` | 409 `DATASET_OWNED` |

### 真实 UI（Playwright + msedge，8/8）

1. 管理员登录。
2. 共享开关初始为关闭。
3. 开启后显示“已共享”。
4. 刷新后仍为“已共享”。
5. 用户端“共享”标签出现该版本。
6. 关闭后显示“未共享”。
7. 用户端刷新后该版本消失。
8. 用户自有版本开关禁用并显示“用户自有版本不能开放共享。”

### 静态与回归

- 前端 `npm run typecheck`：通过。
- 前端 `npm run lint`：0 error，86 warning（既有 `react(set-state-in-effect)` 等提示，未新增 error）。
- 前端 `npm run check:styles`：通过。
- 前端 `npm run check:modules`：217 个源码文件、1 个应用入口，通过。
- 前端 `npm test`：63 个测试文件、473 个测试全部通过。
- 后端 `regression_scope.py --layer key`：329 passed, 1 deselected（295.29s）。
- 前端 `npm run build`：通过（`✓ built in 2.62s`）。
- `test_repository_updates.py::test_real_updates_remind_without_analyzing` 在并发负载下等待 `analysis-completed` 事件的 10 秒截止过短；单独运行通过。已把截止放宽到 30 秒后重跑 key 层。

## 空间回收

| 目录 | 处理前 | 处理后 |
| --- | --- | --- |
| `docs/evidence/_run/` | 2.0G | 47M |
| `backend/.cache/` | 22G | 1.7G |
| `temp/` | 19M | 6.9M |

保留：`backend/model-packages/`、`backend/storage/catalog.sqlite3`、`backend/data/datasets/` 全部已跟踪基线、`backend/.cache/repositories/`、`backend/.cache/deep/`、`.dsh-tmp/`（可能被其他会话使用）。

## 未覆盖

- 批次 `express`、`redis` 的 `NoneType < str` 排序错误未修复。
- 本批次 9 个版本因 SZZ 证据截断或切分无效不可训练。
- `.dsh-tmp/` 未清理。
