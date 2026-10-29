# 收紧项目详情页的记录与结果

## Why

项目详情页上一版把「当前分析结果」和「分析记录」放在同一张大卡片里：记录一多就把整页撑长，两块的边界靠内边距区分，读起来像一栏；发起分析占了窄栏的六个字段，内联展开后把记录推出视口；记录行的动作按钮排成一排、失败信息直接铺后端原文。

## What Changes

- 结果与记录拆成左右两张独立卡片：结果在左、记录在右，各自有 1px 边框、12px 圆角与轻阴影；仓库更新与自动检查移到左列结果卡下方。
- 分析记录卡高度固定在 620px 内、内部滚动，记录增加不再推动整页；没有记录时给出与卡片高度匹配的说明。
- 记录行改成「标记列 + 内容列」的时间线：节点与竖线画在标记列，最后一条不再画线；当前结果用绿色节点与浅绿底标出。
- 记录动作收成一个「更多」按钮 + 浮层菜单（打开结果 / 对比 / 重试 / 取消 / 详情 / 删除），删除与分析详情改用对话框确认。
- 失败记录只显示一句可读结论，后端原文收进「分析详情」；失败用警示三角，进行中用旋转图标。
- 风险分布从圆环改为三条水平占比条，数量与百分比同行显示。
- 发起分析收进对话框，页头只留一个主按钮。

## Capabilities

### Modified Capabilities

- `interface-presentation`：项目详情页的结果与记录分区、记录时间线与动作菜单、风险分布的表现形式。

## Impact

- 代码：`frontend/src/pages/ProjectPage.tsx`、`frontend/src/components/AnalysisLauncher.tsx`、`frontend/src/ui/controls.tsx`、`frontend/src/ui/dialog.tsx`、`frontend/src/ui/popover.tsx`、`frontend/src/styles/project.css`、`frontend/src/styles/ui.css`。
- 契约不变：记录接口、同步接口、错误码与数据集版本命名都不改。
- 测试：`ProjectPage.test.tsx` 更新到单按钮与菜单交互。
- 风险：记录卡固定高度依赖视口高度，极矮的窗口需要滚动整页；深色主题的主按钮改成浅色反白。
