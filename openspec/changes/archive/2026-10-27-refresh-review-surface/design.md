# Design

## Context

审查工作区已有真实数据通路：`/api/v1/review-sources` 接入公开 PR，后端克隆仓库、落不可变快照（本次接入的 PR #31 为 74 个文件），前端 `PullRequestJourney.tsx` 负责队列、工作单、问题与证据、草稿与导出。呈现层是手写 CSS：`tokens.css` 定义四套主题（冷灰、steel、charcoal、paper）与间距、圆角、阴影变量，`base.css`/`components.css`/`product.css`/`modern.css`/`admin.css`/`pr-review.css` 依次叠加。

问题集中在两处：队列页的版式把操作说明放在视觉中心，真正的工作行被降级；工作单里代码是纯文本，行号、高亮、证据定位都缺失，且三栏平摊宽度，代码只拿到 564 像素。

## Goals / Non-Goals

**Goals**

- 队列页一眼可扫：待审工作、进度、未关闭问题、下一步动作在同一行内可读。
- 工作单以代码为主体，1440 宽视口下代码栏不少于 780 像素。
- 差异可读：语法高亮、旧/新行号分开、行级证据定位可见。
- 控件、间距、状态反馈在同一套令牌下统一，主题与密度切换时全部跟随。
- 不改变任何数据契约与既有功能路径。

**Non-Goals**

- 不改后端接口、快照结构、草稿格式与导出内容。
- 不重写 `product.css` 等既有页面样式，只新增工作区表面样式并做局部覆盖。
- 不引入图表库、动画库或三维效果。
- 不把导航改成窄图标栏，不把管理工作区并入普通审查流。

## Decisions

**基础控件用 antd，主题令牌从 CSS 变量桥接。** 现有界面是手写控件，尺寸、聚焦态、禁用态各自实现，很难统一。antd 提供完整的交互与无障碍默认行为，但它的默认色板与既有四套主题冲突。做法是在 `ui/AntdProvider.tsx` 用 `ConfigProvider` 把 `--accent`、`--card`、`--line` 等变量读进 token，并用 `MutationObserver` 监听 `data-theme` 变化重新计算，使 antd 控件随主题切换。取舍是引入约 1.2 MB 依赖，换来一致的状态与键盘行为。

**差异渲染用 `react-diff-view` + `refractor`，行号栏自己渲染。** 纯文本 diff 无法承载证据定位。`react-diff-view` 提供 `parseDiff`、`tokenize` 与可替换的 `renderGutter`，但它的 gutter 只在锚点模式下包 `<a>`，默认模式没有可点击元素，因此由 `renderGutter` 自己输出带 `onClick` 的按钮，并按 `change.type` 决定旧/新行号各自是否有值——删除行在新侧显示为空，新增行在旧侧为空。取舍是需要理解 `gitdiff-parser` 的 `Change` 联合类型，换来准确的锚点语义。

**hunk 头自己补。** `react-diff-view` 的 `UnifiedHunk` 只渲染 `tbody`，不渲染 `@@` 行。按文件拆成多个 `Diff`，每个前面加一行 `.wb-hunk-head`，既补上上下文信息，也让文件边界清楚。

**工作单收起左侧导航。** 三栏各占一列会让代码只剩 564 像素。`AppShell` 在根节点输出 `data-route`，`pr-work` 路由下用 CSS 把侧栏宽度归零、栅格改成单列。取舍是工作单内没有全局导航，用页头返回按钮与面包屑承担返回。

**文件路径按尾部截断。** `direction: rtl` 的省略会吃掉路径开头的字符（`_kend/jit_baseline/api_errors.py`）。改为在 JS 里保留末两段并加前缀省略号，配合 `title` 显示完整路径。

## Risks / Trade-offs

- **antd 与既有 CSS 的层叠冲突**：antd 组件自带 `.ant-*` 样式，可能压过既有页面规则。缓解：只在新表面使用 antd 组件，既有页面逐步替换；`workbench.css` 中覆盖项限定在 `.wb`/`.mr` 作用域内。
- **语法高亮覆盖率**：`refractor` 的 common 包不含 jsx/tsx，未注册语言退回纯文本。缓解：按扩展名映射并在未注册时降级，不抛错。
- **长行与并排视图**：并排视图下每侧更窄，长行仍会折行。缓解：并排作为可选项，默认统一视图；代码区横向滚动而非强制折行。
- **依赖体积**：antd 全量引入增加首屏体积。缓解：只从 `antd` 具名导入，Vite 做 tree-shaking；后续可按需替换为轻量实现。
- **回归风险**：工作单 JSX 被整体替换，草稿恢复、证据跳转、导出等逻辑必须逐项走查。缓解：保留原有状态与回调函数不动，只替换视图层，并用真实 PR 走查全部路径。
