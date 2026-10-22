# Spec Delta

## MODIFIED Requirements

### Requirement: WSN-02 对象上下文可恢复

项目、分析与验证报告页面 SHALL 在地址中显式携带对应对象身份；页面内容 MUST 属于地址所指的项目与分析。进入报告后返回、浏览器前进后退或刷新 MUST 恢复原对象，MUST NOT 默认改选第一项目或最新分析。首次访问没有项目时 SHALL 提供新建项目入口；对象不存在或不可访问时 MUST 给出反馈与返回项目入口。既有旧地址 SHALL 映射到同一项目与分析，MUST NOT 静默丢弃对象。

#### Scenario: 第二仓库往返

- **WHEN** 用户在仓库 B 的分析 B1 筛选并打开详情，进入验证报告后返回
- **THEN** 仍查看 B/B1，原有效筛选、详情身份与计划状态恢复，不切换到仓库 A

#### Scenario: 刷新项目页

- **WHEN** 用户刷新 `#/projects/<项目标识>`
- **THEN** 仍是同一项目，当前结果与分析记录不切换到其他项目

#### Scenario: 旧地址进入分析

- **WHEN** 用户打开旧的仓库分析地址（`#/repositories/<id>/analyses/<syncId>/commits`）
- **THEN** 落到同一项目同一分析的审查页，项目与分析身份不变

#### Scenario: 深链接对象失效

- **WHEN** 用户刷新包含已不存在项目或分析的地址
- **THEN** 页面指出该对象不可用并提供返回项目入口的操作，不显示其他项目或最新分析冒充原对象
