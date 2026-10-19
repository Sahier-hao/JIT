## ADDED Requirements

### Requirement: PDB-23 effort-aware 指标 Popt 与 IFA

当运行声明的指标集包含这两项时，系统 SHALL 记录 **Popt** 与 **IFA**，并 MUST 给出足以手算复核的定义与中间量。Popt MUST 为**全成本范围、density-ranked** 的归一化面积；`Recall@20%LOC` 仍为 **risk-ranked、20% 预算、整条提交前缀停止**，二者 MUST NOT 互相冒名或合并成同一指标名。IFA MUST 为按既有风险序扫描时**首个正标签之前的负标签条数**。任一项无法定义时 MUST 返回 null 与原因，不得填 0；未声明这两项指标的既有运行 MUST 保持原有指标集与结果不变。

#### Scenario: 手算样例可核算

- **WHEN** 测试集标签为 `[1,0,1,0]`、风险为 `[.9,.8,.2,.1]`、LOC 为 `[1,1,4,4]`
- **THEN** IFA 为 `0`（最高风险条目本身就是正例）
- **AND** Popt 的模型／oracle／worst 面积分别为 `0.775`／`0.825`／`0.175`，归一化结果为 `12/13 ≈ 0.923077`
- **AND** 另取标签 `[0,1,1,0]` 时 IFA 为 `1`（首个正例前有 1 个负例）

#### Scenario: 密度排序与全成本范围

- **WHEN** 计算 Popt
- **THEN** 模型顺序按 `risk/(la+ld)` 降序（同分按时间降序、标识升序），oracle 按 `label/(la+ld)` 降序、worst 取 oracle 反向
- **AND** 横轴覆盖累计成本 0 到总成本，纵轴为累计正例占比，面积按梯形计算并记录三个面积值
- **AND** 报告把 Popt 标为 density-ranked、全范围，与 risk-ranked 的 `Recall@20%LOC` 分开呈现

#### Scenario: IFA 定义

- **WHEN** 按既有风险序扫描测试集
- **THEN** IFA 为首个正标签之前出现的负标签数量（首个即正例时为 0）

#### Scenario: 未定义时返回原因

- **WHEN** 总工作量为 0、没有正标签，或 oracle 与 worst 面积相等
- **THEN** 对应指标返回 null 与可读原因，其余已定义指标照常保留

#### Scenario: 指标集版本隔离

- **WHEN** 一个运行声明 `metric-set-v1`，另一个声明 `metric-set-v2`
- **THEN** v1 运行不出现新指标、结果与既有记录一致
- **AND** 两者不因指标集不同而声称可直接排名，比较报告如实声明差异
