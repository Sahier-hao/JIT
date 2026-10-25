import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CommitDetail } from './CommitDetail'
import type { Dataset } from './domain'

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
const empty = { repositoryId: REPO, viewSyncId: SYNC, commitId: SHA, risk: .4,
  modelId: MODEL, runId: RUN, datasetVersion: 'data-v1', explanationStatus: 'not-generated',
  explanation: [], explanationMethod: null, explanationSummary: null, explanationReason: null,
  reasonCode: null, baselineSource: null, baselineDatasetVersion: null, missingBaselineFeatures: [],
  featureSchemaVersion: null, modelSha256: null, generatedAt: null, limitations: ['不是缺陷结论或代码定位'] }
const supported = { ...empty, explanationStatus: 'supported', explanationMethod: 'occlusion-mean-v1',
  explanationSummary: '新增行数推高模型分数。', baselineSource: 'zero', baselineDatasetVersion: 'model-data',
  missingBaselineFeatures: ['ns', 'nd', 'nf', 'ent', 'la', 'ld'], featureSchemaVersion: 'openstack-six-v1',
  modelSha256: 'b'.repeat(64), generatedAt: '2026-10-25T00:00:00Z',
  explanation: [{ feature: 'la', value: 30, baseline: 0, delta: .12, direction: 'increases' }] }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
function renderDetail(dataset = data, id = SHA) {
  return render(<CommitDetail data={dataset} id={id} added={false} onAdd={vi.fn()} onClose={vi.fn()}/> )
}
afterEach(() => vi.restoreAllMocks())

it('reads without inferring and generates a pinned model explanation only after a click', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => response(init?.method === 'POST' ? supported : empty))
  renderDetail()
  const button = await screen.findByRole('button', { name: '生成模型解释' })
  expect(fetch.mock.calls).toHaveLength(1)
  expect(String(fetch.mock.calls[0][0])).toContain(`viewSyncId=${SYNC}`)
  await userEvent.setup().click(button)
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
  expect(screen.getByText('新增行数（la）')).toBeVisible()
  expect(screen.getByText('+0.120000')).toBeVisible()
  expect(screen.getByText('零基线：原模型绑定数据集的均值不可用。')).toBeVisible()
  expect(fetch.mock.calls[1][1]?.method).toBe('POST')
  expect(data.records[0].risk).toBe(.4)
})

it('shows saved explanations without posting and rejects mismatched analysis identities', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(supported))
  const view = renderDetail()
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
  expect(fetch.mock.calls).toHaveLength(1)
  view.unmount()
  fetch.mockResolvedValue(response({ ...supported, viewSyncId: REPO }))
  renderDetail()
  expect(await screen.findByRole('button', { name: '重新读取解释' })).toBeVisible()
  expect(screen.queryByText('新增行数推高模型分数。')).not.toBeInTheDocument()
})

it('keeps unsupported reasons retryable and handles a successful retry', async () => {
  let attempts = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method !== 'POST') return response(empty)
    return response(++attempts === 1 ? { ...empty, explanationStatus: 'not-supported', explanationReason: '原模型暂不可用', reasonCode: 'MODEL_NOT_READY' } : supported)
  })
  renderDetail(); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '生成模型解释' }))
  expect(await screen.findByText('原模型暂不可用')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '重新尝试生成' }))
  expect(await screen.findByText('新增行数推高模型分数。')).toBeVisible()
})

it('does not display a late explanation after switching to another commit', async () => {
  let complete: (response: Response) => void = () => {}
  const nextSha = 'c'.repeat(40)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes(SHA)
    ? new Promise<Response>(resolve => { complete = resolve })
    : response({ ...empty, commitId: nextSha }))
  const view = renderDetail()
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  const next = { ...data, records: [{ ...data.records[0], id: nextSha }] }
  view.rerender(<CommitDetail data={next} id={nextSha} added={false} onAdd={vi.fn()} onClose={vi.fn()}/>)
  expect(await screen.findByRole('button', { name: '生成模型解释' })).toBeVisible()
  complete(response(supported))
  await waitFor(() => expect(screen.queryByText('新增行数推高模型分数。')).not.toBeInTheDocument())
})
