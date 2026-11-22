# 算法库结构图

## 实现范围

- 新增用户主导航「算法库」和 `#/algorithms` 独立页面。
- 方法目录为 9 个注册方法返回结构图类型、输入、输出和阶段元数据。
- 页面按经典与深度分类切换方法，展示结构图、可用状态、依赖、预处理、解释口径、冻结声明和可配置参数。
- 训练创建弹窗继续提供快速文字说明，完整算法库只读，不修改训练参数或运行身份。

## 图示覆盖

- 逻辑回归：特征加权与 logistic 输出。
- 决策树：阈值根节点、分支与叶节点。
- 随机森林：样本子集、并行树与投票/平均。
- 高斯朴素贝叶斯：逐特征均值方差、先验和似然。
- 梯度提升树：残差拟合与逐轮累加。
- MLP、表格 ResNet、FT-Transformer 与 Wide&Deep：层、残差、token 注意力和并联分支。

## 验证

- 后端方法目录测试通过，9 种结构类型均返回 `kind/input/output/stages`。
- 前端定向测试 128 项通过，覆盖路由往返、导航高亮、分类切换、图示输出、不可用原因和参数读值。
- 完整前端单测：69 个文件、586 项通过。
- `npm run typecheck`、生产构建、样式与模块边界检查通过。
- Playwright 在 1280×900 与 390×844 下打开 `#/algorithms`，切换决策树和表格残差网络；结构图非空，页面无横向溢出。

本地页面证据：

- `docs/evidence/_run/algorithm-library-desktop-tree.png`
- `docs/evidence/_run/algorithm-library-desktop-deep.png`
- `docs/evidence/_run/algorithm-library-mobile-deep.png`

## 未通过的仓库级检查

- 全量 `npm run lint` 仍受既有 `.dsh-tmp/updates-tail.tsx` 语法错误影响。
- `npm run check:api-types` 仍报告现有 OpenAPI 生成类型过期；本次未修改 OpenAPI。
- 当前后端虚拟环境未安装 `ruff`。
