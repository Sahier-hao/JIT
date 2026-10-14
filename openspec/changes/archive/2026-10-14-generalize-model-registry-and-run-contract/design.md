# Design

## Context

动机与证据见 [proposal](proposal.md)；行为约定见 [public-data-baseline](specs/public-data-baseline/spec.md) 增量。

当前实现把"只有一个模型，它是逻辑回归"写进了**校验**而不只是训练代码，四处与"当前代码"比较：

| 位置 | 与什么比较 | 新增方法／依赖／指标时会怎样 |
| --- | --- | --- |
| `backend/jit_baseline/artifacts.py:141` | 模块级常量 `MODEL_CONFIG`（`config.py:14-15`） | 超参不同的方法直接被判"固定模型…不匹配" |
| `artifacts.py:46` + `artifacts.py:160` | 写死七个包名的 `environment()`，且要求全等 | 装上任何新依赖，三份既有运行全部加载失败 |
| `artifacts.py:237` | 用**当前** `evaluate()` 重算后要求身份一致 | 给 `evaluate()` 增加任何指标键，既有运行全部校验失败 |
| `artifacts.py:250` | 硬编码六个指标键并直接下标取值 | 扩展键元组后与旧运行比较抛 `KeyError` |

另有三处结构性事实：

- `ALGORITHMS`（`algorithms.py:7-14`）只有一条记录，`DEFAULT_ALGORITHM` 被无条件写进每个运行的声明（`artifacts.py:103`、`:113`），与 `--schema` 无关；`MODEL_LABELS`（`algorithms.py:26-29`）按 **schema 名**索引，同一 schema 无法表达第二个方法。
- `ALGORITHMS` 在测试中**零 import**（唯一相关断言是 `backend/tests/test_artifacts.py:162` 的 `ALGORITHM_UNKNOWN`），而 `SCHEMAS` 有精确内容断言（`test_schemas.py:10`）。多 schema 已被建模并有防线，多方法从未被建模。
- "过去不被作废"目前**没有自动化证据**：所有产物测试都在 `tmp_path` 现场重训新运行（`test_artifacts.py:12-17`），没有任何测试读取已提交的 `backend/artifacts/baseline`；`compare_runs` 的 pytest 覆盖为零。只有 `frontend/scripts/verify.ps1:64-65` 会撞上。

约束：既有运行的产物、复现与归档证据不得被重写（沿用上一 change 的 D7）；`GET /api/review-batch` 的响应契约与前端行为不变；`artifacts.py:208` 的 `isinstance(model, Pipeline)` 与 `n_features_in_` 检查是 `Snapshot.load`、`predict_risks`、`verify_run` 共同的依赖面。

## Goals / Non-Goals

**Goals:**

- 让"方法"成为可具名声明、按运行解析的契约，使同一 schema 下能并存多个方法。
- 让校验依据**运行自身的声明**（方法、依赖、指标集），不再依据模块级常量或"当前代码"。
- 保证三份既有运行（`artifacts/baseline`、`artifacts/reproduction`、`kamei14-v1`）在改动后仍通过 `verify` 与 `compare`，且这一点有自动化测试作证。
- 为深度方法预留依赖与复现口径两个声明位，使后续深度 change 不必再改契约。

**Non-Goals:**

- 不补到经典 ≥4 或深度 ≥4，不引入深度学习框架，不登记任何序列型方法（PDB-09 口径不变）。
- 不新增任何指标；只让"指标集"成为可声明、按声明重算的对象。
- 不做 SHAP 或任何解释实现；只在注册条目里预留解释口径字段。
- 不改 `metrics.py` 的指标定义、不改 `api.py`、不改前端、不改 openapi。
- 不引入运行索引或目录布局变更：仍是一个运行一个目录。

## Decisions

### D1. 校验改为按该运行声明的算法比对超参

`check_files` 现把 `config["model"]` 与模块级 `MODEL_CONFIG` 全等比较。改为与 `get_algorithm(config["algorithmVersion"])` 声明的冻结超参比较，与上一 change 的 `declared_schema()`（`artifacts.py:125-127`）同一写法。

**备选与否决理由**：把 `MODEL_CONFIG` 换成"按方法名索引的字典"——那只是把一张常量换成一张常量表，校验依据仍不是该运行自己的声明，运行身份与校验依据继续分离；将来声明来源一变（例如改从产物读取）就要再改一次。

### D2. 环境语义：从"全等"改为"声明的依赖必须被满足"

这是本次**唯一会回溯性推翻既有运行**的一点。方法注册条目声明 `requires`（包名与版本）；运行记录基础环境与该方法的依赖；校验要求记录的依赖在当前环境中被满足（包含关系），不再要求全等。

**备选与否决理由**：(a) 直接扩充 `environment()` 的包名元组——既有运行的记录里没有新键，全等判定立刻失败，正是本次要避免的后果；(b) 记录当前环境全部已安装包——记录随环境漂移而不稳定，且让运行身份依赖与实验无关的包；(c) 记录基础包 + 该方法的声明依赖，校验用包含关系——采纳。既有运行的记录只有基础包，按包含关系仍成立，**无需重写任何产物**。

### D3. 指标集版本化，校验按声明的指标集重算

运行声明 `metricSet` 版本；`evaluate()` 接受指标集选择；`verify_run` 按该运行声明的指标集重算。旧运行无该字段时回退到首轮指标集——与 `declared_schema()` 对 `protocol` 的回退同构。**本 change 不新增指标**，只补机制。

**备选与否决理由**：(a) 只比"记录里已有的键"——会放过"记录少了一项应有指标"的错误，等于降低校验强度；(b) 每次加指标就重写全部历史产物——违反"不重写已冻结证据"，且要重训基线。

### D4. 方法标识由 (schema, 方法) 共同决定

`MODEL_LABELS` 现按 schema 名索引，同一 schema 只能一个方法。改为按 (schema, 方法) 派生；对**没有**方法声明的旧运行保留回退到 `logistic-regression-six-v1`（`test_artifacts.py:170` 已固化该回退，必须继续成立）。

**备选与否决理由**：让每个方法各占一个 schema——把方法与特征集合强行绑定，同一特征集合下无法比较多个方法，与"比较"这一课程要求相冲突。

### D5. 注册内容与流水线契约

注册条目声明：名称、类别（经典／深度）、冻结超参、所需依赖、复现口径、解释口径（本 change 只预留）。流水线仍固定三段命名 `counts` / `scale` / `model`（该命名被 `test_model.py:77` 直接读取），方法只声明后两段：**按 schema 的变换由 schema 决定、方法不得覆盖**（否则违反 FSV-03 的"模型输入形状与声明一致"），是否标准化由方法声明，估计器由方法提供。

**模型加载契约不变**：仍要求 joblib 可序列化的 sklearn `Pipeline`，且具备 `n_features_in_` / `classes_` / `predict_proba`（`artifacts.py:208`）。保持它可以让 `Snapshot.load`、`predict_risks`、`verify_run` 的改动面收敛到校验一处；深度模型将来以"自定义估计器作为 Pipeline 末步"接入。注意 `Log1pColumns` 特意写成模块级类"以便 joblib 序列化"（`model.py:18`），将来的适配器同样必须在可导入模块内定义。

**备选与否决理由**：放宽为"任何具备 `predict_proba` 的对象"——削弱既有的类型与形状校验（`MODEL_INVALID` 分支），并要为每个非 Pipeline 模型另写一套加载校验。

### D6. 本次只登记一个新增方法：决策树

目的是实测契约能容纳第二个方法，**不为凑数量**。

**备选与否决理由**：(a) 一次上 4 个经典方法——契约若有问题，4 个方法同时暴露，排查面变大；(b) 选 Gaussian 朴素贝叶斯——其概率输出另有核验要求（设计文档提到"类别顺序、数值与概率输出核验"），会引入与契约无关的变量。决策树无新依赖、训练确定、无需概率校准核验，最能干净地检验契约。覆盖缺口仍按 PDB-09 如实记录。

### D7. 深度位置预留但不实现

注册条目新增"复现口径"字段（数值容差或独立协议），`compare_runs` 改为读该声明而非写死 1e-8。现有方法与新方法声明数值容差；将来深度方法可声明"锁定环境 + 固定种子 + 结构一致"的独立协议，届时无需再改契约。

**备选与否决理由**：本次不引入该字段，等深度 change 再加——那时又要动一次运行身份与校验，等于把同一个重构做两遍。

### D8. 测试加固是本次范围的一部分，不是顺手活

- 新增：对已提交运行（`artifacts/baseline`、`artifacts/reproduction`）的校验回归。
- 新增：`compare_runs` 的自动化测试（现为零覆盖）。
- 新增：`MODEL_INVALID`、`REPRODUCTION_FAILED`、`SCHEMA_FIELD_UNKNOWN` 三个错误码的用例（现均无覆盖）。
- 改造：`test_model.py` 中读 `coef_` / `C` / `class_weight` / `max_iter` 的一组用例，保留"默认方法"的等价断言，把与具体估计器强绑定的部分改为对声明驱动行为的断言。

理由：pytest 现在不读已提交产物，若不补，"过去未被作废"就没有任何自动化证据，只能靠人记得手动跑完整脚本。按 VEV-01，测试输出仍只写运行工作区 `docs/evidence/_run/`。

### D9. 文档与错误码同步

`backend/PROTOCOL.md` 泛化：原文保留为"六字段逻辑回归"这一条协议的记录，另起一节说明方法清单与按声明校验。`backend/README.md` 修正与代码矛盾的一句（现写 `run` "不接受参数或字段选择"，而 `cli.py:19` 已接受 `--schema`）。`docs/全局错误码表.md` 把 `MODEL_NOT_CONVERGED` 的描述由"固定逻辑回归未收敛"改为按方法声明的收敛契约。`docs/团队分工.md` 状态列同步。

### D10. 重建本机既有运行，而不是给旧 pickle 打补丁（范围变更，实施中发现，已获用户同意）

实施到"既有运行仍可校验"这条验证时发现：本机 `artifacts/baseline` 与 `artifacts/reproduction` 的模型 pickle 引用 `jit_baseline.model.log_counts`，该符号已在 d0370b7 被 `Log1pColumns` 取代，当前代码无法加载这两个运行。用 `git stash` 回到 HEAD 复现，确认该缺陷先于本 change 存在。

处理方式：按固定命令重建这两个运行（`cli run`）。归档证据 `docs/evidence/` 不改；重建运行的 `datasetVersion` 与归档证据一致、六个指标在 1e-8 内一致。

**备选与否决理由**：(a) 在 `model.py` 加回 `log_counts` 兼容符号让旧 pickle 可加载——等于把同一个变换留两份实现，与 D2（`Log1pColumns` 取代按位置写死的变换）的设计相冲突，且只掩盖这一个 pickle，没有解决"改了序列化类却不重建产物"这个根因；(b) 本 change 不动产物、另立缺陷修复 change——真实模式继续不可用，本 change 的端到端验证拿不到绿色证据；(c) 直接删除旧目录后重建而不留备份——旧运行已不可加载，没有保留价值，但重建前仍先备份到 `.cache/`，避免误删无法回溯。

**为什么这个缺陷此前没被发现**：没有测试读取已提交的运行（所有产物测试都在临时目录现场重训），`backend/artifacts/` 不进版本控制，而上一 change 的 D7 把"baseline 不被重写、运行标识不变"当作前提断言，没有验证它仍然可加载。D8 补的既有运行校验回归正是为此。



## Risks / Trade-offs

- [一致性检查被削弱] 环境与指标集改为按声明后，不再拒绝"环境多出包"或"指标集少算一项"。→ 缓解：包含关系方向严格（**声明的必须被满足**）；指标集必须完整重算声明的全部指标，少一项即失败，不是只比交集。
- [回退分支被滥用] 若回退写宽，可能让"缺失声明"被当成合法。→ 缓解：缺失声明只允许回退到已冻结的首轮声明（六字段逻辑回归 + 首轮指标集），其余一律拒绝；每个回退分支各有用例。
- [决策树风险分布与逻辑回归差异大] 单棵树的 `predict_proba` 是叶节点频率。→ 缓解：只用它检验契约，不设为默认、不更换服务所用的运行；效果对比留待多模型 change。
- [测试改造误伤既有断言语义] `test_model.py` 的一组用例锁死了逻辑回归内部结构。→ 缓解：改造时保留对默认方法的等价断言，只把与具体估计器强绑定的部分改为声明驱动。
- [三份既有运行被静默作废] 这是本次最大风险，且 pytest 现在发现不了。→ 缓解：D8 的回归测试是本 change 的验收前置；完整验证脚本的 `verify`（`verify.ps1:64`）与 `compare`（`:65`）作为端到端确认。

## Migration Plan

1. 先改校验（D1、D2、D3）并补 D8 的既有运行回归；此步确认的是**重建后的**运行与归档证据一致（重建前本机运行已不可加载，见 D10）。
2. 再扩注册表与流水线契约（D4、D5），仍以六字段逻辑回归为默认，确认默认行为与各视图契约不变。
3. 再登记决策树并生成独立运行（D6），确认新旧运行并存且各自可校验。
4. 按 D10 备份并重建本机 `artifacts/baseline` 与 `artifacts/reproduction`，确认 `verify` 与 `compare` 通过、响应契约对前端保持兼容。
5. 最后文档与错误码（D9）并登记缺陷，跑完整验证脚本，再显式冻结证据。

**回滚**：新增方法与新建运行目录可直接删除；被重建的两个运行已备份到 `.cache/`（不进版本控制），需要时可用备份还原。`docs/evidence/` 全程不被写入，回滚不涉及已冻结证据。

## Open Questions

- 决策树的具体冻结超参（如 `max_depth`、`min_samples_leaf`、`random_state`）在实现时按依赖预算确定，不影响本设计、规格与任务分解。
- 多方法运行的组织方式（是否需要一个运行索引）留到方法数量真正增加时决定；本 change 沿用"每运行一个目录"。
