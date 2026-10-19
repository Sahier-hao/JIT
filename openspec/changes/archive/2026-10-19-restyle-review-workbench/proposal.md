# Proposal

## Why

界面现在把「公开数据集回放」当成主工作台，评审员一进来看到的就是 1,853 条 2014 年的 OpenStack 提交和一句话「公开历史数据·模型估计」。这是开发者验证模型的样本，不是评审员要看的东西。同时页面主体是一张占满宽度的六列表格，没有「今天该审哪些」的落点，看完也带不走结论。

界面需要回到它真正的用户——公司里的代码评审员：他打开系统只想知道这个仓库最近有哪些提交值得先看，挑十几条带走。

## What Changes

- **评审台以仓库为入口**：左侧列出已接入的仓库，点进去看该仓库当前视图的待审提交；没有仓库时显示接入引导，不再默认展示公开数据集。
- **公开数据集回放降级为验证视图**：移到「管理 → 验证数据」，保留运行、模型与指标的查证能力，不再出现在评审台来源切换里。
- **重写应用骨架**：左侧固定侧栏（品牌、仓库列表、评审/数据/管理三组导航、凭据入口）+ 主内容区 + 右侧常驻「本次审查」队列；1280 宽以下右侧队列收成抽屉。
- **重写评审台**：仓库标题与同步摘要、风险分布条、搜索/日期/排序工具栏、紧凑列表（行首风险色条、标题与元信息、风险百分比与细条、变更行、文件数）、分页条。
- **重写提交详情抽屉**：风险结论、中文归因（改动文件多 / 新增行多 / 多人参与 …）、8 项提交规模、来源与限制。
- **设计令牌整体替换**：冷灰底 + 深墨文字，主按钮近黑、蓝色只用于选中与链接；引入自托管的 Inter 西文子集（中文继续用系统字族）；浅色为默认主题，深色可选；舒适/紧凑两档密度。
- **接入仓库页调整**：表单收敛为「地址 + 开始同步」，其余进「高级选项」；作业以时间线呈现，失败给人话与下一步。
- **模型页移入「管理」**：保留指标面板，不再作为一级导航。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `interface-presentation`: 新增 IP-10「应用骨架」与 IP-11「评审台布局」；修改 IP-09「素材一致性」——允许状态使用带底色的短标签（原规定禁用胶囊），其余约束保留。
- `commit-risk-review`: 修改 CRR-01「演示来源可识别」——评审台默认来源改为仓库，公开数据回放改为由管理页进入的验证视图，两者不混排；原场景名称逐字保留。

## Impact

- 前端：`frontend/src/styles/*`（tokens 全量替换、shell/pages/workbench 重写）、新增 `frontend/src/styles/review-queue.css`、`frontend/src/AppShell.tsx`、`App.tsx`、`CommitDetail.tsx`、`RepositorySourcesPage.tsx`、`ModelsPage.tsx`、`navigation.ts`、`repositoryPage.ts`、`shortlist.ts`；新增 `frontend/public/fonts/inter-latin.woff2` 与 `fonts/LICENSE.txt`。
- 数据依赖：本 change 依赖 `add-repository-workspace` 的 5 个仓库接口；未合入前前端只能对接 `/api/v1/repository-syncs`。
- 测试：`frontend/src/*.test.tsx` 中依赖「公开数据」默认来源的用例要改；新增评审台与队列单测；`frontend/e2e/*` 中工作台与无障碍用例要按新骨架重写选择器。
- 文档：`docs/产品设计文档.md` 的界面结构与视觉规范章节、`docs/产品需求文档.md` 的 5.1 信息架构图。
- 风险：`openspec/specs/interface-presentation` 的 IP-04 已在上一个规格调整中改为「资源自包含」，本 change 按该版本引入字体，不再改动它。
