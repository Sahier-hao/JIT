# 交付的外部运行

本目录存放**在别的机器上产生、经仓库交付**的运行产物（例如在有加速设备的机器上训练的方法）。
它是 `backend/artifacts/` 下**唯一纳入版本控制**的路径：其兄弟目录（`baseline/`、`reproduction/`、
`decision-tree-*/`）都由本机 `cli run` 现场重训而得，因此被 `.gitignore` 忽略；这里的产物**在本机
无法重算**，只能随仓库交付，否则无处可取、也无法进入 PR 评审。

## 为什么需要这个例外

既有约定"正式模型和源文件不入 Git，使用命令重新取得"（见 [README](../README.md)）成立的前提是
**产物可由命令在本机重现**。外部产物的前提不成立，因此需要一个受控例外；放开范围仅限本目录，
`.gitignore` 中其余规则不变。

## 交付约定（产方）

1. **以分支 + PR 提交**：开 `feature/` 分支，把整个产物目录放到本目录下（如
   `backend/artifacts/external/<方法名>/`），在 PR 说明方法与产方环境，由非作者席位审阅。
2. **提交整个目录**：`manifest.json`、`model.joblib`、`test-input.json`、`test-labels.json`、
   `reference-predictions.json`、`metrics.json`、`source.json`、`split.json`、`summary.json`
   缺一不可——校验按其中的完整性清单逐项核对。
3. **环境如实声明**：`manifest.json` 的 `trainingEnvironment` 记录产方真实的平台、Python 与框架
   版本（含本机没有的框架）。**不要为了让本机校验通过而省略依赖**——该声明是运行身份的一部分。
4. **设备中立交付**：保存模型前映射到 CPU（如 `model.cpu()` 后再保存）。在加速设备上序列化的
   产物在本机无法加载，会被以 `MODEL_INVALID` 拒绝。
5. **复现口径**：收方会用你交付的 `test-input.json` 重算风险，并与你交付的 `reference-predictions.json`
   **按你在方法条目里声明的口径**比较，不套用 `1e-8`。若你的模型是随机初始化、或在加速设备上产生了
   参考预测，请声明一个你自己的容差（`atol`／`rtol`）；声明为独立协议（非数值容差）的方法，收方
   **不会套用统一容差，也不会静默接受**——该口径的比较方式冻结后才会接入。

## 校验（收方）

与校验本机运行**同一个入口**，不需要额外的接收命令：

```bash
.venv/Scripts/python.exe -m jit_baseline.cli verify --run artifacts/external/<方法名>
```

校验会实际加载模型、用交付的无标签输入重算风险，并按该运行声明的复现口径与交付的参考预测比较；
输出中的 `origin` 标明该运行是外部产生、`verificationEnvironment` 记录本次校验时的本机环境。
校验不重训、不覆盖产方声明，也不改写既有运行。口径与错误语义见 [PROTOCOL.md](../../PROTOCOL.md)
的「环境声明与跨机器语义」一节。
