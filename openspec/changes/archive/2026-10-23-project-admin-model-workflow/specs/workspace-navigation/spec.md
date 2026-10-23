# Spec Delta

## ADDED Requirements

### Requirement: WSN-07 管理路由与普通项目分区

管理区 SHALL 使用 `#/admin/models`、`#/admin/datasets` 与 `#/admin/reports`，普通主导航 SHALL 保持项目审查任务。管理入口 MUST 在桌面及 390px 窄屏可达。旧报告地址 SHALL 解析同一运行/视图后进入受保护管理区；旧模型/预测/连接工具地址 MUST 继续明确退役，不静默重新激活。

#### Scenario: 普通项目进入管理员页面
- **WHEN** 用户从项目导航打开管理工作区
- **THEN** 进入独立管理上下文，未登录先登录，不在普通项目正文展示数据验证记录

#### Scenario: 旧报告深链接要求登录
- **WHEN** 用户访问旧报告或历史运行地址
- **THEN** 保留原 runId 与视图语义，先检查管理员会话；不以公开报告绕过服务器权限

#### Scenario: 窄屏管理入口
- **WHEN** 用户在 390px 视口打开项目或管理登录页
- **THEN** 管理入口可见、可操作且页面无横向溢出
