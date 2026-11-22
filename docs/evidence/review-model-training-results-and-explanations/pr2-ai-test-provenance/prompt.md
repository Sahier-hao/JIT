# PR2 AI 测试定向提示词

## 工具信息

- 工具：OpenAI Codex
- 轮次：`review-model-training-results-and-explanations` PR2 解释后端
- 用户请求：`$openspec-apply-change`

## 任务

继续实现 `review-model-training-results-and-explanations` 的 PR2，只做解释后端：

1. 建立解释方法注册表，声明 `occlusion-mean-v1` 与 `linear-logodds-v1` 的
   适用范围、单位、基线、成本、确定性和限制；目录只返回模型实际适用的方法。
2. 实现逻辑回归 `linear-logodds-v1`：当前输入和基线都经过原 Pipeline 的实际
   预处理，每个特征贡献为
   `coef_i * (transformed_current_i - transformed_baseline_i)`，全部贡献和必须
   等于当前输入相对基线的 log-odds 差。
3. 保留原遮挡法默认行为；未指定方法时旧请求仍返回原口径，不因新增方法改变风险。
4. 新增迁移 043，把解释主键扩展为 `(sync_id, commit_id, method)`；旧记录只补
   方法键，payload 不重写，重复初始化幂等。
5. 服务支持按方法读取、生成和列出；同一方法幂等，新方法不覆盖旧方法；模型已不可用
   时，已保存解释仍可读取。
6. 增加方法目录、按方法生成、已保存解释列表 API；未知或不兼容方法明确拒绝，不能
   静默生成替代解释，也不能修改原风险。
7. 更新 OpenAPI 和后端测试，覆盖概率/logit 单位、排序稳定性、错误码和响应结构。
8. 新增 AI 测试必须标注来源，归档提示词并建立人工复核记录；缺少来源、提示词或
   人工结论时交付检查必须失败。人工审核不得由 AI 代签。

## 测试约束

- 使用一次性 SQLite、临时模型副本和测试客户端，不访问正式数据库。
- 不重训模型、不增加解释依赖、不读取标签。
- 线性分解必须使用实际 Pipeline 预处理，不允许只对原始特征做系数相乘。
- 迁移审计必须比较旧 payload；测试必须覆盖同方法幂等和不同方法共存。
