/**
 * 预测结果与按编号重开（任务 5.1、5.2；MPW-08、MPW-09）。
 *
 * 覆盖：单条记录的风险与原始输入、完整来源展示、结果链接只含批次身份、
 * 按编号重开是只读 GET（不重新预测、不依赖目录、不要求模型现在可用）、非法编号不发请求。
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialProvider } from './credentials'
import { PredictionsPage } from './PredictionsPage'
import { parseCreatedPrediction } from './predictionContract'
import {
  BATCH_ID,
  COMMIT_ID,
  INPUT_SHA,
  MODEL_ID,
  MODEL_SHA,
  PREDICTION_ID,
  RUN_ID,
  SIX_VALUES,
  errorResponse,
  explainedRecord,
  jsonResponse,
  predictionPayload,
} from './testFixtures'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const submission = {
  modelId: MODEL_ID,
  project: 'openstack',
  recordId: 'demo-0001',
  features: { ...SIX_VALUES },
  commitId: COMMIT_ID,
  time: '2026-10-15T18:00:00Z',
}

function createdResult() {
  return parseCreatedPrediction(predictionPayload(), submission)
}

function renderPage(options: { batchId?: string | null; snapshot?: ReturnType<typeof createdResult> | null; token?: string } = {}) {
  const { batchId = null, snapshot = null, token = 'member-token' } = options
  return render(
    <CredentialProvider initialToken={token}>
      <PredictionsPage navigate={() => {}} batchId={batchId} snapshot={snapshot} />
    </CredentialProvider>,
  )
}

function paths() {
  return fetchMock.mock.calls.map((call) => String(call[0]))
}

// 侧栏导航里也有一个同名按钮「打开已有结果」，查询表单必须限定在表单内。
function lookupForm(): HTMLElement {
  return screen.getByLabelText('批次编号').closest('form') as HTMLElement
}

function lookupButton(): HTMLElement {
  return within(lookupForm()).getByRole('button', { name: '打开已有结果' })
}

describe('刚创建完成的结果快照', () => {
  it('展示风险、六项原始输入与完整来源，且不发起任何请求', () => {
    renderPage({ batchId: BATCH_ID, snapshot: createdResult() })

    expect(screen.getByText('用户提供特征 · 模型估计')).toBeVisible()
    expect(screen.getByText('11.6%')).toBeVisible()
    expect(screen.getByText('openstack')).toBeVisible()
    expect(screen.getAllByText('demo-0001').length).toBeGreaterThan(0)
    expect(screen.getByText(COMMIT_ID)).toBeVisible()
    for (const [name, value] of Object.entries(SIX_VALUES)) {
      expect(screen.getByText(name)).toBeVisible()
      expect(screen.getByText(String(value))).toBeVisible()
    }
    expect(screen.getByText(BATCH_ID)).toBeVisible()
    expect(screen.getByText(PREDICTION_ID)).toBeVisible()
    expect(screen.getByText(MODEL_ID)).toBeVisible()
    expect(screen.getByText(RUN_ID)).toBeVisible()
    expect(screen.getByText(MODEL_SHA)).toBeVisible()
    expect(screen.getByText(INPUT_SHA)).toBeVisible()
    expect(screen.getByText(/预测解释未支持：该模型的真实预测解释尚未接入/)).toBeVisible()
    expect(screen.getByText('原始特征由调用方提供，尚未核验源码提取或真实标签。')).toBeVisible()
    // 快照来自创建响应，不需要再读一次。
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('已支持的归因逐项展示特征、输入值、训练均值与方向', () => {
    renderPage({
      batchId: BATCH_ID,
      snapshot: parseCreatedPrediction(predictionPayload({ records: [explainedRecord()] }), submission),
    })

    expect(screen.getByText('occlusion-mean-v1', { exact: false })).toBeVisible()
    expect(screen.getByText('本次预测风险为 11.6%，影响最大的是 ns（拉低 0.052）。')).toBeVisible()
    const table = screen.getByRole('table')
    expect(within(table).getByText('ns')).toBeVisible()
    expect(within(table).getByText('2.400')).toBeVisible()
    expect(within(table).getByText('0.052', { exact: false })).toBeVisible()
    expect(within(table).getByText('0.031', { exact: false })).toBeVisible()
    expect(within(table).getByText('推高', { exact: false })).toBeVisible()
    expect(within(table).getByText('拉低', { exact: false })).toBeVisible()
    // 支持时不再出现未支持原因。
    expect(screen.queryByText(/预测解释未支持/)).toBeNull()
  })

  it('结果链接只含批次身份，可手动复制', async () => {
    const user = userEvent.setup()
    renderPage({ batchId: BATCH_ID, snapshot: createdResult() })
    const link = screen.getByLabelText('结果链接')
    expect(link).toHaveValue(`${window.location.origin}${window.location.pathname}#/predictions/${BATCH_ID}`)
    expect(link).toHaveAttribute('readonly')

    // 剪贴板不可用时如实提示手动复制；可用时提示已复制。两种都不能谎称成功。
    await user.click(screen.getByRole('button', { name: '复制结果链接' }))
    expect(
      await screen.findByText(/当前浏览器不允许自动复制|结果链接已复制到剪贴板。/),
    ).toBeVisible()
  })

  it('剪贴板不可用时如实提示手动复制，不谎称已复制', async () => {
    const user = userEvent.setup()
    // userEvent.setup() 会注入剪贴板桩，这里显式移除，走真实的失败分支。
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderPage({ batchId: BATCH_ID, snapshot: createdResult() })
    await user.click(screen.getByRole('button', { name: '复制结果链接' }))
    expect(await screen.findByText(/当前浏览器不允许自动复制/)).toBeVisible()
    // 链接本身仍可手动选中复制。
    expect(screen.getByLabelText('结果链接')).toHaveValue(
      `${window.location.origin}${window.location.pathname}#/predictions/${BATCH_ID}`,
    )
  })

  it('剪贴板可用时提示已复制', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderPage({ batchId: BATCH_ID, snapshot: createdResult() })
    await user.click(screen.getByRole('button', { name: '复制结果链接' }))
    expect(await screen.findByText('结果链接已复制到剪贴板。')).toBeVisible()
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}#/predictions/${BATCH_ID}`,
    )
  })
})

describe('按编号重开', () => {
  it('只用一次只读 GET，且不读取模型目录、不重新预测', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, predictionPayload()))
    renderPage({ batchId: BATCH_ID })

    expect(await screen.findByText('11.6%')).toBeVisible()
    expect(paths()).toEqual([`/api/v1/prediction-batches/${BATCH_ID}`])
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('GET')
    expect(screen.getByText(/本页直接按批次编号读取结果，没有重新预测/)).toBeVisible()
  })

  it('即使该模型现在不可用、目录也读不到，历史结果仍然照常展示', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        200,
        predictionPayload({
          model: predictionPayload().model && {
            ...(predictionPayload().model as Record<string, unknown>),
            state: 'invalid',
            error: { code: 'INTEGRITY_ERROR', message: '运行文件校验不匹配，请核验并重新登记' },
          },
        }),
      ),
    )
    renderPage({ batchId: BATCH_ID })
    expect(await screen.findByText('11.6%')).toBeVisible()
    // 结果正文里的模型来源被冻结保存，只读重开不因目录状态而失败。
    expect(paths().every((path) => path.startsWith('/api/v1/prediction-batches/'))).toBe(true)
  })

  it('没有凭据时不发请求', () => {
    renderPage({ batchId: BATCH_ID, token: '' })
    expect(screen.getByText(/请在左侧输入团队访问凭据/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('地址里的编号不是 UUID 时不发请求并说明原因', () => {
    renderPage({ batchId: 'not-a-uuid' })
    expect(screen.getByText('批次编号无效')).toBeVisible()
    expect(screen.getByText(/没有发出任何请求/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('编号不存在时给出结果不存在与重新输入入口', async () => {
    fetchMock.mockImplementation(async () => errorResponse(404, 'NOT_FOUND', '指定资源不存在'))
    renderPage({ batchId: BATCH_ID })
    expect(await screen.findByText('没有找到该资源')).toBeVisible()
    expect(screen.getByText('指定资源不存在')).toBeVisible()
    expect(lookupButton()).toBeVisible()
    expect(paths()).toHaveLength(1)
  })

  it('存储不可用时按可公开原因反馈并可重试', async () => {
    const user = userEvent.setup()
    let failing = true
    fetchMock.mockImplementation(async () =>
      failing
        ? errorResponse(503, 'STORAGE_UNAVAILABLE', '目录存储不可用，请检查初始化、版本或存储权限')
        : jsonResponse(200, predictionPayload()),
    )
    renderPage({ batchId: BATCH_ID })
    expect(await screen.findByText('目录存储不可用')).toBeVisible()

    failing = false
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('11.6%')).toBeVisible()
  })
})

describe('手动输入批次编号', () => {
  it('未输入任何编号时不请求，非法编号只提示不请求', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('heading', { name: '打开已有结果' })).toBeVisible()
    expect(screen.getByText(/不提供全量历史预测列表/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('批次编号'), '123')
    await user.click(lookupButton())
    expect(await screen.findByText(/批次编号必须是标准的 UUID/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('合法编号交给路由，由结果页发起读取', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()
    render(
      <CredentialProvider initialToken="member-token">
        <PredictionsPage
          navigate={navigate}
          batchId={null}
          snapshot={null}
        />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('批次编号'), BATCH_ID.toUpperCase())
    await user.click(lookupButton())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'result', batchId: BATCH_ID }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
