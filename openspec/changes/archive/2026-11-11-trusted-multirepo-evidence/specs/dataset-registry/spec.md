## ADDED Requirements

### Requirement: DSR-11 批处理数据版本的来源与重建

登记批处理产出的数据版本时，系统 SHALL 额外记录仓库、固定 revision、观察终点、SZZ 版本、成熟期与逐仓库计数，并保持与单项目版本的相同哈希与不可覆盖规则。旧版本标签 MUST NOT 被新 SZZ 规则改写；重建 MUST 生成新版本并说明与旧版本的关系。

#### Scenario: 重建旧 simple-SZZ 数据

- **WHEN** 使用完整 SZZ 重建同一仓库历史
- **THEN** 生成新的数据版本身份，旧版本文件与标签保持不变，两者可并列核对

#### Scenario: 源文件变化

- **WHEN** 同名版本的 CSV 内容或描述哈希与登记不一致
- **THEN** 登记失败并给出具体版本与哈希，不覆盖既有文件
