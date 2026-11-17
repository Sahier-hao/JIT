# Design

## Context

动机见 [proposal.md](proposal.md)。当前前端的样式事实：

- Tailwind 4 已接入，但只加载 `theme` 与 `utilities`，`preflight` 关闭；`index.css` 的 `@theme inline` 只映射了 24 个颜色别名，风险色阶、五个色族、图表色、阴影、字号与间距尚未进入工具类。
- `styles/tokens.css` 是四套主题（concrete / steel / charcoal / paper）的唯一来源，`tokens.test.ts`、`contrast.test.ts`、`typography.test.ts` 直接读取该文件校验键完整性与对比度。
- `index.css` 依次导入 20 个页面样式层，`claude.css`、`modern.css`、`dashboard.css`、`project-redesign.css`、`workbench-modern.css` 依靠顺序互相覆盖；另有 4 个组件级 CSS 由组件直接导入。
- `src/ui/` 已经是适配层，但实现混用 Mantine 与 Radix：`Button`、`Input`、`Select`、`Checkbox`、`Switch`、`Disclosure`、`Alert`、`Tag`、`Tooltip`、`Dropdown`、`Segmented`、`Modal` 由 Mantine 渲染，`Popover` 已用 Radix + Tailwind。Mantine 仅被 8 个文件引用。
- `cn`（clsx + tailwind-merge）、CVA、Radix 包、lucide-react 均已在依赖中；`Icon.tsx` 另有一套 20 格自绘图标，产品内同时存在两种图标网格。
- 页面中有 1 274 处 `className`；12 个领域类名被 Playwright 当作定位钩子（共 24 处）。
- 图表由 ECharts SVG 渲染并从 CSS 变量读数；代码差异用 react-diff-view 自带 CSS；Markdown 使用 `markdown.css` 的后代选择器。

约束：`interface-presentation` 的 IP-01…IP-28 继续有效；四套主题、两档密度、1280×720 / 1440×900 与 768 窄屏、运行时不请求外部资源、Windows CI 均需保持。

## Goals / Non-Goals

**Goals:**

- 界面外观只有一套来源：设计令牌 + Tailwind 工具类 + 共享组件；页面样式不再有覆盖层。
- 用户工作区与管理端共享同一套控件、表格、卡片与反馈形态。
- 移除 Mantine 与 24 个手写页面样式文件，最终只保留入口、令牌、基础层与第三方内容四个样式表。
- 行为、路由、文案与后端契约不变；既有令牌与对比度测试继续通过。

**Non-Goals:**

- 不重做信息架构、导航结构、页面流程或界面文案；不增加新功能。
- 不追求与当前外观逐像素一致；允许按统一基线调整间距、字号与表面。
- 不改图表的数据映射、后端接口、数据库与模型契约。
- 不引入像素差异 CI 门禁；不替换 Vitest / Playwright。
- 不迁移 `vscode-extension`（无样式资产）。

## Decisions

### 1. 样式单一来源与最终文件边界

布局、间距、颜色、排版、圆角、阴影全部由 Tailwind 工具类表达；重复形状由 `src/ui` 组件承担；页面只组合组件与工具类。最终允许存在的样式表及其职责：

- `src/index.css`：导入顺序、`@theme inline` 语义映射、`@custom-variant`、preflight。
- `src/styles/tokens.css`：四套主题与密度的设计令牌，保持现有路径与键名。
- `src/styles/base.css`：`@font-face`、文档级底色、滚动条、`prefers-reduced-motion` 等无法用工具类表达的基础规则。
- `src/styles/content.css`：Markdown 与代码差异等第三方内容的容器内后代规则，用 `@apply` 与令牌编写。

其余 `styles/*.css`、`trend.css`、`components/*.css`、`pages/*.css` 全部删除。备选方案是把所有样式都塞进工具类，但 Markdown、diff 与 ECharts 浮层依赖后代选择器，强行内联会引入更差的实现。

### 2. 令牌桥接扩到完整语义与标尺

`tokens.css` 继续是唯一主题来源，`@theme inline` 补齐：表面（`background`/`card`/`sunken`/`soft`/`strong`/`rail`）、文字（`fg`/`fg-2`/`fg-3`/`fg-4`）、线、五个色族的三档、风险七键、图表四键、主行动、遮罩；同时映射字号、行高、圆角、阴影、间距档位。主题切换仍由 `html[data-theme]` 决定，Tailwind 不保存颜色状态。

备选方案是换成 shadcn 默认的 oklch 调色板，但会丢失四套主题、既有对比度证据与中文排版约束，不采用。

### 3. 组件层采用 shadcn/ui 形态并在仓库内落地

在 `src/ui/` 内复制 shadcn/ui 组件源码并改造为项目令牌，不运行 `shadcn init`（会重写 `index.css` 并引入第二套变量文件）。保留现有导出与 props 语义，页面调用方式不变；新增 `className` 一律经 `cn` 合并，允许页面用工具类做布局微调，但不得覆盖组件形状。

组件清单：`Button`、`IconButton`、`Input`、`TextArea`、`NumberInput`、`PasswordInput`、`Select`、`Checkbox`、`Switch`、`Disclosure`、`Segmented`、`Dialog`、`Popconfirm`、`Drawer`、`Dropdown`、`Popover`、`Tooltip`、`Tag`、`Alert`、`Empty`、`Progress`、`Table`（表头/行/单元）、`Card`（头/体/脚）、`PageHeader`、`SectionHeader`。

实现选择：

- 行为层用 Radix；现有 `checkbox`、`collapsible`、`dialog`、`dropdown-menu`、`popover`、`select`、`switch`、`tooltip` 包继续使用，仅补 `@radix-ui/react-alert-dialog`（确认气泡）。
- 变体用 CVA，类名合并用既有 `cn`；不引入 shadcn CLI 运行时。
- `Drawer` 用 Radix Dialog 加侧滑面板，替换现在的手写 portal 与内联样式。
- `Table`、`Card`、`PageHeader` 是新增的共享形状，用来消除各页面各自复制的表头、卡片标题与页面标题结构。

备选方案是保留 Mantine 只迁移页面 CSS。Mantine 自带 CSS、需要桥接文件与专用 PostCSS 预设，正是双体系与覆盖层的来源；保留它无法达成 IP-29 的单一来源。

### 4. 统一视觉基线

在令牌与工具类中固定以下档位，所有页面按同一档位取值：

- 字号：12 元信息、13 表格与紧凑正文、14 正文与操作、16 区块标题、20 页面标题、24 仅入口与品牌标题；连续中文不小于 14px，元信息不小于 12px。
- 行高：正文 1.5、标题 1.3、表格数字 1.2；等宽只用于标识、数字、刻度与代码。
- 间距：4px 基数；页面水平内边距 24px（窄屏 16px），区块间距 24px，卡片内边距 16px，表格单元水平 12px。
- 圆角：6 / 8 / 12 / 16 / 20 五档，卡片 8、对话框 12、标签 6 或全圆，输入与按钮 6。
- 阴影：只保留三级，浮层用二级、对话框用三级；卡片默认只用发丝线，不靠投影分层。
- 表面：页面底 `canvas`、下沉区 `sunken`、卡片 `card`、强调面 `soft`/`strong`；同一层级跨页面一致。
- 状态：危险 `rose`、警告 `amber`、成功 `teal`、信息 `violet`、主色 `blue`（松）；风险色阶继续独立，状态色必须带文字。
- 焦点：2px `accent-ring` 外环加 2px 偏移，悬停只改底色不改尺寸；尊重减少动效偏好。
- 表格：表头 12px、行高 40px（紧凑 32px）、分隔线 `line-soft`；数字右对齐、等宽。

### 5. 密度通过主题间距变量实现

`html[data-density="compact"]` 只在 `tokens.css` 中改写一组密度变量；`@theme inline` 把它们映射为 `--spacing-row`、`--spacing-cell-x`、`--spacing-card` 等，共享表格、卡片与列表使用 `h-row`、`px-cell-x`、`p-card` 这类工具类。页面不写 `compact:` 条件类，也不复制两套布局。备选方案是给每个组件加密度变体，会让每个页面重新维护两套间距，不采用。

### 6. 在样式层删除完成后启用 preflight

shadcn 形态的组件依赖 preflight 的盒模型与表单重置，但当前页面仍依赖浏览器默认的列表、段落与 SVG 呈现。迁移完成前启用会改变所有旧页面的默认外观，使中间状态不可用，也无法判断回归来自迁移还是重置。因此 preflight 放在收尾批次：旧样式层删除后启用，`base.css` 收缩为字体、文档底色、滚动条与减少动效；Markdown 与代码差异的覆盖规则集中到 `content.css`，并限定在 `.markdown-body`、`.diff-body` 容器内；ECharts 浮层通过 `className` 与令牌样式保持。

迁移期间由 `base.css` 显式提供标题、表单控件与 SVG 对齐等基础默认值，保持与当前渲染一致。风险在于启用后 react-diff-view 与浏览器默认表单样式会变化。若出现不可控回归，回退到关闭 preflight 并在 `base.css` 保留最小重置，其余决策不受影响。

### 7. 图标统一入口

`Icon.tsx` 继续作为唯一图标入口，内部图形改用 lucide-react 并统一 16px 尺寸、1.5 描边；品牌标志保留自绘。直接引用 lucide 的 13 个文件改为使用 `Icon`，新增图形只在 `Icon.tsx` 登记。这样产品内只有一套网格与线宽，符合 IP-09。

### 8. 测试钩子与样式类解耦

浏览器验收不再用样式类定位。迁移组件时同步给 12 个领域钩子加稳定的 `data-testid`（如 `admin-model-card`、`trend-tooltip`、`wb-hunk`），Playwright 改用角色、文本或 testid；样式类只承担外观，不再承担测试契约。

### 9. 迁移批次与删除顺序

按页面族分批，每批包含“迁移组件 → 更新该批测试 → 运行检查 → 删除已无消费者的样式层 → 截图存档”。共享层（`components.css`、`modern.css`、`claude.css`、`dashboard.css`）可能跨批使用，只在其最后一个消费者迁移后删除；`index.css` 的导入列表每批只减不增。

批次顺序：基座 → 控件层 → 外壳与入口 → 项目与分析 → PR 审查 → 趋势与报告 → 个人工作区 → 管理端 → 收尾。先做控件层是因为页面迁移依赖稳定的共享组件；管理端放后面是因为它最大且独立，迁移期间不影响用户主流程。

### 10. 验证与证据

每批运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`；受影响旅程运行对应的 Playwright 配置。视觉核对在 1280×720 与 1440×900、浅色与深色主题下截图，列表页额外核对紧凑密度，证据存放在 `docs/evidence/unify-frontend-visual-system/<批次>/`。不把截图比对放进 CI，避免 Windows 字体渲染差异造成假失败。

### 11. 防止样式回流

新增 `scripts/check-styles.mjs` 并在 `npm test` 中由 Vitest 调用：校验 `src` 下只存在允许的四个样式表、`index.css` 只导入允许的文件、`src/**/*.tsx` 不导入页面级 CSS、不出现 `@mantine` 引用。失败信息直接指出违规文件。这样“再写一个页面 CSS”会在本地与 CI 被拦住，而不是靠评审记忆。

## Risks / Trade-offs

- [视觉回归被分批掩盖] → 每批固定视口与主题截图存档，并运行受影响旅程；发现差异先修共享组件而不是给单页打补丁。
- [preflight 改变第三方渲染] → 先在隔离页面验证 Markdown、代码差异与 ECharts 浮层；必要时回退到最小重置，保留其余决策。
- [Radix 与 Mantine 的焦点、滚动锁、portal 行为不同] → 迁移时补键盘与焦点回归用例，确认对话框关闭后焦点回到触发元素，抽屉与下拉不被裁切。
- [移除 Mantine 遗漏隐藏用法] → 以 `@mantine` 引用守卫加类型检查兜底；最后一个引用删除后再移除依赖与 PostCSS 预设。
- [令牌测试与 CSS 文本耦合] → 保持 `tokens.css` 路径、键名和四主题块结构；只在确有语义变化时同步更新测试。
- [范围膨胀为全站重设计] → 每批只做外观与组件替换，不改路由、文案与数据流程；批次有明确退出条件。
- [密度与主题组合遗漏] → 共享表格与卡片只在两档密度、四套主题下核对，页面不自带密度分支。
- [e2e 选择器迁移造成假失败] → testid 与组件迁移同批提交，先跑对应配置再删旧类名。

## Migration Plan

1. 建立基座：扩充令牌与 `@theme`、启用 preflight、落地共享组件、加入样式守卫。此时页面外观基本不变。
2. 替换 `src/ui` 的 Mantine 实现，移除 `MantineProvider`，运行全部单元测试与对话框、选择、菜单的浏览器用例。
3. 按批次迁移页面族；每批通过检查后删除已无消费者的样式文件，`index.css` 导入逐批收缩。
4. 收尾：删除剩余样式文件、Mantine 包与 PostCSS 预设，更新 `frontend/README.md` 与 `docs/当前产品.md`，补齐证据与审计记录。

回退以批次为单位：每批保持独立提交，回退该批即可恢复上一外观；令牌键名与主题契约不变，不涉及数据库或接口迁移，无数据回退步骤。
