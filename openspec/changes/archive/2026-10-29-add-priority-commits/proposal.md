# 结果卡补上「最该先看的提交」

## Why

结果卡只有总数与风险构成，卡片被拉高后显得空，用户也缺少「下一步看什么」的入口。

## What Changes

- 结果卡在风险构成下方增加「最该先看的提交」：取本次分析分数最高的三条，显示短提交号、标题与分数。
- 卡片高度改为由右栏记录数决定（网格拉伸），左卡不再强制固定高度。
- 结果卡内容在竖直方向均匀分布，避免底部留大片空白。

## Capabilities

### Modified Capabilities

- `interface-presentation`

## Impact

- `frontend/src/pages/ProjectPage.tsx`、`frontend/src/styles/project.css`
- 新增一次 `GET /api/v1/repository-syncs/{id}/commits?limit=60` 读取，失败时静默隐藏该区块
