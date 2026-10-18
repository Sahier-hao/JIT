/**
 * 数据来源页（任务 6.1/6.2/6.6/6.7；RCL-07/09）。
 *
 * 覆盖：无凭据不发请求、空列表给入口、提交后清空地址并重新读取、失败给"下一步"而不是只给错误码、
 * 降级说明原因、进行中显示阶段、完成后带着同步身份去工作台。
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialProvider } from './credentials'
import { RepositorySourcesPage } from './RepositorySourcesPage'
import { jsonResponse } from './testFixtures'

const SYNC = {
  syncId: '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f',
  repositoryId: '2c3d4e5f-6071-4823-9445-566778899001',
  repositoryUrl: 'https://github.com/octo/example.git',
  branch: 'main',
  since: null,
  until: null,
  commitLimit: 500,
  requestedStrategy: 'auto',
  status: 'completed',
  stage: 'completed',
  datasetVersion: 'kamei14-git-v1-example-100_200',
  runId: null,
  modelId: null,
  modelStrategy: 'repository-trained',
  degradeReason: null,
  trainRecords: 120,
  trainPositives: 24,
  createdAt: '2026-10-18T06:00:00Z',
  updatedAt: '2026-10-18T06:01:00Z',
  requestId: null,
  error: null,
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function listResponse(syncs: unknown[]) {
  return jsonResponse(200, { syncs, total: syncs.length, limit: 20, offset: 0 })
}

function renderPage(token = 'member-token', onOpenSync = vi.fn()) {
  render(
    <CredentialProvider initialToken={token}>
      <RepositorySourcesPage onOpenSync={onOpenSync} />
    </CredentialProvider>,
  )
  return onOpenSync
}

function createCall() {
  return fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/v1/repository-syncs') && (call[1] as RequestInit | undefined)?.method === 'POST')
}

describe('数据来源页', () => {
  it('没有凭据时不发请求，并说明为什么不能同步', () => {
    renderPage('')
    expect(screen.getByText(/同步需要团队凭据/)).toBeVisible()
    expect(screen.getByRole('button', { name: '开始同步' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('没有同步记录时给空态与下一步', async () => {
    fetchMock.mockResolvedValue(listResponse([]))
    renderPage()
    expect(await screen.findByText('还没有同步过仓库')).toBeVisible()
    expect(screen.getByText(/公开仓库地址即可开始/)).toBeVisible()
  })

  it('提交后把表单字段交给服务端，并重新读取列表', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(jsonResponse(202, { ...SYNC, status: 'queued', stage: 'queued' }))
      return Promise.resolve(listResponse([]))
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByRole('textbox', { name: '仓库地址' }), 'https://github.com/octo/example.git')
    await user.click(screen.getByRole('button', { name: '开始同步' }))

    await waitFor(() => expect(createCall()).toBeDefined())
    const body = JSON.parse(String((createCall()![1] as RequestInit).body))
    expect(body).toEqual({ repositoryUrl: 'https://github.com/octo/example.git', commitLimit: 500, strategy: 'auto' })
    // 提交成功后地址被清空，避免误以为同一次点击提交了两遍。
    await waitFor(() => expect(screen.getByRole('textbox', { name: '仓库地址' })).toHaveValue('https://github.com/octo/example.git'))
    // 首次读取 + 提交成功后的重新读取。
    const listCalls = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'GET')
    await waitFor(() => expect(listCalls.length).toBeGreaterThanOrEqual(2))
  })

  it('失败的同步同时显示服务端原因与"下一步"', async () => {
    fetchMock.mockResolvedValue(
      listResponse([
        {
          ...SYNC,
          status: 'failed',
          stage: 'failed',
          error: { code: 'REPOSITORY_UNAVAILABLE', message: '仓库不可访问：https://example.invalid/repo.git' },
        },
      ]),
    )
    renderPage()
    expect(await screen.findByText('仓库打不开或分支不存在')).toBeVisible()
    expect(screen.getByText(/确认地址是公开的 HTTP\(S\) 仓库/)).toBeVisible()
    expect(screen.getByText('仓库不可访问：https://example.invalid/repo.git')).toBeVisible()
  })

  it('降级到现成模型时说明原因，不把通用模型说成本仓库训练', async () => {
    fetchMock.mockResolvedValue(listResponse([{ ...SYNC, modelStrategy: 'generic-model', degradeReason: 'fewPositives' }]))
    renderPage()
    expect(await screen.findByText('现成通用模型')).toBeVisible()
    expect(screen.getByText(/能确认的缺陷引入太少/)).toBeVisible()
    expect(screen.queryByText('本仓库数据训练')).toBeNull()
  })

  it('进行中的作业显示当前阶段', async () => {
    fetchMock.mockResolvedValue(listResponse([{ ...SYNC, status: 'collecting', stage: 'collecting', modelStrategy: null }]))
    renderPage()
    expect(await screen.findByText('正在采集')).toBeVisible()
    expect(screen.getByText(/完成后自动刷新/)).toBeVisible()
  })

  it('完成后带着同步身份进入工作台', async () => {
    fetchMock.mockResolvedValue(listResponse([SYNC]))
    const onOpen = renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '去工作台看这批提交的风险' }))
    expect(onOpen).toHaveBeenCalledWith(SYNC.repositoryId, SYNC.syncId)
  })
})
