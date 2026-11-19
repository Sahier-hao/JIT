# Proposal

## Why

2026-11-17 的用户数据工作区与管理端共享改动一直停留在未提交工作树，真实管理员共享开关没有完成一次可复核的 UI 闭环；同时侧栏“项目”在“我的数据 / 我的训练 / 我的模型 / 个人中心”等路由上误高亮，管理数据集详情在两个版本之间切换时仍停留在旧版本。工作树还混入本机新采集的大体积数据集、误生成目录和 20G 级缓存，使 `git status` 与交付基线不再可信。

## What Changes

- 收口 2026-11-17 的用户数据、训练、模型与管理共享改动，保留全部产品行为。
- 修正侧栏“项目”高亮范围：只在项目与审查相关路由高亮，用户自助工作区不误亮。
- 修正管理数据集详情在数据集/版本切换时的重挂载，确保开关与元数据始终对应当前地址。
- 在隔离目录库与独立端口上完成管理员共享开关的真实 UI 闭环：开启/撤销、用户端出现/隐藏、自有版本拒绝、刷新保持。
- 补充数据集时间事实与完整性字段的降级规则：目录库未导入描述文件时，登记时间取描述文件写入时间，清单哈希按描述文件内容计算。
- 清理误生成目录、一次性缓存与运行垃圾，收紧 `.gitignore`，并记录批次 `20261117-135630-79116af6` 的真实可用性。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `user-data-workspace`: 增加管理员显式共享白名单、用户自有版本禁止共享，以及数据版本时间事实与完整性字段的返回规则。
- `interface-presentation`: 增加侧栏导航唯一活动项与用户自助工作区不误亮“项目”的呈现要求。

## Impact

- 影响 `frontend/src/components/layout/AppShell.tsx`、`frontend/src/features/admin/AdminDatasetsPage.tsx`、`frontend/src/features/datasets/pages/MyDataPage.tsx`、`backend/jit_baseline/user_api.py` 与 `backend/jit_baseline/catalog_storage.py`。
- 影响前端单测、后端 key 回归与一次隔离浏览器验收；不新增运行时依赖，不改变既有 URL、错误码结构、模型身份或数据库迁移。
- 工作树卫生涉及 `.gitignore`、`backend/data/datasets/README.md` 与 `docs/计划/2026-11-19-四阶段架构收敛台账.md`，不影响运行期依赖。
