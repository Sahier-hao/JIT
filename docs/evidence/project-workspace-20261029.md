# 项目详情页的记录与结果分区：验收记录

- 日期：2026-10-29
- 环境：Windows 11、Edge（Chromium channel）、前端 Vite dev `http://127.0.0.1:4173`、后端 `http://127.0.0.1:8000`
- 页面：`#/projects/1e4e22fd-38bf-5739-b51c-630dcac0c075`（JIT，49 条提交、5 条分析记录）

## 命令结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0 |
| `npx vitest run` | 36 files / 282 tests passed（147.93s） |
| `npm run build` | 3219 modules，built in 1.75s |
| `openspec validate refine-project-workspace --strict` | valid |
| `openspec validate --all --strict` | 20 passed, 0 failed |

## 版面核对

| 视口 | 结果 |
| --- | --- |
| 1440×900 | 左栏 730px、右栏 360px、间距 20px；横向溢出 0；记录卡固定 560px，5 条记录完整显示 |
| 1280×800 | 单列回退，三块纵向排列；横向溢出 0 |
| 390×844 | 单列，统计四格折成两列，横向溢出 0 |
| 深色主题（charcoal） | 卡片边框、占比条、时间线节点均可见；主按钮为浅色反白 |

## 截图

- `docs/evidence/screenshots/project-workspace-1440.png`
- `docs/evidence/screenshots/project-workspace-1280.png`
- `docs/evidence/screenshots/project-workspace-390.png`
- `docs/evidence/screenshots/project-workspace-dark.png`

## 人工走查

- 记录卡「更多」菜单：打开结果、与当前结果对比、用这些参数重试、取消分析、分析详情、删除记录均可用；删除与分析详情在对话框中完成。
- 失败记录显示一句中文结论与警示三角，后端原文只在「分析详情」里出现。
- 发起分析按钮在页头右侧，点击后在对话框里修改参数，取消后草稿保留。
- 记录增加到 6 条时页面高度不变，列表在卡内滚动并显示「已显示全部 5 次分析」。

## 未覆盖

- 深色主题下只核对了 1440 一档，窄屏深色未逐档截图。
- 记录数超过 20 条时的分页与滚动行为未单独验证。
- 分析进行中的实时进度刷新未在本次走查中触发。

## 追加：结果卡重排（2026-10-29）

- 四格统计条与分支 chip 已移除，改为「46px 总提交数 + 三条 12px 占比条」。
- 「查看提交与审查计划」改为主按钮。
- 数据集区间显示为 `2026-10-13 → 10-27`，完整版本号在 title 中。
- 截图：`docs/evidence/screenshots/project-workspace-1440.png`。


## 追加：两卡等高与配色（2026-10-29）

- .project-workspace 改为同一行拉伸，.pw-detail/.pw-rail 实测高度均为 430px。
- 记录卡上限 430px、卡内滚动；结果卡多余高度在 hero 区上下均分。
- 风险色改为项目页局部变量：高 `#C9352A`、中 `#DF8B10`、低 `#93A3B6`；深色主题 `#F0736A` / `#F2A93E` / `#94A5BA`。
- 数字与百分比分列右对齐、`tabular-nums`。


## 追加：仓库更新入口移入页头（2026-10-29）

- 页头新增胶囊入口（刷新图标 + 自动更新 + 状态词），点开为对话框；结果卡下方不再有更新行。
- 按钮字体统一为 `500 13.5px/20px var(--display)`，图标与文字基线对齐。
- 截图：`docs/evidence/screenshots/project-update-entry-1440.png`、`project-update-dialog.png`。

