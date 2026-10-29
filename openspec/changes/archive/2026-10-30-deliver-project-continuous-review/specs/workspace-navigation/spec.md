# Spec Delta

## MODIFIED Requirements

### Requirement: WSN-02 对象上下文可恢复

项目、分析与验证报告页面 SHALL 在地址中显式携带对应对象身份；页面内容 MUST 属于地址所指的项目与分析。项目子视图、固定 PR 快照与趋势视图 SHALL 在地址中保留项目 ID、子视图、snapshotId 或 viewId；概览与分析使用各自地址，刷新、前进后退或重开 MUST 恢复原对象与原视图，MUST NOT 默认改选第一项目、最新分析或最新趋势。进入报告后返回、浏览器前进后退或刷新 MUST 恢复原对象，MUST NOT 默认改选第一项目或最新分析。返回控件 SHALL 指向明确的上一级对象并用文字说明目的地：审查页回到所属项目页，项目页回到项目列表；不同层级 MUST NOT 用同一文案指向不同页面。首次访问没有项目时 SHALL 提供新建项目入口；对象不存在或不可访问时 MUST 给出反馈与返回项目入口。既有旧地址 SHALL 映射到同一项目与分析，MUST NOT 静默丢弃对象；旧 PR 工作单地址 SHALL 进入同一 PR 和本地记录。

#### Scenario: 第二仓库往返

- **WHEN** 用户在仓库 B 的分析 B1 筛选并打开详情，进入验证报告后返回
- **THEN** 仍查看 B/B1，原有效筛选、详情身份与计划状态恢复，不切换到仓库 A

#### Scenario: 刷新项目页

- **WHEN** 用户刷新 `#/projects/<项目标识>`
- **THEN** 仍是同一项目，当前结果与分析记录不切换到其他项目

#### Scenario: 从审查页返回

- **WHEN** 用户在审查页点击返回控件
- **THEN** 回到该分析所属的项目页，而不是项目列表或其他项目；项目页上的返回控件指向全部项目

#### Scenario: 旧地址进入分析

- **WHEN** 用户打开旧的仓库分析地址（`#/repositories/<id>/analyses/<syncId>/commits`）
- **THEN** 落到同一项目同一分析的审查页，项目与分析身份不变

#### Scenario: 深链接对象失效

- **WHEN** 用户刷新包含已不存在项目或分析的地址
- **THEN** 页面指出该对象不可用并提供返回项目入口的操作，不显示其他项目或最新分析冒充原对象

#### Scenario: 项目子视图刷新

- **WHEN** 用户刷新 `#/projects/<id>/overview`、`/analyses`、`/prs` 或 `/trends`
- **THEN** 均停留在同一项目的同一子视图；`/analyses` 显示分析结果与记录，`/overview` 显示仓库概览，不回到其他项目

#### Scenario: 固定 PR 快照重开

- **WHEN** 用户重开带 snapshotId 的固定 PR 预览地址
- **THEN** 读取同一 PR 的同一快照，不以最新远端版本替代，个人草稿与当前轮次不变

#### Scenario: 趋势视图重开

- **WHEN** 用户重开 `#/projects/<id>/trends/<viewId>`
- **THEN** 读取同一固定视图的来源与口径，不自动改为最新趋势或单次分析
