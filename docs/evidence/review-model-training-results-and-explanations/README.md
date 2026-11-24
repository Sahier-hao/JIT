# 训练阈值与多方法解释验收

[PR #75](https://github.com/Sahier-hao/JIT/pull/75) 交付三档训练比较，[PR #76](https://github.com/Sahier-hao/JIT/pull/76) 交付解释方法和迁移 043，[PR #77](https://github.com/Sahier-hao/JIT/pull/77) 交付冻结测试集阈值复核。[PR #78](https://github.com/Sahier-hao/JIT/pull/78) 恢复关键回归。[PR #80](https://github.com/Sahier-hao/JIT/pull/80) 与 [PR #79](https://github.com/Sahier-hao/JIT/pull/79) 交付多方法解释前端及恢复、无障碍和浏览器测试。

## 回归结果

| 检查 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| 后端完整回归 | 1054 | 0 | 0 |
| 前端单元测试 | 604 | 0 | 0 |
| 多方法解释、模型包恢复、两账户续审浏览器用例 | 3 | 0 | 0 |

后端完整回归在 Windows、Python 3.14.2 上执行，使用短的临时路径和固定 OpenStack 数据初始化独立目录库。后端有四条警告。前端类型检查、生成 API 类型校验、Lint 和构建通过，Lint 和构建有警告。[机器可读验收结果](verified-results.json)

## 可追溯验收

- 同一 OpenStack 时间切分下的逻辑回归和随机森林已完成训练比较，阈值测试使用保存的分数和标签。[比较导出](threshold-comparison.json) · [阈值复核截图](threshold-results.png)
- 多解释用例以实际登记的逻辑回归模型生成两种解释。浏览器注入一次网络中断，随后向隔离服务重试，成功保存解释。刷新后读取已保存结果，没有新增生成请求。切换提交、贡献表的行列标题及窄屏无页面溢出均有断言。[请求记录](explanation-requests.json) · [多方法对照](explanation-methods-multi-method-explanations.png) · [窄屏截图](explanation-narrow-multi-method-explanations.png)
- 模型包用例恢复九个已登记模型，并显示混合包中的成功、冲突和失败原因，覆盖三种视口。[恢复截图](model-package-recovery-1440.png)
- 在 v42 的历史数据库副本上验证迁移 043。九条旧解释的归属和原文哈希、训练、模型、风险与历史结果的行数和内容哈希一致。迁移自动生成的旧版备份可读，重复初始化幂等。[迁移审计](migration-043-audit.json)
- 解释后端测试的提示词、用例来源和人工复核记录见 [PR2 复核](pr2-ai-test-provenance/manual-review.md)。
