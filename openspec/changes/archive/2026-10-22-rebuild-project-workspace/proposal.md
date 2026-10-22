## Why

前端只有「新建分析」一个入口：建立项目时必须同时给出分析范围，项目与分析混在一起；一个项目做过几次分析、哪次是当前结果无处可看；分析失败后没有记录，只能重新填一遍表单。

后端已经在 `add-project-management` 中补齐项目管理与分析记录接口，前端这次把信息架构改成「项目 → 分析」两层：

- 新建项目只登记仓库地址；
- 分析属于项目，可多次发起，每次产生一条记录；
- 项目页同时呈现当前结果、发起分析与分析记录；
- 失败与中断保留在记录里，可查看原因并用原参数重试。

本 change 把已实现的界面契约写回规格，覆盖 FPR-02 的分析流程与 WSN-02 的对象上下文。

## What Changes

- 路由改为 `#/projects`、`#/projects/new`、`#/projects/:id`；审查页固定在 `#/projects/:id/analyses/:syncId/(commits|plan)`，旧地址继续映射到同一对象。
- 新增项目页三段：当前分析结果（计数、数据版本、模型策略、进入审查）、发起分析（分支/范围/上限/策略）、分析记录（打开结果、原参数重试、删除记录）。
- 项目页提供重命名与带确认的硬删除；有在途分析时删除返回冲突并提示等待。
- 没有成功结果时显示「还没有可用的分析结果」并区分「上次失败」与「从未分析」；删除当前结果记录后项目回到无结果，不回退旧结果。
- 分析记录分页倒序；记录删除只允许已结束的作业。
- 导航保持「项目」「验证报告」，外观仍是轻量控件。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `focused-project-review`：FPR-02 改为项目与分析分离的流程（新建项目只收地址、分析在项目页发起、每次分析一条记录、当前结果只认最近成功）。
- `workspace-navigation`：WSN-02 扩展到项目与分析的地址身份，并说明旧地址兼容。

## Impact

- 前端：`frontend/src/{navigation,projectClient,projectStatus,App}.tsx`、`pages/{ProjectsPage,NewProjectPage,ProjectPage}.tsx`、`components/AnalysisForm.tsx`、`styles/product.css`；删除 `RepositorySourcesPage`。
- 测试：新增 `projectClient`、`NewProjectPage`、`ProjectPage` 等用例；前端 26 文件 / 223 用例。
- 后端：无新增改动，接口来自已归档的 `add-project-management`（RCL-15/16/17）。
- 迁移：无。
