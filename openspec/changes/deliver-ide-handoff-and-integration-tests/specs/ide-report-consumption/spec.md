## ADDED Requirements

### Requirement: IDC-06 CI 报告交接与跨 IDE 可行性

系统 SHALL 让 CI 以固定模型和明确提交范围生成 `jit-commit-analysis-v1` 报告产物；产物 MUST 记录仓库、基准与目标 SHA、模型与运行身份、覆盖范围和限制，供开发者下载并在 IDE 中显式导入。CI 分析失败时 MUST NOT 生成替代报告或把失败当作已交付；CI MAY 上传报告产物，但 MUST NOT 评论 PR、阻断合并或修改分支保护。真实仓库回归 MUST 使用 CI 或离线生成的报告核对仓库、提交与工作树身份；工作树修改、分支切换、文件重命名或删除、过期报告与重新生成 MUST 给出明确状态且不错误定位。Eclipse 与 Visual Studio 的交付 MUST 先给出成本、插件 API、`jit-commit-analysis-v1` 协议复用与风险结论；未实际完成插件时 MUST NOT 声明已交付。

#### Scenario: CI 报告交接

- **WHEN** PR CI 成功生成固定提交范围的报告
- **THEN** 报告产物包含身份、覆盖和限制，开发者可下载并在 IDE 中显式导入核对

#### Scenario: CI 分析失败

- **WHEN** CI 分析失败或缺少固定模型包
- **THEN** 不生成替代报告，失败状态保留，CI 不评论 PR、不阻断合并

#### Scenario: 真实仓库回归

- **WHEN** 在真实仓库导入报告并切换分支、修改工作树或使用过期报告
- **THEN** IDE 显示身份或版本不匹配并拒绝错误定位，恢复后可重新核对或导入新报告

#### Scenario: 跨 IDE 结论

- **WHEN** 审核 Eclipse 与 Visual Studio 的可行性结论
- **THEN** 文档给出成本、插件 API、协议复用和风险，并明确未交付完整插件
