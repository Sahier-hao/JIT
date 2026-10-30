# Spec Delta

## Purpose

让项目公开事件以固定来源和幂等身份进入站内提醒，使用户能回到对应快照或分析，同时不把公开提醒混同于个人审查状态或 PR 整体风险。

## ADDED Requirements

### Requirement: PNT-01 持久事件与固定引用

系统 SHALL 为项目 PR 发现、版本更新、开放/关闭/合并、分析就绪与需处理失败保存持久事件。事件 MUST 包含项目、PR、快照及可用的任务或模型身份，MUST NOT 生成 PR 整体风险值；重复检查或重启 MUST 按幂等键收敛为同一事件。

#### Scenario: 重复检查
- **WHEN** 同一快照被重复发现
- **THEN** 不重复创建事件，原有事件保持

#### Scenario: 事件来源
- **WHEN** 用户查看事件详情
- **THEN** 显示项目、PR、快照与模型等固定引用，不显示整体风险分

#### Scenario: 过时结果
- **WHEN** 旧快照的任务完成
- **THEN** 事件标为历史，不冒充当前快照结果

### Requirement: PNT-02 站内提醒与本地已读

站内提醒 SHALL 按时间倒序分页展示项目公开事件。已读状态 MUST 只保存在当前浏览器，MUST NOT 声称账户同步；已读不等于已复核。点开提醒 SHALL 进入对应固定来源或固定分析，MUST NOT 自动创建、切换或改写个人草稿。

#### Scenario: 标为已读
- **WHEN** 用户标记事件已读
- **THEN** 只更新当前浏览器的已读记录，不改变服务端事件或私人工作

#### Scenario: 打开固定来源
- **WHEN** 用户从提醒查看来源
- **THEN** 进入绑定该快照的只读预览或固定分析，不以最新版本冒充

#### Scenario: 私人工作不变
- **WHEN** 新事件出现
- **THEN** 不自动建立工作单、不切换当前轮次，也不改动笔记与问题

### Requirement: PNT-03 初始化摘要与覆盖说明

项目首次启用跟踪 SHALL 将现有开放 PR 的发现合并为摘要事件，MUST NOT 为每个 PR 刷屏。分析就绪事件 SHALL 说明实际评分提交数、覆盖是否完整与固定模型；覆盖不完整时 MUST 明确不能视为低风险结论。

#### Scenario: 首次扫描
- **WHEN** 项目首次启用并发现多个开放 PR
- **THEN** 生成一条摘要事件说明数量与范围

#### Scenario: 覆盖不完整
- **WHEN** 分析只覆盖部分 PR 提交
- **THEN** 就绪事件说明缺失范围，不把未覆盖条目当作低风险

#### Scenario: 高分提交
- **WHEN** 分析包含高分档提交
- **THEN** 事件说明数量，但不称其为缺陷或 PR 整体风险

### Requirement: PNT-04 分支新提交提醒

系统 SHALL 在分支检查发现与当前分析 HEAD 不同的新 HEAD 时写一条 `branch-updated` 事件，包含项目、分支、新 HEAD 与上次已分析 HEAD；MUST NOT 自动创建分析。事件 SHALL 按项目、分支和 HEAD 幂等；分析完成同一 HEAD 后 SHALL 不再为待处理。

#### Scenario: 发现新提交
- **WHEN** 分支检查发现新 HEAD
- **THEN** 写一条分支提醒，显示分支和短 HEAD，不创建分析记录

#### Scenario: 同一 HEAD 再次检查
- **WHEN** 同一项目、分支和 HEAD 被再次检查
- **THEN** 不新增重复事件

#### Scenario: 完成对应分析
- **WHEN** 用户发起分析并完成同一 HEAD
- **THEN** 提醒不再为待处理，项目分析结果更新
