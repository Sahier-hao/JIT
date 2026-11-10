# ide-report-consumption Specification

## Purpose
让 IDE 只读消费已生成的提交分析报告，在核对仓库与提交身份后展示风险、候选和建议，并拒绝在过期版本上定位。

## Requirements

### Requirement: IDC-01 导入与身份核对

IDE 扩展 SHALL 允许用户显式导入检查包或报告，并核对报告中的仓库标识、提交 SHA、文件路径与行号。报告与当前工作区或当前提交不匹配时 MUST 显示过期或不匹配状态，MUST NOT 在错误版本上标注位置。

#### Scenario: 身份匹配

- **WHEN** 用户导入与当前工作区仓库和提交一致的报告
- **THEN** 扩展展示提交风险列表与候选位置，并可跳转到对应文件行

#### Scenario: 身份不匹配

- **WHEN** 报告的目标 SHA 与当前检出不一致
- **THEN** 扩展显示不一致状态和原因，不标注代码行

#### Scenario: 文件已变化

- **WHEN** 报告中的文件路径在当前工作区不存在或行号超出范围
- **THEN** 该条目显示不可定位原因，不跳到错误位置

### Requirement: IDC-02 只读与不可信内容

扩展 MUST 只读消费报告，MUST NOT 修改源码、自动应用修复建议或执行报告中的命令与 HTML。报告中的路径、文本和链接 MUST 视为不可信数据，MUST NOT 被当作指令执行。

#### Scenario: 不自动修复

- **WHEN** 用户查看候选与修复建议
- **THEN** 扩展只展示建议和定位信息，不写入或修改源码

### Requirement: IDC-03 与 Web 同一口径

IDE 展示的分数、规则与覆盖 MUST 与 Web 报告使用同一份数据与定义，MUST NOT 把静态规则候选换算成行级缺陷概率，MUST NOT 补造缺失指标。

#### Scenario: 同一条目

- **WHEN** 同一报告在 Web 与 IDE 中打开
- **THEN** 两侧显示相同的提交分数、规则标识和覆盖说明

### Requirement: IDC-04 安装与冒烟验证

系统 SHALL 提供扩展的构建、调试与演示步骤。验证 MUST 至少覆盖构建与扩展宿主的实际冒烟；环境不支持宿主时 MUST 记录具体缺口，MUST NOT 宣称 IDE 旅程已通过。

#### Scenario: 构建成功

- **WHEN** 按文档执行扩展构建
- **THEN** 生成可安装的扩展包并记录构建输出

#### Scenario: 宿主不可用

- **WHEN** 当前环境无法启动 IDE 扩展宿主
- **THEN** 记录不可验证的原因和已完成的构建/静态检查范围
