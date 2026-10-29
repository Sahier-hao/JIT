# 仓库更新卡片的表面重排（2026-10-28）

## 背景

项目详情页的「仓库更新」卡片原先由一段 16px 状态标题、四列 11px 标签加 13px 值、
一段 12px 说明和一个折叠行拼成，纵向只有一层小字。本轮把它改成三段结构，并顺带
修掉 antd 控件被原生输入框样式覆盖的问题。

## 改动

- `frontend/src/components/RepositoryUpdates.tsx`
  - 状态带：图标 + 结论（`role="status"`）+ 一句细节 + 右侧三项统计（上次成功检查、
    下次检查、检查频率），状态用 `data-tone` 区分 ok / active / alert。
  - 自动检查开关与「更新设置」并列成一行；设置展开后是三列表单（跟踪分支、更新模型、
    检查频率 / 时间窗口、提交上限、保存并检查），提示文案提到表单之前。
  - 删掉重复的说明段落，状态细节与统计不再互相复述。
- `frontend/src/styles/product.css`
  - `.update-band`、`.update-band-icon`、`.update-band-text`、`.update-stats`、`.update-stat`
    等状态带样式；900px 以下纵向堆叠，640px 以下统计改为标签与值两端对齐的行。
  - `.update-foot` 两列布局（开关 + 设置），设置展开后独占整行。
  - 原生 `input/select/textarea` 的尺寸与边框规则改为排除 `[class*="ant-"]`，
    避免 antd `Select` 内部的搜索框被画成可见边框、盖住已选值。
- `frontend/src/styles/modern.css`：同一处原生控件规则同样排除 antd 控件。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0 |
| `npx vitest run`（全量） | 36 files / 282 tests passed |
| `npx vitest run src/components/RepositoryUpdates.test.tsx src/pages/ProjectPage.test.tsx` | 17 passed |
| `npm run build` | 3219 modules，`index-G9kH9jti.css` 97.04 kB（gzip 18.43）、`index-twyCwyTQ.js` 1,120.91 kB（gzip 362.95），2.17 s |

版面实测（1440×900、390×844）：横向溢出 0，控制台无报错（仅 favicon 404）。

截图：

- `docs/evidence/screenshots/project-updates-1440.png`：无新提交状态与整页节奏。
- `docs/evidence/screenshots/project-updates-settings.png`：更新设置展开后的三列表单。
- `docs/evidence/screenshots/project-updates-390.png`：窄屏下状态带与统计的堆叠。

## 未覆盖

- 更新中、更新失败两个状态只在浏览器里看过，未留档；失败态的红色说明行沿用
  `.field-error`，与状态带的 `alert` 色调是否重复，还需要再看一版。
- 检查进行时点击「立即更新」按钮的禁用态没有单独截图。
