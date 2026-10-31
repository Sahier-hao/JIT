# 管理区多项目实验报告验收

日期：2026-10-31。范围：升级实施方案第二阶段「在管理区展示多项目实验报告」。使用仓库内真实冻结报告与隔离临时服务；报告文件、管理员会话和浏览器交互为真实执行，不重新训练。

## 交付行为

| 能力 | 实现与验证范围 |
| --- | --- |
| 只读报告发现 | 服务从固定根目录递归发现 `multi-project-report.json`，单文件上限 8 MiB；默认扫描 `backend/artifacts/multi-project` 与仓库 `docs/evidence`，可用 `JIT_MULTI_PROJECT_REPORT_ROOT` 覆盖。 |
| 受控标识 | 报告标识为文件内容 SHA-256 前 24 位；同一内容去重，浏览器只能提交该标识，不能提交文件路径。 |
| 结构校验 | 校验报告类型、版本、必需字段以及 `results`/`boundary` 结构；无效报告在列表中标记原因，详情返回 `REPORT_INVALID`，不使整个列表失败。 |
| 状态归一 | 全部口径完整为 `complete`；存在完整口径但有失败记录或部分失败为 `partial`；没有完整口径为 `failed`；无法解析为 `invalid`。原始 `status` 保留为 `reportStatus`。 |
| 管理员 API | `GET /api/admin/multi-project-reports` 与 `GET /api/admin/multi-project-reports/{reportId}`，必须管理员会话；未登录返回 401，未知或路径式标识返回 404。 |
| 管理区页面 | 新增「多项目实验」导航、`#/admin/experiments` 列表与 `#/admin/experiments/{reportId}` 详情。 |
| 报告内容 | 详情展示项目数据、来源与修订、分区样本、schema、指标集、四种训练方式、逐目标指标、训练来源、宏平均、总体方差、已定义项目数、最差项目、失败阶段/错误/原因，以及全局+本地融合权重、验证样本数和选择依据。 |
| 缺失值 | 指标为空时显示 `—` 和原因，不显示为 0。 |
| 边界 | 页面明确只读、宏平均不是全局最佳模型、不改变默认模型；不自动排序、不自动选模型。 |

## 关键实现

- [multi_project_reports.py](../backend/jit_baseline/multi_project_reports.py) 负责固定根目录、内容哈希、结构校验、状态归一和受控来源；不写数据库、不调用训练。
- [api.py](../backend/jit_baseline/api.py) 注册管理员报告路由；[admin.py](../backend/jit_baseline/admin.py) 把 `/api/admin/multi-project-reports` 纳入管理员保护前缀。
- [multiProjectReportContracts.ts](../frontend/src/multiProjectReportContracts.ts) 解析列表与详情；[AdminExperimentsPage.tsx](../frontend/src/pages/admin/AdminExperimentsPage.tsx) 与 [AdminExperimentDetailPage.tsx](../frontend/src/pages/admin/AdminExperimentDetailPage.tsx) 呈现报告。
- 新增地址解析与回写；导航增加「多项目实验」，管理分区标题同步。
- 无数据库迁移，无模型目录或默认模型写入。

## 验证结果

### 后端全量

`backend/.venv/Scripts/python.exe -m pytest -q --basetemp=.cache/p2-full`：**645 passed**，1 条既有 PyTorch 警告，361.98 秒。

新增用例：

- `tests/test_multi_project_reports.py`：完整、部分失败、失败、无效报告的状态与计数；同内容去重；路径式标识和未知标识不读取文件；匿名请求 401；管理员读取成功；读取前后默认模型不变。
- `tests/test_openapi.py`：报告接口必须管理员会话、404 契约和状态枚举与文档一致。

### 前端全量

`npm run typecheck`、`npm run lint`、`npm run build` 通过。`npm test`：**41 个文件、328 passed**。

新增用例：

- `src/multiProjectReportContracts.test.ts`：直接解析仓库内真实四项目报告，核对 5 种方法、4 个项目、local AP 宏平均 `0.4952844`、总体方差 `0.0268454`、global+local 融合 `alphaGlobal=0.4/alphaLocal=0.6` 与验证 Brier，不填充缺失值。
- `src/pages/admin/AdminExperimentsWorkspace.test.tsx`：列表状态与受控标识跳转；详情四种口径、宏平均/方差、融合权重、失败原因、缺失指标显示 `—` 和原因；不存在报告可返回列表。
- `src/workspaceRoutes.test.ts`：`#/admin/experiments` 与详情地址往返。

期间修复既有管理员懒加载用例：`ProductWorkspace.test.tsx` 对「验证报告 / 返回用户工作区」的查找原先使用 1 秒默认超时，新增管理页面后懒加载偶尔超过该时限；改为 15 秒后全量 328 项通过，未改变产品行为。

### 浏览器

`npx playwright test e2e/admin-experiments.spec.ts --config=playwright.project-workspace.config.ts --project=desktop-1440`：**1 passed**。实际步骤：

1. 匿名请求报告列表返回 401 `AUTH_REQUIRED`。
2. 在隔离预览服务建立管理员会话，打开 `#/admin/experiments`，看到真实报告状态「完整」。
3. 打开报告详情，看到来源 `docs/evidence/add-multi-project-training-comparison/multi-project-report.json`、只读边界、本地训练宏平均 `0.4953`。
4. 展开「全局+本地」，看到融合权重和验证 Brier。
5. 完整报告显示「报告没有失败记录」。

截图：`docs/evidence/_run/admin-experiments-browser/report-detail.png`。

### 真实报告核对

仓库内冻结报告为四项目、五种经典方法、四种口径，共 20 个方法×口径组合、80 个目标结果，失败记录为 0。详情显示的 local / pooled / leave-one-project-out / global+local AP 宏平均分别为 `0.4953`、`0.4555`、`0.4583`、`0.4862`，与报告源文件一致；融合权重逐目标不同，例如 `mp-commons-lang` 为全局 0.4 / 本地 0.6，验证 Brier 约 0.0970。

### OpenSpec

`openspec validate expose-multi-project-reports --type change --strict`：通过。`openspec validate --changes --strict`：5 个变更全部通过。

## 未完成或未验证

- 只支持 `reportVersion=1` 的多项目报告；未知版本在列表中标记无效。
- 不提供在线多项目训练、重跑、取消或修改报告；仍然只有离线命令生成报告。
- 无效报告可在列表中看到原因，但详情不可打开。
- 默认扫描 `docs/evidence` 便于查看仓库内真实报告；生产部署若不携带该目录，需要设置 `JIT_MULTI_PROJECT_REPORT_ROOT`。
- 本次没有新增数据库迁移；既有数据库、模型、训练任务、报告文件保持不变。
