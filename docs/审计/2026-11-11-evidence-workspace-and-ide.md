# 证据接回工作区、隔离旅程与 IDE（2026-11-11）

本记录只写实际执行与结果；未运行的远端流程明确标注未验收。

## 一、数据集观察窗口与证据入口

- `store.dataset_list` / `version_view` 新增 `labelObservations`：标签规则与版本、观察终点（epoch 与 ISO）、成熟期、二值化规则、SZZ 证据是否截断。
- `#/admin/datasets/{name}/{version}` 展示观察终点、标签版本与“证据截断（回溯时间预算用尽，正例只覆盖部分历史）”；旧 `szz` 字段存在时仍按原样显示。
- 新增只读 `EvaluationEvidence` 服务与 `/api/admin/evaluation-evidence`：
  - 固定目录：`backend/artifacts/evaluation-evidence`、`docs/evidence/evaluation-matrix`、`docs/evidence/line-candidates`；
  - 按内容 SHA-256 标识，拒绝浏览器路径；
  - 评价矩阵引用数据集版本的描述文件或 CSV 哈希变化时标为 `stale` 并给出原因；
  - 无效 JSON 标为 `invalid`，未知标识返回 `EVIDENCE_UNKNOWN`。
- `#/admin/experiments` 增加“评价证据”表：类型、状态（可用/陈旧/无效）、数据集/仓库与候选数、内容 SHA-256、来源；不新增平行门户。

测试：`tests/test_evaluation_evidence.py` 3 项（可用/陈旧/未登记、无效与未知、数据集视图观察事实）；前端实验页测试 3 项；OpenAPI 契约测试 17 项通过。

## 二、隔离服务上的端到端旅程

隔离目录：`D:/tmp/w8`（独立 SQLite、独立 artifacts、独立 18830 端口；数据集目录只读引用真实数据）。不接触开发库与其他会话服务。

旅程（真实 HTTP 接口）：

1. 建立管理员；读取数据集列表（29 个数据集，包含 `kamei14-git-v2-flask-mature`）。
2. 建立项目 `https://github.com/encode/httpx`。
3. 以 `force-train` + 逻辑回归 + `temporal-70-15-15` 发起分析：真实采集（缓存 HEAD、2023-01 起）→ 登记数据集 → 训练 → 评分。
4. 同一参数重复提交，返回同一 `syncId`（幂等）。
5. 完成后口径：`partitionCoverage.status=verified`、`memberVerification=digest`、preset `temporal-70-15-15`；
   训练/验证/测试/留出 186/40/40/3，清洗排除 8，总数 277，分区计数之和与总数相等。
6. 提交列表第一页分区：训练 119、验证 37、测试 37、留出 3、排除 4。
7. 趋势视图 `partitionCoverage.status=verified`。
8. 另起一次分析并取消，取消意图被接受。

浏览器（隔离前端 18831 代理到 18830，真实 Chromium）：登录 → 项目列表（277 个已分析提交、8 个高风险）→ 打开项目 → 分析页口径卡显示模型身份、数据集 269/277、正例 8、训练/验证/测试 186/40/40、留出 3 条（“时间视图，不是模型成员”）、标签页“留出 3 / 测试 40 / 全部 277”，页面无异常。截图：`docs/evidence/2026-11-11-project-scope.png`。

## 三、多账户与失效

- 用户 A 从共享数据集派生新版本；A 的数据列表包含该版本，用户 B 不包含，管理员数据集列表包含；B 读取该版本被拒绝（403/404）。
- 退出登录后再次读取用户接口返回 401。
- 模型产物损坏：模型卡 `available=false`，原因“运行文件校验不匹配，请核验并重新登记”；以该模型发起的现成模型分析在创建时即被拒绝（503 `MODEL_NOT_READY`），不静默换模型。

## 四、提交触发与 IDE

- 新增 `.github/workflows/commit-analysis.yml`：
  - `pull_request`（opened/synchronize/reopened）与 `push` 到 `main` 触发；
  - 检出 base 提交、再取 head 对象，固定 `BASE_SHA`/`HEAD_SHA`；
  - 模型包地址、SHA-256 与模型 ID 来自仓库变量，缺失即失败，不读取“最新默认模型”；
  - `permissions: contents: read`，只上传报告产物，不评论、不设门禁；
  - 同一 PR 的并发运行取消旧运行。
- 本地等价链：隔离目录 `catalog-init --skip-bundled-models` → `register-model`（真实项目模型）→ `pr-check-analyze --base HEAD~3 --head HEAD`，3 个提交、输出 JSON/Markdown；同一命令重复执行内容哈希一致；base=head 返回 `NO_CHANGES`（前一轮已验收）。
- VS Code 扩展：
  - 身份状态增加 `dirty`：报告提交与 HEAD 一致但工作树有未提交改动时不再标“一致”；
  - 定位前按文件执行 `git status --porcelain -- <path>`，被改动文件只按报告快照打开并提示，不跳到报告行号；
  - 打开前校验解析后的绝对路径位于工作区内，越界拒绝；
  - 宿主冒烟新增真实命令入口导入（`jitReport.import` 传 URI）与工作树改动断言；
  - 在两个真实仓库（本仓库克隆、axios 克隆）分别通过扩展宿主冒烟：报告导入、身份一致、dirty 降级、过期报告、非法报告拒绝；VSIX `0.1.1` 已打包（本地构建产物，不进 Git）。

未验收：GitHub 上的实际远端运行（本机无对应仓库变量与权限）；远端 fork 事件未实际触发。

## 五、边界

- 隔离旅程只覆盖一个小窗口（2023-01 起 277 个提交），不替代跨仓库评价。
- 浏览器步骤由 Playwright 驱动，不是人工点击；截图见上。
- 远端 CI 与 fork 行为标注为未验收，不用本地通过代替。
