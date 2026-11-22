# 数据清洗与预处理操作序列

## 实现范围

- 清洗配方支持 v2 有序操作：去重、缺失字段、日期范围、固定数值区间和分位区间。
- v1 配方规范化保持原形状，历史来源与配方的派生哈希不变。
- 预览逐步返回数据集前后统计、排除原因和逐入模字段分布；派生清单保存同一步骤事实。
- 用户端与管理端共用清洗预览组件，展示数据集变化图、指定特征分布图与逐步统计表。

## 关键技术决定

- 每条规则在前一步的保留记录上执行，分位边界按该步输入计算并记录实际上下界。
- 新操作只做行过滤，不改变特征值语义，避免派生训练数据与项目线上推理口径不一致。
- v2 配方绑定当前 schema；未知字段、非法边界和空分位范围在预览前拒绝。

## 验证

- 后端：`backend/tests/test_curation.py`，7 项通过，覆盖 v1 兼容、三步过滤、分位边界、派生谱系与 schema 校验。
- 前端：完整 `npm test -- --maxWorkers=1 --no-file-parallelism`，68 个文件、582 项通过；最终组件生命周期调整后再次运行工作区 11 项测试与类型检查，均通过。
- 类型与构建：`npm run typecheck`、`npm run build` 通过。
- 样式与模块：`npm run check:styles`、`npm run check:modules` 通过。
- 浏览器：1280×900 和 390×844 下打开三步清洗流程，两个图表均渲染非空 SVG；页面和弹窗无横向溢出，标题、关闭按钮和底部操作栏在内容滚动时保持可见。

本地页面证据：

- `docs/evidence/_run/curation-desktop-top.png`
- `docs/evidence/_run/curation-desktop-bottom.png`
- `docs/evidence/_run/curation-mobile-top.png`
- `docs/evidence/_run/curation-mobile-bottom.png`

## 未通过的仓库级检查

- `npm run lint` 被既有 `.dsh-tmp/updates-tail.tsx:58` 语法错误中断；本次修改文件的定向 `oxlint` 无错误。
- `npm run check:api-types` 报告现有 OpenAPI 生成类型已过期；本次未修改 OpenAPI 和生成类型。
- 当前后端虚拟环境未安装 `ruff`，因此无法运行 Python 静态检查。
