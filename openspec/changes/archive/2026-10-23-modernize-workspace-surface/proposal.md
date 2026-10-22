# Proposal

## Why

项目工作区已经能完成「建项目 → 发起分析 → 看结果 → 切换当前结果」，但界面层还停在功能可用：卡片、按钮、表格几乎同一平面，悬停、焦点和选中缺少反馈；分析选项常显占掉首屏空间；审查页和项目页都用「‹ 项目」返回，却指向不同层级；切换当前结果时整页回到加载态，滚动位置丢失。

## What Changes

- 新增 `frontend/src/styles/modern.css` 表面层，在 `product.css` 之后加载：统一卡片/表格/按钮/记录的圆角、边框、阴影与悬停层级，状态用胶囊与色点表达，焦点轮廓可见，动效克制。
- 令牌只增不改：新增 `--r-xs`、`--r-md`、`--r-xl` 与 `--sh-3`，四套主题沿用既有键。
- 项目页的「发起分析」默认收起分析范围，只显示分支、时间范围、上限与模型策略的摘要；展开后编辑，提交按钮始终可见。
- 分析记录的当前结果改用单选圆点选择：点整条记录切换，打开/重试/删除仍是独立操作。
- 返回控件按层级命名：审查页「返回项目」回到所属项目页，项目页「全部项目」回到项目列表。
- 项目详情重新拉取时保留已加载页面，切换当前结果不再整页回到加载态，滚动位置保持。

## Capabilities

### Modified Capabilities

- `focused-project-review`：FPR-02 增加「发起区默认收起」与「切换当前结果保持位置」。
- `interface-presentation`：新增 IP-13「统一表面与可见状态」。
- `workspace-navigation`：WSN-02 明确返回控件指向的层级与文案。

## Impact

- 前端：`frontend/src/styles/{tokens,modern,product}.css`、`frontend/src/index.css`、`frontend/src/components/AnalysisForm.tsx`、`frontend/src/pages/{ProjectPage,ProjectsPage}.tsx`、`frontend/src/ReviewWorkbench.tsx`、相关测试。
- 后端与 API：无新增接口；本 PR 同时提交此前已归档的 `select-current-analysis`（PATCH 切换当前结果）。
- 无数据库迁移，无新增依赖。
