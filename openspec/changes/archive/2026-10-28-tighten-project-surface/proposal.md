# 收紧项目详情页的区块层级

## Why

项目详情页由三个功能块拼成，但每个块各自发明了一套标题与间距：仓库更新在卡片内部用 18px 标题，发起分析与当前分析结果在卡片外用 22px 标题，分析选项又是卡片内的 16px 标题加图标。整页因此出现 26、22、18、16、13、12 六档字号，其中 18px 只出现一次。

由此带来的具体问题：

- 左边缘不齐：卡片标题从 x=90 开始，状态带正文从 x=174 开始，同一张卡片里的红色错误行又回到 x=90。
- 同一件事说三遍：状态带标题「仓库更新未完成」、说明「这次检查没有完成，可以重试」、卡片外的红字「无法读取仓库，请检查地址、分支或网络后重试」；「不会覆盖当前结果」与卡片底部的「发起后会新增一条记录，当前结果不会被覆盖」也是同一句。
- 恢复动作离问题太远：重试按钮在卡片右上，离错误文字约 180px，而且是描边按钮；页面上真正抢眼的是两端两个深色主按钮。
- 只读摘要做成了按钮：发起分析折叠行的四个灰底标签看起来像筛选项，实际只是当前参数。
- 间距反了：区块之间留 56–80px，区块内部的状态带、错误行、复选框、更新设置却挤在 40px 内。

## What Changes

- **统一区块标题**：三个区块都用 15px 的 `.section-label` 标题加右侧动作，不再有卡片内 18px 标题、卡片外 22px 标题和带图标的 16px 标题三种写法。
- **仓库更新收敛成一张卡片**：状态带、自动检查开关、更新设置放进同一张带边框的卡片；错误信息进入状态带的详情行，卡片外那行红字删除；重试按钮移到区块标题右侧，失败时升为主按钮。
- **发起分析去掉重复信息**：「不会覆盖当前结果」从区块标题移到底部动作条，与「开始分析」同一行；四个只读标签合并成一行参数摘要，不再画成按钮。
- **当前分析结果保留单一主按钮**：「查看提交与审查计划」降为链接按钮，全页只保留「打开审查」与「开始分析」两个深色主按钮。
- **窄屏重排**：状态带在 900px 以下改为两列（图标 + 文本），统计三项落到第二行整行；390px 下标题不再被挤成四行。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `interface-presentation`：新增「项目详情页的区块层级」要求，规定区块标题规格、卡片边界、主按钮数量与错误信息的落点。

## Impact

- 前端源文件：`frontend/src/pages/ProjectPage.tsx`、`frontend/src/components/RepositoryUpdates.tsx`、`frontend/src/components/AnalysisForm.tsx`。
- 样式：`frontend/src/styles/product.css`（删除 `.repository-updates` 的绿边与遗留规则，新增 `.project-updates`、`.update-card`）、`frontend/src/styles/modern.css`（`.analysis-disclosure-summary`、`.analysis-card .form-submit`）。
- 接口与数据不变：`/api/v1/repositories/{id}`、更新设置与发起分析契约、`repository-updates` 的轮询行为都没有改动。
- 测试：`RepositoryUpdates.test.tsx`、`AnalysisForm.test.tsx`、`ProjectPage.test.tsx` 全部通过；可访问名称与 `role=alert` 结构保持原样。
- 风险：把错误信息并入状态带后，原先依赖卡片外红字位置的观感变化；`.update-card` 的边框与其它卡片一致后，区块之间只能靠留白区分。
