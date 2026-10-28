# 发起分析对话框：实现与验收记录

- 日期：2026-10-28
- 变更：`openspec/changes/analysis-dialog/`（已归档为 `2026-10-28-analysis-dialog`）
- 环境：Windows 11、Edge（`channel: 'msedge'`）、前端 `http://127.0.0.1:4173`（Vite dev server）、后端 `http://127.0.0.1:8000`
- 数据：项目 `JIT`（`1e4e22fd-38bf-5739-b51c-630dcac0c075`）

## 改动范围

| 文件 | 改动 |
| --- | --- |
| `frontend/src/components/AnalysisForm.tsx` | 去掉内联展开与卡片外壳，只渲染字段区与页脚；新增 `onCancel` |
| `frontend/src/components/AnalysisLauncher.tsx` | 新增：参数摘要 + 主按钮 + `Modal` |
| `frontend/src/pages/ProjectPage.tsx` | 换用 `AnalysisLauncher`；重试不再滚动定位 |
| `frontend/src/styles/product.css` | `.analysis-launcher`、`.analysis-dialog`、窄屏对话框滚动 |
| `frontend/src/styles/modern.css` | 删除窄栏里针对展开区的覆盖规则 |
| `frontend/src/components/AnalysisForm.test.tsx` | 去掉「先展开分析选项」步骤 |
| `frontend/src/pages/ProjectPage.test.tsx` | 先点「发起分析」再断言字段；提交用例走对话框 |

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0 |
| `npx vitest run src/pages/ProjectPage.test.tsx src/components/AnalysisForm.test.tsx` | 2 files / 16 tests passed |
| `npx vitest run` | 36 files / 282 tests passed（199.06s） |
| `npm run build` | 3219 modules，built in 2.67s，`index-LPi3ju90.js` 1,181.42 kB（gzip 380.59） |
| `openspec validate analysis-dialog --strict` | Change 'analysis-dialog' is valid |

## 版面核对

| 视口 | 入口卡宽度 | 对话框 | 横向溢出 | 页脚可见 |
| --- | --- | --- | --- | --- |
| 1440×900 | 360（窄栏） | 600×621 | 0 | 是 |
| 390×844 | 全宽 | 374×832 | 0 | 是（内容在框内滚动，操作行贴底） |

## 截图

- `docs/evidence/screenshots/analysis-launcher-1440.png`：入口卡（四项摘要 + 深色主按钮）
- `docs/evidence/screenshots/analysis-dialog-1440.png`：对话框（两列短字段、单列长字段）
- `docs/evidence/screenshots/analysis-dialog-390.png`：窄屏对话框（单列、操作行贴底）

## 人工走查

1. 打开 `#/projects/1e4e22fd-38bf-5739-b51c-630dcac0c075`，窄栏显示「分支 main / 时间范围 最近 90 天 / 提交上限 500 条 / 模型 自动（按数据量给建议）」。
2. 点「发起分析」，对话框打开，标题「发起分析」，页脚「取消 / 开始分析」。
3. 改分支与提交上限后点「取消」，再打开——改动仍在（草稿）。
4. 入口卡摘要随之更新为改动后的值。
5. 从失败记录的「用这些参数重试」进入，对话框自动打开并预填。

## 未覆盖

- 真实提交一条新分析的完整等待链路（后端在截图期间被 GitHub 未认证配额限制，返回 429 / `REPOSITORY_UNAVAILABLE`）。
- 截图期间四条历史分析记录被界面上的「删除记录」逐个删除（23:30–23:34，每次删除后页面重新拉取），项目一度回到「等待分析」状态；新分析已在 23:37 自动开始采集。截图取自删除前的健康状态。
