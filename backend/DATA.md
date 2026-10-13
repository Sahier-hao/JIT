# 首轮公开数据边界

来源为 McIntosh 与 Kamei（2018），*Are Fix-Inducing Changes a Moving Target? A Longitudinal Case Study of Just-In-Time Defect Prediction*，IEEE TSE 44(5):412–428 的 [发布者复现包](https://github.com/software-rebels/JITMovingTarget)。固定版本为 `184403ad3734894c8417cbec72fdef3da5edc0b9`，本地原始文件仅位于忽略的 `data/openstack/`，不把公开可读推定为已核验再分发许可。

原始依据：[CSV](https://raw.githubusercontent.com/software-rebels/JITMovingTarget/184403ad3734894c8417cbec72fdef3da5edc0b9/data/openstack.csv)、[转换脚本](https://github.com/software-rebels/JITMovingTarget/blob/184403ad3734894c8417cbec72fdef3da5edc0b9/scripts/load_data.r)、[过滤配置](https://github.com/software-rebels/JITMovingTarget/blob/184403ad3734894c8417cbec72fdef3da5edc0b9/scripts/experimental_settings.r)。三个文件都必须通过 `jit_baseline/config.py` 的固定 SHA-256；不匹配时停止，不覆盖或替换。

| 固定输入字段 | 发布者语义 | 处理 |
| --- | --- | --- |
| ns | 子系统数 | 非负整数，模型内 log1p |
| nd | 组件数 | 非负整数，模型内 log1p |
| nf | 文件数 | 非负整数，模型内 log1p；界面展示原值 |
| ent | 原生 Entropy | 有限非负数，保留原值；未重建其计算公式 |
| la | 增加行数 | 非负整数，模型内 log1p |
| ld | 删除行数 | 非负整数，模型内 log1p |

这是六项发布者原生变更字段，**不是完整 Kamei14**。没有用 Reviewer 的 `rexp` 或未核验的 Relative author experience 别名凑字段。标识、日期、bugcount、fixcount 和审查指标均不进入模型输入；界面的变更行数是原始 `la+ld`。

标签按发布者规则：bugcount 大于零为 1；零或空值为 0，表示未观测到缺陷引入，不能称为已证实无缺陷。非空标签必须为非负整数。原始 CSV 行号从表头后的第 2 行起保留，便于核对；没有逐条 fix→introducing→issue 证据，本项目未自行复核 SZZ 或重建标签。

固定纳入顺序：UTC Unix 秒 `[1322599384,1393590700)` → `la>0` → `la+ld<=10000` → `nf<=100`。原始身份、时间与六项度量先校验，排除规则不会隐藏无效记录；各排除数量按首次触发规则统计，不重叠。

本次实际校验：原始 26,855 行，纳入 12,374 行；按上述顺序排除 13,646／812／3／20 行；纳入发布标签正例 1,616，空标签 9,812。六字段无缺失。原始 SHA-256 为 `2b1d2128bee82e905b0233d6646c3fa88eed033e440482e2f89272a3dd436505`，完整来源与质量记录见 [data-quality.json](../docs/evidence/connect-public-data-baseline-review/data-quality.json)。这些是数据统计，不是模型效果。

按不同时间组冻结 70%／15%／15%，相同时间不跨区。所有学习到的变换只拟合训练集；固定验证集不用于重拟合，测试集只用于冻结后的评价与历史回放。发布标签来自后来快照，缺少逐条历史可获得日期：时间划分不能证明当时所有标签或特征可获得，结果只作回顾性评价，不证明在线效果。

自建 SZZ 按用户转述的教师确认是可选附加功能；完整 14 维、两类至少八模型、预测解释与完整课程评价仍是后续范围，不能以本基线通过推定课程完成。

## kamei14-v1 字段来源核验

本轮按 `config.py` 锁定的 SHA-256 取回三个发布者文件、逐字节校验后，逐列核对 `kamei14-v1` 的字段来源。文件字节数与校验值（与 `config.py` 一致）：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `openstack.csv` | 4,448,994 | `2b1d2128bee82e905b0233d6646c3fa88eed033e440482e2f89272a3dd436505` |
| `load_data.r` | 3,737 | `4be31b4663f2dfc677594ca278abfcd814d42d04f09b06be1a5b031c1aace475` |
| `experimental_settings.r` | 1,442 | `2d62ff540dc26ef05864d20862b2966e637eba34b9e66a09a06cdaa2837d3209` |

在固定纳入顺序得到的 12,374 条记录上逐列统计（`fix` 由发布者规则 `fixcount > 0` 生成）：

| Kamei 字段 | 来源列 | 纳入集合内缺失 | 结论 |
| --- | --- | ---: | --- |
| ns, nd, nf, entropy, la, ld | `ns, nd, nf, ent, la, ld` | 0 | 已有，纳入无缺失 |
| fix | `fixcount`（`> 0`） | 11,541 | 可用；按发布者规则空值视为 0，正例 833 |
| ndev | `ndev` | 344 | 可用（History 家族） |
| age | `age` | 344 | 可用（实数；3,285 个非整数值） |
| nuc | `nuc` | 344 | 可用（History 家族） |
| exp | `aexp` | 344 | 可用（Author 家族） |
| sexp | `asexp` | 344 | 可用（Author 家族） |
| lt | 无 | — | **不可得**：CSV 不含变更前文件规模（Size 家族只有 `la`、`ld`），不能用 `la+ld` 替代 |
| rexp | `rexp` 列是 Reviewer experience；候选 `arexp` 只给标签 | 344（`rexp` 列） | **不可得**：语义无法核验，不得以同名列冒名替换 |

`ndev/age/nuc/aexp/arexp/asexp` 六列同时缺失 **344** 行（占 12,374 行的 2.8%），散布于整个时间窗口而非集中在开头；`fixcount` 缺失 **11,541** 行；`fix := fixcount > 0` 得到 **833** 个正例。以上数字由只读脚本从固定 CSV 按固定纳入顺序复算，脚本与输出见本 change 的运行证据。

准入规则：`kamei14-v1` **不得对缺失填补零值**，必须显式排除缺少必需字段的行并记录数量与原因。唯一例外是布尔字段 `fix`，其取值由发布者既有转换 `fixcount > 0` 定义（空值表示该变更未修复缺陷），作为发布者规则记录，不推广到计数与间隔类字段。
