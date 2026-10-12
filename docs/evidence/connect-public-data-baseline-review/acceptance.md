# 本轮功能验收记录

归档状态（2026-10-11）：已同步两份主规格并归档 change，详见 [归档记录](archive-record.json)。以下保留 2026-10-10 实现验收时的状态与证据，测试结果及实验限制未改写。

`connect-public-data-baseline-review` 已按冻结方案实现并由自动检查复核。本记录是本机功能与回顾性基线证据，不是用户评审、团队评审或完整课程验收。主规格与归档等待用户另行指示。

最终完整复验：`pwsh -File frontend/scripts/verify.ps1`，结束UTC时间 2026-10-10T15:24:19.1170744Z。结果70项后端、69项前端单元／行为、42项浏览器检查通过，两个视口均覆盖真实与演示。类型、lint、构建、当前change与主规格严格校验全部退出0。后端TestClient有1条上游httpx弃用提示；实际TCP与HTTP检查通过。详细命令、退出码、环境与源码哈希见 [verification.json](verification.json)、[原始日志](verification.log)、[unit-results](unit-results.json)、[browser-results](browser-results.json)。

实际模型对1853条冻结测试记录生成风险。两次独立运行分区完全一致，风险和已定义指标最大绝对差0（容差1e-8），见 [真实基线报告](baseline-report.md) 和 [比较](reproduction-comparison.json)。已核验的38个主规格、归档、旧证据、OpenSpec配置与人工JSON保持原哈希，完整复验的protectedFilesUnchanged=true，原始保护表见 [protected-files](protected-files.json)。没有继承旧项目代码或技术架构，也未提交、发布或归档。

真实成功主链路使用实际HTTP，无人工风险响应拦截；逐条核对API与参考风险、DOM完整身份与百分比，完成搜索、日期、排序、详情原始六字段、加入／移除、刷新及键盘焦点。完整链路证据见 [1280](desktop-1280-real-chain.json)、[1440](desktop-1440-real-chain.json) 和 screenshots 下 real-list/detail/shortlist/keyboard。生产预览代理另见preview-check.json。

实际服务生命周期在独立副本上通过本机TCP验证缺模型503→恢复并重启200；同一已拟合pipeline另用不同序列化格式形成不同模型SHA和runId，但所有风险相同，见 [http-lifecycle](http-lifecycle.json)。该副本及runtime-context-fixture-batch.json仅为运行隔离行为夹具，不是第二个正式实验或新增训练模型。前端边界检查明确注入网络中断、错误摘要及该实际TCP副本响应；解除注入后恢复真实服务。正式模型及原始数据不被这些测试替换。

本次实测（并行测试环境，记录单次观察，不声明课程性能目标已达标）：

| 视口 | 首次完整列表就绪ms | 完整标识搜索ms | 核对 |
| --- | ---: | ---: | --- |
| 1280×720 | 1628 | 487 | 1853身份及显示风险逐条一致 |
| 1440×900 | 1541 | 485 | 1853身份及显示风险逐条一致 |

此前失败保留在development/：预期RED、测试构建阶段、沙箱socket停顿、旧preview复用、summary选择器与完整列表加载时序诊断。最终测试不启用重试；清单核对先等待整个批次就绪，未改变任何正式模型、评价阈值或测试数据。最终lint无提示，主链路无pageerror。页面可纵向滚动；两尺寸无页面级横向溢出，详情关闭／加入按钮与内容滚动均可键盘操作。

逐场景映射（对被修改的CRR使用change增量，其余使用未变主规格；模型边界用独立夹具，不把合成指标当真实效果）：

| 要求 | 场景 | 结果 | 实现检查与证据 |
| --- | --- | --- | --- |
| CRR-01 | 查看演示工作台 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-01 | 来源信息不完整 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-01 | 查看真实历史回放 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-01 | 手动切换模式 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-02 | 展示可用提交 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-02 | 变更信息缺失 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-03 | 合法风险值包含边界 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx) |
| CRR-03 | 缺失或无效风险值 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx) |
| CRR-04 | 搜索并清空 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-04 | 没有匹配项 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-05 | 日期边界与搜索组合 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-05 | 日期范围无效 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-06 | 风险同分及暂无预测 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-06 | 切换排序 | 通过 | [frontend/src/domain.test.ts](../../../frontend/src/domain.test.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-07 | 打开并返回 | 通过 | [frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-07 | 提交或解释不可用 | 通过 | [frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-07 | 真实度量不冒充归因 | 通过 | [frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts) |
| CRR-08 | 完成优先审查选择 | 通过 | [frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-08 | 重复加入与移除 | 通过 | [frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-08 | 清单为空 | 通过 | [frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-09 | 刷新后恢复 | 通过 | [frontend/src/shortlist.test.ts](../../../frontend/src/shortlist.test.ts)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/storage.spec.ts](../../../frontend/e2e/storage.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-09 | 版本或保存内容不匹配 | 通过 | [frontend/src/shortlist.test.ts](../../../frontend/src/shortlist.test.ts)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/storage.spec.ts](../../../frontend/e2e/storage.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-09 | 模式或模型运行改变 | 通过 | [frontend/src/shortlist.test.ts](../../../frontend/src/shortlist.test.ts)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/storage.spec.ts](../../../frontend/e2e/storage.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts) |
| CRR-10 | 保存被拒绝 | 通过 | [frontend/src/shortlist.test.ts](../../../frontend/src/shortlist.test.ts)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/storage.spec.ts](../../../frontend/e2e/storage.spec.ts) |
| CRR-10 | 恢复不可用 | 通过 | [frontend/src/shortlist.test.ts](../../../frontend/src/shortlist.test.ts)、[frontend/src/App.test.tsx](../../../frontend/src/App.test.tsx)、[frontend/e2e/storage.spec.ts](../../../frontend/e2e/storage.spec.ts) |
| CRR-11 | 数据加载成功或为空 | 通过 | [frontend/src/useDataset.test.tsx](../../../frontend/src/useDataset.test.tsx)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[http-lifecycle.json](http-lifecycle.json) |
| CRR-11 | 加载失败并重试 | 通过 | [frontend/src/useDataset.test.tsx](../../../frontend/src/useDataset.test.tsx)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[http-lifecycle.json](http-lifecycle.json) |
| CRR-11 | 真实服务或来源失效 | 通过 | [frontend/src/useDataset.test.tsx](../../../frontend/src/useDataset.test.tsx)、[frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[http-lifecycle.json](http-lifecycle.json) |
| CRR-12 | 桌面核心链路 | 通过 | [frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[screenshots/](screenshots/) |
| CRR-12 | 键盘操作与焦点返回 | 通过 | [frontend/e2e/workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[screenshots/](screenshots/) |
| CRR-13 | 查看同一运行的记录 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[基线截图](screenshots/) |
| CRR-13 | 摘要缺失或来自其他运行 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[基线截图](screenshots/) |
| CRR-13 | 演示来源不显示真实效果 | 通过 | [frontend/src/historical.test.tsx](../../../frontend/src/historical.test.tsx)、[frontend/e2e/historical.spec.ts](../../../frontend/e2e/historical.spec.ts)、[基线截图](screenshots/) |
| PDB-01 | 核验指定版本 | 通过 | [backend/tests/test_data.py](../../../backend/tests/test_data.py)、[backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[data-quality.json](data-quality.json)、[http-lifecycle.json](http-lifecycle.json) |
| PDB-01 | 数据内容不符合约定 | 通过 | [backend/tests/test_data.py](../../../backend/tests/test_data.py)、[backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[data-quality.json](data-quality.json)、[http-lifecycle.json](http-lifecycle.json) |
| PDB-02 | 形成首轮输入与评价标签 | 通过 | [backend/tests/test_data.py](../../../backend/tests/test_data.py)、[backend/DATA.md](../../../backend/DATA.md)、[manifest.json](manifest.json) |
| PDB-02 | 标签或字段含义无法确定 | 通过 | [backend/tests/test_data.py](../../../backend/tests/test_data.py)、[backend/DATA.md](../../../backend/DATA.md)、[manifest.json](manifest.json) |
| PDB-03 | 冻结分区 | 通过 | [backend/tests/test_model.py](../../../backend/tests/test_model.py)、[split.json](split.json) |
| PDB-03 | 时间或类别条件不满足 | 通过 | [backend/tests/test_model.py](../../../backend/tests/test_model.py)、[split.json](split.json) |
| PDB-04 | 冻结后评价 | 通过 | [backend/tests/test_model.py](../../../backend/tests/test_model.py)、[backend/PROTOCOL.md](../../../backend/PROTOCOL.md)、[baseline-report.md](baseline-report.md) |
| PDB-04 | 测试标签独立于预测 | 通过 | [backend/tests/test_model.py](../../../backend/tests/test_model.py)、[backend/PROTOCOL.md](../../../backend/PROTOCOL.md)、[baseline-report.md](baseline-report.md) |
| PDB-05 | 生成实际风险 | 通过 | [backend/tests/test_model.py](../../../backend/tests/test_model.py)、[backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[backend/tests/test_api.py](../../../backend/tests/test_api.py)、[http-check.json](http-check.json)、[reference-predictions.json](reference-predictions.json) |
| PDB-05 | 产物或推理不完整 | 通过 | [backend/tests/test_model.py](../../../backend/tests/test_model.py)、[backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[backend/tests/test_api.py](../../../backend/tests/test_api.py)、[http-check.json](http-check.json)、[reference-predictions.json](reference-predictions.json) |
| PDB-06 | 核算两类指标 | 通过 | [backend/tests/test_metrics.py](../../../backend/tests/test_metrics.py)、[backend/PROTOCOL.md](../../../backend/PROTOCOL.md)、[baseline-report.md](baseline-report.md)、[summary.json](summary.json) |
| PDB-06 | 无定义或效果有限 | 通过 | [backend/tests/test_metrics.py](../../../backend/tests/test_metrics.py)、[backend/PROTOCOL.md](../../../backend/PROTOCOL.md)、[baseline-report.md](baseline-report.md)、[summary.json](summary.json) |
| PDB-07 | 复现固定基线 | 通过 | [backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[reproduction-comparison.json](reproduction-comparison.json)、[manifest.json](manifest.json)、[http-lifecycle.json](http-lifecycle.json) |
| PDB-07 | 上下文变化或记录不全 | 通过 | [backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[reproduction-comparison.json](reproduction-comparison.json)、[manifest.json](manifest.json)、[http-lifecycle.json](http-lifecycle.json) |
| PDB-08 | 请求当前回放 | 通过 | [backend/tests/test_api.py](../../../backend/tests/test_api.py)、[backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[backend/tests/test_http_lifecycle.py](../../../backend/tests/test_http_lifecycle.py)、[http-check.json](http-check.json)、[http-lifecycle.json](http-lifecycle.json) |
| PDB-08 | 产物不可用后恢复 | 通过 | [backend/tests/test_api.py](../../../backend/tests/test_api.py)、[backend/tests/test_artifacts.py](../../../backend/tests/test_artifacts.py)、[backend/tests/test_http_lifecycle.py](../../../backend/tests/test_http_lifecycle.py)、[http-check.json](http-check.json)、[http-lifecycle.json](http-lifecycle.json) |

六字段尚非完整Kamei14；只实现一个固定逻辑回归；标题／预测解释未提供；未逐条复核SZZ链路、标签历史可获得日期和发布者特征提取；不能证明在线效果。完整课程至少八模型、两类模型、完整指标与解释、在线预测、至少20关联用户故事、至少两项非功能要求及过程交付仍需后续规划与验收。自建SZZ可选来自用户转述教师确认，不冒充原始材料中的豁免。本轮没有虚构访谈、团队评审或达标效果。
