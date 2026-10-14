# Design

## Context

动机见 [proposal](proposal.md)；行为约定见 [public-data-baseline](specs/public-data-baseline/spec.md) 增量。

`generalize-model-registry-and-run-contract` 已在 main 上建立具名方法注册表：`algorithms.ALGORITHMS` 的每个条目声明 `label`／`name`／`category`／`detail`／`params`（运行声明与校验用的冻结超参）／`estimator`（实现名）／`kwargs`（构造估计器用）／`preprocess`／`requires`／`reproducibility`／`explanation`；`model.ESTIMATORS` 把实现名映射到可序列化的估计器类；`fit_model(train_records, *, schema=None, algorithm=None)` 按 schema 的变换与方法的声明拼装流水线；`artifacts.check_files` 按运行声明的 `algorithmVersion` 比对 `params`；`environment(requires)` 只记录方法声明的依赖子集。现有 3 个方法：`logistic-regression-l2-v1`、`decision-tree-v1`、`random-forest-v1`。

## Goals / Non-Goals

**Goals:**

- 把经典方法补到 5 个（≥4），并保持与既有三条同样的声明格式与校验口径。
- 提供多方法并列比较入口，并把"是否可直接排名"作为报告的显式结论。

**Non-Goals:**

- 不重做注册表、运行身份、环境声明与既有规格（已在 main 上）；不引入第二套注册机制。
- 不做深度方法、不引入新框架、不补 Popt／IFA、不做 SHAP 解释。
- 不做自动模型选择，不改 `GET /api/review-batch` 与前端。

## Decisions

### D1. 沿用既有注册条目格式，不引入新机制

两个新方法按现有 3 条相同的字段集声明；估计器实现加进 `model.ESTIMATORS`。这样方法标识仍由 (schema, 方法) 决定、校验仍比对 `params`、依赖仍由 `requires` 决定——不需要任何新的注册中心或新的解析路径。

**备选与否决理由**：另建一套"方法插件"机制——与既有条目重复，且会出现两套权威声明；本 change 的规模不值得。

### D2. 两个方法的冻结声明

| 方法 | 类别 | 冻结超参（`params`） | 估计器 kwargs | 预处理 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `gaussian-naive-bayes-v1` | 经典 | `var_smoothing=1e-9`、`threads=1` | 同上 | 无（除 schema 的 log1p） | 无 |
| `gradient-boosting-v1` | 经典 | `n_estimators=200`、`learning_rate=0.1`、`max_depth=3`、`min_samples_leaf=50`、`seed=2026`、`threads=1` | 同上 + `random_state=2026` | 无（除 schema 的 log1p） | 无 |

- 朴素贝叶斯直接对特征做高斯建模，不需要标准化；梯度提升是树模型，同样不需要标准化。两者都沿用 schema 声明的 log1p 变换（方法不得覆盖 `counts` 步）。
- 梯度提升的 `max_depth=3`／`min_samples_leaf=50` 取"小树 + 叶下限"的保守取值，既控制训练时间，也与既有树方法的正则化取向一致；一旦冻结，不由验证或测试结果调整。
- 两者都是确定性方法（`random_state` 固定），沿用既有 `reproducibility: {"mode": "tolerance", "atol": 1e-8, "rtol": 0.0}` 口径；解释口径与既有方法一样记 `method: None` 与原因（解释 change 未做）。

### D3. 并列比较的判定规则

比较命令逐个加载运行，取下列五项的规范值：测试成员（按运行记录顺序的提交标识）、`datasetVersion`、特征 schema 名、分类阈值、评价协议（`metrics.effort` 的 `name`／`ordering`／`policy`）。以第一个运行为基准逐项比对：全部一致 → `directlyRankable: true`；任一项不同 → `false` 并列出"哪个方法与基准的哪一项不同"。

报告并列每个运行的方法标识、`params`、已定义指标、样本数与阈值、以及训练耗时；未定义指标原样保留 `{value: null, reason}`，不填零。

**备选与否决理由**：让命令在不可比时直接报错——那会把"可比较但结论不同"与"口径都不同"混为一谈；PDB-20 要求的是**如实声明**并给出差异项，而不是拒绝服务。

### D4. 训练耗时记入摘要但不进入运行身份

比较报告需要"训练耗时"（PDB-20）。耗时是墙钟量、不可复现，因此 MUST NOT 进入 `config`（否则同一输入两次运行的 `runId` 会不同）；实现把它记在 `summary` 的独立字段里，仅供比较展示。

### D5. 范围边界

本次只加方法与比较命令；不改运行身份与校验口径、不改环境声明、不改服务与前端、不改写任何已归档证据。

## Risks / Trade-offs

- [新方法的训练时间进入测试路径] → 两个方法都是小模型（小树／单次高斯拟合），并把耗时记入摘要以便观察。
- [注册表内容被测试固定] → 既有 `test_algorithms.py` 把方法集合写成断言；新增方法时同步更新该断言，属预期维护。
- [比较结论被读成排名] → 报告强制包含 `directlyRankable` 与差异项；口径不一致时明确拒绝排名。
- [朴素贝叶斯的高斯假设与 log1p 后的计数特征不完全匹配] → 作为方法前提记录，效果不佳按 PDB-06 如实报告，不据此事后剔除。

## Migration Plan

1. 注册两个方法并接入 `ESTIMATORS`，同步更新把注册表内容固定在断言里的测试。
2. 新增并列比较命令与三条路径的测试（同口径／口径不一致／没有运行）。
3. 更新 `docs/团队分工.md` A-2，记录经典已达 5 个、深度仍缺 1 个。
4. 全量测试与完整验证脚本，冻结证据。
5. 回退方式：移除两个注册条目即回到 3 个方法；比较命令是新子命令，移除不影响既有命令。

## Open Questions

- 深度 4 个方法的具体候选（第 4 个表格型架构）与框架依赖——属后续 change。
- 是否需要一个"选定模型"的选择规则（协议 v2）供 US-08／在线预测使用——属后续 change。
