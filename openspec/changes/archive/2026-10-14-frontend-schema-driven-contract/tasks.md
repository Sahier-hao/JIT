# Tasks

## 1. 契约数据模型与解析器

- [x] 1.1 在 `domain.ts` 扩展 `BaselineSummary` 类型：`featureSchema: {name; inModel: string[]; unavailable: {name; reason}[]} | null`、`algorithmVersion: string | null`、`metricSet: string | null`、`model: {id; name} | null`，全部可空；验证 `npm run typecheck` 通过
- [x] 1.2 按 D7 把 `parseHistorical` 重组为两阶段（纯重构，行为零变化）：共享信封校验（现有校验逐行保留）+ 形态分派点（旧形态分支先指向现有六字段/6 键校验）；验证现有全部单测通过且无任何断言改动
- [x] 1.3 在形态分派点实现具名形态校验（D3）：`summary.features` 严格等于 `featureSchema.inModel`（顺序一致）、`summary.protocolVersion` 等于 `featureSchema.name`、每条 unavailable 有非空 name 与 reason、`features` 不含 unavailable 名称、记录 `metrics` 键集合严格等于入模字段集合（键是字段名，kamei14 为 `entropy` 而非 `ent`）、summary 内 `model.id` 与顶层 `model.id` 一致、`lines === la + ld` 与 `files === nf` 交叉检查仅当声明含这些字段时执行；验证具名夹具（1.4）解析通过
- [x] 1.4 新增 `frontend/src/named-fixture.ts` 构建器（与 `historical-fixture.ts` 同风格，shape 依据 `backend/jit_baseline/artifacts.py` 与 `schemas.py` 的 `_KAMEI14`：12 入模字段、`lt`/`rexp` unavailable 及原因、确定性合成数值满足信封算术）与解析单测：解析成功、features 与 inModel 不符判不可用、protocolVersion 与 schema 名不符判不可用、unavailable 缺 reason 判不可用、旧形态夹具仍按旧口径通过；验证 `npm test` 全绿

## 2. 基线摘要与来源文案 schema 化

- [x] 2.1 `BaselineRecord.tsx` 按 D4 展示：具名形态显示 `featureSchema.name`、入模字段、未提供字段及原因、`algorithmVersion`、`metricSet`、模型标识；旧形态（声明为 null）保留"六字段"旧文案与旧字段展示；验证组件测试 + `npm test` 全绿
- [x] 2.2 `BaselineRecord.tsx` 与 `CommitDetail.tsx` 按 D5 增加解释可用性声明（"预测解释：未提供"）；旧形态（featureSchema 为 null）文案逐字保留（"尚非完整 Kamei14"等），具名形态生成新文案（schema 名、字段数、方法标识）；验证 `npm test` 通过且旧形态组件断言零改动
- [x] 2.3 更新 `App.tsx:94` 页脚按形态生成（旧形态保留"历史测试批次 · 六字段基线"，具名形态显示 schema 名）；验证 `npm run typecheck` + 相关组件测试通过
- [x] 2.4 更新 `frontend/README.md`：说明两种运行形态（旧六字段与具名 schema/方法运行）及基线摘要按声明展示，替换"六项发布者字段"等不再唯一成立的说法；验证 README 中无过期描述（`grep` 检查"六字段"表述均已限定为旧形态）

## 3. e2e 双形态

- [x] 3.1 新增 `frontend/e2e/contract-shapes.spec.ts`：import `named-fixture` 构建器，用 `page.route('**/api/review-batch')` 注入 `JSON.stringify(namedFixture())`，验证真实模式可用、基线摘要展示 schema 名/未提供字段及原因/方法标识/解释未提供声明（CRR-13、CRR-14 场景），并抽查未提供字段列表的键盘可达性与文字标识（CRR-12 状态不只靠颜色）；验证 `npx playwright test e2e/contract-shapes.spec.ts` 通过
- [x] 3.2 回归旧形态：现有 `workbench.spec.ts`、`historical.spec.ts`、`storage.spec.ts`、`accessibility.spec.ts` 在真实服务（旧运行）下全绿，且既有断言（如 `historical.spec.ts:94` 的"尚非完整 Kamei14"）零改动通过（旧形态文案逐字保留）；验证 `npm run test:e2e` 全绿

## 4. 验证与证据

- [x] 4.1 全量前端检查：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过；验证四条命令退出码 0
- [x] 4.2 按 `frontend/README.md` 验证环境说明（pwsh + chcp 65001 + `C:\JIT` 目录联接）运行 `frontend/scripts/verify.ps1` 全链路，并在 `docs/evidence/_run/` 重新冻结易用性/性能基线证据（UI 文案变更后的 1280/1440 两视口与首屏性能复测）；验证 verify.ps1 success 与冻结产物校验通过

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- 后端冻结并切换 kamei14-v1 运行后：以真实 `summary.json` 与 `named-fixture` 逐字段核对（D6），修正夹具差异并补一条真实具名形态 e2e（当前以 route-mock 覆盖）。
