# 实施验证与归档记录

状态：29 项任务全部关闭。技术任务已实现并验证；7.4 按用户 2026-10-14 指示“7.4任务默认通过”关闭。本文件记录开发验证与该决定，不代表另有非作者签署、正式模型效果报告或 LAN 验收。

## 已实现范围

SQLite 显式初始化／版本检查、CLI 与管理员 HTTP 登记、受控候选、原运行与 UUID 映射及位置去重、成员／管理员凭据、目录与 schema 查询、严格六字段 JSON 预测、原子保存及不可变重开。五种既有经典方法与 compare-methods 保留；原历史 GET 的认证、错误和输入行为保持原约定。

目录数据库默认是本机运行数据，测试和系统验收使用独立临时库与产物副本；没有为团队发放正式凭据或部署 LAN。新前端页、CSV、十二字段预测和真实解释仍未实施。

## 本轮证据

- 最终后端全量：**211 passed**，`docs/evidence/_run/catalog-pytest.log`／`catalog-pytest.xml`。有一项既有 TestClient/httpx 弃用警告，未改应用锁定依赖。
- 既有完整链：前端 **78** 项、浏览器 **50** 项，typecheck／lint／build、原产物 verify／独立复现、四个主规格严格校验均通过；`docs/evidence/_run/verification.json` 的 success 与 protectedFilesUnchanged 为 true。链后补充了边界测试与拒绝路径角色诊断，最终后端及实际新 HTTP 已重新验证；前端源码未改。
- 新功能实际 TCP：`docs/evidence/_run/catalog-system.json`。两并发首次登记分别返回 201／200，持久身份相同；成员登记 403／匿名 401；真实预测创建／重开／进程重启恢复通过，原产物文件哈希未变。
- 最终日志：`catalog-system-service.log` 中被拒绝的合法成员记为 member，并可按 requestId 与业务 UUID 追踪；证据不记录 Bearer 凭据。
- OpenAPI：`docs/evidence/_run/catalog-contract.json`，校验 **19** 个实际响应和成功请求，所有 component schema 通过 Draft 2020-12 结构检查。
- 性能：两种模型各 5 次预热后 **200** 次合法本机单并发请求，错误数为零，最近秩 P95：逻辑回归 **0.1264 秒**，决策树 **0.1258 秒**。原始逐次计时、CPU／RAM／环境、登记耗时在 catalog-system.json；达到本轮建议 2 秒目标，不外推 LAN 或其他模型。

运行证据原先写入可覆盖的 `_run`。归档阶段显式冻结到 `docs/evidence/register-existing-models-and-predict-json/`，以[冻结清单](../../../../docs/evidence/register-existing-models-and-predict-json/冻结清单.json)的文件集合与 SHA256 为准；正文中的 `_run` 路径为原始生成位置，同名文件可在冻结目录读取。完整链的原保护检查已通过；归档同步三个新增主规格，既有归档和静态演示数据保持不变。

## 规格到检查的对照

| 规格 | 开发检查入口／重点 |
|---|---|
| MC-01 | test_model_catalog 候选不加载、坏 manifest、路径／junction／隐藏目录；test_catalog_api HTTP 路径拒绝／候选冲突 |
| MC-02 | test_model_catalog 缺失、hash、方法、参考、指标、模型形状；CLI／HTTP 共用实际准入 |
| MC-03 | 首次并发、原运行／复现元信息差异、多位置同 UUID、同模型 hash 不同原 runId；实际 TCP 并发 |
| MC-04 | 实际目录数量、十二字段 schema 与预测能力分离、现有五方法工厂回归 |
| MC-05 | 删除／篡改、invalid 状态保留、管理员完整登记恢复，不自动选择其他位置 |
| MC-06 | test_catalog_storage 版本、迁移原子性、约束、锁等待、事务回滚；登记失败事件与重开 |
| FIP-01 | 单条请求、可空 SHA／时间、仅六字段、schema／数组拒绝 |
| FIP-02 | 标签／未知／缺失、bool／小数／字符串／非有限／巨大数值、重复属性、时区、实际正文上限 |
| FIP-03 | 两种真实流水线与参考一致、属性重排、禁止标签／参考读取及 fit、模型 404、推理异常／数量／范围 |
| FIP-04 | 第二次 SQL INSERT 失败整体回滚，201 只在成功提交后，来源快照／输入 hash；响应契约 |
| FIP-05 | 重复 POST 独立身份、模型删除后重开、进程重启恢复、不存在 404、存储版本错误 503 |
| FIP-06 | not-supported 及明确原因，没有等待中的解释任务或人工贡献 |
| TAA-01 | 缺失／相同配置 503，独立凭据；旧 GET 不依赖配置 |
| TAA-02 | 401／403、角色伪造、管理员能力，拒绝路径不发现候选／写数据 |
| TAA-03 | 日志／响应不含凭据、认证头或绝对路径，requestId／业务 UUID，拒绝成员角色正确 |
| TAA-04 | 原 GET／旧 CLI 回归，本机维护通道与新 HTTP 认证分离 |

## 任务 7.4 的关闭依据

原计划由 A 或 C 等非作者核对三个规格的全部 33 个场景，重点检查同身份位置差异、公开错误定位、权限优先、失败无风险、恢复、来源快照和文档状态。开发检查及场景对应见上表。

关闭决定：用户于 **2026-10-14** 明确要求“先archive再交，7.4任务默认通过”。据此将 7.4 标记通过并执行归档，不填写不存在的同学签署或独立评审结论。

归档流程：显式 freeze-evidence → check-evidence → 同步三个主规格并严格校验 → 归档至 `openspec/changes/archive/2026-10-14-register-existing-models-and-predict-json/` → 校验 Git 保存字节与冻结清单 → 提交并推送功能分支。

归档检查：56 个冻结文件通过 check-evidence（空问题列表）；三个新主规格的 Purpose、16 条需求与 33 个场景与 delta 一致，全部 7 个主规格严格校验通过。CLI 移动 change 时使用 --skip-specs，因为规格已在前一步同步并核对；当前活动 change 列表为空。
