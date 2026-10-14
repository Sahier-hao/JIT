// kamei14-v1 形态的契约夹具（D6）：shape 依据 backend/jit_baseline/artifacts.py 的 summary
// 生成逻辑与 schemas.py 的 _KAMEI14。发明出来的行为测试夹具，不是真实实验。
// 记录 metrics 键是字段名（data.py:104/116）——ent 来源列在 kamei14-v1 字段里叫 entropy。
export function namedFixture(runId = 'a'.repeat(64)) {
  const sha256 = 'b'.repeat(64)
  const datasetVersion = 'fixture-kamei14-v1'
  const inModel = ['ns', 'nd', 'nf', 'entropy', 'la', 'ld', 'fix', 'ndev', 'age', 'nuc', 'exp', 'sexp']
  const value = (value: number | null, reason: string | null = null) => ({ value, reason })
  const measures: Record<string, number> = { ns: 1, nd: 2, nf: 2, entropy: .4, la: 10, ld: 2, fix: 0, ndev: 3, age: 4, nuc: 5, exp: 1, sexp: 2 }
  const records = [0, 1].map(i => ({ id: String(i).repeat(40), time: `2014-01-0${i + 1}T00:00:00Z`, risk: i ? .75 : 0,
    lines: 12, files: 2, metrics: { ...measures } }))
  const featureSchema = { name: 'kamei14-v1', inModel, unavailable: [
    { name: 'lt', reason: '固定快照不含变更前文件规模（Size 家族只有 la、ld），不能用 la+ld 替代' },
    { name: 'rexp', reason: '同名列 rexp 是 Reviewer experience；候选 arexp 只给标签、无定义，无法核验' }] }
  return { contractVersion: 1, mode: 'historical', project: 'OpenStack-fixture', version: datasetVersion, datasetVersion, runId,
    model: { id: 'logistic-regression-kamei14-v1', name: '逻辑回归 · Kamei14（12 字段入模）', sha256 }, records,
    summary: { runId, datasetVersion, modelSha256: sha256, features: [...inModel],
      featureSchema, algorithmVersion: 'logistic-regression-l2-v1', metricSet: 'metric-set-v1',
      model: { id: 'logistic-regression-kamei14-v1', name: '逻辑回归 · Kamei14（12 字段入模）' },
      source: { publisher: 'fixture publisher', url: 'https://github.com/software-rebels/JITMovingTarget', revision: 'c'.repeat(40),
        sha256, citation: 'Invented unit fixture, not real evidence', labelRule: '发布者未观测到缺陷引入不等于无缺陷',
        files: Object.fromEntries(['openstack.csv', 'load_data.r', 'experimental_settings.r'].map(name => [name, { url: `https://example.com/unit-only/${name}`, sha256, bytes: 1 }])),
        quality: { rawRows: 10, includedRows: 10, positiveLabels: 2, blankLabels: 1, excluded: {} } },
      cohort: { startEpochInclusive: 0, endEpochExclusive: 2000000000, addedLinesGreaterThan: 0, maxChurnInclusive: 10000, maxFilesInclusive: 100 },
      split: { train: { count: 6, positiveCount: 1, start: '2012-01-01T00:00:00Z', end: '2012-12-31T00:00:00Z' },
        validation: { count: 2, positiveCount: 0, start: '2013-01-01T00:00:00Z', end: '2013-12-31T00:00:00Z' },
        test: { count: 2, positiveCount: 1, start: records[0].time, end: records[1].time } },
      metrics: { rocAuc: value(1), averagePrecision: value(1), precision: value(1), recall: value(1), f1: value(1), recall20Loc: value(0),
        threshold: .5, counts: { records: 2, positive: 1, negative: 1 }, confusion: { tp: 1, fp: 0, tn: 1, fn: 0 },
        effort: { name: 'Recall@20%LOC (risk-ranked)', totalLoc: 24, budgetLoc: 4.8, usedLoc: 0, selectedCount: 0,
          ordering: 'risk-desc,time-desc,id-asc', policy: 'whole-commit-prefix-stop' },
        reference: { apNoInformation: .5, allNegative: { precision: value(null, '没有预测为正的提交'), recall: value(0), f1: value(0),
          confusion: { tp: 0, fp: 0, tn: 1, fn: 1 } } } },
      threshold: .5, protocolVersion: 'kamei14-v1',
      limitations: ['字段 lt、rexp 未提供：lt（固定快照不含变更前文件规模，不能用 la+ld 替代）；rexp（同名列是 Reviewer experience，候选 arexp 只给标签、无定义）。', '回顾性历史评价，未验证历史当时标签可获得性；预测解释未提供。'] } }
}
