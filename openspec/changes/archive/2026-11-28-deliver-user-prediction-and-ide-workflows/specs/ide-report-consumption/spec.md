## ADDED Requirements

### Requirement: IDC-08 提交后检查的真实模型选择

后端 SHALL 提供只读模型列表命令，列出目录库中已启用、ready 且所有入模字段都能由提交采集生成的真实模型。VS Code 扩展 SHALL 在配置提交后检查和独立模型选择命令中通过 QuickPick 选择模型；命令不可用时 MAY 回退手工输入真实 `modelId`，MUST NOT 编造候选、静默使用默认模型或替换已选模型。

#### Scenario: 模型列表可用

- **WHEN** 用户打开提交后检查配置或「JIT: 选择模型」
- **THEN** 扩展展示真实模型名称、方法、schema、运行和默认状态

#### Scenario: 选择模型

- **WHEN** 用户从 QuickPick 选择模型
- **THEN** 扩展保存该 `modelId`，后续自动检查显式传给 CLI

#### Scenario: 模型列表不可用

- **WHEN** 模型列表命令失败
- **THEN** 扩展要求手工输入真实 `modelId`，并与执行失败分别提示

#### Scenario: 没有兼容模型

- **WHEN** 目录库没有可用模型
- **THEN** 扩展说明原因且不生成伪造选项

### Requirement: IDC-09 提交解释与统一证据术语

提交分析报告 SHALL 为评分提交附带可选提交级解释，包含状态、方法、贡献项和中文摘要；解释失败 MUST 降级为 `not-supported` 且不改变分数。VS Code 扩展 SHALL 从提交节点、通知和命令面板提供只读解释入口，展示提交 SHA、模型身份、提交级预测分数、中文摘要和 Top 特征贡献。扩展 MUST NOT 把报告文本当 HTML、命令或可执行内容。状态栏、tooltip、通知、树视图、Problems 和解释视图 SHALL 统一使用「提交级预测分数」与「可疑代码行」，每条可疑代码行 MUST 展示规则 ID、命中证据和说明并可跳转。

#### Scenario: 成功解释

- **WHEN** 报告包含 supported 解释
- **THEN** 扩展打开只读虚拟 Markdown，展示分数、模型与特征贡献

#### Scenario: 解释失败

- **WHEN** 报告标注 not-supported
- **THEN** 扩展展示原因且保留原提交分数

#### Scenario: 可疑代码行

- **WHEN** 用户打开 Problems 或侧栏候选
- **THEN** 条目显示规则 ID、命中证据、说明和文件行号，点击定位

#### Scenario: 报告内容不可信

- **WHEN** 报告文本包含 HTML 或命令片段
- **THEN** 扩展只按纯文本数据展示，不执行或注入
