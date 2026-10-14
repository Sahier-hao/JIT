# Design

## Context

前端 `historicalContract.ts` 目前把真实批次契约写死为旧六字段口径：字段必须严格等于 `['ns','nd','nf','ent','la','ld']`、记录 `metrics` 必须恰好 6 个键、`threshold === 0.5`、`source.files` 固定三个文件名、`runId` 为 64 位十六进制。基线记录 UI 硬编码"固定测试批次 · 六字段 · 回顾性评价"与"尚非完整 Kamei14"。

后端（已合并）的新冻结产物 summary 新增：`featureSchema = {name, inModel, unavailable: [{name, reason}]}`、`algorithmVersion`、`metricSet`、`model: {id, name}`，且 `batch()` 原样透传 summary；旧运行 summary 没有这些键。关键代码事实（本设计依据，非推定）：

- `summary.features` 对新运行来自 `list(schema.in_model_names())`（artifacts.py:144），与 `featureSchema.inModel` 同源同序；
- `summary.protocolVersion` = schema 名（artifacts.py:186）；
- 记录 `metrics` 键是**字段名**而非来源列名（data.py:104/116）——kamei14-v1 的 `ent` 来源列在字段里叫 `entropy`，`lt`/`rexp` 无来源列故不出现在行数据中，行键恰好等于 12 个入模字段；
- `runId = identity(config)` 仍是 sha256 十六进制（artifacts.py:29），所有运行一致，前端 hash 校验不变；
- 旧运行 summary 无 `model` 键，batch() 回退 `model_descriptor(DEFAULT_SCHEMA, DEFAULT_ALGORITHM)`；具名运行 summary 自带 `model`，batch() 直接使用。

当前服务的运行仍是旧产物（manifest `featureSchema: None`），kamei14-v1 运行尚未冻结。动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- 解析器按"有无字段声明"双形态工作，旧运行行为不回退（CRR-14）
- 具名形态下按声明校验（字段顺序、不可用字段、度量键集合、来源一致性），校验失败仍 fail-closed（CRR-11）
- 基线摘要展示 schema 名、入模字段、未提供字段及原因、方法/模型标识、解释可用性声明（CRR-13）
- 双形态可测试：单测夹具 + e2e 路由 mock，不依赖后端先冻结 kamei14-v1

**Non-Goals:**
- 不改后端代码（`contractVersion` 保持 1，形态判定放前端）
- 不新增用户功能（不实现解释展示、不引入新视图）
- 不做契约版本号语义升级——那是后端与前端共同决定的下一个 change
- 不改进旧形态的展示文案（即使"显示 protocolVersion 代码值"这类改进很有诱惑，也明确排除，以兑现 CRR-14 的零回退验收）

## Decisions

**D1 形态判定依据字段声明存在性，而非契约版本号。**
`summary.featureSchema` 存在 → 具名形态；缺失 → 旧口径（openstack-six-v1 等价假设：六字段、无方法声明）。`contractVersion` 继续只校验等于 1。
- 旧路径的"不回退"是逐字级的：旧形态保留现有全部写死校验与全部展示文案原样不动（CRR-14 的"展示行为不回退"）；只有具名形态走新校验与新文案。
- 形态判定唯一依据是字段声明的存在性：即使响应携带 `algorithmVersion` 而没有 `featureSchema`，仍按旧形态解析（该情形已固化为规格 CRR-14 的场景，避免两个信号冲突时产生第三种解释）。
- 备选：等后端升 `contractVersion=2` 再区分——被否：本 change 不改后端，且后端当前没有升版计划，会无限期阻塞。
- 后果：若后端未来升版，前端需再次跟进；已在 Open Questions 记录。

**D2 契约数据模型扩展为可空声明字段。**
`BaselineSummary` 增加：`featureSchema: {name; inModel: string[]; unavailable: {name; reason}[]} | null`、`algorithmVersion: string | null`、`metricSet: string | null`、`model: {id; name} | null`（summary 内）。旧数据全部为 null，展示层对 null 使用旧文案。
- 备选：为具名形态另建一套类型与解析函数——被否：双解析器会分叉校验逻辑，CRR-11 的不一致检查会变成两份。

**D3 字段校验按声明替换写死常量。**
具名形态：`summary.features` MUST 严格等于 `featureSchema.inModel`（顺序一致，FSV-01 顺序由声明决定）；`summary.protocolVersion` MUST 等于 `featureSchema.name`（来源一致性，CRR-11）；每个 unavailable 条目 MUST 有非空 name 与 reason；`features` MUST NOT 包含 unavailable 名称。旧形态：保持现有六字段严格校验原样不动。
- 具名形态下 `summary.features` 信息上冗余于 `inModel`——它存在的价值正是作为一致性校验对象：数据自我重复的地方就是最便宜的不一致探测器（fail-closed 哲学，与现有 `summary.runId === raw.runId`、`counts` 求和校验同一思路）。
- 记录级：`metrics` 键集合 MUST 严格等于该 schema 的入模字段集合（键是字段名；当前两个 schema 的入模字段恰好覆盖全部有来源的列，`lt`/`rexp` 无来源故不在行数据中）。`lines === la + ld`、`files === nf` 两项交叉检查仅当声明 schema 含这些字段时执行（当前两 schema 均含；未来 schema 若不含则应跳过而非误伤），旧形态恒执行。
- 风险：未来 schema 若声明"非入模但有来源"的字段，严格等于会误伤——届时按 CRR-14"声明与数据不符判不可用"的反面（数据合法）需扩展声明结构，记录于 Risks。

**D4 运行与模型标识展示来源。**
列表头与基线摘要继续用 batch() 顶层 `model.{id,name}`（两形态都存在；具名形态下即"逻辑回归 · Kamei14（12 字段入模）"等）；基线摘要新增展示 `featureSchema.name`、`algorithmVersion`（代码值）与 `metricSet`（代码值）。旧形态下这几项显示旧文案（"六字段"）。summary 内 `model.id` 与顶层 `model.id` 交叉校验（具名形态；旧形态 summary 无 model 键，跳过）。
- 备选：前端内置方法注册表映射展示名——被否：注册表在后端，前端复制会再次产生写死假设（FSV-01 的教训）。

**D5 解释可用性声明由契约形状推导。**
基线摘要固定展示"预测解释：未提供"。推导依据不是外部注册表事实，而是**契约本身的形状**：批次记录 MUST NOT 携带 `explanation` 字段（解析器持续强制），契约中亦无解释字段——因此"未提供"是当前契约可自证的结论；当后端引入解释字段时，契约变更会显式携带该字段，UI 改读字段值。这条推导使声明与被校验的数据同源，不依赖"所有已登记方法的解释口径为空"这类会过期的旁证（CRR-07 场景、CRR-13 的 MUST 声明）。
- 备选：从 `summary.limitations` 文本中解析解释状态——被否：limitations 是非结构化字符串，解析脆弱。

**D6 双形态测试策略：单测夹具 + e2e 路由 mock，夹具是 TS 构建器而非手写 JSON。**
具名形态夹具实现为 `frontend/src/named-fixture.ts` 构建器（与现有 `historical-fixture.ts` 同风格）：以 artifacts.py 的 summary 生成逻辑与 schemas.py 的 `_KAMEI14` 为 shape 依据，12 个入模字段（含 `entropy` 而非 `ent`）、2 条 unavailable（`lt`/`rexp` 及原因）、确定性合成数值满足信封全部算术校验（effort 预算、混淆矩阵求和等）。
- 单测：import 该构建器，覆盖解析成功、features 与 inModel 不符判不可用、protocolVersion 与 schema 名不符判不可用、unavailable 缺 reason 判不可用、旧形态回归不变。
- e2e：`contract-shapes.spec.ts` 用 `page.route('**/api/review-batch', ...)` 注入 `JSON.stringify(namedFixture())`（e2e 已能 import src 模块，见 `historical.spec.ts` import `../evidence.ts` 的既有先例），验证真实模式可用、基线摘要展示 schema 名/未提供字段及原因/方法标识/解释未提供声明，并抽查未提供字段列表的键盘可达性（CRR-12 状态不只靠颜色）。
- 备选：等后端冻结 kamei14-v1 后跑真实 e2e——作为后续补充而非前置（Workflow follow-up）；届时以真实 summary.json 与手构夹具逐字段核对，差异即契约理解偏差，按核对结果修正夹具。

**D7 解析器两阶段结构：共享信封 + 形态分派。**
`parseHistorical` 重组为两阶段，形态差异被压缩到一个小的分派点：
1. **共享信封校验**（两形态完全一致、现有逻辑逐行保留）：contractVersion/mode、runId hash、datasetVersion/version 一致性、顶层 model、summary 身份交叉（runId/datasetVersion/modelSha256）、threshold、protocolVersion 非空、source 三文件与校验值、quality 算术、cohort、split 时间顺序与计数、metrics/effort/reference 全链路算术、records 身份/时间/风险；
2. **形态分派**：旧形态 → 现有六字段与 6 键校验原样；具名形态 → D3 的新校验。
- 理由：共享不变量单一来源（避免双形态各自复制一份信封校验）；旧形态回归面被隔离在分派点的旧分支里（CRR-14 零回退的工程保障）；将来新形态（如解释字段、契约 v2）只需新增分派分支。
- 备选：在现有单函数里加 if/else 分支——被否：两套校验交错在同一函数里，旧路径回归风险大、审查成本高。

## Risks / Trade-offs

- [具名形态契约 shape 是我方依据后端代码推定的，后端未发布该契约] → 单测夹具与解析器按 artifacts.py 现状编写；若后端 shape 变化，解析器 fail-closed 判不可用（CRR-11），并靠 e2e mock 双形态快速定位；后端冻结 kamei14-v1 后按 D6 核对真实产物。
- [前端先升级、后端后切换运行期间的窗口] → 新前端 + 旧运行 = 正常（兼容过渡）；旧前端 + 新运行 = 数据不可用（fail-closed）。因此部署顺序必须"先前端、后切运行"，记录于 Migration Plan。
- [metrics 键严格等于入模字段的假设] → 当前两个 schema 均成立（含 `entropy` 字段名的细节）；若未来引入非入模可观测字段，需要后端在 featureSchema 中补充完整字段清单，按新 change 升级。
- [`threshold === 0.5` 校验对所有运行仍写死] → 当前两个方法共享冻结阈值 0.5，成立；若未来方法声明不同阈值，该检查需随新 change 升级（与 D3 的字段校验同源，记为有意保留的常量）。
- [route-mock e2e 与真实后端可能出现偏差] → mock 夹具从后端测试与 artifacts.py 生成逻辑对齐构造；后端冻结 kamei14-v1 后补一条真实 e2e（记录在 tasks 的验收项）。
- [具名形态的无障碍覆盖只有 e2e 抽查] → 未提供字段列表是新 UI 内容，3.1 的键盘抽查 + 既有 accessibility.spec 回归旧形态，两视口截图证据在 4.2 复测。

## Migration Plan

1. 前端实现 + 全量前端测试通过（新旧形态），构建产物验证。
2. 部署新前端（旧运行继续服务，行为不回退——CRR-14 验收）。
3. 后端后续冻结并切换 kamei14-v1 运行时，新前端已就绪；届时补跑真实具名形态 e2e 并按 D6 核对夹具。
4. 回滚：前端回退旧构建即可；若后端已切换具名运行则旧前端会 fail-closed（数据不可用提示），故回滚窗口内应同时回退服务运行。

## Open Questions

- 契约版本号何时升为 2 及语义归属（后端 change 决定）——不影响本设计的形态判定。
- kamei14-v1 运行冻结与切换服务的时间——决定真实 e2e 补测与夹具核对时机。
