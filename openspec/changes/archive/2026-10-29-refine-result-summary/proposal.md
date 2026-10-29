# 当前结果卡片的表现力

## Why

「当前分析结果」是项目页的主内容，但四格数字加三条细进度条读起来像一张报表：总提交数与风险构成彼此割裂，占比条只有 6px 高，主按钮被降级成一行绿色文字。用户反馈「可视化图表现力不够、按钮不够明显、卡片可以重构、小字尽量少」。

## What Changes

- 结果卡主体改成左右并排：左侧 46px 的总提交数，右侧三条 12px 占比条，数字与比例按风险着色。
- 去掉四格统计条与分支 chip，页脚只保留数据集区间与一个主按钮。
- 「查看提交与审查计划」由链接样式改为主按钮。
- 修正带哈希后缀的数据集版本号解析，chip 显示为 `2026-10-13 → 10-27`。

## Capabilities

### Modified Capabilities

- `interface-presentation`

## Impact

- `frontend/src/pages/ProjectPage.tsx`、`frontend/src/styles/project.css`
- 数据契约不变，仅展示层
