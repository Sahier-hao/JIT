# 变更提案：把发起分析收进对话框

## Why

「发起分析」目前内联展开在项目详情页的窄栏里。窄栏 360px 宽、固定在右侧，而表单有六个字段（分支、时间范围、提交上限、模型、模型策略），展开后只能挤成两列：日期框和下拉框被裁到一半，整列高度增加约 300px，把「分析记录」推出视口。宽屏双栏（IP-18）要求窄栏同时容纳三种密度的内容，而表单是其中最不适合内联展开的一种。

## What Changes

- **新增入口卡**：窄栏里的「发起分析」只剩四项参数摘要（分支、时间范围、提交上限、模型）、一个深色主按钮和一句说明。
- **摘要反映真实参数**：摘要读表单写下的同一份会话草稿，显示的就是「现在提交会用的设置」；在对话框里改过的值，关闭后仍会显示在摘要里，而不是回退成写死的默认值。
- **表单移入对话框**：点击后打开宽 600px 的 antd 对话框，字段单列排布，页脚固定放「取消 / 开始分析」。
- **草稿不丢**：关闭对话框不清空草稿；从失败记录「用这些参数重试」时，对话框自动打开并预填原参数。

## Capabilities

### Modified Capabilities

- `interface-presentation`：新增 IP-19，规定发起分析的入口形态、摘要的真实性要求与对话框行为。

## Impact

- 代码：`frontend/src/components/AnalysisForm.tsx`（去掉内联展开，改为纯表单）、新增 `frontend/src/components/AnalysisLauncher.tsx`、`frontend/src/pages/ProjectPage.tsx`（换用入口卡，重试不再滚动定位）、`frontend/src/styles/product.css`、`frontend/src/styles/modern.css`。
- 测试：`frontend/src/components/AnalysisForm.test.tsx`、`frontend/src/pages/ProjectPage.test.tsx`。
- 契约不变：仍调用同一个 `startRepositorySync`，草稿键 `jit:analysis-draft:<repositoryUrl>` 不变，历史记录与当前结果不受影响。
