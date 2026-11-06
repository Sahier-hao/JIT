# Design

## Context

工作区在功能层已经稳定（路由、审查队列、项目页三视图、趋势图与等价数据表），皮肤层则在前几轮试验里反复变化：先按外部营销站规范改成奶油纸面，再改成冷灰蓝，最后只剩"换了字体"的观感。现状的约束是：

- 组件层已经换成 Mantine 9，样式通过 `frontend/src/styles/*.css` 与 `index.css` 的 `@import` 顺序叠加生效；同一属性后声明者胜，因此覆盖必须按顺序、按权重规划。
- `tokens.css` 被四个测试直接约束：`tokens.test.ts`（键覆盖）、`contrast.test.ts`（4 主题 × 10 对 ≥4.5:1）、`typography.test.ts`（禁止给标题等选择器等宽）、`chartTokens.test.ts`（`--chart-*` 必须被引用）。
- 页面里存在若干"全局规则反噬"点：`tr { background: var(--card) }` 会让深色代码面里的 diff 底色失效；`.wb-body` 同时带 `flex` 与固定 `height` 会把页面撑到十几万像素；`modern.css` 曾把侧栏令牌锁回旧冷灰。
- 字体受用户明确约束"沿用现在的"：Latin 用随包 `Inter var`，展示字用系统衬线，代码用 JetBrains Mono；运行时不请求外部资源（IP-04）。
- 实现期约束（用户反馈驱动）：代码呈现要"向 GitHub 页面看齐"——白底、浅色增删、不要深灰底、代码区是独立圆角卡片且带阴影、`@@` 外面不能还有一层大卡。皮肤层在 change 进行中仍在演进，编码反映最终形态：令牌最后校准为 GitHub 中性灰阶，松色强调不变。

## Goals / Non-Goals

**Goals:**

- 用三层样式表把"骨架 / 密度 / 页面布局"分开，后续调整只改对应一层。
- 让配色可替换：换主题 = 只改 `tokens.css` 的值，不改任何组件。
- 项目页与 PR 列表在 1512/1024/860/375 四档都没有横向溢出，控件命中高度达标。

**Non-Goals:**

- 不改路由、不改接口、不改数据结构。
- 不引入新的 UI 依赖（不新增组件库、不引入 CSS-in-JS）。
- 不追求与任何外部品牌站"像素一致"；只沿用其可观察的规则（发丝线、稀缺强调色、深色面承载代码）。

## Decisions

**1. 皮肤层拆成三张表，而不是继续往 `tokens.css` 里堆。**

- `tokens.css` 只放变量；`claude.css` 放跨页面的骨架（侧栏、顶栏、页头、列表、工作单三栏、深色代码面）；`dashboard.css` 放密度（读数条、列头、行栅格、粘性表头、触控目标、窄屏堆叠）；`project-redesign.css` 只放项目页与 PR 列表的布局。
- 替代方案是直接改 `components.css`/`workbench.css`，但那些文件同时被管理区与旧页面引用，改动会外溢。

**2. 覆盖顺序靠 `index.css` 的 `@import` 顺序保证，而不是 `!important` 堆叠。**

- 新表放在 `claude.css` 之后、`dashboard.css` 再到 `project-redesign.css`；同权重后者胜，符合"越具体越靠后"。
- 少数必须压过的全局规则（`tr` 底色、`td` 白底、Mantine 的 `--button-color`）才用 `!important`，并在注释里写明压的是哪条全局规则。

**3. 配色换成"冷灰纸面 + 松色强调"，键名不变。**

- `--blue*` 与 `--violet*` 是历史键名，值改为松与墨，避免全仓改引用；文件头注释说明这件事。
- 强调色只用于选中态、链接、焦点环与图表编码；主行动走 `--btn`（近黑）。这是四套主题共同的约束，也是 `contrast.test.ts` 能稳定通过的前提。
- 图表分类色改成松/苔/赭/砖/墨五族，回退常量（jsdom 取不到 CSS 变量时使用）同步改；否则 `ProjectTrends.test.tsx` 里对描边颜色的断言会在 jsdom 下失败。

**4. 项目页页首改成"结论 → 上下文 → 动作"三层，视图切换上移。**

- 仓库地址、默认分支、仓库更新入口合并成一行 `.project-meta`；`.update-entry` 原本是 `width:100%` + 纵向文字，放在行内会撑成两个大白块，必须显式 `width:auto` 并把文本方向改回横向。
- 一级页签改下划线式；二级切换（分析结果/风险趋势）通过 `ProjectTrends` 的 `switchSlot` 插槽放进趋势页头，与「调整口径」同一行，避免"页签 → 标签 → 标题"三层堆叠。

**5. 未知覆盖必须显式呈现。**

- 折线图上用 `markArea` 把连续无样本的时间段涂成浅色并标注"无已评分提交"；`markArea` 是 ECharts 的独立组件，必须注册 `MarkAreaComponent` 才会生效（否则静默不画）。
- 图下方配一条逐段时间桶的覆盖条带：有样本用强调色，未证明覆盖用浅色，并配一行说明。只有 1 个数据点的时间窗因此看起来是"有意的空"，而不是渲染坏了。

**6. PR 列表的筛选与排序分离成两种控件。**

- 范围三项互斥、文案短 → 一条灰轨道内的白色药丸；Mantine 的 `indicator` 是 JS 量偏移后绝对定位的，改了 padding 就错位，所以直接隐藏它、把选中态画在 control 上。
- 排序两项但语义是"取值" → 收成菜单按钮（复用现有 `Dropdown`），按钮文案随选择变化。
- "含已合并"不是筛选项，是范围说明，移进列表页脚。

**7. 代码区交给 `react-diff-view` 自带样式 + Primer 变量，不再手写代码面板。**

- `react-diff-view` 的 `style/index.css` 已经 import，它是一套现成的 GitHub 视觉约定，靠 CSS 变量取色：`--diff-background-color`、`--diff-text-color`、`--diff-gutter-insert-background-color`、`--diff-gutter-delete-background-color`、`--diff-code-insert-background-color`、`--diff-code-delete-background-color`、`--diff-selection-background-color` 等。
- 本地只做三件事：把 Primer 的变量值定义在 `.wb-diff-scroll`（预览页与工作单共用同一个 `CodeDiff`，一处定义两页都认）、给 hunk 头与行号列对齐 GitHub 的几何（20px 行高、`@@` 灰带、行分隔线）、保留轻量的主题适配。
- 被淘汰的路线：注入层时代的深色代码面（`claude.css`）与"手写底色 + `::before` 加号"的浅色覆盖，全部删除——实测它们与库自带的 `background-color` 规则互相覆盖，出现"灰绿灰红"的第三种颜色，而且改一次要同步三个文件。

**8. 语法高亮静默失效的根因是 `refractor` 版本差异，用一行适配器修，不 fork 依赖。**

- 现象：`.token` 数量恒为 0，代码全单色;控制台无报错（异常被组件吞掉）。
- 根因：`react-diff-view` 的 `tokenize(){highlight:true}` 假定 `refractor.highlight()` 返回节点数组，而 refractor 5 返回 `{type:'root', children}`，`for...of` 抛 `Invalid attempt to iterate non-iterable instance`。
- 修法：传 `highlight: (value, language) => refractor.highlight(value, language).children` 的适配器，`tokenize` 的其余选项不变。
- 语言注册：`refractor` 默认已注册 `python`/`typescript`/`javascript` 等，但 `tsx`/`jsx`/`docker` 未注册，需 `for (const language of [jsx, tsx, docker]) if (!refractor.registered(language.displayName)) refractor.register(language)`；包导出映射是 `"./*": "./lang/*.js"`，子路径写 `refractor/jsx`，写成 `refractor/lang/jsx` 会 TS2307。

**9. 审查三栏拆成独立圆角卡片，外层容器清零；高度跟随视口，投影只压本卡。**

- 文件栏、代码区、笔记区各自 1px `#d8dee4` 描边、12px 圆角、`0 1px 2px rgba(31,35,40,.05), 0 6px 16px -12px rgba(31,35,40,.30)` 投影，间距 16px；`.wb`（工作单）与 `.pr-preview-grid`（预览页）的外层容器 `border/background/box-shadow` 全部清零——`.pr-preview-grid` 曾被 `project-workspace.css` 的"统一卡片表面"选择器套上一张方角大卡，残留 `--sh-3` 投影在两张小卡外又画了一圈轮廓。
- 卡片高度改为 `calc(100vh - …)` 跟随视口：底边落进窗口内可见，四角与投影完整——此前两卡超出窗口被裁，底部圆角与投影挤在裁切线附近，看起来"粘住"。
- 面板不是可点目标：鼠标移入只改变行 hover，不影响面板本身的投影（大面积投影变化会闪）。
- 预览页与工作单共用这套卡片语言，靠 `.pr-preview-*` 与 `.wb-*` 并列在 `workbench-modern.css` 的同一段规则实现，避免两页漂移。

**10. 代码范围必须有真实边界；"全部文件"按状态呈现。**

- 文件范围来自分析结果里的提交→文件映射；未分析的快照映射为空，"全部文件"按钮点了等于没切。`PullRequestPreview` 在映射存在时才把这个动作渲染成按钮（文案含具体数量），映射为空时渲染状态文字（`title` 说明原因），解释仍由该页既有的提示条承担。

## Risks / Trade-offs

- [令牌键名与语义不符] `--blue` 现在装松色 → 在 `tokens.css` 头部写明，新增变量一律用语义名（`--accent` / `--dark`），避免读者误判。
- [四主题对比度回归] 改色容易掉到 4.5:1 以下 → 每次改色都先跑 `contrast.test.ts`；主题只在值上不同，结构保持同构。
- [Mantine 内部结构变动] 依赖 `.mantine-SegmentedControl-control[data-active]` 等内部类名 → 覆盖集中在 `project-redesign.css` 一处，升级 Mantine 时只需改这里。
- [全局规则反噬] 深色面里的 diff、`tr` 白底、按钮色继承 → 用"先重置为透明、再按语义上色"的写法，并在注释里标注被压的全局选择器。
- [页码/工具条布局回退] `.pr-hub-list` 的单列 grid 被长标题撑宽并裁掉右侧按钮 → 用 `minmax(0, 1fr)` + 标题省略号，避免再出现。
- [react-diff-view / refractor 升级] 视觉依赖库脚手架与既往版本的 `varielize` 假定 → 覆盖集中在 `workbench-modern.css` 一处；适配器只在 `CodeDiff.tsx` 顶部一段，升级若改变返回值只需改适配器。
- [令牌作用域依赖] `--gh-*` 与 `--diff-*` 定义在面板选择器上，输入框/下拉不在面板内会取不到（实测曾导致边框为 0）→ 定义作用域用逗号串联 `.wb-code, .wb-files, .wb-notes, .pr-preview-files, .pr-preview-code`，新增面板时必须同步加进这个列表。
