# 项目详情页区块层级收紧：验证记录（2026-10-28）

## 环境

- 前端：`http://127.0.0.1:4173`（Vite 开发服务器，Edge 渲染）
- 后端：`http://127.0.0.1:8000`，`/api/health` 返回 `{"status":"ok"}`
- 数据：项目 `1e4e22fd-38bf-5739-b51c-630dcac0c075`（JIT，56 条已分析提交）
- 截图脚本：`frontend/.dsh-tmp/shot.mjs`、`frontend/.dsh-tmp/up-open.mjs`（Playwright，Edge channel）

## 命令结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0 |
| `npx vitest run src/components/RepositoryUpdates.test.tsx src/components/AnalysisForm.test.tsx src/pages/ProjectPage.test.tsx` | 3 files / 20 passed |
| `npx vitest run` | 36 files / 282 tests passed（160.83s） |
| `npm run build` | 3219 modules，built in 1.70s |

## 版面核对

| 视口 | 横向溢出 | 说明 |
| --- | --- | --- |
| 1440×1000 | 0 | 三个区块标题同列，卡片边界一致，主按钮为「打开审查」与「开始分析」 |
| 1440×1000（更新设置展开） | 0 | 三列表单两行，「保存并检查」落在第二行第三格 |
| 390×1000 | 0 | 状态带「图标 + 文本」两列，统计三项独占一行，结论标题两行内 |

## 截图

- `docs/evidence/screenshots/project-surface-1440.png`：默认态
- `docs/evidence/screenshots/project-surface-settings-1440.png`：更新设置展开
- `docs/evidence/screenshots/project-surface-390.png`：窄屏

## 人工走查

- 状态带结论、详情与统计三者的左边缘与卡片标题对齐。
- 失败态下「重试更新」位于区块标题右侧并为主按钮，失败原因只出现在状态带内。
- 「发起分析」底部动作条提示在左、「开始分析」在右。
- 「查看提交与审查计划」为链接按钮，与页头「打开审查」不再竞争。

## 未覆盖

- 仓库更新的失败态没有在本次截图中逐档留证：后端在截图期间多次返回 `REPOSITORY_UNAVAILABLE`（GitHub 未认证配额 429），失败态曾随构建一并核对，但最终三张截图是健康态与设置展开态。
- 分析记录列表的分页、删除与取消确认未重新走查，本轮未改动这些交互。
- 深色主题（charcoal）下主按钮仍为蓝色，与浅色主题的深墨色不一致，留待统一决定。
