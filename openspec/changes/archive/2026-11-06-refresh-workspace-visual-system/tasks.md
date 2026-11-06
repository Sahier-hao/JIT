# Tasks

## 1. 设计令牌与配色

- [x] 1.1 `frontend/src/styles/tokens.css` 重写四套主题，键名与主题名不变；文件头注释说明 `--blue*`/`--violet*` 为历史键名、值已改为松与墨（实现期又按用户反馈校准为 GitHub 中性灰阶，见 11.x）
- [x] 1.2 主行动保持近黑 `--btn`，强调色只用于选中态、链接、焦点环与图表编码；风险色阶仍为暖色方向且四主题同构
- [x] 1.3 `frontend/src/styles/project-workspace.css` 与 `frontend/src/ui/chart.tsx` 的序列色、分类色与 jsdom 回退常量同步新配色
- [x] 1.4 `npx vitest run src/tokens.test.ts src/contrast.test.ts src/typography.test.ts src/chartTokens.test.ts` 通过（4 主题 × 10 对 ≥4.5:1，键覆盖完整）

## 2. 分层样式表

- [x] 2.1 新增 `frontend/src/styles/claude.css`：侧栏、顶栏、页头、审查队列、工作单三栏与深色代码面的骨架规则
- [x] 2.2 新增 `frontend/src/styles/dashboard.css`：读数条、列头、行栅格、粘性表头、触控目标与窄屏堆叠
- [x] 2.3 新增 `frontend/src/styles/project-redesign.css`：项目页与 PR 列表的布局
- [x] 2.4 `frontend/src/index.css` 按 claude → dashboard → project-redesign 的顺序追加引入
- [x] 2.5 删除 `frontend/src/styles/modern.css` 中把侧栏令牌锁回旧冷灰的四行覆盖，侧栏改为继承主题令牌

## 3. 审查队列的读数与列头

- [x] 3.1 `frontend/src/components/PersonalWorks.tsx` 增加按阶段计数的读数条与「工作 / 进度 / 检查 / 动作」列头（列头 `aria-hidden`）
- [x] 3.2 行内动作在悬停时由灰色文字变为强调色下划线，行高与列宽在各分组间一致
- [x] 3.3 实拍确认 6 条种子工作单分为三组，读数条数值与分组数一致

## 4. 项目页页首与视图层级

- [x] 4.1 `frontend/src/pages/ProjectPage.tsx` 页首改为项目名 + 状态 + 一行上下文（仓库链接、默认分支、仓库更新入口），不再显示视图与模型编号
- [x] 4.2 一级页签改为下划线式；分析视图的二级切换与「调整口径」同一行出现
- [x] 4.3 实拍确认页首无内部编号、无第二层同名标签，1512/1024 两档无横向溢出

## 5. 趋势视图

- [x] 5.1 `frontend/src/components/ProjectTrends.tsx` 读数改为四格（已分析提交 / 平均风险分 / 高分提交 / 高分占比），每格带说明
- [x] 5.2 逐周覆盖条带（有样本用强调色、未证明覆盖用浅色）与说明文案上线
- [x] 5.3 缺口底纹：`trendOption` 增加 `markArea`，`frontend/src/ui/chart.tsx` 注册 `MarkAreaComponent`，图上标出「无已评分提交」
- [x] 5.4 逐周数据表折叠进 `<details>`，口径表单收进折叠区，删除页面上的原始 JSON
- [x] 5.5 实拍确认只有 1 个有样本周时，图上显示底纹与说明，等价数据表可一次展开

## 6. PR 审查列表工具条

- [x] 6.1 范围改为一条灰轨道内的白色药丸（开放 / 已结束 / 全部），隐藏 Mantine 的 indicator 并把选中态画在 control 上
- [x] 6.2 排序收成带菜单的次级按钮（排序：按最近更新 / 排序：按风险最高），当前项带选中标记
- [x] 6.3 「含已合并」移入列表页脚，工具条与列表间距 20px；≤860px 换行且动作按钮不被裁切
- [x] 6.4 修复列表被长标题撑宽后裁掉右侧按钮的问题（`minmax(0, 1fr)` + 标题省略号）`r`n- [x] 6.5 修复行内「开放」胶囊被「查看 PR」按钮压住：`.pr-row-main` 改为可伸缩且 `min-width:0`，标题只收缩不撑宽，1280/1024/860/1512 四档实测胶囊右缘与按钮间距 20px、行高统一 83px

## 7. 无障碍与响应式

- [x] 7.1 行内动作与工具条按钮命中高度 32px、窄屏 44px；焦点环可见且不被遮挡
- [x] 7.2 `frontend/src/Feedback.tsx` 的加载提示补 `aria-busy` 与 `aria-live`
- [x] 7.3 审计脚本在 375 / 768 / 1024 / 1512 四档确认 `/reviews`、`/projects` 无过小命中区、无 <12px 正文、无横向溢出

## 8. 验证

- [x] 8.1 `npx tsc -b` 通过
- [x] 8.2 `npx vitest run src/tokens.test.ts src/contrast.test.ts src/components/ProjectTrends.test.tsx src/components/ProjectPullRequests.test.tsx src/pages/ProjectPage.test.tsx` 通过
- [x] 8.3 `npm run build` 通过（2.02s，仅 chunk 体积警告与 ProjectActivity 的动态导入提示）
- [x] 8.4 全量 `npx vitest run` 通过（45 文件 / 344 项）
- [x] 8.5 四路由（`#/reviews`、`#/projects`、`#/projects/{id}`、`#/projects/{id}/prs`）浏览器冒烟：零 console 错误、无横向滚动、强调色均为 `#1F5D4C`

## 9. 审查工作单的代码呈现（实现期，GitHub 式）

- [x] 9.1 新增 `frontend/src/styles/workbench-modern.css` 并作为 `index.css` 最后一个 import，接管工作单面板与代码区；删除 `claude.css` 的深色代码面与 `dashboard.css` 中被取代的整段工作单规则
- [x] 9.2 修复语法高亮静默失效：`frontend/src/ui/CodeDiff.tsx` 增加 refractor 适配器（`highlight` 返回 `children` 数组）并补注册 `jsx`/`tsx`/`docker`；实测 `.token` 数 410
- [x] 9.3 diff 变量挂 `.wb-diff-scroll`（工作单与预览页共用）：Primer 增删底色、gutter 染色与文字、代码列左缘分隔线、20px 行高、`@@` 行头灰带与省略
- [x] 9.4 工作单三栏拆成三张独立圆角卡（描边 + 轻投影 + 16px 间距），高度跟随视口，底边落进窗口；折叠态恢复自适应高度
- [x] 9.5 文件栏：筛选/排序/说明互不遮挡（双 margin 与 `order` 覆盖块修复）、sha 胶囊换行、`--gh-*` 令牌作用域扩大到全部面板
- [x] 9.6 `npx tsc -b`、`npx vitest run`（45 文件 / 344 项）、`npm run build` 通过；1600 宽整窗零 console 错误

## 10. PR 预览页统一（实现期）

- [x] 10.1 预览页文件栏与代码区改为与工作单同一套独立卡片语言；外层 `.pr-preview-grid` 的边框/背景/投影全部清零（曾套一张方角大卡）
- [x] 10.2 底部「作者说明」归位为第三张独立圆角卡
- [x] 10.3 文件行两行化（name 里完整、dir 在变化处显示，`PullRequestPreview.tsx` 按前一行目录去重）；`−0` 不再渲染
- [x] 10.4 「全部文件」范围语义修复：无文件映射时渲染状态文字（`title` 说明原因），有映射时才是按钮；实测工具条只剩一个可点元素
- [x] 10.5 GitHub 429 期间用本地快照打桩完成预览页实拍；五档视口（1600/1512/1280/1080/860）无横向溢出

## 11. 令牌校准（实现期）

- [x] 11.1 `tokens.css` 的表面/文字/线三组由"冷灰纸面"校准为 GitHub 中性灰阶：`--canvas #FFFFFF`、`--sunken/--soft #F6F8FA`、`--fg #1F2328`、`--fg-2 #424A53`、`--fg-3 #59636E`、`--line #D0D7DE`；松色强调 `#1F5D4C`、五色族与风险色阶不变
- [x] 11.2 `chart.tsx` 回退常量与 `project-workspace.css` 的 series/ink 同步新中性灰；`ProjectTrends.test.tsx` 期望色小写断言已同步
- [x] 11.3 `contrast.test.ts` 在新中性灰下 4 主题 × 10 对 ≥4.5:1 通过

## Workflow follow-up

- 提交前清理仓库根目录的临时文件 `crop-sec3.png` 与 `backend/_check_pr.py`
- 归档本 change 后按 AGENTS.md 约定开/更新 PR
