# 审查工作区表面改版 · 验证记录

日期：2026-10-27。对应变更 `openspec/changes/refresh-review-surface`。

## 环境

- 前端开发服务 `http://127.0.0.1:4173`（Vite 8.3.4），后端 `http://127.0.0.1:8000`（`jit_baseline.cli serve`，经系统代理访问 GitHub）。
- 数据：真实公开 PR `https://github.com/Sahier-hao/JIT/pull/31`，快照 `488ea3a1-8dcc-585f-9601-7b5c35299b5c`，74 个文件、1 个提交，远端状态 `merged`。
- 浏览器：Edge（`channel: 'msedge'`），视口 1440×900、1280×720、390×844。

## 命令结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -b` | 退出码 0，无类型错误 |
| `npm run build` | 3219 modules transformed；`index-85x6rHsc.css` 89.15 kB（gzip 17.12 kB）、`index-BSk5VyJz.js` 1,078.85 kB（gzip 348.54 kB）；2.20s 完成 |
| `npm test` | 36 个测试文件、282 个用例全部通过，102.75s |

`npm run build` 报出单块超过 500 kB 的提示（antd 与 react-diff-view 引入所致），未作为失败处理。

## 版面实测（`getBoundingClientRect`）

| 视口 | 文件栏 | 代码栏 | 问题栏 | 页面横向溢出 |
| --- | --- | --- | --- | --- |
| 1440×900 | 268 | **800** | 372 | 0 |
| 1280×720 | 236 | **724** | 320 | 0 |
| 390×844 | 横向文件条 | **390** | 纵向堆叠 | 0 |

改版前同一页面代码栏为 564 px（1440×900，左侧全局导航 236 px 占位）。修正前 1280 与 390 两个视口存在 8 px 横向溢出，来源是页头进度条 `margin: -24px` 超出页头内边距；给 `.wb-head` 加 `overflow-x: clip` 后三档视口均为 0。

## 截图

| 文件 | 内容 |
| --- | --- |
| `.dsh-tmp/final-1440d.png` | 工作单，1440×900，三栏、语法高亮、旧/新行号分栏 |
| `.dsh-tmp/final-1280c.png` | 工作单，1280×720 |
| `.dsh-tmp/final-390wb2.png` | 工作单，390×844，文件栏改为横向条 |
| `.dsh-tmp/my-reviews2.png` | 审查队列，1440×900，工作行 + 分组 |
| `.dsh-tmp/final-390.png` | 审查队列，390×844 |

## 人工走查

- 点击行号：旧行号关联 `base`、新行号关联 `head`，问题记录出现对应证据，行保持 `is-focused` 高亮；删除行只在新侧留空、新增行只在旧侧留空（截图可见 30 行删除只占旧侧、30 行新增只占新侧）。
- 统一/并排切换、完整上下文、标记已阅读、文件阅读状态下拉均可用。
- 版本与说明、输出意见、草稿备份三个抽屉可开可关；抽屉内「本轮结论」「本轮结论说明」在重开后仍保留（单元测试覆盖）。
- 远端 PR 已合并时给出历史审查提示，草稿与原结论保留。
- 队列页在 390 px 下无横向滚动，接入输入与「检查关注工作更新」可点。

## 状态核对（`frontend/.dsh-tmp/states.mjs`，路由拦截造态）

| 状态 | 触发方式 | 结果 |
| --- | --- | --- |
| 读取中 | 拦截 `**/api/v1/pr-sources/**` 不返回 | `.wb-state` 面板显示「正在读取 PR」与预计耗时，附「返回我的审查」 |
| 读取失败 | 拦截 refresh 返回 500 | 面板转为「这个工作单暂时读不出来」，显示错误文案与「重试读取」「返回我的审查」，标题点变为警示色 |
| 空队列 | 清空 localStorage 后进 `#/reviews` | 页头接入框 + 虚线空态面板，无居中大标题 |
| 禁用态 | 未选结论时「确认输出」保持禁用 | 单元测试覆盖（`keeps writing and reports unsaved text when browser storage fails`） |
| 保存失败 | 拦截 localStorage 写入抛错 | 顶部提示未保存，编辑内容保留 |

截图：`.dsh-tmp/state-loading.png`、`.dsh-tmp/state-error.png`、`.dsh-tmp/state-empty.png`。

## 交互走查（`frontend/.dsh-tmp/walk.mjs`，Edge 1440×900）

六项全部通过：点击行号 `关联 backend/jit_baseline/api.py:base:27` 生成一条证据；切「并排」渲染 `.diff-split`；打开「输出意见」抽屉；按 Escape 关闭且焦点回到触发按钮；切换文件后代码栏更新；「标记已阅读」可用。并排截图 `.dsh-tmp/walk-split.png`。

## 未覆盖

- 项目详情页与管理工作区的表面统一不在本次范围（见 tasks.md 的 Workflow follow-up）。
- 首次进入工作单仍要等待快照拉取（74 个文件约 25 s），本次未优化加载耗时。
- 导出意见、草稿恢复走的是单元测试与既有实现，未在浏览器里逐条重放。
