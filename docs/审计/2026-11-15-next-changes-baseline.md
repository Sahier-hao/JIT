# 2026-11-15 后续变更的现状依据

本文记录规划前的只读核对，代码基点为 `fbf219e`。这些观察不是新功能实施验收，也不是新模型训练或真实用户效果结论。

## 1. 标签观察与评价输入

核对对象为 `docs/evidence/evaluation-matrix/2026-11-11-python.json` 与 `2026-11-11-javascript.json` 引用的六个数据版本。逐个验证本机 manifest SHA-256 和 CSV SHA-256，均与报告引用一致。

按 manifest 的 cohort 规则筛选原始 CSV，再按 UTC 去重时间组执行 70/15/15 切分；重算的测试数及正例数与报告一致。将测试零标签提交的作者时间与各版本声明的 `observedThrough` 比较，距该终点不足 `maturityDays=90` 的数量如下：

| 数据集 | 测试提交 | 正例 | 观察不足 90 天的零标签 | SZZ 截断 |
| --- | ---: | ---: | ---: | --- |
| flask-mature | 560 | 31 | 9 | 否 |
| pydantic-mature | 825 | 69 | 129 | 是 |
| httpx-mature | 216 | 3 | 0 | 否 |
| axios-mature | 280 | 47 | 135 | 是 |
| cc-switch-farion-mature | 330 | 44 | 286 | 是 |
| express-mature | 817 | 76 | 18 | 否 |

这些版本声明的观察终点均为 `2026-08-01T00:00:00Z`。上述统计只检验相对于其声明终点的成熟性，未将该声明本身视为已证明的完整历史覆盖，也没有重新运行 SZZ 或判定零标签究竟有无真实缺陷。

代码链路：

- `backend/jit_baseline/collect.py` 以样本窗口终点计算 `observed_through`，在内存记录 `labelStatus`；`_csv_bytes` 仅保存提交、时间、二元标签和特征。
- `backend/jit_baseline/szz.py` 在同一窗口内选择修复提交，预算提前结束时记录截断。
- `backend/jit_baseline/data.py` 从 `bugcount` 重建二元标签，没有重建成熟准入集合。
- `backend/jit_baseline/evaluation_matrix.py` 的 `load_dataset` 校验 CSV 后直接重建记录并切分；`split_preview.py` 和训练入口也需一并处理。
- `artifacts.py` 与同步训练已有 holdout 约束，不能仅因评价入口有缺口就声称所有既有模型都用近期样本训练。

本机这些成熟数据目录尚有未跟踪文件。新 worktree 或干净检出不一定包含其原始输入；应使用受校验可移植包或按固定 revision 重建，不能把“报告已提交”解释为原始数据已交付。实施前应重新核对当前文件与基点，避免以本文替代现状检查。

## 2. 预算评价差异

- `metrics.py` 的 `evaluate` 在一条提交超预算时执行前缀停止，保存 `whole-commit-prefix-stop`。
- `benefit.py` 的版本 2 主结果使用跳过继续，另有前缀停止敏感性结果；已有模型、密度、成本升序、时间和随机策略。
- 矩阵当前只提供改动量降序、时间与三个随机顺序，未完整复用收益报告的基线与配对区间。

因此不能无提示合并两套 Recall@20%LOC，修正新协议时也不能改写旧报告。已有模型收益方向见 `docs/审计/2026-11-11-evaluation-matrix.md`，其结论同时受上节数据限制约束。

## 3. 账户与个人审查

`frontend/src/prReview.ts` 使用固定键 `jit:pr-review:works:v1`，内部身份仅按仓库和 PR 划分；工作单已有快照轮次、revision 冲突校验及备份合并。用户会话已经存在，但这些存储函数没有接收账户上下文。

这里的结论来自源码链路，未在本轮执行真实浏览器双账户复现。后续实施必须验证换号、迟到请求、跨标签页、旧数据迁移及备份恢复，不能只替换键名。

## 4. 持续回归现状

`.github/workflows/` 当前三个工作流围绕提交分析和报告；`commit-analysis.yml` 的成功状态表示模型包校验、导入、范围分析及上传成功，没有运行 pytest、前端测试或类型检查。

`docs/审计/2026-11-13-closeout.md` 记录了当时本地完整回归及远端模型报告结果。本次未重新执行完整测试，不能将历史通过数作为新增回归工作流的验收结果。

## 5. 本轮规划校验的边界

四份新 change 的模板、依赖和文件路径由 OpenSpec 1.14.1、项目 `spec-driven` schema 解析。规划完成后的严格校验结果以实际 `openspec validate --changes --strict --json` 输出为准；该校验只能说明规划结构有效，不表示功能已经实现或测试通过。
