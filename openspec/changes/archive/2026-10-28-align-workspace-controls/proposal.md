# 统一工作区控件与状态表面

## Why

审查队列与 PR 工作单已经重建，但同一次改版没有覆盖其余页面。项目详情页的仓库更新仍用浏览器原生复选框、文本输入、数字输入和文件选择；管理区的登录表单、模型刷新按钮和数据版本折叠块也是原控件；计划备份区同样如此。这些原生控件在同一个页面里与新的组件表面并排出现，按钮高度、边框、焦点环和禁用态各不相同，用户看到的是"一半是产品、一半是原型"。

同一批页面还有第二个问题：次要文字统一取同一个灰值，11 到 12 像素的说明、标签和表尾全部落在同一种浅灰上，整页读起来发虚。审查队列、分析页、验证报告页和对比页在这一轮之前也没有统一的控件表面，同一个「重新加载」在不同页面分别是原生按钮和组件按钮。

## What Changes

- 项目详情页的仓库更新：自动检查开关、跟踪分支、更新模型、检查频率、时间窗口、提交上限、保存与立即更新按钮改用统一组件，更新设置改为带指示箭头的折叠区。
- 审查工作单的版本说明、输出意见、个人草稿备份三个抽屉：备份与反馈区块去掉页面级分隔线，按钮与说明分行排列，文件选择走隐藏输入加按钮，不再出现浏览器原生的"选择文件"控件。
- 管理区：登录与初始化表单改用统一输入框与按钮，去掉装饰性英文眉标；工具栏、刷新按钮改用统一按钮；数据版本的展开改用统一折叠面板。
- 全站主按钮色与产品既有主操作保持一致（深墨色），强调色只用于选中、链接与状态。
- 四个主题的次要文字与分隔线各加深一档：`--fg-2`、`--fg-3`、`--line`、`--line-strong`、`--line-soft`、`--sunken` 在默认、steel、charcoal、paper 四套主题里同步调整，辅助信息不再与装饰性灰色混在一起。
- 审查队列、项目列表、项目详情、分析、验证报告、对比、趋势与管理区的原生按钮、输入框与下拉全部改用同一套组件；带图标的按钮补可访问名称，避免图标文本混进按钮名。
- 分析页工具条的原生日期输入与组件下拉统一到同一高度，搜索框恢复左侧内边距；空态与失败态由带阴影的大圆角卡片改为虚线紧凑块；项目状态从标题下方的独立一行移到标题右侧。

## Capabilities

### New

无。

### Modified

- `interface-presentation`：新增一条要求，规定工作区内不再出现浏览器原生表单控件，且同一动作在主工作区与管理区使用同一套按钮层级。

## Impact

- 代码：`frontend/src/pages/AdminWorkspace.tsx`、`frontend/src/components/{RepositoryUpdates,PlanTransfer,AnalysisForm,PRModelClues,RepositoryExplanation}.tsx`、`frontend/src/pages/{PullRequestJourney,ProjectsPage,ProjectPage,NewProjectPage,AnalysisComparison,ModelPolicyCards}.tsx`、`frontend/src/{ReviewWorkbench,VerificationReport,TrendPage,CommitDetail}.tsx`、`frontend/src/ui/AntdProvider.tsx`、`frontend/src/styles/{admin,pr-review,product,modern,base,workbench,tokens}.css`。
- 契约：不新增或修改后端接口；审查计划备份、草稿备份与反馈导出的文件格式不变。
- 测试：既有前端测试全部保留，仅调整断言以匹配统一组件渲染后的可访问名称；`AnalysisComparison.test.tsx` 的下拉选择由原生 `selectOptions` 改为点击组件选项。
- 风险：antd 会为两个汉字的按钮自动插入空格，导致可访问名称变化；已在主题层关闭该行为，并对刷新按钮显式关闭。带图标的按钮若不给可访问名称，图标文本会进入按钮名，测试与读屏都会读到多余内容。
- 验证：`docs/evidence/workspace-controls-20261028.md` 记录第一轮的控件与抽屉核对，`docs/evidence/workspace-contrast-20261028.md` 记录对比度与其余页面控件替换的结果。
