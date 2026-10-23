# JIT 缺陷预测 · 提交评审

面向评审员的本机课程项目：建立项目、发起分析、查看提交风险与详情，安排个人审查计划。管理员在独立工作区登录后维护模型、数据和验证记录。

用户从「新建项目」登记公开 HTTP(S) 仓库，再在项目内选择范围与实际可用模型。分析保留独立记录，支持进度跟踪、历史分页、结果切换和修改参数后重试。采集使用简化 SZZ，模型分数不代表已确认缺陷。

- [当前产品、运行与开发入口](docs/当前产品.md)
- [项目交付约定](AGENTS.md)

- [后端安装、固定训练与本机服务](backend/README.md)
- [产品需求文档（目标与验收）](docs/产品需求文档.md)
- [产品设计文档（共享方案与契约）](docs/产品设计文档.md)
- [数据与标签原始依据](backend/DATA.md)
- [冻结实验口径](backend/PROTOCOL.md)
- [前端运行与操作](frontend/README.md)
- [真实基线结果与复现](docs/evidence/connect-public-data-baseline-review/baseline-report.md)
- [已归档 change](openspec/changes/archive/2026-10-11-connect-public-data-baseline-review/proposal.md)

前端：127.0.0.1:4173；API：127.0.0.1:8000。用户入口 `#/projects`，管理员入口 `#/admin`。首次进入管理工作区建立账户，后续凭密码登录；没有默认密码。管理员可设置仓库分析默认模型、启用或停用模型；用户明确选择优先，历史结果保留。升级前备份目录库，再执行 `catalog-init` 应用迁移 008。历史需求、规格与证据保留各自的版本和日期。
