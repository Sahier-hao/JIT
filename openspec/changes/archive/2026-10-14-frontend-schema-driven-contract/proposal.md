# Proposal

## Why

后端已合并具名特征 schema 与具名方法架构（`openstack-six-v1`、`kamei14-v1`、`logistic-regression-l2-v1`、`decision-tree-v1`），此后新冻结的运行会在 summary 中携带 `featureSchema`、`algorithmVersion`、`metricSet`、`model.{id,name}` 等声明，且 `batch()` 原样透传。但前端契约解析器（`historicalContract.ts`）仍硬编码六字段顺序、固定三个源文件、`threshold === 0.5` 与 `runId` 形态，基线记录 UI 写死"六字段"。一旦服务切换到具名运行（如 `kamei14-v1`，12 字段入模、2 字段 unavailable），前端会把合法数据判为"数据不可用"（CRR-11 的不一致检查误伤），也无法满足 CRR-13 按当前 schema 列出已提供/未提供字段及原因的要求，同时违反 FSV-01 对调用方"不得依赖按位置写死的字段假设"的约束。趁 kamei14-v1 运行尚未冻结服务，先把前端侧契约泛化到位。

## What Changes

- 契约解析器按运行声明解析：`summary.featureSchema`（名称、入模字段、unavailable 字段及原因）与 `algorithmVersion`、`metricSet`、`model.{id,name}` 纳入契约校验与数据模型；缺省（旧运行）回退 `openstack-six-v1` 口径
- 记录级校验按声明 schema 的入模字段集合校验 `metrics` 键，不再写死 6 个键
- 基线记录 UI 按当前 schema 展示：入模字段、未提供字段及原因、方法名与模型标识、解释口径声明；替换硬编码的"六字段"与"尚非完整 Kamei14"
- 兼容过渡：旧六字段运行继续可用、展示行为不回退；形态判定依据字段声明的存在性，而非 `contractVersion`（本 change 不改后端，`contractVersion` 保持 1）
- 测试与证据：新增具名形态（kamei14-v1 形态）契约夹具与解析器单测；e2e 覆盖旧/新两种形态；基线 UI 组件测试；UI 变更后重新冻结性能与易用性证据

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `commit-risk-review`: 新增运行形态兼容要求（CRR-14）——工作台 SHALL 同时接受无字段声明的旧运行与带 schema/方法声明的具名运行，按各自声明解析与展示，前端升级 MUST NOT 使旧运行不可用或行为回退；CRR-13 的"按当前 schema 列出字段及原因"与"声明预测解释是否提供"由本 change 落实（要求文本不变，实现补齐）。

## Impact

- 前端：`frontend/src/historicalContract.ts`（解析与校验）、`frontend/src/domain.ts`（`BaselineSummary` 类型）、`frontend/src/BaselineRecord.tsx`（展示）、`frontend/src/CommitDetail.tsx`（解释声明文案）、`frontend/src/App.tsx`（页脚形态文案）、`frontend/README.md`（形态说明）
- 测试：`frontend/src/historical.test.tsx`、`frontend/src/domain.test.ts`、`frontend/e2e/historical.spec.ts` 及无障碍 e2e
- 证据：变更后重新运行 `verify.ps1` 并在 `docs/evidence/_run/` 重新冻结性能/易用性基线
- 后端：无代码改动（依赖已合并的 summary 新字段透传行为）；契约形态判定约定需与后端对齐（记录于 design 与规格）
- 依赖：不新增第三方依赖
