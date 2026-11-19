# 前端 Sprint2 核心单元用例提示词记录

## 使用的 AI 工具

- 工具：OpenAI Codex
- 任务入口：`openspec-apply-change`
- change：`deliver-sprint2-unit-test-report`

本文件记录交给 AI 编码工具、用于生成本轮前端新增测试的完整任务提示词。
它不是对隐藏系统提示、产品运行提示或第三方模型内部提示的归档。

## 完整任务提示词

```text
继续实现 OpenSpec change `deliver-sprint2-unit-test-report`。

只做 Sprint2 单次交付，不新增长期 PR 测试门禁。前端正式单元范围限定为不依赖
React 渲染、浏览器、真实 HTTP 或开发机存储的领域与契约纯函数。

为每个登记函数提供独立的正常、边界和异常用例，断言实际返回值、排序、错误结果
或解析状态。不得以只验证调用次数、对象存在或无意义真值替代业务断言。

使用 Node 环境运行快速套件，生成行覆盖率和分支覆盖率，并与机器清单、测试结果
一起生成可追溯报告。人工复核由项目负责人实际完成，AI 不得填写审核人或审核结论。
```

## 采用范围

- 新增 `frontend/src/sprint2Core.test.ts`。
- 新增 `frontend/vitest.sprint2.config.ts` 与 `npm run test:unit:sprint2`。
- 未修改产品页面、API 客户端、状态管理或既有完整回归配置。
- AI 新增的每个正式用例名称均带 `[AI生成]` 标记。

## 测试文件与定位

- 测试文件：`frontend/src/sprint2Core.test.ts`
- 用例到核心函数的映射：`docs/test-delivery/sprint2-unit-test/core-tests.json`
- 人工审核待办：`docs/test-delivery/sprint2-unit-test/manual-review.json`
