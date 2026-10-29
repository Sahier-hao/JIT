# 项目详情页细节返工（2026-10-29）

## 环境
- 前端 `npm run dev -- --port 4173 --strictPort`（job `pwsh-71c48cb8375a4ffd`），后端 `python -m jit_baseline.cli serve --port 8000`（job `pwsh-4dbe2853081b41e0`，带 `HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:33210`）。
- 浏览器 Playwright + Edge channel，视口 1440×900。

## 本轮改动
- 分析结果卡：四格统计 + SVG 圆环图（三段弧 + 数量/百分比图例）+ 分支/数据 chip。
- 分析记录：固定高度 `min(520px, calc(100vh - 240px))`，记录增加不推动页面；每条记录恢复卡片边界与时间线节点；操作收进单个「更多操作」菜单（打开结果/对比/重试/取消/详情/删除），详情与删除改走对话框，取消新增确认对话框。
- 失败记录：`AlertTriangle` 图标 + 一句人话（`FAILURE_TEXT` 映射错误码），原文进「分析详情」；行高两行截断。
- 记录元信息：`MM-DD HH:mm · 起止日期`，去掉策略文案避免折行。

## 验证
| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc -b` | exit 0 |
| 单元/组件测试 | `npx vitest run` | 36 files / 282 tests passed（155.77s） |
| 构建 | `npm run build` | built in 2.29s，CSS 124.29 kB / JS 1.19 MB |

## 截图
- `docs/evidence/screenshots/project-workspace-20261029.png`（1440×900，`#/projects/1e4e22fd-38bf-5739-b51c-630dcac0c075`）。

## 未覆盖
- 深色主题（charcoal）本轮未重新截图核对。
- 窄屏（≤1024）下记录菜单与时间线的换行未逐档验证。
