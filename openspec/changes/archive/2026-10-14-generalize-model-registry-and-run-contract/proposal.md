# Proposal

## Why

课程要求"两类（经典与深度学习）不少于 8 种预测模型"，这是本项目最长的一条关键路径；但本后端从训练到**校验**都写着"只有一个模型，它是逻辑回归"，第二个方法加不进来。

卡点不在训练代码，而在**校验**。`check_files` 与 `verify_run` 在四处拿运行记录去和**当前代码**比：超参必须**正好等于**模块级常量 `MODEL_CONFIG`（`artifacts.py:141`）；环境必须**正好等于**写死的七个包版本（`artifacts.py:46,160`）；指标集由**当前** `evaluate()` 重算后要求身份一致（`artifacts.py:237`）；复现比较 `compare_runs` 硬编码六个指标键并直接下标取值（`artifacts.py:250`）。

后果是：引入第二个方法、以后增加一个指标、或为深度方法装上 PyTorch，都会把**已验收并归档的运行**一并判为不可用——与 PDB-07（运行可追踪与复现）和 FSV-03（旧运行按自身声明继续通过）的既有立场直接冲突。

上一 change 的 D6 已处理过同一类问题：把"源码指纹逐字节相等"降级为"声明算法版本"。但只覆盖了源码指纹一处，同类的其余三处（超参、环境、指标集）仍未覆盖。

这个缺口**不会被 pytest 发现**：所有产物测试都在临时目录现场重训（`tests/test_artifacts.py:12`），没有测试读取已提交的运行，`compare_runs` 的 pytest 覆盖为零；只有完整验证脚本会撞上（`verify.ps1:64-65`）。只跑快循环的重构是"假绿"。

启动时机也成熟：口径冲突已定死，`ALGORITHMS`、`algorithmVersion` 与 `ALGORITHM_UNKNOWN` 拒绝路径都已存在，缺的只是让校验读声明而不是读常量。

## What Changes

- 新增**具名方法注册表**：每个方法以具名记录声明其名称、类别（经典／深度）、冻结超参、所需依赖、解释口径与复现口径。注册表是方法集合的唯一声明来源，对齐 `feature-schema-versioning` 已有的写法。
- 运行身份的方法标识改由 **(schema, 方法)** 共同决定，使同一 schema 下可以有多个方法并存；`MODEL_LABELS` 现按 schema 名索引，只能表达一个方法。
- **BREAKING**（仅内部契约）校验改为按该运行**声明的算法**比对超参，不再比对模块级常量 `MODEL_CONFIG`。
- **BREAKING**（仅内部契约）环境校验由"全等"改为"该运行声明的依赖必须被当前环境满足"，使新增依赖不再作废既有运行。
- **BREAKING**（仅内部契约）指标集获得版本并计入运行声明；校验按该运行声明的指标集重算，使以后增加指标不再作废既有运行。**本 change 不新增任何指标**，只补上"指标集可声明"这一机制。
- 新增 `--algorithm` 命令行参数；**无参数时仍产出六字段逻辑回归运行**（默认行为不变）。
- 登记**一个**新增经典方法（决策树），目的是实测这套契约能否容纳第二个方法，**不为凑数量**；本次不追求经典 ≥4 或深度 ≥4 的覆盖目标。
- 为深度方法预留声明位置（依赖与复现口径两个字段），但**不引入深度学习框架、不训练深度模型**。
- 补齐配套回归，使"既有运行未被作废"具备自动化证据：对已提交运行的校验回归、`compare_runs` 的自动化测试、当前零覆盖的错误码（`MODEL_INVALID`、`REPRODUCTION_FAILED`、`SCHEMA_FIELD_UNKNOWN`）。
- 修正 `backend/README.md` 与代码矛盾的一句（现写"`run` 按固定方案处理、训练和评价，不接受参数或字段选择"，而 `cli.py:19` 已接受 `--schema`）；`backend/PROTOCOL.md` 泛化（原文保留为本条协议记录），`docs/全局错误码表.md` 与 `docs/团队分工.md` 的状态列同步。
- **重建本机既有运行**（范围变更，实施中发现，已获用户同意）：实施到"既有运行仍可校验"这条验证时发现，本机 `backend/artifacts/baseline` 与 `artifacts/reproduction` 的模型 pickle 引用 `jit_baseline.model.log_counts`——该符号在 d0370b7（`align-feature-and-model-definitions`）中已被 `Log1pColumns` 取代，因此当前代码无法加载这两个运行，真实模式服务返回 503 `MODEL_INVALID`。该缺陷**先于本 change 存在**（在 HEAD 状态用 `git stash` 复现），且因为没有任何测试读取已提交运行、`backend/artifacts/` 又不进版本控制而长期未被发现。产物是本机可再生状态（README：正式模型和源文件不入 Git，使用命令重新取得），故按固定命令重建这两个运行。归档证据 `docs/evidence/` 不修改；重建运行的 `datasetVersion` 与归档证据一致、六个指标在 1e-8 内一致（已由常驻回归用例核对）。
- 登记该缺陷的现象、复现条件、优先级、状态与关联提交，使过程证据可核验。

**本轮已确认边界**：只做"契约重构 + 一个新增经典方法 + 配套回归"，另按用户同意重建本机既有运行并登记由此发现的缺陷（见上）。不加 Popt／IFA，不做 SHAP 解释，不补到 8 个方法，不改前端，不改 `GET /api/review-batch` 的响应契约，不改 `metrics.py` 的指标定义，不引入新依赖。

**后续范围**：经典补到 ≥4、表格型深度 ≥4（含框架引入与独立复现口径）、Popt／IFA、SHAP 解释、数据集管理与落库、在线预测接口，均由后续 change 承担，不能因本 change 验收而宣称课程要求已达成。

## Capabilities

### New Capabilities

（无。方法契约的家本来就在 `public-data-baseline`——其 PDB-09 即为「具名方法清单与表格型输入口径」；另立一个同类能力会把同一族要求拆到两处，因此本次以新增要求的方式扩展该能力。）

### Modified Capabilities

- `public-data-baseline`: 新增 PDB-10～PDB-14，把"运行按自身声明解析与校验"补成明确契约——按该运行声明的方法校验（而非模块级常量）、按声明的依赖校验环境（而非全等）、按声明的指标集重算、方法标识由 schema 与方法共同决定、复现口径按方法声明。既有 PDB-01～PDB-09 的语义不变。

## Impact

- **后端代码**：`backend/jit_baseline/algorithms.py`（注册表内容扩展）、`artifacts.py`（按声明的算法／依赖／指标集校验与环境语义）、`model.py`（流水线按方法构造，保留既有步骤命名）、`config.py`、`cli.py`（新增 `--algorithm`）；`metrics.py` 的指标定义不变，仅改为按声明的指标集可选重算。
- **数据与产物**：新增方法写入独立产物目录，与既有运行并列；按固定命令**重建**本机 `artifacts/baseline` 与 `artifacts/reproduction`（原因见上，产物为可再生本机状态）；**不修改** `docs/evidence/` 下任何已冻结证据。
- **不修改**：`backend/jit_baseline/api.py`、`docs/api/openapi.yaml`、`frontend/**`。
- **依赖**：不引入新依赖（新增方法使用现有 scikit-learn）。
- **测试**：改造锁死单一逻辑回归的用例（`backend/tests/test_model.py` 中读 `coef_`／`C`／`class_weight`／`max_iter` 的一组），新增注册表内容断言、按声明校验的失败路径、既有运行校验回归与 `compare_runs` 测试；测试输出仍只写运行工作区 `docs/evidence/_run/`。
- **文档**：`backend/PROTOCOL.md`、`backend/README.md`、`docs/全局错误码表.md`、`docs/团队分工.md`。
- **不影响**：`GET /api/review-batch` 的响应契约与前端行为。
