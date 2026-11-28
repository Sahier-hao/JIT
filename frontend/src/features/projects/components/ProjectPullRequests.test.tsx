import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectPullRequests } from '@/features/projects/components/ProjectPullRequests'
import { PRTrackingPanel } from '@/features/reviews/components/PRTrackingPanel'
import { modelChoices, NOW, PROJECT, prBatch, prPage, response, tracking } from '@/features/projects/projectActivity.fixture'
import { WORK_KEY } from '@/features/reviews/prReview'
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
it('loads missing PR cache once without submitting analysis and preserves the project context', async () => {
  const navigate = vi.fn(), fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => response(String(path).includes('pull-request-batches') ? null : prPage({ checkedAt: init?.method === 'POST' ? '2026-10-29T00:00:00Z' : null })))
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={navigate}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '查看 PR' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/analyses'))).toBe(false)
  expect(localStorage.getItem(WORK_KEY)).toBeNull()
})
it('retries failed discovery and paginates closed and all ranges explicitly', async () => {
  let failed = true
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).includes('pull-request-batches')) return response(null)
    const url = new URL(String(path), 'http://localhost'), page = Number(url.searchParams.get('page')) || 1
    if (failed) return response({ error: { code: 'GITHUB_UNAVAILABLE', message: '远端暂不可用', requestId: 'r' } }, 503)
    return response(prPage({ page, hasMore: page === 1 }))
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('远端暂不可用'); failed = false
  await user.click(screen.getByRole('button', { name: '重新加载' }))
  await screen.findByRole('heading', { name: '#12 修复边界' })
  await user.click(screen.getByText('已结束'))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('state=closed&page=1'))).toBe(true))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('state=closed&page=2'))).toBe(true))
  await user.click(screen.getByText('全部'))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('state=all&page=1'))).toBe(true))
})
it('explains unsupported non-GitHub projects truthfully', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => response(String(path).includes('pull-request-batches') ? null : prPage({ supported: false, owner: null, name: null, pullRequests: [] })))
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  expect(await screen.findByText('此项目不是公开 GitHub 来源')).toBeVisible()
  expect(screen.queryByRole('button', { name: '查看 PR' })).not.toBeInTheDocument()
})
function trackingApi(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).includes('pull-request-batches')) return response(null)
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    if (String(path).includes('/pull-requests')) return response(prPage({ hasMore: true }))
    return response(tracking({ ...overrides, ...(init?.method === 'PATCH' ? JSON.parse(String(init.body)) : {}) }))
  })
}
it('requires an explicit existing PR confirmation and pins the selected model rather than the new default', async () => {
  const fetch = trackingApi()
  render(<PRTrackingPanel repositoryId={PROJECT}/>); const user = userEvent.setup()
  const modelSelect = await screen.findByRole('combobox', { name: '固定自动分析模型' })
  expect(modelSelect).toHaveTextContent('原固定模型')
  await user.click(modelSelect)
  expect(await screen.findByRole('option', { name: /停用模型/ })).toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Escape}')
  expect(screen.getByText(/还有后续页，以上不是完整数量/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '启用自动分析' }))
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '取消设置' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '启用自动分析' }))
  await user.click(screen.getByRole('button', { name: '确认启用并处理现有开放 PR' }))
  const body = JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))
  expect(body).toEqual({ enabled: true, modelId: 'model-original', intervalSeconds: 300, confirmExisting: true })
  expect(body).not.toHaveProperty('scratch')
  expect(localStorage.getItem(WORK_KEY)).toBeNull()
})
it('shows real batch progress and retries only failed items', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).includes('/pull-request-batches/latest')) return response(prBatch())
    if (String(path).includes('/pull-request-batches/')) return response(prBatch({ status: 'running', submission: { pending: 0, submitted: 1, reused: 0, failed: 0, skipped: 0 } }))
    if (String(path).includes('/pull-requests')) return response(prPage())
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    return response(null)
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  expect(await screen.findByText(/已入队 1 · 复用 0 · 失败 1/)).toBeVisible()
  expect(screen.getByText(/范围 2 个开放 PR/)).toBeVisible()
  expect(screen.getByLabelText('批量分析阶段')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '仅重试失败项' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path, init]) => String(path).endsWith('/retry') && init?.method === 'POST' && JSON.parse(String(init.body)).kind === 'failed')).toBe(true))
})
it('submits a limited batch from the PR toolbar and preserves the chosen model on retry', async () => {
  const submitted: unknown[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    const url = new URL(String(path), 'http://localhost')
    if (url.pathname.endsWith('/pull-requests/count')) return response({ count: 10 })
    if (url.pathname.endsWith('/pull-requests/analyze')) {
      submitted.push(JSON.parse(String(init?.body)))
      if (submitted.length === 1) return response({ error: { code: 'TEMP', message: '暂时无法提交批次', requestId: 'fixture' } }, 503)
      return response(prBatch({ modelId: 'model-new', scope: { kind: 'limit', limit: 2 } }), 202)
    }
    if (url.pathname.endsWith('/pull-request-batches/latest')) {
      return response(submitted.length === 2 ? prBatch({ modelId: 'model-new' }) : null)
    }
    if (url.pathname.endsWith('/repository-models')) return response({ models: modelChoices })
    if (url.pathname.endsWith('/pull-requests')) return response(prPage())
    return response(tracking())
  })
  render(<ProjectPullRequests repositoryId={PROJECT} modelId="model-original" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '批量分析 PR' }))
  const dialog = await screen.findByRole('dialog', { name: '批量分析 PR' })
  expect(await within(dialog).findByText(/开放 PR 共 10 个/)).toBeVisible()
  await user.click(within(dialog).getByRole('combobox', { name: '批量分析模型' }))
  await user.click(await screen.findByRole('option', { name: /新默认模型/ }))
  await user.click(within(dialog).getByRole('combobox', { name: '批量分析范围' }))
  await user.click(await screen.findByRole('option', { name: '前 N 个开放 PR' }))
  const limit = within(dialog).getByRole('spinbutton', { name: '批量分析数量' })
  await user.clear(limit)
  await user.type(limit, '2')
  const submit = within(dialog).getByRole('button', { name: '提交批量分析' })
  await user.click(submit)
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('暂时无法提交批次')
  await user.click(submit)
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(submitted).toEqual(Array(2).fill({ modelId: 'model-new', scope: { kind: 'limit', limit: 2 } }))
  expect(await screen.findByText(/模型 新默认模型/)).toBeVisible()
  expect(JSON.parse(localStorage.getItem('jit:tracked-analysis-jobs') ?? '[]')[0]).toMatchObject({
    kind: 'pr-batch', batchId: 'batch-1', label: 'PR 批量分析 · 当前项目',
  })
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/repository-syncs'))).toBe(false)
})

it('keeps an unavailable current model instead of silently substituting the default', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const url = new URL(String(path), 'http://localhost')
    if (url.pathname.endsWith('/repository-models')) return response({ models: modelChoices })
    if (url.pathname.endsWith('/pull-requests/count')) return response({ count: 5 })
    if (url.pathname.endsWith('/pull-request-batches/latest')) return response(null)
    return response(prPage())
  })
  render(<ProjectPullRequests repositoryId={PROJECT} modelId="model-disabled" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '批量分析 PR' }))
  const dialog = await screen.findByRole('dialog', { name: '批量分析 PR' })
  expect(await within(dialog).findByText(/原分析模型不可用（已停用）/)).toBeVisible()
  const submit = within(dialog).getByRole('button', { name: '提交批量分析' })
  expect(submit).toBeDisabled()
  await user.click(within(dialog).getByRole('combobox', { name: '批量分析模型' }))
  await user.click(await screen.findByRole('option', { name: /新默认模型/ }))
  expect(submit).toBeEnabled()
})

it('submits a single unanalyzed PR with the project model', async () => {
  const sync = {
    syncId: '55555555-5555-4555-8555-555555555555', repositoryId: PROJECT,
    repositoryUrl: 'https://github.com/example/project', branch: 'feature', since: null, until: null,
    commitLimit: 500, requestedStrategy: 'generic-model', status: 'queued', stage: 'queued',
    datasetVersion: null, runId: null, modelId: 'model-current', modelStrategy: 'generic-model',
    degradeReason: null, trainRecords: null, trainPositives: null, createdAt: NOW, updatedAt: NOW,
    requestId: null, error: null, sourceKind: 'pr', sourceSnapshotId: 'v1',
  }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path) => {
    if (String(path).includes('pull-request-batches')) return response(null)
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    if (String(path).includes('/analyze')) return response({ snapshotId: 'v1', analyses: [{ sync, scores: [], fileRisks: [] }] })
    return response(prPage({ pullRequests: [{ ...prPage().pullRequests[0], analysisStatus: null, modelId: null, syncId: null, snapshotId: null }] }))
  })
  render(<ProjectPullRequests repositoryId={PROJECT} modelId="model-current" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path, init]) => String(path).endsWith('/pull-requests/12/analyze') && init?.method === 'POST')).toBe(true))
  const call = fetch.mock.calls.find(([path]) => String(path).endsWith('/pull-requests/12/analyze'))
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ modelId: 'model-current' })
  expect(JSON.parse(localStorage.getItem('jit:tracked-analysis-jobs') ?? '[]')[0]).toMatchObject({
    kind: 'pr', syncId: sync.syncId, label: 'PR 分析 · #12 修复边界',
  })
})
it('marks a PR that reused saved features', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).includes('pull-request-batches')) return response(null)
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    return response(prPage({ pullRequests: [{ ...prPage().pullRequests[0], featureSource: { kind: 'repository-features' } }] }))
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  expect(await screen.findByText(/复用已保存特征/)).toBeVisible()
})
it('shows the fixed head SHA, commit list, model identity and check time after auto analysis', async () => {
  const head = 'b'.repeat(40)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).includes('pull-request-batches')) return response(null)
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    return response(prPage({
      pullRequests: [{
        ...prPage().pullRequests[0],
        headSha: head,
        commitCount: 1,
        commitsComplete: true,
        commits: [{ sha: head, message: 'fix: background update', time: NOW }],
        checkedAt: NOW,
        analysisStatus: 'completed',
        modelId: 'model-original',
      }],
    }))
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  expect((await screen.findAllByText(head.slice(0, 10), { selector: 'code' })).length).toBeGreaterThan(0)
  expect(screen.getByText(/检查于/)).toBeVisible()
  expect(screen.getByText('原固定模型')).toBeVisible()
  await user.click(screen.getByText('提交列表（1）'))
  expect(screen.getByText('fix: background update')).toBeVisible()
})
it('cancels a running batch only after confirmation', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path) => {
    if (String(path).endsWith('/cancel')) return response(prBatch({ status: 'cancelled', cancelledAt: '2026-10-29T00:00:00Z', cancelRequested: true }))
    if (String(path).includes('/pull-request-batches/latest')) return response(prBatch({ status: 'running', counts: { pending: 3, queued: 1, running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0, skipped: 0 } }))
    if (String(path).includes('/pull-requests')) return response(prPage())
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    return response(null)
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '取消批次' }))
  expect(fetch.mock.calls.some(([path]) => String(path).endsWith('/cancel'))).toBe(false)
  await user.click(screen.getByRole('button', { name: '确认取消' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path, init]) => String(path).endsWith('/cancel') && init?.method === 'POST')).toBe(true))
})
it('reanalyzes a completed PR with a different model', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path) => {
    if (String(path).includes('pull-request-batches')) return response(null)
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    if (String(path).includes('/analyze')) return response({ snapshotId: 'v1', analyses: [] })
    return response(prPage())
  })
  render(<ProjectPullRequests repositoryId={PROJECT} modelId="model-original" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '换模型' }))
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('/pull-requests/12/analyze'))).toBe(true))
  const call = fetch.mock.calls.find(([path]) => String(path).endsWith('/pull-requests/12/analyze'))
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ modelId: 'model-new' })
})
it('does not silently substitute a disabled fixed model and pauses without sending model changes', async () => {
  const fetch = trackingApi({ enabled: true, modelId: 'model-disabled' })
  render(<PRTrackingPanel repositoryId={PROJECT}/>); const user = userEvent.setup()
  await screen.findByText(/原选模型已不可用/)
  expect(screen.getByRole('combobox', { name: '固定自动分析模型' })).toHaveTextContent('停用模型（已停用）')
  expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '暂停自动分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true))
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))).toEqual({ enabled: false })
})
it('filters analysis status in the main list with page-local counts', async () => {
  const completed = { ...prPage().pullRequests[0] }
  const failed = { ...completed, number: 13, title: '失败的分析', analysisStatus: 'failed' }
  const pending = { ...completed, number: 14, title: '等待分析', analysisStatus: null }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).includes('pull-request-batches') ? response(null) : response(prPage({ pullRequests: [completed, failed, pending] })))
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  await screen.findByRole('heading', { name: '#13 失败的分析' })
  const filter = await screen.findByRole('combobox', { name: '本页分析状态' })
  expect(screen.queryByRole('complementary', { name: '待处理 PR' })).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.selectOptions(filter, 'failed')
  expect(screen.getByRole('heading', { name: '#13 失败的分析' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: '#14 等待分析' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '#12 修复边界' })).not.toBeInTheDocument()
  expect(screen.getByText('本页显示 1 / 3 个')).toBeVisible()
  await user.selectOptions(filter, 'all')
  expect(screen.getByRole('heading', { name: '#14 等待分析' })).toBeVisible()
})
it('keeps pagination available when the status filter is empty on this page', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const url = new URL(String(path), 'http://localhost')
    if (url.pathname.includes('pull-request-batches')) return response(null)
    const page = Number(url.searchParams.get('page')) || 1
    const pr = prPage().pullRequests[0]
    return response(prPage({ page, hasMore: page === 1, pullRequests: [page === 1 ? pr : { ...pr, analysisStatus: null }] }))
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '#12 修复边界' })
  await user.selectOptions(await screen.findByRole('combobox', { name: '本页分析状态' }), 'unscored')
  expect(screen.getByText('本页没有符合分析状态的 PR')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(await screen.findByRole('heading', { name: '#12 修复边界' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: '本页分析状态' })).toHaveValue('unscored')
})
