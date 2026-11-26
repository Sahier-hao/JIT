# Spec Delta

## ADDED Requirements

### Requirement: FPR-19 提交详情的历史修复证据

固定分析的提交详情 SHALL 对正例展示已保存的后续修复证据，并允许从证据跳转到修复提交 diff 的对应文件与行号。证据 MUST 标注为历史参考而非模型生成的修复建议，MUST NOT 改写原分数、分析身份或历史标签。

#### Scenario: 正例有修复记录

- **WHEN** 用户打开带有修复证据的正例提交
- **THEN** 显示修复提交、文件、日期、修复 diff 行和引入行
- **AND** 有可用仓库地址时提供修复 diff 链接

#### Scenario: 正例缺少修复明细

- **WHEN** 正例标签存在但修复证据为空
- **THEN** 明确说明明细缺失，不补造提交或行号
