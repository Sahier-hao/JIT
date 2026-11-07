# add-model-card-and-diagnostics 证据

本目录记录只读模型卡、三档诊断、旧模型补充报告和当前九模型收益结论的最终验证。

## 结果

- 新训练产物保存 `metricsByPartition`、split 规则、数据规模和训练吞吐。
- 三档指标按 train、validation、test 的原始唯一成员计算，训练采样副本不重复计数。
- 当前九个模型都有按 `artifactRunId`、模型 SHA-256、数据 SHA-256 和 split 摘要绑定的诊断报告。
- 当前九模型的收益报告已按当前模型包身份重新生成；旧收益报告保留作历史证据，不冒充当前模型。
- 项目模型选择器和管理员详情复用同一模型卡；公开投影不包含本机路径、SQLite、登记审计和维护动作。

## 验证

`verification/frontend-vitest.json` 为最终前端报告：47 个测试文件、361 项全部通过。
`verification/browser-results.json` 为默认 Playwright 报告：18 项通过、2 项按项目配置跳过、
0 项意外失败。专用模型卡流程覆盖项目入口、草稿保持、管理员复用、收益展示与三视口无横向溢出。
`verification/backend-tests.txt` 记录后端全量：750 项通过、1 项因真实源码数据集未配置而跳过。
`verification/model-identity.json` 记录九个当前模型的诊断与收益身份绑定。

## 截图

- `screenshots/model-card-project-1280.png`
- `screenshots/model-card-admin-1440.png`
- `screenshots/model-card-admin-390.png`

截图来自隔离数据集库、真实登记模型和真实 API。模型卡中的指标来自模型产物或冻结补充诊断；
不把示例值、当前项目在线结果或其他模型指标回填给旧模型。
