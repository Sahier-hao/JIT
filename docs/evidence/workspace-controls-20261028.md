# 工作区控件一致性验证记录（2026-10-28）

## 环境

- 仓库：`Sahier-hao/JIT`，分支 `feat/frontend-visual-system`。
- 前端：`npm run dev`（Vite 8.3.4，`http://127.0.0.1:4173`）。
- 后端：`python -m jit_baseline.cli serve --port 8000`，健康检查 `{"status":"ok"}`。
- 浏览器：Edge（Playwright `channel: 'msedge'`），视口 1440×900。
- 数据：真实 PR `Sahier-hao/JIT#31`（快照 74 个文件）、真实项目 `1e4e22fd-38bf-5739-b51c-630dcac0c075`。

## 本轮改动

- 项目详情页的仓库更新改用统一开关、输入框、下拉与数字输入；更新设置改为带箭头的折叠区；去掉左侧强调色边线与装饰性眉标。
- 审查工作单的版本说明、输出意见、个人草稿备份三个抽屉：去掉页面级分隔线，说明与按钮分行，文件选择走隐藏输入加按钮。
- 计划备份与恢复的导入导出改用按钮加隐藏输入。
- 管理区登录与初始化表单改用统一输入框与按钮，去掉装饰性英文眉标；工具栏、刷新按钮、数据版本折叠改用统一组件。
- 主题层：主色绑定产品主操作色；关闭两字按钮自动空格；`[hidden]` 强制生效，删除覆盖它的旧文件输入规则。

## 验证结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc -b` | exit 0 |
| 生产构建 | `npm run build` | 3219 modules，`index-DzPgo8ks.css` 94.17 kB（gzip 17.99）、`index-jt0EbX6r.js` 1,120.09 kB（gzip 362.74），19.89 s |
| 前端测试 | `npm test` | 36 个文件、282 个用例全部通过（126.27 s） |
| 规格校验 | `openspec validate align-workspace-controls --strict` | Change is valid |

## 截图核对

- `docs/evidence/screenshots/controls-queue-1440.png`：审查队列，左侧对齐标题、接入输入框、虚线空态，无居中大标题。
- `docs/evidence/screenshots/controls-projects-1440.png`：项目列表，卡片密度收敛，指标与最近请求同行。
- `docs/evidence/screenshots/controls-project-1440.png`：项目详情，仓库更新卡片无左侧色条，「更新设置」为折叠行，「立即更新」与「开始分析」同为深墨主按钮。
- `docs/evidence/screenshots/controls-workbench-1440.png`：PR 工作单三栏，代码栏 800 px，行号区分旧/新，hunk 头可见。
- `docs/evidence/screenshots/controls-delivery-drawer.png`：输出意见抽屉，统一下拉与文本域。
- `docs/evidence/screenshots/controls-backups-drawer.png`：草稿备份抽屉，两个按钮，页面无原生「选择文件」控件。
- `docs/evidence/screenshots/controls-admin-signin.png`：管理登录页，统一输入框与按钮，无英文眉标。

## 未覆盖

- 项目详情页的其余内联表单、验证报告页仍保留页面级分隔线，已记入 `tasks.md` 的 Workflow follow-up（6.1）。
- 反馈案例导出的文件内容未在浏览器里逐条重放，仍由既有单元测试覆盖。
- 深色主题（charcoal）只做了主题切换回归，未逐页截图。
