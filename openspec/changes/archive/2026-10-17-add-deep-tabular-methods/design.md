# Design

## Context

动机见 [proposal](proposal.md)；行为约定见 [public-data-baseline](specs/public-data-baseline/spec.md) 的 PDB-22（main 上的 PDB-21 已用于时间桶聚合，本 change 顺延编号）。

main 上已有的接入面：

- `algorithms.ALGORITHMS` 的条目声明 `label`／`name`／`category`／`detail`／`params`（运行声明与校验用的冻结超参）／`estimator`（实现名）／`kwargs`／`preprocess`／`requires`／`reproducibility`／`explanation`。上一轮明确这三个字段是为深度预留的。
- `model.ESTIMATORS` 把实现名映射到可 joblib 序列化的估计器类；`fit_model` 固定拼装 `counts`（由 schema 决定）→ 可选 `scale`（由方法声明）→ `model`（估计器）。深度模型必须作为**末步**接入，且类必须定义在可导入模块里。
- `check_reference_predictions`（PDB-18）只接受 `mode == "tolerance"`；声明其它口径会以 `REPRODUCTION_FAILED` 拒绝，`build_run` 末尾的 `verify_run` 因此也过不了。`backend/artifacts/external/README.md` 明确写：随机初始化的模型应自己声明 `atol`／`rtol`。
- `environment(requires)` 只记录方法声明的依赖子集；新增依赖不会让既有运行失效（PDB-11）。
- 当前没有 torch，也没有 CI 工作流；six 字段训练集 8,669 行、6 个入模字段。

## Goals / Non-Goals

**Goals:**

- 用 4 个结构上互不相同的表格型深度方法把深度覆盖补到 ≥4，并让它们走与经典方法完全相同的运行身份、校验与比较流程。
- 把"深度模型的随机性"落成可核验的声明：冻结种子/超参/epoch，复现容差来自实测。

**Non-Goals:**

- 不做预测解释（A-4）、不补 Popt／IFA（A-3）、不改服务／前端／模型目录与预测接口。
- 不登记任何序列型架构（LSTM／GRU／1D-CNN）；不引入 GPU 依赖或外部产物交付流程。
- 不做超参搜索或早停；不在验证分区上调参。

## Decisions

### D1. PyTorch（CPU）+ 可导入适配器，作为流水线末步

新增一个深度模块，内含 torch 架构与一个 sklearn 兼容适配器：实现 `fit`／`predict_proba`／`classes_`／`n_features_in_`，并保证可 joblib 序列化。`model.ESTIMATORS` 增加 4 个实现名，`algorithms.py` 增加 4 个条目（`category: "deep"`，`requires: ("torch",)`，`preprocess: ("scale",)`）。

**备选与否决理由**：只用 scikit-learn 的 `MLPClassifier`——只能算 1 个深度方法，且无法表达残差／token 化架构，达不到"深度 ≥4"；改用其它框架——团队已确定按 PyTorch 走，且既有产物与测试都用 Python 栈。

### D2. 四个架构与冻结超参

| 方法 | 结构 | 初始冻结声明（训练前固定） |
| --- | --- | --- |
| `mlp-v1` | 多层感知机（2 隐层 + Dropout） | hidden=(64, 32)、dropout=0.2、lr=1e-3、batch=256、epochs=30、weight_decay=1e-4、seed=2026 |
| `tabular-resnet-v1` | 残差 MLP（2 个残差块） | blocks=2、hidden=64、dropout=0.2、lr=1e-3、batch=256、epochs=30、weight_decay=1e-4、seed=2026 |
| `ft-transformer-v1` | 每字段一个 token + Transformer 编码器 | d_token=32、heads=4、layers=1、dropout=0.1、lr=1e-3、batch=256、epochs=30、seed=2026 |
| `wide-deep-v1` | 线性塔 + MLP 塔并联 | deep=(64, 32)、dropout=0.2、lr=1e-3、batch=256、epochs=30、weight_decay=1e-4、seed=2026 |

- FT-Transformer 的 token 顺序 MUST 跟随 schema 的入模字段顺序（不是任意排列）；这是"表格型"而不是"序列型"的关键区别。
- Wide&Deep 与 MLP 的差别是**结构**（线性分量与深层分量并联），不是层宽参数变体。
- 以上取值在实现时定稿后写入条目；一旦冻结，不由验证或测试结果调整。

### D3. 复现口径用"实测容差"，不用独立协议

四个方法都声明 `reproducibility: {"mode": "tolerance", "atol": <实测上界>, "rtol": 0.0}`。实现顺序是：先用冻结声明独立训练两次，记录最大风险差与各指标差，再按观测上界留出余量声明 `atol`。

**备选与否决理由**：声明 `independent-protocol` 更贴近"深度模型不保证逐字节一致"的直觉，但当前 `check_reference_predictions` 与 `compare_runs` 都不接受该口径，声明了连 `build_run` 都无法完成；外部产物 README 也明确要求随机模型"声明自己的 atol／rtol"。因此本轮用实测容差，独立协议留待真正需要跨设备复现时再实现。

### D4. 固定 epoch，不做早停

epoch 数与全部超参在训练前冻结，训练只跑一次固定预算。验证分区只用于流程检查，不参与拟合或调参。

**备选与否决理由**：用验证集早停会直接违反 PROTOCOL 第 2 条与 PDB-04；把早停写进"声明的训练协议"看似可行，但它仍然是依据验证结果改变拟合过程，本轮不采用。

### D5. 先在 six 字段 schema 上训练

4 个深度运行使用 `openstack-six-v1`，与 5 个经典方法共享同一测试成员，`compare-methods` 才能给出 9 个方法的同口径并列；kamei14 上的深度运行作为后续可选扩展。

### D6. 适配器的确定性与保存契约

- 训练前设置 Python／NumPy／torch 种子，使用单线程，并在可用时开启确定性算法；保存前统一映射到 CPU。
- 适配器作为模块级类定义（joblib 需要可导入路径），内部保存 `state_dict` 或等价的可序列化结构。
- 预测输出必须为 `[0,1]` 的标签 1 概率，沿用 `predict_risks` 的既有校验。

### D7. 范围边界

不改运行身份、校验口径、环境声明、目录登记与预测接口；不改写任何既有运行或已归档证据。解释仍如实声明未提供。

### D8. 顺延需求编号，并与并行合入的时间桶聚合共存

本 change 起草后，main 合入了时间桶聚合（占用 PDB-21）。因此：

- 本 change 的新需求顺延为 **PDB-22**，不覆盖 main 已有的 PDB-21。
- `artifacts.TRAINING_CODE` 同时包含 `deep.py` 与 `trends.py`；4 个深度运行用最新 main 的代码重建，摘要带上时间桶聚合，`verify_run` 按 PDB-21 重算并核对守恒。
- 深度的训练与复现口径不受影响：`algorithms.py`／`model.py`／`deep.py` 在本次 rebase 中没有变化，实测复现差仍为 0。

## Risks / Trade-offs

- [torch 体积与安装时间] → 只装 CPU 轮子并 pin 版本；`requires=("torch",)` 让运行声明显式依赖它；安装失败时以明确错误拒绝而不是静默跳过。
- [8,669 行训练集上深度模型容易过拟合] → 冻结保守结构（小隐层、Dropout、weight_decay），效果如实报告，不据测试结果改结构。
- [深度训练比经典方法慢] → 固定 epoch 与小批量；逐方法记录训练耗时，训练预算在实现任务里先测量再定稿。
- [CPU 上仍有微小非确定性] → D3 的实测容差 + 记录观测差；不声称逐字节一致。
- [第 4 个架构被质疑是"参数变体"] → Wide&Deep 有独立的线性分量，结构上与 MLP 不同，并在条目 `detail` 中写明。
- [FT-Transformer 的 token 化被误解为序列建模] → token 顺序固定跟随 schema 字段，不是时间序列；条目与文档都写明。

## Migration Plan

1. pin torch、加入适配器与 `mlp-v1`，先打通"深度运行可 build、可 verify、可 compare"这一条链路，并实测复现差。
2. 依次加入 `tabular-resnet-v1`、`ft-transformer-v1`、`wide-deep-v1`。
3. 生成 4 个 six 字段运行，两次独立训练取实测差并冻结容差，产出 9 方法并列报告。
4. 更新 `docs/团队分工.md` A-2 与 `backend/PROTOCOL.md` 的深度口径。
5. 回退方式：移除 4 个注册条目与 torch 依赖即回到 5 个经典方法；深度运行目录独立，删除不影响既有运行。

## Open Questions

- 是否需要 GPU／外部产物交付（`artifacts/external/`）——本轮 CPU 可完成，暂不需要。
- 深度模型的解释（SHAP／梯度）——属 A-4，另立 change。
