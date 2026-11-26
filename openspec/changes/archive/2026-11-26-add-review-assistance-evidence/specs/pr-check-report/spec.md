# Spec Delta

## ADDED Requirements

### Requirement: PCR-07 离线报告中的后续修复证据

离线 PR 分析包 SHALL 在可用时携带已保存的后续修复证据，包括修复提交、文件、证据时间、引入行和修复侧行；JSON 报告 MUST 保留结构，Markdown 报告 MUST 展示文件与行号。证据 MUST 只读，MUST NOT 生成补丁、自动评论或改变原有分数与身份校验。

#### Scenario: 导出含证据的分析包

- **WHEN** 固定分析关联了后续修复证据
- **THEN** 分析包包含逐提交证据，内容哈希覆盖这些字段

#### Scenario: 生成 Markdown

- **WHEN** 分析包含修复证据
- **THEN** Markdown 增加修复证据表，并尽可能链接到修复提交 diff 的对应文件与行号

#### Scenario: 旧分析包没有证据

- **WHEN** 读取旧版分析包
- **THEN** 报告仍可生成，不补造证据或改变既有退出码
