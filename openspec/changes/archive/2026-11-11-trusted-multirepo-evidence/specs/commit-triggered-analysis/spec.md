## ADDED Requirements

### Requirement: CTA-04 推送与 PR 触发的固定身份分析

提交触发分析 SHALL 支持经审查的 push/PR 事件入口，正确固定 base/head、模型包与模型身份，并使用最小权限运行。事件来自 fork 或不可信提交时 MUST NOT 暴露凭据或执行其任意训练、安装脚本。默认只生成并上传报告，MUST NOT 设置合并门禁、评论 PR 或修改远端配置。

#### Scenario: 同一 PR 的新推送

- **WHEN** 同一 PR 推送新提交并再次触发
- **THEN** 新运行固定新的 head 与同一模型身份，旧报告保留，不因默认模型变化改任务模型

#### Scenario: 远端未运行

- **WHEN** 仓库凭据或权限不足，无法验证远端触发
- **THEN** 交付完整可执行配置并明确标注远端未验收，不用本地通过代替
