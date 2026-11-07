# 系统重复与模式混淆审查（2026-11-08）

## 范围与方法

- 前端：全部页面、组件、客户端、路由与样式；后端：`backend/jit_baseline` 的路由与服务层。
- 三路只读审查（前端工作流、前端实现重复、后端接口面）汇总后，对关键结论逐条回到代码或运行中的服务核对。
- 本文只收录能指到具体文件/行或可用请求复现的结论；审查代理提出但经核对不成立的条目列在「误报与已排除」。
- 本次审查不修改产品行为，不替代 OpenSpec 变更。

## 结论摘要

- 用户可见的重复入口/模式混淆：**8 处**（2 处高、4 处中、2 处低）。
- 数据正确性/边界：**2 处需要处理**（1 中、1 低）。
- 前端实现重复：手写取数文件 28 个 vs react-query 生产文件 5 个；10 处 `setInterval`；8 处请求 `/repository-models`；69 处路由对象字面量；4 份错误码文案；8 套分页；23 处 `quiet-empty`。
- 后端接口重叠：模型卡 2 条返回路径、数据集 2 套序列化、产物 2 套枚举、任务引擎 3 套生命周期实现。
- 已确认死代码：5 个零引用导出组件、3 片零引用 CSS、5 条已退役预测/查询路由。

## 一、用户可见：入口与模式

| 级别 | 问题 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| 高 | 点击已完成的分析记录行会无提示地切换项目「当前结果」 | `frontend/src/pages/ProjectPage.tsx:372`（可见标题只有「已完成」）、`390-394`（整行按钮的可访问名才说明后果）、`453`（菜单另有「设为当前结果」）、`136-149`（`makeCurrent`） | 用户以为只是查看，实际概览、趋势、数据来源全部换成旧分析；同一后果有两个入口 | 行点击改为「打开结果」，切换当前结果只保留一个可见按钮；切换后给出状态提示 |
| 高 | 概览页同一屏有三个「发起分析」 | `ProjectPage.tsx:225`（页头）、`:238`（概览回调）、`RepositoryOverview.tsx:198`（右上「发起第一次分析」）、`:231`（底部「发起分析」） | 三个按钮做同一件事，主操作不唯一 | 概览空状态只留一个主入口，其余删除或降为链接 |
| 中高 | 项目页「构建数据集」完成后跳到管理工作区，需要管理员登录 | `DatasetBuildDialog.tsx:94-101,113-115`（完成态跳 `admin/datasets`）、`AdminWorkspace.tsx:58-68`（未登录显示登录框）、`App.tsx:46-47`（管理员独立外壳） | 普通审查者建完数据后被送到登录页，刚建的版本在用户工作区没有入口 | 完成按钮改为「进入管理工作区查看并训练」并说明需要管理员登录；或在项目页保留只读的构建结果 |
| 中 | PR 审查页右侧「PR 分析记录」是左侧列表的第二份拷贝 | `ProjectPullRequests.tsx:150-158`（`recordRows` 只是 `rows` 按状态重排）、`:216-234`（左列表）、`:241-250`（右栏），两侧都 `navigate('pr-work')` | 同一 PR 左右各出现一次，右栏还包含「尚无分析」，只列当前页 | 删除右栏，或改成真正的「待处理/失败」子集并改名 |
| 中 | 「最近一次成功分析的结果」与「当前分析结果」在固定旧结果时互相矛盾 | `ProjectPage.tsx:246`（左侧文案）、`:262`（右侧标题）、`projectClient.ts:58-59`（当前视图可被任意成功分析替换） | 用户固定较早的分析后，左侧仍声称是最新成功结果 | 左侧改为「当前审查所用的结果」；固定旧结果时加「历史固定结果」标签 |
| 中 | 同一份训练产物出现在三个列表，且有两套「登记」 | `AdminTrainingPage.tsx:93-101,127-140`（训练列表/详情无后续链接）、`AdminExperimentRunsPage.tsx:187-201`（实验登记）、`AdminModelsPage.tsx:147-152`（本机模型产物）、`adminContracts.ts:655`（promote）与 `AdminModelsPage.tsx:81`（`/models/register`） | 训练成功后要自己去别的页找同一条产物；两个登记按钮目标相同、文案不同 | 训练成功详情加「查看实验登记」「查看模型详情」；登记只保留一个权威入口 |
| 中 | 同一 PR 有两个只读页面与两种模式，URL 不能表达模式 | `App.tsx:46-53`（带 `snapshotId` 走固定快照）、`PullRequestJourney.tsx:163-165`（无工作单显示只读预览，否则工作单）、`PullRequestJourney.tsx:41-87`（固定快照页只有单文件下拉，没有提交排序/搜索/解释） | 同一链接在不同浏览器打开的内容不同；创建工作单后无法回到只读；从提醒进入的固定快照功能更少 | 给只读模式一个可寻址参数/路由；固定快照复用 `PullRequestPreview` 并标注「固定版本」 |
| 中 | 「分析全部 PR」与「自动分析→处理现有开放 PR」的关系没有说明 | `ProjectPage.tsx:73-83,224,311-329`（一次性批次）、`PRTrackingPanel.tsx:92-100`（首次会处理现有开放 PR） | 用户不知道两者会不会重复提交、结果是否复用 | 批次对话框注明「仅本次，不开启自动跟踪」；自动分析确认框说明复用规则 |
| 低 | 「开始审查」在不同入口代表打开、创建、创建并切换轮次三种后果 | `PersonalWorks.tsx:108`、`PullRequestJourney.tsx:52-64,77`、`PullRequestPreview.tsx:64`（已改名为「创建审查工作单」） | 用户无法从标签判断是否会写入本地草稿 | 统一为「打开工作单 / 创建工作单 / 创建并进入此固定版本轮次」 |
| 低 | 趋势视图未就绪时，页内的「分析结果 / 风险趋势」切换一起消失 | `ProjectTrends.tsx:70-74`（`switchSlot` 只在 `view` 存在时渲染）、`:76-84`（空态/错误） | 打开 `/trends` 失败时看不到当前模式和返回入口 | 把切换移出 `view ?` 条件，空态也显示当前模式 |
| 低 | 趋势的「来源范围」与「单次固定分析」两个控件写同一个 `sourceId` | `ProjectTrends.tsx:76` | 下拉与自由输入互相覆盖，用户不知道以哪个为准 | 只保留一个控件；手填收进高级折叠项 |
| 低 | 模型比较会自动加载并自动挑对手，页面上的「比较」按钮只改 URL | `AdminComparisonPage.tsx:24-47`（自动选与自动加载）、`:59`（比较按钮）、`AdminModelDetailPage.tsx:32`（只传一个 id） | 「加入比较」语义与实际不符，按钮点了没有可见变化 | 删除「比较」按钮或改为「复制比较链接」；加入比较后让用户选择对手 |

## 二、数据正确性与边界

| 级别 | 问题 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| 中 | `/api/v1/commits?version=X&module=m` 会返回其他数据集版本的提交 | `api.py:555-557` 调用不带 version 的 `count_by_entity/commits_by_entity`；`catalog_storage.py:343-367` 的 JOIN 只要求 commit 与 entity 同版本 | 该端点是管理员接口、前端未调用，但会给出与请求版本不一致的 `total` 和提交 | 给 entity 查询加 `dataset_version` 条件，或删除该查询入口 |
| 低 | 仓库提交列表把解释状态硬编码为 `not-supported` | `sync.py:1091-1094` vs `repository_explanation.py:52-54` | 同一提交在两个接口里的解释状态可能不同；前端目前只读解释端点，未受影响 | 从列表投影移除解释字段，统一由解释端点提供 |
| 低 | 已退役的预测服务仍注册 3 条路由并在启动时构造服务 | `api.py:293-304,487-489`、`prediction.py` | 死 API 被误认为现役契约，启动多创建一个无用服务 | 删除路由与服务构造；测试直接测 `prediction.py` |
| 低 | `/api/v1/repositories/{id}/summary` 与仓库详情重复且前端零调用 | `api.py:741-743`、`sync.py:1105-1111`、前端检索 0 调用 | 同一事实两套返回 | 删除端点或让详情复用同一投影 |

## 三、前端实现重复

| 级别 | 问题 | 证据 | 建议 | 范围 |
| --- | --- | --- | --- | --- |
| 高 | 同一套「加载/重试/轮询」状态机手写 28 次，react-query 只在 5 个生产文件使用 | `projectClient.ts:157-190` 手写轮询 vs `repositoryWorkspace.ts:220-241` 的 `useQuery`；`setAttempt` 计数 48 处；`lib/localCache.ts` 与 react-query 缓存并存 | 主要读取统一迁到 `useQuery`，`retry` 暴露 `refetch`；删除自维护 `attempt/revision` | 大 |
| 高 | 一个进行中的分析在项目页触发至少 3 条独立轮询，间隔不同 | `ProjectPage.tsx:41`（`useRepository`）、`:85`（`useRepositorySyncs`）、`:219`（`RepositoryUpdates`）；间隔 1500/1500/1500–15000ms | 以 `activeSyncId` 为 key 保留一处轮询，其余从缓存派生 | 中 |
| 中 | `/repository-models` 有 8 处请求/调用，3 种缓存策略 | `modelClient.ts:20,25-34`、`AnalysisForm.tsx:66`、`ProjectPullRequests.tsx:67-71`、`PRTrackingPanel.tsx:26`、`ProjectPage.tsx:56`、`useSnapshotAnalyses.ts:80-84` | 新增 `useRepositoryModels()`（`useQuery(['repository-models'])`），其余改为调用它 | 小-中 |
| 中 | 路由只靠裸字面量：69 处 / 20+ 文件 | `ProjectPage.tsx` 13 处、`AdminExperimentRunsPage.tsx` 10 处、`AdminWorkspace.tsx` 7 处等 | 在 `navigation.ts` 增加 `routes.*` 工厂，机械替换 | 中 |
| 中 | 同一错误码有 4 份文案，合同层的 `failHint` 只有自己的单测在用 | `repositoryContract.ts:303-336`（生产零引用）、`ProjectPage.tsx:464-479`、`RepositoryUpdates.tsx:18-23`、`Feedback.tsx:12-20` | 保留一张 code → {title, next} 表，其余查表 | 小 |
| 中 | 空态/错误/加载/分页/确认各有多套实现 | `quiet-empty` 23 处；分页 `pager` 7 处 + `pr-hub-pager` 1 处；确认流程 4 个文件；5 个零引用导出（`InlineAlert`、`Popconfirm`、`MetaBlock`、`StatusNote`、`Disclosure`） | 空态只留 `EmptyState`；分页抽 `Pagination`；确认统一模板；未用导出二选一（接入或删除） | 中 |
| 中 | 状态与远端标签常量被复制到多个文件 | `remoteLabel` 3 份（`PersonalWorks.tsx:11`、`ProjectPullRequests.tsx:19`、`PullRequestJourney.tsx:26`）；`STATUS_LABELS`/`DEGRADE_LABELS` 已存在于 `repositoryContract.ts:29-45` | 全部回到既有导出，删除本地副本 | 小 |
| 中 | 同一「排序」语义有三种控件：原生 select、Mantine Select、Dropdown+Button | 原生 `<select>` 10 处（`ReviewWorkbench.tsx:257` 等）；`VerificationReport.tsx:46`；`ProjectPullRequests.tsx:169-183` | 按 IP-16 统一：≤3 项用分段控件，长选项用带当前值的菜单按钮 | 小 |
| 中 | 三个文件超过 400 行，混合多个页面级职责 | `ProjectPage.tsx` 520、`PullRequestJourney.tsx` 505、`adminContracts.ts` 676 | 按区块/资源拆分（项目头、记录栏、当前结果；固定快照与工作单；model/dataset/training/experiment 契约） | 大 |
| 低 | CSS 顶层选择器 181/667 被重复定义，存在整片死样式 | `.page-heading` 9 处、`.analysis-job` 7 处；`.update-card` 等 0 引用；`.ledger/.status-tag` 0 引用 | 按组件归并样式层，删除死区，跑视觉回归 | 大 |

## 四、后端接口面

| 级别 | 问题 | 证据 | 建议 | 范围 |
| --- | --- | --- | --- | --- |
| 中 | 模型卡事实有两条返回路径，字段与失败语义不同 | `api.py:383-389`（`/models/{id}` 内联 card）、`api.py:391-393`（`/model-cards/{id}`）；不可加载时卡片返回 200 `available:false`，详情走 `MODEL_NOT_READY` 503 | 卡片只保留一个来源；详情复用同一投影并统一「未就绪」表达 | 小 |
| 中 | 三套任务引擎复制同一生命周期，终态词表不一致 | `sync.py:169-330,735-790`、`training_tasks.py:43-230,483-555`、`dataset_builds.py:43-222,429-491`；训练用 `succeeded`，其他用 `completed` | 抽共享 TaskStorage/TaskView 与终态词表，先合并队列位置与视图 | 中-大 |
| 中 | 数据集事实有两套序列化，项目端与管理员端脱敏规则不同 | `store.py:188-213`（原样返回 manifest URL 与路径）vs `project_datasets.py:41-67`（非 http(s) 置空）；`_label_rule/_limitations` 两份 | 投影集中到 `store.py`，传入公开/管理开关；删除重复函数 | 中 |
| 中 | 产物清单两套枚举：`/model-candidates` 与 `/experiment-runs` | `catalog.py:449-479`（平铺扫描）vs `catalog.py:249-291`（递归）；`/models` 在同一响应里混用两者 | 让 candidates 成为 experiment inventory 的投影，或删除 candidates | 中 |
| 中 | 多项目报告被枚举两遍，根目录与身份不同 | `catalog.py:25,302-313`（artifacts 根，artifactKey）vs `multi_project_reports.py:22-30,106-127`（multi-project/docs/evidence，reportId） | 复用同一发现函数与 reportId | 小-中 |
| 低 | 路由与服务重复校验同一 payload，错误形状取决于哪层先看到 | `api.py:199-208` 与 `pr_review.py:239-243`；`api.py:267-276` 与 `pr_review.py:317-320` | payload 形状校验下沉到一层，统一错误字段 | 小-中 |
| 低 | 采集窗口与「已完成分支分析」判定各写多份 | `sync.py:645-661` 与 `dataset_builds.py:78-87`；`analysis_comparison.py:34-50`、`project_datasets.py:99-121`、`sync.py:1033-1043` | 抽 `analysis_source()` 与 `require_completed_branch_sync()` | 中 |
| 低 | 管理路由清单两份手工维护 | `admin.py:38-45`（鉴权）与 `api_errors.py:113-124`（统一错误体） | 合并成一张路由表 | 小 |

## 五、误报与已排除

- **「模型卡被管理员中间件保护，普通用户点开模型卡会 401」不成立。** `admin.py:38-45` 的保护前缀是 `/api/v1/models`，不匹配 `/api/v1/model-cards`；实测未登录 `GET /api/v1/model-cards/{id}` 返回 200。模型卡是公开只读投影，与「用户端可用」的设计一致。
- **「数据集构建对匿名开放是安全问题」不成立。** 本机产品没有项目用户账户，项目侧接口按设计匿名可用；`created_by='project'` 是如实的审计标签，不是权限绕过。真正要关注的是「构建完成跳管理员登录」的体验问题（见第一节）。
- **「`/api/v1/commits` 跨版本」不涉及普通用户。** 该端点受管理员保护、前端无调用；但作为管理接口仍应修正返回口径。

## 六、建议路线

### 第 1 批：先堵用户可见的纰漏（建议本周）

1. 分析记录行：查看与「设为当前结果」分离；切换后给状态提示；补一条测试断言可见文案。
2. 概览页三个「发起分析」收敛为一个主入口；项目卡片文案从「开始分析」改为「打开项目」。
3. 数据集构建完成按钮改为「进入管理工作区查看并训练」，说明需要管理员登录。
4. 项目页三条轮询收敛为一个 `useQuery` 数据源（先处理 `useRepositorySyncs` 与 `RepositoryUpdates` 的重复）。
5. 修正 `/api/v1/commits?module=` 的版本条件。

### 第 2 批：同一件事只留一个入口（下一迭代）

6. PR 页右栏改为「待处理 PR」子集或删除。
7. 训练产物：训练成功详情加后续链接；登记只保留一个权威入口。
8. `pr-work` 增加可寻址的只读模式；固定快照复用 `PullRequestPreview`。
9. 趋势来源只留一个控件；趋势空态也显示模式切换。
10. 模型比较删除冗余按钮，加入比较时让用户选择对手。
11. 「最近一次成功分析」文案按实际时间语义改写。

### 第 3 批：实现债与一致性（按模块排期）

12. `useRepositoryModels()` + 主要读取迁到 react-query；删除自维护 `attempt/revision`。
13. 路由工厂、错误文案单表、标签常量、分页、空态、确认模板统一。
14. 拆分 `ProjectPage`、`PullRequestJourney`、`adminContracts`。
15. 删除零引用导出、死 CSS、退役预测路由与 `/summary`；合并两份管理路由清单。
16. 后端任务引擎抽取共享生命周期；数据集与产物投影各留一份。

## 七、防复发机制

1. **入口清单**：在 `docs/当前产品.md` 增加一张「对象 × 主入口 × 其他入口 × 模式标识」表；新增页面必须先在表里登记。
2. **OpenSpec 约束**：在 `interface-presentation` 增加一条要求：会改变全局状态或写入本地草稿的按钮，可见文案必须说明后果；同一对象只能有一个规范入口，其他入口必须标注上下文。
3. **测试护栏**：为本次修掉的模式混淆补旅程测试（只读/工作单、查看/设为当前结果、构建完成去向），失败即提示。
4. **轻量静态检查**：新增脚本检查禁止项——生产代码新增原生 `<select>`、`navigate({ name: ... })` 字面量、新的错误码映射表；在 CI 中提示而不是硬失败，先控制增量。

## 八、验证边界

- 本次是静态审查 + 关键点实测（模型卡 200、数据集构建去向、分析记录行行为），没有逐页跑完整浏览器回归。
- 未核实「仓库外是否有调用方」；涉及删除的退役端点需先确认部署环境。
- 所有行号对应 2026-11-08 的工作树（含未提交的 PR 详情改动）。
