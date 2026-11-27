# 模型训练与评估交付报告

- change：`align-training-and-model-evaluation`
- 分支：`feature/align-training-and-model-evaluation`
- 基线提交：`420696fa4d9a858ee32106dbbd90de98e7456905`
- 机器检查：通过
- 人工复核：等待 PR 审核

## 汇总

| 项目 | 结果 |
| --- | --- |
| OpenAPI 操作总数 | 103 |
| 业务 API 清单 | 99 |
| admin 认证单独排除 | 4 |
| 高风险业务操作 | 76 |
| 矩阵操作数 | 99 |
| 矩阵引用测试 | 93 passed / 0 failed |
| 受影响后端测试 | 159 passed / 0 failed / 0 skipped |
| 前端单测 | 697/697 passed |
| 真实 E2E | 1 passed / 0 unexpected |
| typecheck / lint / build | 通过 |
| 样式 / 模块 / API 类型检查 | 通过 |

## 真实 E2E

隔离环境使用独立 SQLite、数据集根和模型产物根，通过真实前端与后端完成：

1. 校验 65/20/15 自定义比例和错误比例；
2. 真实 MLP 训练，查看逐轮损失；
3. 只登记选中的精确模型，并验证重复登记幂等；
4. 从训练详情进入模型评估，在验证集选择缺陷阈值并在冻结测试集复核；
5. 保存有成熟标签和旧标签的预测批次，从第二入口打开评估；
6. 核对 `immature`、`unknown` 排除计数；
7. 延迟真实批次请求并切换对象，验证旧响应不覆盖新对象；
8. 验证取消、重试、未就绪登记失败和不可用模型；
9. 在 1440、1280 和 390 宽度截图并确认无横向溢出。

## 证据

- OpenAPI：`openapi.generated.yaml`
- 操作清单：`api-inventory.json`
- 场景映射：`scenario-mapping.json`
- 场景矩阵：`scenario-matrix.json`
- 矩阵结果：`matrix-results.json`、`matrix-junit.xml`
- 后端受影响测试：`backend-targeted-junit.xml`
- 前端单测：`frontend-unit-results.json`
- 浏览器结果：`browser-results.json`
- E2E 身份：`e2e-identities.json`
- 截图：`screenshots/`
- AI 测试来源：`ai-test-provenance/`

## 人工复核

AI 生成或修改的测试已列明来源和提示词。人工复核仍待 PR 审核人完成，签署前本报告不宣称最终交付通过。

## 已知限制

- 预测批次只有在数据版本显式声明固定可靠测试分区时才可标为正式评估；普通保存批次保持探索性复核。
- 全仓文档链接检查仍报告 428 个既有历史文档目标缺失；本次新增文档未引入相对文件链接。
