# Spec Delta

## ADDED Requirements

### Requirement: CCL-08 高置信 Python 规则扩展

静态候选分析 SHALL 在原有可变默认参数、裸 except、eval/exec 规则之外，识别显式 `subprocess` shell、缺少 Loader 的 `yaml.load`、显式关闭 requests TLS 校验和 `tempfile.mktemp`。每条规则 MUST 有稳定的规则标识、标题、理由、人工核对项和可核对示例；没有明确模板时 MUST 不生成建议。

#### Scenario: 新规则命中

- **WHEN** Python 文件显式使用 `shell=True`、无 Loader 的 `yaml.load`、`verify=False` 或 `tempfile.mktemp`
- **THEN** 返回对应规则、证据、位置和规则专用建议

#### Scenario: 反例

- **WHEN** 调用显式传入安全 Loader、保持证书校验、使用原子临时文件接口或未开启 shell
- **THEN** 对应新规则不生成候选

#### Scenario: 没有模板

- **WHEN** 规则标识没有登记建议模板
- **THEN** 建议为空，不编造通用修复

### Requirement: CCL-09 规则版本隔离

规则或分析器升级 SHALL 使用新的版本标识，旧候选 MUST 保留在旧版本下。系统读取旧结果时 MUST 按旧版本返回并明确标记为 legacy，MUST NOT 与当前规则结果混列、静默重算或把新规则追加到历史结果。

#### Scenario: 读取旧结果

- **WHEN** 某快照只有旧规则结果
- **THEN** 返回旧版本候选、规则版本和 legacy 状态
- **AND** 页面标注旧规则结果未重算

#### Scenario: 生成新结果

- **WHEN** 用户重新检查当前快照
- **THEN** 新结果写入当前分析器与规则版本，旧版本记录保持可读且不参与当前列表
