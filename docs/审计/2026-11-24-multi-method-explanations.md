# 多解释方法与训练结果核对：收尾验收

日期：2026-11-24。范围：change `review-model-training-results-and-explanations` 的 PR1–PR3 合并后收尾。对应 PR：#75（训练三档比较）、#76（解释方法后端）、#80（解释前端选择与比较）。当前产品说明见[当前产品](../当前产品.md)，离线细节见[提交解释、离线报告与行级研究](../离线与研究.md)。

## 交付能力

- 训练比较：管理员和用户实验页逐方法展示 train、validation、test 三档指标、样本数、正例数、实际参数、状态、错误和耗时；训练档只用于拟合诊断，不作为泛化结果。
- 解释方法目录：`occlusion-mean-v1`（默认，模型无关，单位 `probability`，训练分区均值基线，缺失字段显式零基线）与 `linear-logodds-v1`（仅二元逻辑回归，单位 `logit`，输入与基线经过原 Pipeline 实际预处理）。目录只返回该模型实际可用的方法。
- 按方法持久化：迁移 043 将解释主键扩展为 `(sync_id, commit_id, method)`；同方法重复生成幂等，新方法不覆盖旧方法，旧 payload 不重写，删除父提交时级联删除解释。
- API：保留单数 `/explanation`（可选 `method`，省略时仍为 `occlusion-mean-v1`），新增 `/explanations` 与 `/explanation-methods`；未知或不兼容方法明确拒绝（422），不静默改用其他方法，也不改变原风险。
- 前端：提交详情先读取已保存解释，由用户显式选择并生成；方法切换互不覆盖；贡献条形图与等价表格展示特征、本次值、基线、带符号贡献、方向、单位、基线与稳定性；同一提交的多种方法并列核对主要特征、方向和排序稳定性。

## 单位与边界

- `probability` 与 `logit` 单位不同，不能相加、不能共享排名，也不自动选择“最佳解释”。
- 特征贡献不是缺陷根因、因果解释或代码行定位。
- 遮挡法不能解释字段交互，贡献不是可加因果分解；线性分解要求输入与基线经过原 Pipeline 的实际预处理。
- 前端对 `probability` 保留 `abs(delta) <= 1`；对 `logit` 只要求有限数，允许其绝对值超过 1。
- 模型不可用时已保存解释仍可读；生成失败不修改原风险，也不切换其他模型。
- 本交付不包含 SHAP、LIME 或自动挑选“最佳解释”的能力。

## 验证入口

- 后端完整回归：`backend/.venv/Scripts/python.exe -m scripts.regression_scope --layer full --pytest-junit <path>`
- 前端完整回归：`npm run typecheck`、`npm run check:api-types`、`npm test`、`npm run build`、`npm run lint`、`npm run check:modules`、`npm run check:styles`
- 真实隔离服务浏览器旅程：`npm run test:e2e:explanations`
- 迁移 43 审计：`backend/.venv/Scripts/python.exe -m scripts.audit_explanation_migration --output <path>`
- 文档一致性：`backend/.venv/Scripts/python.exe -m scripts.check_docs_links --root ..`

## 实际结果

- 后端完整回归：1054 项，1051 passed、0 failed、3 skipped；跳过原因均为显式条件（1 项真实数据集未导入，2 项本机缺 PowerShell 7 `pwsh`，CI 的 Windows 环境会执行）。
- 前端：72 个测试文件、603/603 passed；typecheck、check:api-types、lint、模块边界、样式检查与生产构建均 exit 0。
- 真实隔离服务 E2E：`multi-method-explanations` 1 passed（0 unexpected、0 skipped、0 flaky），生成 occlusion（probability）与 linear（logit）、刷新重开、切换提交和窄屏均通过；截图与请求记录见冻结证据。
- 迁移 43 审计：11 项检查全部通过；旧训练、模型、风险和历史计数与内容不变，解释 payload 保留，默认方法回填，显式方法保留，外键有效，二次初始化幂等，源数据库未被修改。
- 文档口径：产品文档只声明本交付的两种方法，未声明 SHAP、LIME、自动“最佳解释”、因果或代码定位。
- 已知既有问题：`docs/项目文件索引.md` 有 4 个历史断链（与本 change 无关）；`test_verification_guard` 在本机因缺 `pwsh` 显式 skip。

## 证据与冻结

收尾证据冻结于 `docs/evidence/review-model-training-results-and-explanations/`，冻结清单逐文件记录相对路径与 SHA-256。本次冻结覆盖 25 个文件（含 PR2 来源证据与 3 张浏览器截图），`sourceRunId=90194300c466a392249eaaead7b9c52d8cde2d346b0eb229b24c53bcce6ca538`；`python -m jit_baseline.cli check-evidence` 返回 `passed=true`、`problems=[]`（冻结时间 2026-11-24T11:25:56Z）。
