# 当前九模型分区诊断

本目录每份 `<artifactRunId>.json` 都是对应既有模型的冻结补充诊断，不修改原模型、manifest、hash、
默认策略或历史结果。

报告记录 train、validation、test 三档指标、各分区样本/正例数、split 摘要、数据哈希、模型哈希、
指标集和阈值。读取端只接受与已登记模型运行身份和当前模型哈希完全匹配的报告；缺失报告表示
“未记录”，冲突报告拒绝展示。

生成命令：

```powershell
& .venv/Scripts/python.exe -m jit_baseline.cli diagnose-model `
  --run artifacts/<artifact-key> `
  --output ../docs/evidence/model-diagnostics
```

九份报告均对应仓库内置九模型包。测试只校验报告与包清单身份一致；生成过程不改写模型文件。
