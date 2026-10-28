# 任务：把发起分析收进对话框

## 1. 表单收敛

- [x] 1.1 `AnalysisForm` 去掉内联展开状态与卡片外壳，只渲染字段区与页脚
- [x] 1.2 新增 `onCancel` 属性，页脚固定「取消 / 开始分析」
- [x] 1.3 保留草稿键 `jit:analysis-draft:<repositoryUrl>` 与既有提交逻辑

## 2. 入口卡与对话框

- [x] 2.1 新增 `AnalysisLauncher`：摘要（分支、时间范围、提交上限、模型）+ 主按钮 + 说明
- [x] 2.2 摘要读会话草稿合并默认值，关闭对话框时重新读取
- [x] 2.3 `Modal` 宽 600、`destroyOnHidden`、标题「发起分析」
- [x] 2.4 从失败记录重试时传入 `initial` 并自动打开

## 3. 页面接入与样式

- [x] 3.1 `ProjectPage` 换用 `AnalysisLauncher`，重试不再滚动定位
- [x] 3.2 `product.css` / `modern.css` 增加 `.analysis-launcher`、`.analysis-dialog` 规则，删除窄栏展开区覆盖
- [x] 3.3 摘要与按钮在窄栏 360px 与窄屏 390px 下都不溢出

## 4. 测试

- [x] 4.1 `AnalysisForm.test.tsx` 去掉「先展开分析选项」的步骤
- [x] 4.2 `ProjectPage.test.tsx` 先点「发起分析」再断言字段，提交用例走对话框
- [x] 4.3 全量 `npx vitest run` 通过

## 5. 验证与证据

- [x] 5.1 `npx tsc -b` 与 `npm run build` 通过
- [x] 5.2 截图：入口卡、对话框、390px 对话框
- [x] 5.3 证据写入 `docs/evidence/analysis-dialog-20261028.md`
- [x] 5.4 `openspec validate analysis-dialog --strict` 通过

## 6. 后续

- [ ] 6.1 深色主题（charcoal）主按钮仍为蓝色，与浅色主题的深墨色不一致，需要单独决定
- [ ] 6.2 发起分析成功后若用户停留在页面，可考虑在入口卡上显示「上次分析：成功 · 22:28」
