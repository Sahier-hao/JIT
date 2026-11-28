import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CommitDetail } from '@/features/projects/components/CommitDetail'
import type { Dataset } from '@/lib/domain'

const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'
const MODEL = '33333333-3333-4333-8333-333333333333'
const RUN = '44444444-4444-4444-8444-444444444444'
const SHA = 'a'.repeat(40)
const data: Dataset = { mode: 'repository', project: 'repo', version: 'data-v1',
  records: [{ id: SHA, time: '2024-01-01T00:00:00Z', risk: .4, lines: 34, files: 3 }],
  repository: { repositoryId: REPO, syncId: SYNC, repositoryUrl: 'https://github.com/example/repo',
    branch: 'main', datasetVersion: 'data-v1', requestedStrategy: 'generic-model', modelStrategy: 'generic-model',
    degradeReason: null, trainRecords: null, trainPositives: null, labelNote: '', modelId: MODEL, runId: RUN } }

const base = { repositoryId: REPO, viewSyncId: SYNC, commitId: SHA, modelId: MODEL, runId: RUN, datasetVersion: 'data-v1' }
const empty = { ...base, risk: .4, explanationStatus: 'not-generated', explanation: [], explanationMethod: 'occlusion-mean-v1',
  explanationUnit: 'probability', explanationSummary: null, explanationReason: null, reasonCode: null,
  contributionTotal: null, baselineSource: null, baselineDatasetVersion: null, missingBaselineFeatures: [],
  featureSchemaVersion: null, modelSha256: null, generatedAt: null, limitations: ['不是缺陷结论或代码定位'] }
const occlusionSupported = { ...empty, explanationStatus: 'supported', explanationSummary: '新增行数推高模型分数。',
  baselineSource: 'zero', baselineDatasetVersion: 'model-data', missingBaselineFeatures: ['ns', 'nd', 'nf', 'ent', 'la', 'ld'],
  featureSchemaVersion: 'openstack-six-v1', modelSha256: 'b'.repeat(64), generatedAt: '2026-10-25T00:00:00Z',
  stability: { status: 'stable', rounds: 3, topFeatures: [['la']], baseOrder: ['la'] },
  explanation: [{ feature: 'la', value: 30, baseline: 0, delta: .12, direction: 'increases' }] }
const linearSupported = { ...empty, explanationMethod: 'linear-logodds-v1', explanationUnit: 'logit',
  explanationStatus: 'supported', explanationSummary: '相对训练分区基线，log-odds 总变化为 1.234000；影响最大的字段为 la，推高 1.234000。',
  baselineSource: 'training-partition-mean', baselineDatasetVersion: 'model-data', missingBaselineFeatures: [],
  featureSchemaVersion: 'openstack-six-v1', modelSha256: 'b'.repeat(64), generatedAt: '2026-10-25T00:00:00Z',
  contributionTotal: 1.234, stability: { status: 'stable', rounds: 3, topFeatures: [['la']], baseOrder: ['la'] },
  explanation: [{ feature: 'la', value: 30, baseline: 0, delta: 1.234, direction: 'increases' }] }
const notSupported = { ...empty, explanationStatus: 'not-supported', explanationReason: '原模型暂不可用', reasonCode: 'MODEL_NOT_READY' }

const occlusionMethod = { method: 'occlusion-mean-v1', name: '遮挡均值基线', applicableModels: ['logistic-regression'], unit: 'probability', baseline: 'training-partition-mean', cost: 'x', deterministic: true, limitations: ['不是缺陷结论'] }
const linearMethod = { method: 'linear-logodds-v1', name: '逻辑回归 log-odds 分解', applicableModels: ['logistic-regression'], unit: 'logit', baseline: 'training-partition-mean', cost: 'y', deterministic: true, limitations: ['单位不同不能相加'] }
function methodsBody(overrides: Record<string, unknown> = {}) {
  return { ...base, defaultMethod: 'occlusion-mean-v1', modelAvailable: true, reasonCode: null, modelSha256: 'b'.repeat(64),
    methods: [occlusionMethod, linearMethod], savedMethods: [], ...overrides }
}
function listBody(items: unknown[]) { return { ...base, explanations: items } }
function lineEvidenceBody() {
  return {
    schema: 'line-review-evidence-v1', status: 'supported', reason: null,
    sourceKind: 'repository-commit', resourceId: REPO, repositoryId: REPO,
    commitId: SHA, ref: SHA, path: 'src/token.ts', side: 'head', language: 'typescript',
    coverage: { patchComplete: true, status: 'supported', addedLines: 1, eligibleLines: 1, skippedBlank: 0,
      textSource: 'patch', usesFullFile: false },
    explanationMethod: 'linear-logodds-line-v1', explanationUnit: 'logit',
    contributionCaveat: '行级特征贡献，不是缺陷原因。',
    artifactSha256: 'b'.repeat(64), intercept: -1,
    lines: [{
      rank: 1, path: 'src/token.ts', side: 'head', line: 9, text: 'return token',
      score: .7, logit: .847, languageContribution: .2,
      contributions: [{ feature: 'return', label: 'return 语句', value: 1, weight: 1.5, contribution: 1.5, direction: 'increases' }],
      contributionTotal: 1.5, otherContribution: 0,
    }],
    caveats: ['研究预览，不是缺陷概率。'],
  }
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
function renderDetail(dataset = data, id = SHA) {
  return render(<CommitDetail data={dataset} id={id} onClose={vi.fn()} />)
}
afterEach(() => vi.restoreAllMocks())

it('reads saved explanations without posting and exposes the method selector', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, _init) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody())
    if (url.includes('/explanations?')) return response(listBody([occlusionSupported]))
    return response(notSupported)
  })
  renderDetail()
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
  expect(screen.getByLabelText('解释方法')).toBeVisible()
  expect(fetch.mock.calls.every(([, init]) => (init as RequestInit)?.method !== 'POST')).toBe(true)
})

it('prefers the saved template summary and keeps legacy summary fallback', async () => {
  const templated = { ...occlusionSupported, featureSummary: '本次分数主要受新增行数推高模型分数。' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody())
    if (url.includes('/explanations?')) return response(listBody([templated]))
    return response(notSupported)
  })
  renderDetail()
  expect(await screen.findByText('本次分数主要受新增行数推高模型分数。')).toBeVisible()
  expect(screen.queryByText('新增行数推高模型分数。')).not.toBeInTheDocument()
})

it('links saved repair evidence to the fix diff file and line', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody({ modelAvailable: false, methods: [] }))
    if (url.includes('/explanations?')) return response(listBody([]))
    return response(notSupported)
  })
  const evidence = {
    fixCommit: 'f'.repeat(40), path: 'src/token.py', fixTime: '2026-11-01T00:00:00Z',
    ruleVersion: 'szz-full-v1', diffAnchor: `diff-${'b'.repeat(32)}`,
    lineRanges: [[3, 4]] as Array<[number, number]>,
    parentRanges: [[9, 10]] as Array<[number, number]>,
  }
  const withEvidence: Dataset = {
    ...data,
    records: [{ ...data.records[0], labelStatus: 'positive', labelEvidence: [evidence] }],
  }
  renderDetail(withEvidence)
  expect(await screen.findByRole('heading', { name: '后续修复证据' })).toBeVisible()
  expect(screen.getByText('修复 diff 行 9–10')).toBeVisible()
  expect(screen.getByText('引入行 3–4')).toBeVisible()
  expect(screen.getByRole('link', { name: 'f'.repeat(12) })).toHaveAttribute(
    'href', `https://github.com/example/repo/commit/${'f'.repeat(40)}#diff-${'b'.repeat(32)}L9`,
  )
})

it('loads fixed-commit line evidence lazily and shows explicit rule unavailability', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody({ methods: [], modelAvailable: false }))
    if (url.includes('/explanations?')) return response(listBody([]))
    if (url.includes('/line-evidence?')) return response(lineEvidenceBody())
    return response(notSupported)
  })
  const withFiles: Dataset = {
    ...data,
    records: [{ ...data.records[0], filePaths: ['src/token.ts'] }],
  }
  renderDetail(withFiles)
  const user = userEvent.setup()
  await user.click(screen.getByText('规则命中'))
  expect(screen.getByText(/当前仓库提交分析没有关联的规则运行记录/)).toBeVisible()
  await user.click(screen.getByText('行级研究证据', { selector: 'summary span' }))
  expect(await screen.findByRole('heading', { name: '行级研究排序' })).toBeVisible()
  expect(screen.getByText(/第 9 行/)).toBeVisible()
  const request = fetch.mock.calls.find(([input]) => String(input).includes('/line-evidence?'))
  expect(String(request?.[0])).toContain(`viewSyncId=${SYNC}`)
  expect(String(request?.[0])).toContain('path=src%2Ftoken.ts')
})

it('generates a selected method only after an explicit choice and keeps the risk unchanged', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, _init) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody())
    if (url.includes('/explanations?')) return response(listBody([]))
    return response(linearSupported)
  })
  renderDetail()
  await screen.findByRole('button', { name: '生成模型解释' })
  await userEvent.setup().selectOptions(screen.getByLabelText('解释方法'), 'linear-logodds-v1')
  await userEvent.setup().click(screen.getByRole('button', { name: '生成模型解释' }))
  expect(await screen.findByText(/log-odds 总变化/)).toBeVisible()
  const post = fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
  expect(post).toBeTruthy()
  expect(String(post![0])).toContain('method=linear-logodds-v1')
  expect(data.records[0].risk).toBe(.4)
})

it('switches between saved methods without posting or mixing units', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody())
    if (url.includes('/explanations?')) return response(listBody([occlusionSupported, linearSupported]))
    return response(notSupported)
  })
  renderDetail()
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
  await userEvent.setup().selectOptions(screen.getByLabelText('解释方法'), 'linear-logodds-v1')
  expect(await screen.findByText(/log-odds 总变化/)).toBeVisible()
  await userEvent.setup().click(screen.getByText('完整依据（1 项）'))
  expect(screen.getByText('贡献合计：+1.234（log-odds）')).toBeVisible()
  expect(fetch.mock.calls.every(([, init]) => (init as RequestInit)?.method !== 'POST')).toBe(true)
})

it('opens each saved explanation after the original model becomes unavailable', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) {
      return response(methodsBody({ methods: [], modelAvailable: false, reasonCode: 'MODEL_NOT_READY' }))
    }
    return response(listBody([occlusionSupported, linearSupported]))
  })
  renderDetail()
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
  const selector = screen.getByLabelText('解释方法')
  await userEvent.setup().selectOptions(selector, 'linear-logodds-v1')
  await userEvent.setup().click(await screen.findByText('完整依据（1 项）'))
  const table = await screen.findByRole('table', { name: /linear-logodds-v1/ })
  expect(within(table).getByRole('rowheader', { name: /la/ })).toBeVisible()
  expect(within(table).getByRole('columnheader', { name: /log-odds/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: /生成/ })).not.toBeInTheDocument()
  expect(fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
})

it('compares multiple saved methods side by side without summing or auto-selecting', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody())
    if (url.includes('/explanations?')) return response(listBody([occlusionSupported, linearSupported]))
    return response(notSupported)
  })
  renderDetail()
  await userEvent.setup().click(await screen.findByText('与其他已保存方法核对（2）'))
  const section = await screen.findByRole('region', { name: '多方法并列核对' })
  expect(within(section).getByText('遮挡均值基线')).toBeVisible()
  expect(within(section).getByText('逻辑回归 log-odds 分解')).toBeVisible()
  expect(within(section).getByText('排序稳定性')).toBeVisible()
  expect(screen.getByText('不同方法单位不同，不求和、不共享排名、不自动选择“最佳解释”。')).toBeVisible()
})

it('keeps unsupported reasons retryable and handles a successful retry', async () => {
  let attempts = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, _init) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody())
    if (url.includes('/explanations?')) return response(listBody([]))
    return response(++attempts === 1 ? notSupported : occlusionSupported)
  })
  renderDetail()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '生成模型解释' }))
  expect(await screen.findByText('原模型暂不可用')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '重新尝试生成' }))
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
})

it('shows a no-method reason without pretending an explanation succeeded', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/explanation-methods?')) return response(methodsBody({ methods: [], reasonCode: 'INPUT_SCHEMA_MISMATCH' }))
    if (url.includes('/explanations?')) return response(listBody([]))
    return response(notSupported)
  })
  renderDetail()
  expect(await screen.findByText(/没有可生成的解释方法/)).toBeVisible()
  expect(screen.queryByText('生成模型解释')).not.toBeInTheDocument()
})

it('does not display a late response after switching to another commit', async () => {
  const nextSha = 'c'.repeat(40)
  let complete: (value: Response) => void = () => {}
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, _init) => {
    const url = String(input)
    const commitId = url.includes(SHA) ? SHA : nextSha
    if (url.includes('/explanation-methods?')) return response({ ...methodsBody(), commitId })
    if (url.includes('/explanations?')) return response({ ...listBody([]), commitId })
    return new Promise<Response>((resolve) => { complete = resolve })
  })
  const view = renderDetail()
  await userEvent.setup().click(await screen.findByRole('button', { name: '生成模型解释' }))
  const next = { ...data, records: [{ ...data.records[0], id: nextSha }] }
  view.rerender(<CommitDetail data={next} id={nextSha} onClose={vi.fn()} />)
  expect(await screen.findByRole('button', { name: '生成模型解释' })).toBeVisible()
  complete(response(occlusionSupported))
  await waitFor(() => expect(screen.queryByText('新增行数推高模型分数。')).not.toBeInTheDocument())
})
