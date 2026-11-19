# 后端 Sprint2 核心单元用例提示词记录

## 使用的 AI 工具

- 工具：OpenAI Codex
- 任务入口：`openspec-apply-change`
- change：`deliver-sprint2-unit-test-report`

本文件记录交给 AI 编码工具、用于生成本轮新增测试与测试基础设施的完整任务提示词。
它不是对隐藏系统提示、产品运行提示或第三方模型内部提示的归档。

## 完整任务提示词

```text
继续实现 OpenSpec change `deliver-sprint2-unit-test-report`。

只做 Sprint2 单次单元测试交付，不新增长期 PR 单元测试门禁，不修改
continuous-regression、分支保护或 PR 必过规则。

后端单元范围限定为数据解析与完整性校验、指标、时间切分、方法参数与模型标识等
核心纯逻辑。不得把真实模型训练、临时 SQLite、HTTP 接口、React 组件或浏览器旅程
混入正式快速单元套件。

为每个登记的核心函数提供至少一个正常、一个边界和一个异常用例。断言必须检查
函数可观察的业务结果，不得用无意义真值、仅调用次数或纯存在性断言替代。
测试只使用合成输入和受控替身，不访问网络、正式数据库、正式模型包或私有数据。

同时建立机器可读的测试清单、清单完整性校验、独立运行入口、行/分支覆盖率、
可重复生成的 JSON 与 Markdown 报告。人工审核不能由 AI 代签；审核记录缺失时
最终交付必须失败。
```

## 采用范围

- 新增 `backend/tests/test_sprint2_unit_core.py`。
- 新增清单校验器、统一运行器、报告生成器和负向报告测试。
- 未修改产品运行逻辑、训练算法、API、数据或已归档证据。
- AI 新增的每个正式用例均以 `# [AI生成]` 标记。

## 测试文件与定位

- 测试文件：`backend/tests/test_sprint2_unit_core.py`
- 用例到核心函数的映射：`docs/test-delivery/sprint2-unit-test/core-tests.json`
- 人工审核待办：`docs/test-delivery/sprint2-unit-test/manual-review.json`
