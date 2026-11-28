# Spec Delta

## ADDED Requirements

### Requirement: WSN-10 文档入口与公开地址

系统 SHALL 在公开首页提供文字「文档」入口，并在已登录用户工作区右上角提供可发现的文档入口。两个入口 MUST 指向 `#/docs`；刷新文档地址、直接打开或从业务页面进入 MUST 保持文档身份，且文档阅读本身 MUST NOT 要求登录。

#### Scenario: 首页发现文档

- **WHEN** 未登录用户打开产品首页
- **THEN** 页面可见文字「文档」入口并能进入文档首页

#### Scenario: 工作区发现文档

- **WHEN** 用户已登录并位于项目、分支分析或 PR 审查页面
- **THEN** 右上角可见文档入口，进入后地址为 `#/docs`

#### Scenario: 文档地址恢复

- **WHEN** 用户刷新或重新打开 `#/docs/:slug`
- **THEN** 仍显示同一篇文章，不进入登录页或改选其他工作台页面
