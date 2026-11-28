## ADDED Requirements

### Requirement: PPT-06 自动打分结果与页面同步

项目 PR 列表 SHALL 展示最近自动分析使用的固定模型、固定 head SHA、可展开提交列表、最近检查时间和自动分析状态。后台自动发现新 PR 或 PR 新 head 后 MUST 在无需用户手点单 PR「分析」的情况下排队并执行；页面 MUST 在自动打分开启时周期读取本地缓存以反映排队、运行、完成或失败状态。页面 MUST NOT 把本地刷新当作远端检查，也 MUST NOT 替换项目固定模型。

#### Scenario: 新 PR 自动发现

- **WHEN** 后台周期检查发现新的开放非草稿 PR
- **THEN** 系统按项目固定模型创建自动分析意图并排队

#### Scenario: PR 推送新 head

- **WHEN** 同一 PR 的 head SHA 在远端更新
- **THEN** 新快照成为自动分析目标，旧未开始任务可过时，页面显示新 head 与状态

#### Scenario: 页面无需手动分析

- **WHEN** 项目自动打分开启且用户停留在 PR 列表
- **THEN** 页面周期性显示后台分析状态、固定模型和提交身份

#### Scenario: 真实远端不可用

- **WHEN** 当前环境没有 GitHub 凭据或网络不可达
- **THEN** 系统如实显示失败或缓存状态，保留可复现的演练命令，不伪造远端时间线
