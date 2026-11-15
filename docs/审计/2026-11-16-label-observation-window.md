# 标签观察窗口与成熟样本准入验收

日期：2026-11-16。实施范围：OpenSpec change `separate-label-observation-window`。本文记录实际实现、检查与重建结果；不是模型效果结论，也没有人工复核金标准。

## 1. 实现范围

- 采集把提交纳入窗口与修复观察窗口分开，固定 revision 与实际观察终点；`--observe-through` 可晚于 `--until`，后续修复只为纳入提交提供证据，特征仍只使用父链历史。
- 观察终点超过固定 revision 时截到 revision 时间，并记录 `historyBounded`；不把未来日期当作已完成观察。
- 新数据版本写入受哈希保护的逐提交状态旁车（`commit-label-status-v1`），声明 `mature-observed-v1`：样本窗口、观察窗口、revision、成熟期、历史状态、SZZ 覆盖、准入计数与内容身份。
- 加载时从原始时间和观察声明重算成熟状态，核对状态文件哈希、提交集合和标签；旁车损坏或计数不一致即拒绝新训练。
- 统一准入过程接入切分预览、CLI 训练、单/多方法任务、同步训练与评价矩阵；预览与执行使用同一成员。同步 holdout 与成熟集合取交集，holdout 仍相对样本最新提交计算。
- 旧 SZZ 数据默认拒绝新训练并提示重建；CLI `--allow-legacy-labels` 可显式按历史协议复现。发布者数据沿用原始标签语义。
- 评分覆盖保持完整：同步作业用全部采集提交打分，训练只用成熟合格成员。
- 数据详情、切分预览、权威 ZIP 与用户下载包含观察事实和逐提交状态文件；迁移 036 增加同步降级原因列。
- 同 CSV、不同观察或成熟语义生成新版本；相同语义重复采集复用原版本。

## 2. 真实重建

固定参数：完整 SZZ、成熟期 90 天、样本截止 `2026-08-01`、观察截止 `2026-11-01`、每仓库执行预算 2 小时。实际执行远低于预算。

| 仓库 | revision | 样本窗口 | 实际观察终点 | 历史 | SZZ | 原始/合格 | 正例 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pallets/flask（main） | `49943b5a94413a530761350f04e896f76e8d620e` | 2010-04-06 — 2026-07-30 | 2026-10-30T15:05:20Z | 完整（受 revision 限制） | 完整，无截断 | 3694 / 3694 | 418 |
| axios/axios（v1.x，HEAD） | `85ffbafab1a3f4385b6a4118692a6995ce71d9d8` | 2014-08-18 — 2026-07-30 | 2026-11-01T00:00:00Z | 完整 | 完整，无截断 | 1877 / 1877 | 566 |

与旧 `*-mature` 版本对比：纳入行数完全一致（flask 3694、axios 1877），观察窗口延长后正例分别从 410 增至 418、从 510 增至 566。差异来自样本截止之后发生的修复，正是本次修正的目标；旧版本字节、模型和通过引用保持不变。

版本与文件：

| 数据集 | 版本 | CSV SHA-256 | 状态文件 SHA-256 | 准入身份（前 16 位） |
| --- | --- | --- | --- | --- |
| flask | `kamei14-git-v2-flask-observed-2010-04-06_2026-07-30` | `0130e26841ebe079aefe3ae08da911229ba6d52295cf902b45de86332155d25a` | `6d2ee61a583e46dea5b85c8af8ded39389bfd833c74a4273408cc3ac6b796fcc` | `8373269d8669452d054b4f88353f373d1b96dec6698ffe16dc4375d30ce653c5` |
| axios | `kamei14-git-v2-axios-observed-2014-08-18_2026-07-30` | `d757e43a8ce7f3c8fa2540ae7a42d0e18c75a34468b870718eb2066d383df212` | `0bdb6277d98fe14ca530484e106312e88fcd5bd84f196aaf880a134e114ff0c4` | `072c76b5a3e3e9b8fa3e1de8930a1a1b0369be4ac6a172b7f325a9e8aba2c98e` |

完整哈希、状态文件与证据文件路径、可复现命令见 `docs/evidence/label-observation-2026-11-15/handoff.json`。权威构建位于隔离目录 `backend/artifacts/label-observation/2026-11-15d/`，没有覆盖旧数据。

## 3. 抽样核验

每仓库按修复时间分层固定抽取 10 条证据，自动核对：修复与引入对象存在、路径存在于引入提交、行号位于该文件范围内、修复信号已记录、引入提交是修复提交的祖先。

| 仓库 | 自动通过 | 自动失败 | 待人工 |
| --- | ---: | ---: | ---: |
| flask | 10 | 0 | 0 |
| axios | 10 | 0 | 0 |

抽样明细与空白人工判定列见同目录 `kamei14-git-v2-flask-observed-sample.csv` 与 `kamei14-git-v2-axios-observed-sample.csv`。**人工复核未执行**，`humanReview` 保持 `pending`，不能把这些样本写成人工金标准。

核验中发现并修正的问题：`git blame -C` 会把内容归因到引入提交中的另一个源文件。原实现记录修复提交侧路径，导致证据路径在引入提交不存在。现在读取 `--line-porcelain` 的 `filename` 头，证据路径使用引入提交中的实际源文件，重建后自动核验全部通过。

## 4. 已运行检查

- 隔离服务浏览器旅程（后端 18900、前端 18901、独立数据库与产物目录）：管理员登录后打开 `kamei14-git-v2-flask-observed` 详情，页面显示观察协议 `mature-observed-v1`、原始/纳入 3817/3694、样本/合格 3694/3694、未成熟排除 0、历史状态 `complete`、观察终点 2026-10-30；切分预览显示样本 3694、成熟合格 3694，训练/验证/测试为 2582/552/560、正例 344/38/36。从页面创建逻辑回归训练任务成功，`split.json` 的三档计数与预览完全一致，准入计数 3694/418 与描述文件一致。
- `pytest tests/test_admission.py`：10 项通过，覆盖截止后修复、未来观察边界、成熟边界、状态篡改、未知/截断、旧协议拒绝与显式复现、预览/训练成员一致、同 CSV 不同语义新版本、权威 ZIP 导出重载、训练任务成员一致、发布者数据。
- `pytest tests/test_collect.py tests/test_szz.py tests/test_szz_full.py`：42 项通过。
- `pytest tests/test_splits.py tests/test_datasets.py tests/test_artifacts.py tests/test_curation.py`：通过。
- `pytest tests/test_repository_sync.py tests/test_sync_model_strategy.py tests/test_sync_training_holdout.py tests/test_training_tasks.py tests/test_evaluation_matrix.py tests/test_dataset_builds.py`：通过；同步在无成熟记录时降级为现成模型并保留全部评分。
- `pytest tests/test_analysis_context.py tests/test_sync_control.py tests/test_catalog_storage.py tests/test_model_policy.py`：迁移与 v7/v8/v12 旧库升级通过，包括前向迁移 036。
- 前端 `npm run typecheck` 与 `npm test`：55 个测试文件、396 项通过。
- 完整后端测试与前端测试结果见本轮收尾记录；不以单个测试数量代替浏览器旅程。

## 5. 限制与未完成

- 人工复核、真实用户审查耗时与采纳率未执行；本轮不提供人工金标准或在线效果。
- 只重建 flask 与 axios 两个仓库；其余旧 `*-mature` 版本仍为历史协议，不能冒充新协议可信数据。
- axios 使用默认分支 `v1.x`；`main` 分支停留在 2026-01，不能代表当前活跃历史。revision 已固定记录。
- SZZ 仍可能漏标未关联 issue 的修复、纯新增式修复和跨仓库搬运；成熟准入不改变这一限制。
- 本轮没有重训既有交付模型，也没有修改默认模型；旧模型与旧参考预测保持原语义。

## 6. 交接给下一 change

`unify-review-benefit-evaluation` 应使用以下合格版本，不得用旧 `*-mature` 名称代替：

- `kamei14-git-v2-flask-observed-2010-04-06_2026-07-30`（3694 条，418 正例，完整观察）
- `kamei14-git-v2-axios-observed-2014-08-18_2026-07-30`（1877 条，566 正例，完整观察）

两者语言不同，不能用于留一仓库跨仓库评价；同语言不足三个合格仓库时须输出不足记录。
