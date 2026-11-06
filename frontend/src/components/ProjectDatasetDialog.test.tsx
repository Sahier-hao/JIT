import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectDatasetDialog } from './ProjectDatasetDialog'
import { apiDownload } from '../apiClient'

const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC_A = '22222222-2222-4222-8222-222222222222'
const SYNC_B = '33333333-3333-4333-8333-333333333333'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function dataset(syncId: string, suffix: string, sha: string) {
  return {
    syncId,
    datasetId: `demo-${suffix}`,
    version: `demo-${suffix}-2024-01-01_2024-12-31`,
    schema: 'kamei14-git-v2',
    timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-12-31T00:00:00Z' },
    quality: { rawRows: 120, includedRows: 100, positiveLabels: 20 },
    file: { name: 'dataset.csv', sha256: sha, bytes: 2048 },
    source: { publisher: 'fixture', url: 'https://example.com/repo', revision: 'c'.repeat(40), citation: null, branch: 'main', head: 'd'.repeat(40), window: null },
    labelRule: '简化 SZZ',
    limitations: ['提交级聚合', '特征为提交级聚合'],
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('loads the pinned analysis dataset and clears the previous version when the analysis changes', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = new URL(String(input), 'http://localhost').pathname
    return json(path.includes(SYNC_A) ? dataset(SYNC_A, 'a', SHA_A) : dataset(SYNC_B, 'b', SHA_B))
  })
  const view = render(<ProjectDatasetDialog repositoryId={REPO} syncId={SYNC_A} open onOpenChange={vi.fn()}/>)
  expect(await screen.findByText('demo-a-2024-01-01_2024-12-31')).toBeVisible()
  expect(screen.getByText(SHA_A)).toBeVisible()
  view.rerender(<ProjectDatasetDialog key={SYNC_B} repositoryId={REPO} syncId={SYNC_B} open onOpenChange={vi.fn()}/>)
  expect(await screen.findByText('demo-b-2024-01-01_2024-12-31')).toBeVisible()
  expect(screen.queryByText(SHA_A)).not.toBeInTheDocument()
})

it('requests the verified package from the pinned analysis', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:dataset') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path.endsWith('/export/zip')) {
      return new Response(new Blob(['zip']), {
        status: 200,
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="demo-a-12345.zip"' },
      })
    }
    return json(dataset(SYNC_A, 'a', SHA_A))
  })
  render(<ProjectDatasetDialog repositoryId={REPO} syncId={SYNC_A} open onOpenChange={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '下载 CSV 包' }))
  await waitFor(() => expect(fetch.mock.calls.some(([input]) =>
    new URL(String(input), 'http://localhost').pathname === `/api/v1/repositories/${REPO}/analyses/${SYNC_A}/dataset/export/zip`)).toBe(true))
})

it('uses the server-provided download filename', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('zip', {
    status: 200,
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="demo-a-12345.zip"' },
  }))
  await expect(apiDownload('/download')).resolves.toMatchObject({ filename: 'demo-a-12345.zip' })
})

it('shows an actionable error and retries the dataset request', async () => {
  let attempts = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    attempts += 1
    if (attempts === 1) {
      return json({ error: { code: 'DATASET_UNAVAILABLE', message: '源文件缺失', requestId: 'req-1' } }, 503)
    }
    return json(dataset(SYNC_A, 'a', SHA_A))
  })
  render(<ProjectDatasetDialog repositoryId={REPO} syncId={SYNC_A} open onOpenChange={vi.fn()}/>)
  expect(await screen.findByText('源文件缺失')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '重新加载' }))
  expect(await screen.findByText('demo-a-2024-01-01_2024-12-31')).toBeVisible()
  expect(attempts).toBe(2)
})
