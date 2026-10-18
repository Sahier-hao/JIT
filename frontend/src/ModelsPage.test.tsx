/**
 * 模型中心（任务 3.2、3.3；MPW-03、MPW-04）。
 *
 * 覆盖：无凭据不发请求、可用性与预测支持分开显示、失效模型给出原因、空目录给指引入口、
 * 候选区只在主动打开后才请求、201 新增与 200 复用反馈不同、409 必须刷新重选。
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialProvider } from './credentials'
import { ModelsPage } from './ModelsPage'
import {
  CANDIDATE_ID,
  MANIFEST_SHA,
  MODEL_ID,
  RUN_ID,
  candidatePayload,
  errorResponse,
  jsonResponse,
  modelPayload,
  schemaPayload,
} from './testFixtures'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPage(token = 'member-token') {
  return render(
    <CredentialProvider initialToken={token}>
      <ModelsPage />
    </CredentialProvider>,
  )
}

function paths() {
  return fetchMock.mock.calls.map((call) => String(call[0]))
}

/** 十二字段模型：不可选为六字段单条预测目标，且带有未提供的字段。身份与六字段模型区分开，避免同一份目录里出现重复身份。 */
function twelveFieldModel() {
  return modelPayload({
    modelId: 'cccccccc-2222-4333-8444-555555555555',
    name: '十二字段模型',
    featureSchemaVersion: 'kamei14-v1',
    jsonPredictionSupported: false,
    featureSchema: schemaPayload({
      featureSchemaVersion: 'kamei14-v1',
      jsonPredictionSupported: false,
      fields: [
        ...schemaPayload().fields,
        {
          name: 'lt',
          type: 'integer',
          unit: '发布者原生单位',
          description: 'lt',
          sourceStatus: 'missing',
          inModel: false,
          sourceColumn: 'lt',
          transform: 'raw',
          reason: '固定快照不含变更前文件规模（Size 家族只有 la、ld），不能用 la+ld 替代',
        },
      ],
    }),
  })
}

describe('凭据与请求时机', () => {
  it('没有凭据时不发任何请求，也不自动读取候选目录', async () => {
    renderPage('')
    expect(screen.getByText(/请在设置的团队连接中输入访问凭据/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/本机候选/)).not.toBeInTheDocument()
  })

  it('候选目录只在主动打开管理登记后才请求', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async () => jsonResponse(200, { models: [modelPayload()] }))
    renderPage()
    await screen.findByText('逻辑回归 · 六字段')
    expect(paths()).toEqual(['/api/v1/models'])

    fetchMock.mockImplementation(async (path: string) =>
      path === '/api/v1/model-candidates'
        ? jsonResponse(200, { candidates: [candidatePayload()] })
        : jsonResponse(200, { models: [modelPayload()] }),
    )
    await user.click(screen.getByRole('button', { name: '打开管理登记' }))
    await screen.findByRole('radio', { name: /baseline/ })
    expect(paths()).toContain('/api/v1/model-candidates')
  })
})

describe('已登记模型目录', () => {
  it('可用性与预测支持分开显示，并展示来源与完整身份', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async () => jsonResponse(200, { models: [modelPayload()] }))
    renderPage()
    expect(await screen.findByText('已登记 · 可用')).toBeVisible()
    expect(screen.getByText('支持 openstack-six-v1 的六字段单条预测')).toBeVisible()
    expect(screen.getByText('个已登记模型')).toBeVisible()
    expect(screen.getByText(/来源 本机产生/)).toBeVisible()
    expect(screen.getByText('openstack-six-v1')).toBeVisible()

    await user.click(screen.getByText('查看完整来源与局限'))
    expect(screen.getByText(MODEL_ID)).toBeVisible()
    expect(screen.getByText(RUN_ID)).toBeVisible()
    expect(screen.getByText('公开历史数据，标签为发布者观测。')).toBeVisible()
  })

  it('失效模型如实显示不可用原因与未提供的字段', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        models: [
          modelPayload({
            state: 'invalid',
            error: { code: 'INTEGRITY_ERROR', message: '运行文件校验不匹配，请核验并重新登记' },
          }),
          twelveFieldModel(),
        ],
      }),
    )
    renderPage()
    expect(await screen.findByText('已登记 · 不可用')).toBeVisible()
    expect(screen.getByText(/运行文件校验不匹配，请核验并重新登记/)).toBeVisible()
    expect(screen.getByText(/INTEGRITY_ERROR/)).toBeVisible()
    expect(screen.getByText(/不支持单条 JSON 预测/)).toBeVisible()
    expect(screen.getByText(/lt（固定快照不含变更前文件规模/)).toBeVisible()
  })

  it('空目录给出指引且不自动登记任何候选', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { models: [] }))
    renderPage()
    expect(await screen.findByText('尚无已登记模型')).toBeVisible()
    expect(screen.getByText(/系统不会自动登记本机 baseline/)).toBeVisible()
    expect(paths()).toEqual(['/api/v1/models'])
  })

  it('刷新目录重新请求并反映新的目录内容', async () => {
    const user = userEvent.setup()
    let models: unknown[] = []
    fetchMock.mockImplementation(async () => jsonResponse(200, { models }))
    renderPage()
    await screen.findByText('尚无已登记模型')

    models = [modelPayload()]
    await user.click(screen.getByRole('button', { name: '刷新目录' }))
    expect(await screen.findByText('逻辑回归 · 六字段')).toBeVisible()
    expect(paths().filter((path) => path === '/api/v1/models')).toHaveLength(2)
  })

  it('目录读取失败按可公开原因反馈并可重试', async () => {
    const user = userEvent.setup()
    let failing = true
    fetchMock.mockImplementation(async () =>
      failing
        ? errorResponse(503, 'STORAGE_UNAVAILABLE', '目录存储不可用，请检查初始化、版本或存储权限', {
            requestId: 'req-storage',
          })
        : jsonResponse(200, { models: [modelPayload()] }),
    )
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('目录存储不可用')
    expect(screen.getByText(/req-storage/)).toBeVisible()

    failing = false
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('逻辑回归 · 六字段')).toBeVisible()
  })

  it('成员凭据打开管理登记时权限不足的反馈可见，且不发起登记', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (path: string) =>
      path === '/api/v1/model-candidates'
        ? errorResponse(403, 'ACCESS_DENIED', '此操作需要管理员权限')
        : jsonResponse(200, { models: [modelPayload()] }),
    )
    renderPage()
    await screen.findByText('逻辑回归 · 六字段')
    await user.click(screen.getByRole('button', { name: '打开管理登记' }))
    expect(await screen.findByText('权限不足')).toBeVisible()
    expect(screen.getByText('此操作需要管理员权限')).toBeVisible()
    expect(paths()).not.toContain('/api/v1/models/register')
  })
})

describe('管理员校验登记', () => {
  async function openAdmin(candidates: unknown[], registerResponse: () => Response) {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/model-candidates') return jsonResponse(200, { candidates })
      if (path === '/api/v1/models/register') return registerResponse()
      return jsonResponse(200, { models: [modelPayload()] })
    })
    renderPage('admin-token')
    await screen.findByText('逻辑回归 · 六字段')
    await user.click(screen.getByRole('button', { name: '打开管理登记' }))
    await screen.findByRole('radio', { name: /baseline/ })
    return user
  }

  function registerCalls() {
    return fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/v1/models/register')
  }

  it('只提交所选候选的身份与清单校验值，201 反馈为新增', async () => {
    const user = await openAdmin([candidatePayload()], () => jsonResponse(201, { created: true, model: modelPayload() }))
    await user.click(screen.getByRole('radio', { name: /baseline/ }))
    await user.click(screen.getByRole('button', { name: '校验并登记所选候选' }))

    expect(await screen.findByText(/已新增登记：/)).toBeVisible()
    expect(registerCalls()).toHaveLength(1)
    const init = registerCalls()[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      candidateId: CANDIDATE_ID,
      expectedManifestSha256: MANIFEST_SHA,
    })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer admin-token')
  })

  it('200 反馈为复用，并指出本次沿用既有登记', async () => {
    const user = await openAdmin([candidatePayload()], () => jsonResponse(200, { created: false, model: modelPayload() }))
    await user.click(screen.getByRole('radio', { name: /baseline/ }))
    await user.click(screen.getByRole('button', { name: '校验并登记所选候选' }))
    expect(await screen.findByText(/该产物此前已登记，本次为复用：/)).toBeVisible()
  })

  it('失效候选不可选，并给出无法登记的原因', async () => {
    await openAdmin(
      [
        candidatePayload({
          state: 'invalid',
          manifestSha256: null,
          error: { code: 'ARTIFACT_INVALID', message: '运行声明或环境无效，请核验产物' },
        }),
      ],
      () => jsonResponse(201, { created: true, model: modelPayload() }),
    )
    const radio = screen.getByRole('radio', { name: /baseline/ })
    expect(radio).toBeDisabled()
    expect(screen.getByText(/运行声明或环境无效，请核验产物/)).toBeVisible()
    expect(screen.getByRole('button', { name: '校验并登记所选候选' })).toBeDisabled()
  })

  it('409 上下文变化后必须刷新候选并清空选择，不能自动带回新的校验值', async () => {
    const user = await openAdmin([candidatePayload()], () =>
      errorResponse(409, 'CONTEXT_MISMATCH', '候选或运行上下文发生变化，请重新选择', { requestId: 'req-409' }),
    )
    await user.click(screen.getByRole('radio', { name: /baseline/ }))
    await user.click(screen.getByRole('button', { name: '校验并登记所选候选' }))

    expect(await screen.findByText('需要修正输入或重新选择')).toBeVisible()
    expect(screen.getByText('候选或运行上下文发生变化，请重新选择')).toBeVisible()
    await waitFor(() =>
      expect(paths().filter((path) => path === '/api/v1/model-candidates').length).toBeGreaterThan(1),
    )
    // 只发过一次登记请求：冲突后没有带着新哈希自动重试。
    expect(registerCalls()).toHaveLength(1)
    expect(screen.getByRole('radio', { name: /baseline/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '校验并登记所选候选' })).toBeDisabled()
  })

  it('登记失败只发一次请求，不会自动重发', async () => {
    const user = await openAdmin([candidatePayload()], () =>
      errorResponse(503, 'INTEGRITY_ERROR', '运行文件校验不匹配，请核验并重新登记'),
    )
    await user.click(screen.getByRole('radio', { name: /baseline/ }))
    await user.click(screen.getByRole('button', { name: '校验并登记所选候选' }))
    expect(await screen.findByText('模型当前不可用')).toBeVisible()
    expect(registerCalls()).toHaveLength(1)
    expect(within(screen.getByRole('alert')).getByText(/运行文件校验不匹配/)).toBeVisible()
  })
})

describe('目录正文不符合约定时不展示模型卡', () => {
  it('schema 与模型身份不自洽时整体判为不可用', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { models: [modelPayload({ featureSchema: schemaPayload({ featureSchemaVersion: 'kamei14-v1' }) })] }),
    )
    renderPage()
    expect(await screen.findByText('返回内容不符合约定')).toBeVisible()
    expect(screen.queryByText('已登记 · 可用')).not.toBeInTheDocument()
  })
})
