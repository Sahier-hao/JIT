# 仓库更新入口移到页头

## Why

仓库更新与自动检查是仓库级状态，原先作为结果卡下方的一整行入口，既与「当前分析结果」抢位置，又在小屏上多占一行高度。用户要求「用一个图标加文字作为统一入口」，并质疑它是否该放在结果卡里。

## What Changes

- 页头标题行增加一个胶囊入口：刷新图标 + 「自动更新」+ 状态词，点击打开对话框。
- 对话框内保留状态说明、立即检查、自动检查开关、更新设置与保存。
- 结果卡下方不再有独立的更新行。
- 按钮字体统一到 13.5px/20px，图标与文字基线对齐。

## Capabilities

### Modified Capabilities

- `interface-presentation`

## Impact

- `frontend/src/components/RepositoryUpdates.tsx`、`frontend/src/pages/ProjectPage.tsx`、`frontend/src/styles/project.css`、`frontend/src/styles/ui.css`
- 接口与数据不变
