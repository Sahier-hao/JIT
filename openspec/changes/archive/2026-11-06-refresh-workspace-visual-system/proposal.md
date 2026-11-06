# Proposal

## Why

审查工作区在功能完成后仍然"看起来像脚手架"：默认冷灰蓝的配色、卡片套卡片、两级页签叠加、UUID 直接上屏、项目页只有一张几乎空白的折线图，用户在两轮反馈里分别指出「配色不要蓝色」「信息架构和布局细节不合理、比较粗糙」。这些不是装饰问题——它们让"这一页该看什么、下一步点哪里"变得含糊，也让项目分析与 PR 审查看起来像两个不同的产品。

## What Changes

- 重写设计令牌：四套主题统一换成"冷灰纸面 + 松色强调"，全站不再出现蓝色；强调色只用于选中态、链接、焦点环与数据编码，主行动保持近黑；风险语义色阶仍为暖色方向且跨主题稳定。
- 引入分层样式表：`claude.css`（页面骨架：侧栏/顶栏/页头/列表/工作单三栏/深色代码面）、`dashboard.css`（信息密度：KPI 读数条、列头、行栅格、粘性表头、触控目标与窄屏堆叠）、`project-redesign.css`（项目页新布局），全部通过 `index.css` 按顺序引入，不改组件 DOM 结构以外的实现。
- 项目页页首改为"上下文行"：项目名与状态胶囊，下一行是仓库链接、默认分支与仓库更新入口；项目概览/分析/PR 审查改为下划线式一级页签，页签下方不再叠加第二层标签。
- 趋势视图重排：读数四格（已分析提交/平均风险分/高分提交/高分占比）、逐周覆盖条带、两张图并排、逐周数据表折叠为 `<details>`、口径表单收进折叠区，页头右侧同时承载视图切换与"调整口径"。
- 趋势图把"未知覆盖"画成灰色底纹并标注"无已评分提交"，避免单点图被读成故障或 0。
- PR 审查列表工具条：范围改为一条灰轨道内的白色药丸（开放/已结束/全部），排序收成带下拉菜单的次级按钮（按最近更新/按风险最高），"含已合并"移入列表页脚，工具条与列表之间留 20px。
- 审查队列补充 KPI 读数条与列头（工作/进度/检查/动作），行内动作在悬停时从灰色文字变为强调色，行高统一。
- 无障碍与触控：行内动作与工具条按钮的最小命中高度 32px（窄屏 44px），加载提示补 `aria-busy`/`aria-live`，焦点环可见。
- 移除 `modern.css` 里把侧栏令牌锁回旧冷灰的四行覆盖，侧栏直接继承主题令牌。
- （实现期新增）审查工作单与 PR 预览页的代码呈现改用 GitHub 式：交给 `react-diff-view` 自带样式 + Primer 变量（白底、增删底色、gutter 染色、`@@` 行头、行分隔线、可选语法高亮），不再手写深色代码面板；修复语法高亮一直静默失效的问题（refractor 适配器 + 补注册 `jsx`/`tsx`/`docker`）。
- （实现期新增）审查工作单与预览页拆成独立圆角卡片：文件栏、代码区、笔记区各自 1px 描边 + 12px 圆角 + 轻投影，间距 16px，高度跟随视口；外层容器不再包一层带边框的大卡。
- （实现期新增）PR 预览页文件栏修复：筛选框双重 margin 与 `order` 覆盖块造成的遮挡、`--gh-*` 令牌作用域不足导致输入框无边框、目录列只在变化处显示；「全部文件」按钮在本次提交没有文件映射时改为状态文字，不再渲染按了没反应的按钮。
- （实现期新增）令牌在原"冷灰纸面"方向上继续校准为 GitHub 中性灰阶：白画布 `#FFFFFF`、沉面 `#F6F8FA`、墨字 `#1F2328`、线 `#D0D7DE`，松色强调 `#1F5D4C` 与五色族保持；对比度测试同步通过。

## Capabilities

### New Capabilities

无新增能力：本次只改变既有页面满足既有能力的呈现方式。

### Modified Capabilities

- `interface-presentation`: IP-15 增加队列读数条与列头；IP-16 增加筛选分段控件与排序菜单按钮的一致性要求；IP-17 增加项目页页首上下文行与视图条层级；新增 IP-25（趋势视图的读数、覆盖与折叠数据表）与 IP-26（项目页页首的上下文与视图切换）。
- （实现期新增）`interface-presentation`: 新增 IP-27（审查代码呈现与卡片结构：GitHub 式 diff、独立圆角卡片、文件栏可操作、代码范围有真实边界）。

## Impact

- 前端样式：`frontend/src/styles/tokens.css`、新增 `claude.css`/`dashboard.css`/`project-redesign.css`、新增 `workbench-modern.css`（实现期：工作单与预览页的面板与代码区，作为 `index.css` 最后一个 import）、`modern.css`、`project-workspace.css`、`index.css`；`claude.css` 与 `dashboard.css` 中被 `workbench-modern.css` 取代的旧代码面规则已在实现期删除。
- 前端组件：`components/PersonalWorks.tsx`、`components/ProjectTrends.tsx`、`components/ProjectPullRequests.tsx`、`pages/ProjectPage.tsx`、`ui/chart.tsx`、`Feedback.tsx`、（实现期）`ui/CodeDiff.tsx`、`components/PullRequestPreview.tsx`、`pages/PullRequestJourney.tsx`。
- 图表：ECharts 需注册 `MarkAreaComponent` 才能画缺口底纹；分类色与回退色改为松/苔/赭/砖/墨五族。
- 代码高亮：`refractor`（`react-diff-view` 的 tokenize 需要"返回节点数组"的适配器）。
- 测试：`tokens.test.ts`、`contrast.test.ts`（4 主题 × 10 对 ≥4.5:1）、`ProjectTrends.test.tsx`、`ProjectPullRequests.test.tsx`。
- 无接口、数据库与部署变更；四套主题名称与切换行为不变。
