## ADDED Requirements

### Requirement: RCL-25 采集标签成熟状态的持久化

仓库采集 SHALL 在 CSV、描述文件和查询投影中持久保存标签状态 `positive`、`unobserved`、`immature`，以及观察终点、成熟期和简化 SZZ 规则版本。同一提交的成熟状态 MUST 能由保存的提交时间和观察终点重算；旧产物缺少该字段时 MUST 保持兼容并明确“未记录”，不得推测为已成熟。

#### Scenario: 新建数据集包含成熟字段

- **WHEN** 采集任务完成并登记 `kamei14-git-v2` 数据集
- **THEN** CSV 的每条记录和描述文件均可核对标签状态
- **AND** 描述文件给出三种状态的数量和成熟截止时间

#### Scenario: 旧数据集升级查看

- **WHEN** 用户读取升级前生成的仓库数据集
- **THEN** 原文件与标签保持不变，界面显示成熟状态未记录
