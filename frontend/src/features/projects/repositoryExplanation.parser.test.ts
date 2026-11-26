import { describe, expect, it } from 'vitest'
import {
  parseRepositoryExplanation,
  parseRepositoryExplanationList,
  parseRepositoryExplanationMethods,
  type ExplanationContext,
} from '@/features/projects/repositoryExplanation'

const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'
const MODEL = '33333333-3333-4333-8333-333333333333'
const RUN = '44444444-4444-4444-8444-444444444444'
const SHA = 'a'.repeat(40)
const context: ExplanationContext = {
  repositoryId: REPO,
  viewSyncId: SYNC,
  commitId: SHA,
  risk: 0.4,
  modelId: MODEL,
  runId: RUN,
  datasetVersion: 'data-v1',
}

function explanation(overrides: Record<string, unknown> = {}) {
  return {
    repositoryId: REPO,
    viewSyncId: SYNC,
    commitId: SHA,
    modelId: MODEL,
    runId: RUN,
    datasetVersion: 'data-v1',
    risk: 0.4,
    explanationStatus: 'supported',
    explanation: [{ feature: 'la', value: 30, baseline: 0, delta: 0.12, direction: 'increases' }],
    explanationMethod: 'occlusion-mean-v1',
    explanationUnit: 'probability',
    explanationSummary: '新增行数推高模型分数。',
    explanationReason: null,
    reasonCode: null,
    contributionTotal: null,
    baselineSource: 'zero',
    baselineDatasetVersion: 'model-data',
    missingBaselineFeatures: [],
    featureSchemaVersion: 'openstack-six-v1',
    modelSha256: null,
    generatedAt: null,
    limitations: ['不是缺陷结论或代码定位'],
    ...overrides,
  }
}

describe('parseRepositoryExplanation', () => {
  it('解析 unit、method 与 contributionTotal，并接受 logit delta 超过 1', () => {
    const parsed = parseRepositoryExplanation(explanation({
      explanationMethod: 'linear-logodds-v1',
      explanationUnit: 'logit',
      contributionTotal: 1.234,
      baselineSource: 'training-partition-mean',
      explanation: [{ feature: 'la', value: 30, baseline: 0, delta: 1.234, direction: 'increases' }],
    }), context)
    expect(parsed.explanationUnit).toBe('logit')
    expect(parsed.contributionTotal).toBe(1.234)
    expect(parsed.explanation[0].delta).toBe(1.234)
  })

  it('拒绝未知方法与单位不一致', () => {
    expect(() => parseRepositoryExplanation(explanation({ explanationMethod: 'shap-v1' }), context)).toThrow()
    expect(() => parseRepositoryExplanation(explanation({
      explanationMethod: 'linear-logodds-v1',
      explanationUnit: 'probability',
      contributionTotal: 1.234,
      baselineSource: 'training-partition-mean',
    }), context)).toThrow()
  })

  it('probability 仍拒绝超过 1 的 delta，logit 只要求有限数', () => {
    expect(() => parseRepositoryExplanation(explanation({
      explanation: [{ feature: 'la', value: 30, baseline: 0, delta: 1.2, direction: 'increases' }],
    }), context)).toThrow()
    expect(() => parseRepositoryExplanation(explanation({
      explanationMethod: 'linear-logodds-v1',
      explanationUnit: 'logit',
      contributionTotal: 1.2,
      baselineSource: 'training-partition-mean',
      explanation: [{ feature: 'la', value: 30, baseline: 0, delta: 1.2, direction: 'increases' }],
    }), context)).not.toThrow()
  })

  it('拒绝跨分析身份与风险不一致', () => {
    expect(() => parseRepositoryExplanation(explanation({ commitId: 'c'.repeat(40) }), context)).toThrow()
    expect(() => parseRepositoryExplanation(explanation({ risk: 0.5 }), context)).toThrow()
    expect(() => parseRepositoryExplanation(explanation({ viewSyncId: REPO }), context)).toThrow()
  })

  it('请求指定方法时拒绝返回其他方法', () => {
    expect(() => parseRepositoryExplanation(explanation(), context, { method: 'linear-logodds-v1' })).toThrow()
    expect(() => parseRepositoryExplanation(explanation(), context, { method: 'occlusion-mean-v1' })).not.toThrow()
  })

  it('解析模板摘要，并允许旧解释没有该字段', () => {
    const legacy = parseRepositoryExplanation(explanation(), context)
    expect(legacy.featureSummary).toBeNull()
    const templated = parseRepositoryExplanation(explanation({
      featureSummary: '本次分数主要受新增行数推高模型分数。',
    }), context)
    expect(templated.featureSummary).toBe('本次分数主要受新增行数推高模型分数。')
  })
})

describe('parseRepositoryExplanationMethods / List', () => {
  const methodsBody = {
    repositoryId: REPO,
    viewSyncId: SYNC,
    commitId: SHA,
    modelId: MODEL,
    runId: RUN,
    datasetVersion: 'data-v1',
    defaultMethod: 'occlusion-mean-v1',
    modelAvailable: true,
    reasonCode: null,
    modelSha256: null,
    methods: [
      { method: 'occlusion-mean-v1', name: '遮挡均值基线', applicableModels: ['logistic-regression'], unit: 'probability', baseline: 'training-partition-mean', cost: 'x', deterministic: true, limitations: ['不是缺陷结论'] },
      { method: 'linear-logodds-v1', name: '逻辑回归 log-odds 分解', applicableModels: ['logistic-regression'], unit: 'logit', baseline: 'training-partition-mean', cost: 'y', deterministic: true, limitations: ['单位不同不能相加'] },
    ],
    savedMethods: [{ method: 'occlusion-mean-v1', status: 'supported', generatedAt: null }],
  }

  it('解析方法目录并拒绝目录内单位不一致', () => {
    const parsed = parseRepositoryExplanationMethods(methodsBody, context)
    expect(parsed.methods).toHaveLength(2)
    expect(parsed.methods[0].unit).toBe('probability')
    expect(() => parseRepositoryExplanationMethods({
      ...methodsBody,
      methods: [{ ...methodsBody.methods[0], unit: 'logit' }],
    }, context)).toThrow()
  })

  it('解析已保存列表并拒绝跨分析列表', () => {
    const parsed = parseRepositoryExplanationList({ ...methodsBody, explanations: [explanation()] }, context)
    expect(parsed.explanations).toHaveLength(1)
    expect(() => parseRepositoryExplanationList({ ...methodsBody, explanations: [explanation()], commitId: 'c'.repeat(40) }, context)).toThrow()
  })
})
