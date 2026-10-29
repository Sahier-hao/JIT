# 前端视觉与交互改版记录（2026-10-27 ~ 2026-10-29）

分支 `feat/frontend-visual-system`，相对 `origin/main` 共 38 个提交。本文记录这轮改版的范围、设计决策、逐页变化、验证证据与 OpenSpec 变更索引，供后续维护与评审查阅。

## 1. 背景

起点是三条用户反馈：

1. 「页面像原型，不像能长期使用的产品」——审查队列是居中大标题加 CTA，项目详情页三块内容三套标题规格。
2. 「代码区域太小」——PR 审查工作单的代码栏在 1440px 下只有 564px，长行折成三段。
3. 「控件像毛坯房」——按钮、下拉、文件选择都是原生控件，尺寸与状态不统一。

目标不是加装饰，而是：让主任务占据主要空间、让同一类元素只有一种表达、让状态可见可读。

## 2. 范围

| 页面 | 变化 |
| --- | --- |
| 我的审查（队列） | 左对齐标题 + 接入输入 + 工作行；去掉居中大标题；空态改为虚线块 |
| PR 审查工作单 | 三栏（文件 / 代码 / 问题），隐藏侧栏，代码栏 800px；语法高亮、行号、点击固定证据；读取与失败态改为面板 |
| 项目列表 | 卡片密度收敛，菜单改 antd Dropdown，新建与删除改对话框 |
| 项目详情 | 双栏工作台（结果 + 记录），结果卡「总数 + 占比条 + 最该先看的提交」，记录卡时间线 + 图钉 |
| 分析页 | 工具条统一 32px，页签改胶囊，长解释压成一句 |
| 管理区 | 登录页左对齐表单，数据版本改 Collapse，控件统一 |

## 3. 设计决策

1. **主按钮只留一个**。项目页最终只保留页头「发起分析」与结果卡「查看提交与审查计划」两个强调按钮，其余降为次级或链接；一屏两个以上深色按钮会让用户不知道下一步该点哪个。
2. **工作单优先给代码让路**。`data-route='pr-work'` 时收起侧栏，三栏比例 268 / 1fr / 372，1440px 下代码栏 800px；导航可以从面包屑回到上层。
3. **自建控件层而不是直接铺 antd**。antd 默认样式与既有设计令牌（4 主题、密度偏好）冲突，最终收敛到 `src/ui/` 一套组件（Button / Input / NumberInput / Select / Checkbox / Disclosure / Dialog / Popover / Alert / IconButton），antd 只在少数地方保留。
4. **对比度整体提一档**。四个主题的 `--fg-2 / --fg-3 / --line / --line-strong / --sunken` 各加深一级，次要文字从约 5.4:1 提到约 7:1；侧栏例外，逐像素锁回改版前的取值。
5. **时间线按记录绘制**。容器级绝对定位的竖线会横穿卡片，改为每条记录的标记列画线、卡片压住线，只在左内边距与卡片之间露出。
6. **状态用徽标与图钉表达**。当前结果用图钉而不是单选圆点；仓库更新用页头胶囊而不是标题行。
7. **卡片高度稳定**。记录卡固定 520px（视口不足时取 `100vh − 190px`），记录少时均匀分布，多时卡内滚动，页面高度不随记录变化。
8. **小字只保留必要信息**。页头只留时间与模型，数据集区间收进 chip，分支与频率进对话框。

## 4. 逐页要点

### 审查队列

- 标题左对齐，右侧「检查关注工作更新」；接入输入与按钮 34px 对齐。
- 工作行给出标题、来源、状态、进度、未关闭问题、检查时间。
- 空态是虚线面板，不是「居中大标题 + CTA」。

### PR 审查工作单

- 页头：面包屑、标题、状态、进度条；动作区四个按钮（检查 PR 更新 / 版本与说明 / 输出意见 / 草稿备份与反馈）。
- 代码区：react-diff-view + refractor 高亮，统一/并排切换，行号按钮点击固定证据。
- 读取中与失败：`正在拉取 PR 的文件与固定代码版本…` 面板，失败给重试与返回。

### 项目详情

- 页头：项目名 + 状态徽标 + 仓库更新胶囊 + 「发起分析」。
- 结果卡：46px 总数、三条占比条（按风险着色）、最该先看的提交（短号 + 标题 + 分数）、底部固定的模型说明与主按钮。
- 记录卡：时间线 + 图钉 + 整行可点击 + 「更多」菜单（打开 / 对比 / 重试 / 取消 / 详情 / 删除）。

### 分析页与管理区

- 工具条控件统一 32px，搜索框留出图标内边距。
- 页签胶囊化，表格风险值用等宽字体。
- 管理区登录左对齐，数据版本折叠，错误提示走 Alert。

## 5. 组件与样式分层

- `src/ui/controls.tsx`：Button（primary / secondary / ghost / link / danger，尺寸 md 32px、sm 28px）、Input、NumberInput、Select（Radix）、Checkbox、Disclosure、IconButton。
- `src/ui/dialog.tsx`：Dialog（Radix，含 footer）、Popconfirm、Alert。
- `src/ui/popover.tsx`：Popover（支持受控）。
- `src/styles/tokens.css`：四个主题的设计令牌；`ui.css` 控件样式；`project.css` 项目页；`workbench.css` 工作单；`modern.css` 侧栏与顶栏。

## 6. 验证证据

| 项目 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过（每轮改动后执行） |
| `npx vitest run` | 36 个文件 / 282 项通过 |
| `npm run build` | 通过，约 2s，产物 1.18 MB（gzip 380 KB） |
| 版面 | 1440×900 代码栏 800px；1280×720 724px；390×844 单列；横向溢出 0 |
| 截图 | `docs/evidence/screenshots/` 下 20 余张，含队列、项目、工作单、抽屉、管理区、深色主题 |

详细证据见 `docs/evidence/review-surface-20261027.md`、`workspace-controls-20261028.md`、`workspace-contrast-20261028.md`、`project-surface-20261028.md`、`project-updates-20261028.md`、`project-workspace-20261029.md`。

## 7. OpenSpec 变更索引

| 变更 | 归档目录 | 相关提交 |
| --- | --- | --- |
| refresh-review-surface | 2026-10-27-refresh-review-surface | ecc1ec9、7fd636e |
| align-workspace-controls | 2026-10-28-align-workspace-controls | de292a5、85f2376、c85e64d、42e3505、f61af5f |
| tighten-project-surface | 2026-10-28-tighten-project-surface | c3d3a2e |
| split-project-workspace | 2026-10-28-split-project-workspace | a42ed44、5a4378e、10e86a9、673ecf0、2ead7a4 |
| analysis-dialog | 2026-10-28-analysis-dialog | 5a4378e、120643b |
| refine-project-workspace | 2026-10-29-refine-project-workspace | 2b887f7、9ee4385、9f9dade、aaf05af、599a6cc、2498ee8、573e7e5 |
| refine-result-summary | 2026-10-29-refine-result-summary | dd9f07a |
| update-entry-in-header | 2026-10-29-update-entry-in-header | 4630049、1501607 |
| add-priority-commits | 2026-10-29-add-priority-commits | a9820d2、df526db、734c434 |
| polish-project-records | 2026-10-29-polish-project-records | fb6be04、9764702、0279017、ab52806、0cbfcf4 |

`openspec validate --all --strict`：20 项全部通过。

## 8. 遗留

- 深色主题（charcoal）与 ≤1024px 窄屏只做过抽查，未逐页截图。
- 项目页结果卡在记录较多时仍有约 90px 弹性空隙，取决于右栏高度。
- 前端产物单块 1.18 MB，未做代码分割。
- 分支未 push。
