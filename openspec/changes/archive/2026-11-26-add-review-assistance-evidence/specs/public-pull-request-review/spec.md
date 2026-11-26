# Spec Delta

## ADDED Requirements

### Requirement: PPR-09 只读后续修复证据

PR 只读详情 SHALL 对已保存正例提交展示后续修复证据，包括修复提交、文件、日期、修复侧行与引入行，并 SHALL 在可用时链接到修复提交 diff 的对应文件与行号。证据 MUST 来自固定快照关联的已保存数据，MUST NOT 生成、应用或声称已应用修复补丁。

#### Scenario: 选择有证据的提交

- **WHEN** 用户打开存在后续修复证据的提交
- **THEN** 显示只读证据列表和 diff 行链接
- **AND** 不改变模型分数、文件映射或个人草稿

#### Scenario: 没有证据

- **WHEN** 提交没有修复证据
- **THEN** 不显示伪造的修复记录
