# Proposal

## Why

PR 分析的入口此前分散在只读详情、每个 PR 行和项目页三处：只读详情需要先进入工作单才能生成线索，列表逐行生成又无法选择模型；PR 分析任务与分支分析共用「分析记录」，导致记录列表出现 PR 任务、中断任务被误显示为「分析中」。2026-10-30 用户要求把 PR 分析收敛为列表级批量动作，详情只读结果，并清理没有意义的界面小字。

## What Changes

- 项目页头部新增「分析全部 PR」：点击先选择真实兼容模型，再为所有开放 PR 提交后台分析；已有完成分析的 PR 跳过，进度通过 PR 清单状态反映。
- PR 审查页改为两栏：左侧 PR 清单，右侧「PR 分析记录」，逐条显示状态、模型、最高提交分与时间，点击记录进入对应 PR。
- 只读 PR 详情只展示已保存的风险结果，不再提供模型选择、生成、重试或取消入口；分析统一从列表发起。
- 项目「分析记录」只显示分支分析；PR 分析任务归 PR 分析记录，不再混入分支记录或占用「当前结果」。
- 中断、取消与失败任务如实显示对应状态，不再显示为「分析中」；手动 PR 分析返回实际使用的模型名。
- 界面文案只保留状态、数据与操作提示，删除解释性、重复性与装饰性小字。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- `public-pull-request-review`: 风险结果由列表级批量分析产生，只读详情只展示结果，不再提供分析入口。
- `project-pr-tracking`: 批量分析全部开放 PR、跳过已完成任务，PR 分析记录独立于分支分析记录。
- `interface-presentation`: 新增界面文案克制要求，只保留状态、数据与操作提示。

## Impact

- 后端：`pr_updates.analyze_all_prs`、`analyze_pr` 与 PR 清单的状态/模型字段；`sync.py` 的分析记录支持按用途过滤；`api.py` 新增批量与单 PR 分析路由，分析记录接口排除 PR 任务。
- 前端：`pages/ProjectPage.tsx` 的模型选择对话框；`components/ProjectPullRequests.tsx` 的两栏布局与分析记录；`components/PRModelClues.tsx` 改为只读展示；`ui/*` 组件与样式清理。
- 契约与文档：`docs/api/openapi.yaml` 新增两条分析路径；`docs/当前产品.md`、`AGENTS.md` 的界面文案约定与本轮审计记录。
- 数据：不新增迁移；既有 PR 任务与分析结果保留，仅改变展示归属。
