## 1. 依赖与适配器

- [x] 1.1 在 `backend/requirements.txt` 加入 pinned 的 CPU 版 torch，并在方法条目声明 `requires=("torch",)`；验证：本机安装后 `environment(("torch",))` 记录 torch 版本，缺失时以明确错误失败而非跳过
- [x] 1.2 新增深度模块：sklearn 兼容适配器（`fit`／`predict_proba`／`classes_`／`n_features_in_`）与 `mlp-v1` 架构，作为模块级类定义；验证：合成数据拟合、概率在 [0,1]、joblib 保存后重载预测一致
- [x] 1.3 在 `algorithms.py` 与 `model.ESTIMATORS` 登记 `mlp-v1`（`category: deep`、冻结超参、`preprocess: ("scale",)`、容差待实测）；验证：`build_estimator` 可构造，未声明的实现名仍以 `ALGORITHM_UNKNOWN` 拒绝

## 2. 其余三个架构

- [x] 2.1 实现并登记 `tabular-resnet-v1`（2 个残差块）；验证：合成数据可拟合，结构与 MLP 不同，产物可 joblib 往返
- [x] 2.2 实现并登记 `ft-transformer-v1`：每个 schema 字段一个 token，token 顺序跟随 schema；验证：合成数据可拟合，token 数等于入模字段数，产物可 joblib 往返
- [x] 2.3 实现并登记 `wide-deep-v1`（线性塔 + MLP 塔）；验证：合成数据可拟合，条目 `detail` 写明线性分量，产物可 joblib 往返
- [x] 2.4 冻结四组超参与 epoch 数（写入条目与文档）；验证：训练路径不存在早停分支，验证分区不参与拟合或调参

## 3. 运行与复现

- [x] 3.1 生成 4 个深度运行（six 字段 schema）到独立产物目录；验证：每个运行通过 `verify`，互不覆盖，运行标识互不相同
- [x] 3.2 对每个深度方法用同一冻结声明独立训练两次，记录最大风险差与各指标差，并据此声明 `atol`（留有余量）；验证：观测差不超过声明容差，且报告不声称逐字节一致
- [x] 3.3 用 `compare-methods` 产出 9 个方法（5 经典 + 4 深度）的并列报告；验证：`directlyRankable` 为 true，测试成员一致（1853），9 条记录齐全

## 4. 测试、文档与证据

- [x] 4.1 补齐测试：适配器序列化往返、四架构拟合与推理、容差覆盖实测、序列型架构被拒绝；验证：后端全量测试通过
- [x] 4.2 更新 `docs/团队分工.md` A-2 与 `backend/PROTOCOL.md` 的深度口径（固定 epoch、实测容差、不声称逐字节一致）；验证：两处均出现"深度 4"与"实测容差"
- [x] 4.3 运行完整验证脚本并冻结证据；验证：`verify.ps1` 全绿，冻结清单校验通过，受保护位置未被改动
- [x] 4.4 在最新 main（含 PDB-21 时间桶聚合）上重建 baseline／经典／深度运行并复验：新需求顺延为 PDB-22，`TRAINING_CODE` 同时含 `deep.py` 与 `trends.py`；验证：9 方法并列仍同口径（1853），全部运行通过 `verify`
