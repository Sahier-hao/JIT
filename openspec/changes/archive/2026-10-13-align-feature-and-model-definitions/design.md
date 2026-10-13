# Design

## Context

动机与证据见 [proposal](proposal.md)；行为约定见 [feature-schema-versioning](specs/feature-schema-versioning/spec.md)、[public-data-baseline](specs/public-data-baseline/spec.md) 与 [commit-risk-review](specs/commit-risk-review/spec.md) 增量。

当前实现把特征集合写成**模块级常量**，并在四处写死：

| 位置 | 写死的内容 |
| --- | --- |
| `backend/jit_baseline/config.py` | `FEATURES = ("ns","nd","nf","ent","la","ld")`、`PROTOCOL_VERSION = "openstack-six-v1"` |
| `backend/jit_baseline/model.py` | `result[:, [0,1,2,4,5]] = np.log1p(...)`（按位置写死变换） |
| `backend/jit_baseline/artifacts.py` | `config["features"] != list(FEATURES)`、`config["protocol"] != PROTOCOL_VERSION`、`model.n_features_in_ != 6` |
| `backend/jit_baseline/api.py` | 模型标识 `"logistic-regression-six-v1"` |

另有一处与本次目标直接相关的实现细节：`artifacts.py` 把 5 个训练模块的 SHA-256 写入 `config["sourceCode"]`，`check_files` 用**当前文件哈希**与 manifest 比对，不符即判 `INTEGRITY_ERROR`；`runId = identity(config)` 也包含这些哈希。因此"运行身份"目前与"训练代码逐字节不变"绑死。

`artifacts.py` 的 `runId` 与 `datasetVersion` 已经包含 `features` 与 `protocol`，所以**运行身份层面天然支持多 schema**；真正缺的是"按运行声明的 schema 去解析和校验"。

## Goals / Non-Goals

**Goals:**

- 把"完整 Kamei14 是哪 14 项、该补哪 8 项"和"模型方法该收哪些"这两处跨文档冲突一次定死，并给出可验收的规范。
- 让特征集合成为可具名注册、按运行解析的契约，使 `kamei14-v1` 与 `openstack-six-v1` 能并存。
- 让既有 `openstack-six-v1` 运行的产物、复现与归档证据在引入注册表后仍可加载与校验。

**Non-Goals:**

- 不在本次变更里补 `lt` 与 `rexp`（见 D3），不宣称"完整 Kamei14"已达成。
- 不实现模型注册表、不训练多模型、不补 Popt／IFA、不做 SHAP 解释；本 change 只把"方法清单口径"定死（见 D5），实现另立 change。
- 不改前端，不改 `GET /api/review-batch` 的六字段响应契约。
- 不重建特征提取管线：沿用发布者原生列，不自建 Git 历史聚合或路径聚类。

## Decisions

### D1. 文档权威规则：特征与模型语义以产品设计文档 §5.1.2 与 openapi 为准

两处冲突的统一裁定是：涉及**字段语义与模型方法语义**时，以 `docs/产品设计文档.md` §5.1.2 与 `docs/api/openapi.yaml` 的 `Kamei14Features` 为准；`docs/团队分工.md` 是任务排期与分工视图，从属于它。

**备选与否决理由**：以团队分工为准——那等于采用 `arexp`／`asexp` 作为补齐目标并保留 LSTM／GRU／CNN，与已核验的发布者标签和本项目表格数据形态都矛盾；不做裁定、两处各改一半——冲突会留在原地，下一个席位仍无法验收。选此规则也沿用 A-1 的既有取向（此前 F1 冲突即按该取向解决）。

### D2. 用注册表 + 按运行解析，取代"把常量改成 14 个字段"

新增一个 schema 注册表模块，把每个 schema 表示为具名记录：有序字段清单、每字段来源列、语义核验状态、是否入模、变换方式。`data.py`、`model.py`、`artifacts.py` 改为接收当前运行的 schema，而不是读模块常量。

**备选与否决理由**：直接把 `FEATURES` 改成 14 元组最省事，但 `check_files` 是拿 manifest 里的 `features` 与模块常量比对，改动之后任何按六字段生成的运行都会直接判为"固定字段或协议不匹配"而不可用——用一次重构砸掉已验收的基线。注册表方案额外成本约一个模块与若干处签名改动，换来多 schema 并行与旧运行的持续可加载。

### D3. `kamei14-v1` 采用发布者原生列，`lt` 与 `rexp` 记为不可用

12 个字段的来源与语义可按固定发布者文件核验（`ns, nd, nf, ent, la, ld` 已有；`fix` 由发布者规则 `fixcount > 0` 生成；`ndev`／`age`／`nuc` 属 History 家族，`aexp`／`asexp` 属 Author 家族，标签明确）。`lt` 与 `rexp` 记为 `unavailable`：

- **`lt`**：发布者的 Size 家族只有 `la`、`ld`，不含变更前文件规模；`la+ld` 是本次变更的行数，不能替代。
- **`rexp`**：同名 `rexp` 列是 **Reviewer experience**，不是 Kamei 的 REXP；候选列 `arexp` 标为 "Relative author experience"，固定来源文件只给标签不给定义，无法核验其是否等价于按变更年龄加权的作者经验。

**备选与否决理由**：(a) 用 `rexp` 列充当 REXP——与发布者标签直接矛盾；(b) 用 `arexp` 充当 REXP——无法核验，等于按列名猜测，违反 PDB-02 的既有立场；(c) 换一个自带完整 Kamei14 的数据集——未核验到可用候选，属数据集管理范围，不在本 change 承诺。

### D4. 缺失一律不填补：按 schema 显式排除并计数

纳入范围内有 344 行在 `ndev/age/nuc/aexp/arexp/asexp` 六列上同时缺失（散布于整个时间窗口），`fixcount` 缺失 11,541 行，`fix := fixcount > 0` 得 833 个正例。`kamei14-v1` 的准入规则是**排除缺必需字段的行并记录数量与原因**，而不是填零——`age`／`ndev`／`nuc`／`aexp`／`asexp` 填 0 会把"缺失"改写成"被测量出的 0"，违反 PDB-02 与新增准入规则。

唯一例外是布尔字段 `fix`：其取值由发布者既有转换 `fixcount > 0` 定义，空值表示"该变更未修复缺陷"，作为**发布者规则**记录，不推广到计数与间隔类字段。

### D5. 模型方法口径：只收表格型输入，并如实记录覆盖缺口

本数据集是"每提交一行、若干表格字段"，不是序列。因此方法清单 MUST 只登记消费表格型输入的方法：经典方法任意，深度方法限表格型（MLP、表格 ResNet、FT-Transformer 一类）。`docs/团队分工.md` A-2 里的 LSTM／GRU／一维 CNN 在本 change 中改为"需要真实 diff／消息／源码序列素材后才评估"，不登记。

同时如实记录一个课程覆盖缺口：设计文档只给出 3 个表格型深度候选，而课程要求"两类总计至少八种、深度 ≥4"，因此**深度方法距 ≥4 还差 1 个**，缺口由后续 change 补（第 4 个候选留待实现时按表格型选定）。规格只要求"如实记录缺口、不把参数变体或失败方法计入达标"。

**备选与否决理由**：按团队分工原样做 LSTM／GRU／1D-CNN——把每提交一行的无序度量当作自然时间序列，是造结构而非建模，设计与规格都不接受。

### D6. 运行身份：源码指纹从"强制相等"改为"声明算法版本"

现状下 `check_files` 用当前文件哈希与 manifest 比对，导致任何代码改动都让此前运行不可校验——与本 change 的 FSV-03（旧运行按自身声明继续通过）直接冲突，也妨碍后续任何模型扩展。

改为：运行 manifest 声明**算法版本**（如 `openstack-six-v1` 对应 `logistic-regression-l2-v1`），源码指纹继续作为**溯源信息**写入 manifest 并可核对，但校验不再要求"当前文件哈希等于旧运行记录的哈希"；校验改为核对运行内部一致性（声明 → 派生 `runId` → 产物哈希）与 schema 声明一致。算法一旦变化 MUST 提升算法版本，不得沿用旧版本名。

**备选与否决理由**：(a) 保留逐文件强制相等——旧运行与新代码不可共存，"旧运行仍可加载"无法成立；(b) 直接删掉 sourceCode 记录——丢失溯源，无法回答"这个运行是哪份代码产的"。折中方案保留记录、把"相等"降级为"版本声明 + 溯源"。

### D7. 新运行写到独立目录，旧基线与已冻结证据原地不动

`kamei14-v1` 运行写入自己的产物目录（与 `backend/artifacts/baseline` 并列），不覆盖、不重写、不迁移既有运行，也不改写 `docs/evidence/` 下任何已冻结证据；`build_run` 现有的"输出目录已存在即失败"约定继续作为防覆盖保护。

### D8. 文档口径修正与证据落盘

`docs/团队分工.md` A-1 的字段表与"数据来源"列改为与 Kamei TSE2013 一致，A-2 的方法清单改为表格型口径；`docs/产品设计文档.md` §5.1.2 的缺口表按本次核验结果更新状态列，并补记"深度 ≥4 差 1"；逐列统计与来源结论写入 `backend/DATA.md` 并附三个固定来源文件的 SHA-256；新增失败模式（未知 schema、字段不可用、入模字段与 schema 不符）登记到 `docs/全局错误码表.md`。

### D9. 浏览器验证所需的一处前端工具配置修正（超出原范围，已获用户同意）

实施到 5.1 时发现 `frontend/playwright.config.ts` 用 `../backend/.venv/Scripts/python.exe` 这种正斜杠相对路径启动后端服务，Windows 的 `cmd` 无法把它当命令解析，导致浏览器测试根本起不来（既有问题，与本次后端改动无关）。经用户同意做一行修正：改为反斜杠相对命令 `.venv\Scripts\python.exe -m jit_baseline.cli serve`（`cwd` 仍为 `../backend`）。该改动只影响本地测试编排，不改前端行为、界面契约或 `GET /api/review-batch` 响应；修正后 42 个浏览器用例全部通过。

## Risks / Trade-offs

- [范围偏大：同时改口径、加注册表、修文档] → 任务分段，第 1 段（口径与文档）与第 2 段（注册表与 `kamei14-v1`）可分别评审；若需收缩，先合第 1 段。
- [排除 344 行会改变训练／验证／测试成员，与旧基线成员不可比] → 新 schema 自带新 `datasetVersion` 与 `runId`，旧运行与其证据完全不变；报告写明排除规则与数量，跨 schema 比较须声明不可直接排名。
- [`fix` 在纳入范围内 93% 为 0（833/12,374 为正），接近常量] → 保留在 schema 中但记录为近常量特征，是否入模由后续 schema 版本决定。
- [校验从常量改为按运行声明，可能放松严格性] → 以旧运行回归检查加"篡改字段顺序必须失败"的负向检查共同约束。
- [源码指纹降级为声明式，可能被认为放松溯源] → 算法版本必须随实现变化提升，且源码指纹仍写入 manifest 供核对。
- [`lt` 与 `rexp` 未补齐，课程"完整 Kamei14"仍未达成] → 在规格、文档与摘要中如实记录为未达成项并给出补齐路径，不以本 change 通过推定课程目标完成。
- [两份文档在本 change 后仍可能再次漂移] → 在规范中明确权威规则，并把"团队分工 A 席位口径与产品设计文档 §5.1.2 一致"作为可复核检查点。

## Migration Plan

1. 先引入 schema 注册表与按运行解析，此时行为与现状等价：既有 `openstack-six-v1` 运行与全部测试必须通过。
2. 在新目录生成 `kamei14-v1` 的运行与产物，执行来源校验、完整性校验、复现比较与指标核对，写入独立证据。
3. 修正 `docs/团队分工.md`（A-1、A-2）、`docs/产品设计文档.md`（§5.1.2 状态列与深度缺口）、`backend/DATA.md`、`docs/全局错误码表.md`。
4. 前端与 API 响应契约本次不变。
5. 回退方式：移除 `kamei14-v1` 的注册与引用即回到六字段行为；新运行目录独立存在，删除它不影响 `backend/artifacts/baseline`，也不需要改写任何已归档证据。

## Open Questions

- 第 4 个表格型深度方法具体选哪个（候选需在实现深度方法时按资源预算选定）——不影响本 change 的规格与任务分解。
- `lt` 与 `rexp` 的补齐数据源（第二个公开数据集或发布者提取实现）——属后续 change。
