## 1. 补齐经典方法

- [x] 1.1 在 `backend/jit_baseline/algorithms.py` 按既有条目格式登记 `gaussian-naive-bayes-v1` 与 `gradient-boosting-v1`；验证：两条目字段完整，`params` 与 `kwargs` 一致，类别为经典
- [x] 1.2 在 `backend/jit_baseline/model.py` 的 `ESTIMATORS` 加入两个估计器实现；验证：`build_estimator` 能构造两个估计器，未声明实现名仍以 `ALGORITHM_UNKNOWN` 拒绝
- [x] 1.3 同步更新把注册表内容固定在断言里的既有测试；验证：`tests/test_algorithms.py` 通过且断言包含 5 个方法

## 2. 并列比较

- [x] 2.1 在 `artifacts.py` 实现并列比较并接入 `cli.py` 的 `compare-methods` 子命令；验证：同口径多方法得到并列报告，含 `directlyRankable` 与各方法指标、`params`、训练耗时
- [x] 2.2 训练耗时记入摘要且不进入运行身份；验证：同一输入两次运行的 `runId` 相同，而摘要含耗时字段
- [x] 2.3 口径不一致时声明不可直接排名；验证：跨 schema（或不同测试成员）参与比较时 `directlyRankable` 为 false 且列出差异项
- [x] 2.4 没有可比较的运行时报错；验证：空运行列表以明确错误失败，不产出空报告

## 3. 文档与规格

- [x] 3.1 更新 `docs/团队分工.md` A-2：记录经典已达 5 个、深度仍缺 1 个；验证：该节出现"经典 5"与"深度仍缺 1"
- [x] 3.2 确认 `docs/全局错误码表.md` 已覆盖本 change 的失败路径（未注册方法、没有可比较的运行），需要时补一行；验证：失败路径有测试且错误码与文档一致

## 4. 端到端验证与证据

- [x] 4.1 运行后端全量测试与完整验证脚本；验证：全部通过，输出写入运行工作区且不写入任何已归档 change 的证据目录
- [x] 4.2 冻结本次证据并校验完整性清单；验证：冻结清单校验通过，且运行期间 `openspec/specs`、`openspec/changes/archive` 与已归档证据目录未被改动
