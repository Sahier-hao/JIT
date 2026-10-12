# JIT 缺陷预测 · 提交评审

面向评审员的桌面课程项目：从历史提交的模型风险出发，查看原始改动度量并维护个人优先审查清单。默认真实历史回放，提供明确的人工演示入口。公开数据六字段和一个固定模型是首轮真实链路，完整 Kamei14、后续模型、预测解释与在线预测仍待后续 change。

- [后端安装、固定训练与本机服务](backend/README.md)
- [产品需求文档（目标与验收）](docs/产品需求文档.md)
- [产品设计文档（共享方案与契约）](docs/产品设计文档.md)
- [数据与标签原始依据](backend/DATA.md)
- [冻结实验口径](backend/PROTOCOL.md)
- [前端运行与操作](frontend/README.md)
- [真实基线结果与复现](docs/evidence/connect-public-data-baseline-review/baseline-report.md)
- [已归档 change](openspec/changes/archive/2026-10-11-connect-public-data-baseline-review/proposal.md)

前端 dev/preview：127.0.0.1:4173；只读推理：127.0.0.1:8000。模型与原始数据留在本机、通过固定下载命令复现。服务错误显示原因和重试，不自动显示人工分数。历史观测标签与模型风险均不构成已确认缺陷。
