/**
 * 新建预测（任务 4.1–4.4；MPW-05、MPW-06、MPW-07）。
 *
 * 覆盖：只有可用且支持六字段的模型可选、空值不当成 0、粘贴 JSON 原子填表、
 * 单次显式提交、在途禁用、422 定位字段、断线不得断言保存结果。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialProvider } from './credentials'
import { PredictPage } from './PredictPage'
import type { PredictionResult } from './predictionContract'
import {
  BATCH_ID,
  MODEL_ID,
  errorResponse,
  jsonResponse,
  modelPayload,
  predictionPayload,
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

/** 只读目录 + 可选 schema；预测请求由各用例自行决定。 */
function catalogOnly(models: unknown[]) {
  return async (path: string) => {
    if (path.startsWith('/api/v1/feature-schemas/')) return jsonResponse(200, schemaPayload())
    return jsonResponse(200, { models })
  }
}

function renderPage(
  handler: (path: string, init?: RequestInit) => Promise<Response>,
  token = 'member-token',
) {
  fetchMock.mockImplementation(handler)
  const onCreated = vi.fn<(result: PredictionResult) => void>()
  render(
    <CredentialProvider initialToken={token}>
      <PredictPage onCreated={onCreated} />
    </CredentialProvider>,
  )
  return onCreated
}

function predictionCalls() {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/v1/predictions')
}

async function selectModel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: /逻辑回归 · 六字段/ }))
}

// 六项数值用 change 一次性写入：这些用例验证的是取值、校验与提交正文，
// 不是逐键输入本身；userEvent 的逐键输入在并行 worker 下会把用例推到默认超时边缘。
function fillSix(values = ['4', '7', '12', '2.25', '120', '9']) {
  const names = ['涉及子系统数', '涉及目录数', '修改文件数', '分散程度', '增加行数', '删除行数']
  for (const [index, label] of names.entries()) {
    fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value: values[index] as string } })
  }
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/项目/), 'openstack')
  await user.type(screen.getByLabelText(/记录编号/), 'demo-0001')
  fillSix()
}

describe('范围与凭据', () => {
  it('没有凭据时不发请求', () => {
    renderPage(catalogOnly([modelPayload()]), '')
    expect(screen.getByText(/请在左侧输入团队访问凭据/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('只有可用且支持六字段的模型可选，其余如实分组说明', async () => {
    const user = userEvent.setup()
    renderPage(
      catalogOnly([
        modelPayload(),
        modelPayload({
          modelId: 'ffffffff-1111-4222-8333-444444444444',
          name: '决策树 · 六字段',
          method: 'decision-tree-v1',
        }),
        modelPayload({
          modelId: 'aaaaaaaa-1111-4222-8333-444444444444',
          name: '十二字段模型',
          featureSchemaVersion: 'kamei14-v1',
          jsonPredictionSupported: false,
          featureSchema: schemaPayload({ featureSchemaVersion: 'kamei14-v1', jsonPredictionSupported: false }),
        }),
        modelPayload({
          modelId: 'bbbbbbbb-1111-4222-8333-444444444444',
          name: '失效模型',
          state: 'invalid',
          error: { code: 'INTEGRITY_ERROR', message: '运行文件校验不匹配，请核验并重新登记' },
        }),
      ]),
    )
    expect(await screen.findByRole('radio', { name: /逻辑回归 · 六字段/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /决策树 · 六字段/ })).toBeEnabled()
    expect(screen.queryByRole('radio', { name: /十二字段模型/ })).not.toBeInTheDocument()
    await user.click(screen.getByText(/另有 2 个模型当前不可用于单条预测/))
    expect(screen.getByText(/不支持单条 JSON 预测/)).toBeVisible()
    expect(screen.getByText(/INTEGRITY_ERROR：运行文件校验不匹配/)).toBeVisible()
  })

  it('没有可选模型时给出指引，且不自动登记', async () => {
    renderPage(catalogOnly([]))
    expect(await screen.findByText('当前没有可用于单条预测的模型')).toBeVisible()
    expect(screen.getByRole('link', { name: '模型中心' })).toBeVisible()
    expect(predictionCalls()).toHaveLength(0)
  })
})

describe('表单校验', () => {
  it('未选模型时不能提交，空值不会被当成 0', async () => {
    const user = userEvent.setup()
    renderPage(catalogOnly([modelPayload()]))
    await screen.findByRole('radio', { name: /逻辑回归 · 六字段/ })
    expect(screen.getByRole('button', { name: '提交并保存预测' })).toBeDisabled()
    expect(screen.getByText('请先选择模型。')).toBeVisible()

    await selectModel(user)
    expect(screen.getByText('请先补全必填字段，空白不会被当成 0。')).toBeVisible()
    // 表单整体有效之前按钮一直禁用，不会因为点击而放行。
    expect(screen.getByRole('button', { name: '提交并保存预测' })).toBeDisabled()

    // 触碰过的字段才展示自己的校验信息：空白仍然是空白，不会被折成 0。
    await user.type(screen.getByLabelText(/涉及子系统数/), '1')
    await user.clear(screen.getByLabelText(/涉及子系统数/))
    expect(await screen.findByText('请填写ns · 涉及子系统数，空白不会按 0 处理')).toBeVisible()
    expect(screen.getByLabelText(/涉及子系统数/)).toHaveValue('')
    expect(predictionCalls()).toHaveLength(0)
  })

  it('计数必须是整数，小数与负数被拒绝', async () => {
    const user = userEvent.setup()
    renderPage(catalogOnly([modelPayload()]))
    await selectModel(user)
    await user.type(screen.getByLabelText(/涉及子系统数/), '2.5')
    expect(await screen.findByText(/只接受非负整数/)).toBeVisible()
  })

  it('提交 SHA 必须是 40 位十六进制，时间必须带时区', async () => {
    const user = userEvent.setup()
    renderPage(catalogOnly([modelPayload()]))
    await selectModel(user)
    await user.type(screen.getByLabelText(/提交 SHA/), 'abc')
    expect(await screen.findByText(/40 位十六进制/)).toBeVisible()

    await user.type(screen.getByLabelText(/提交时间/), '2026-01-02T03:04:05')
    expect(await screen.findByText(/必须是带时区的 ISO 时间/)).toBeVisible()
  })

  it('全部合法后提交按钮可用，并按契约组织请求正文', async () => {
    const user = userEvent.setup()
    renderPage(async (path) =>
      path === '/api/v1/predictions'
        ? jsonResponse(201, predictionPayload())
        : catalogOnly([modelPayload()])(path),
    )
    await selectModel(user)
    await fillRequired(user)
    fireEvent.change(screen.getByLabelText(/提交 SHA/), { target: { value: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678' } })
    fireEvent.change(screen.getByLabelText(/提交时间/), { target: { value: '2026-01-02T03:04:05+08:00' } })

    const button = screen.getByRole('button', { name: '提交并保存预测' })
    expect(button).toBeEnabled()
    await user.click(button)

    await waitFor(() => expect(predictionCalls()).toHaveLength(1))
    const init = predictionCalls()[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      modelId: MODEL_ID,
      featureSchemaVersion: 'openstack-six-v1',
      project: 'openstack',
      record: {
        recordId: 'demo-0001',
        features: { ns: 4, nd: 7, nf: 12, ent: 2.25, la: 120, ld: 9 },
        commitId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        time: '2026-01-02T03:04:05+08:00',
      },
    })
  })
})

describe('粘贴特征 JSON', () => {
  it('合法六项一次性填入，项目与记录编号保持不变', async () => {
    const user = userEvent.setup()
    renderPage(catalogOnly([modelPayload()]))
    await selectModel(user)
    await user.type(screen.getByLabelText(/项目/), 'openstack')
    await user.type(screen.getByLabelText(/记录编号/), 'demo-0001')

    fireEvent.change(screen.getByLabelText('特征 JSON'), {
      target: { value: '{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4}' },
    })
    await user.click(screen.getByRole('button', { name: '导入到表单' }))

    expect(await screen.findByText('已按粘贴的六项特征填入表单，其余字段保持不变。')).toBeVisible()
    expect(screen.getByLabelText(/涉及子系统数/)).toHaveValue('1')
    expect(screen.getByLabelText(/删除行数/)).toHaveValue('4')
    expect(screen.getByLabelText(/项目/)).toHaveValue('openstack')
    expect(predictionCalls()).toHaveLength(0)
  })

  it.each([
    ['{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10}', /缺少字段：ld/],
    ['{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4, "label": 1}', /未支持的字段：label/],
    ['{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": "4"}', /字段 ld 的值必须是数字/],
    ['{"ns": true, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4}', /字段 ns 的值必须是数字/],
    ['{"ns": 1, "ns": 2, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4}', /重复出现字段/],
    ['[1, 2, 3]', /必须是一个对象/],
    ['{"modelId": "x", "ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4}', /去掉请求包装字段：modelId/],
    ['{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": -4}', /字段 ld 不能是负数/],
    ['{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4', /不是合法 JSON/],
  ])('拒绝 %s', async (source, expected) => {
    const user = userEvent.setup()
    renderPage(catalogOnly([modelPayload()]))
    await selectModel(user)
    await user.type(screen.getByLabelText(/涉及子系统数/), '99')
    fireEvent.change(screen.getByLabelText('特征 JSON'), { target: { value: source } })
    await user.click(screen.getByRole('button', { name: '导入到表单' }))

    expect(await screen.findByText(expected)).toBeVisible()
    // 失败必须原子：草稿里原来的 99 没有被部分覆盖。
    expect(screen.getByLabelText(/涉及子系统数/)).toHaveValue('99')
    expect(screen.getByLabelText(/删除行数/)).toHaveValue('')
    expect(predictionCalls()).toHaveLength(0)
  })
})

describe('显式提交与错误反馈', () => {
  it('201 且正文与提交快照一致时进入结果页', async () => {
    const user = userEvent.setup()
    const onCreated = renderPage(async (path) =>
      path === '/api/v1/predictions'
        ? jsonResponse(201, predictionPayload())
        : catalogOnly([modelPayload()])(path),
    )
    await selectModel(user)
    await fillRequired(user)
    await user.type(screen.getByLabelText(/提交 SHA/), 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')
    await user.type(screen.getByLabelText(/提交时间/), '2026-10-15T18:00:00Z')
    await user.click(screen.getByRole('button', { name: '提交并保存预测' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(onCreated.mock.calls[0]?.[0].batchId).toBe(BATCH_ID)
  })

  it('201 正文与提交内容不一致时不进入结果页', async () => {
    const user = userEvent.setup()
    const onCreated = renderPage(async (path) =>
      path === '/api/v1/predictions'
        ? jsonResponse(201, predictionPayload({ records: [{ ...predictionPayload().records[0], features: { ns: 99, nd: 7, nf: 12, ent: 2.25, la: 120, ld: 9 } }] }))
        : catalogOnly([modelPayload()])(path),
    )
    await selectModel(user)
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: '提交并保存预测' }))

    expect(await screen.findByText('未能确认保存结果')).toBeVisible()
    expect(onCreated).not.toHaveBeenCalled()
    expect(predictionCalls()).toHaveLength(1)
  })

  it('在途时禁用提交，双击只发一次请求', async () => {
    const user = userEvent.setup()
    const gate = { release: () => {} }
    const pending = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    renderPage(async (path) => {
      if (path !== '/api/v1/predictions') return catalogOnly([modelPayload()])(path)
      await pending
      return jsonResponse(201, predictionPayload())
    })
    await selectModel(user)
    await fillRequired(user)
    const button = screen.getByRole('button', { name: '提交并保存预测' })
    await user.click(button)
    expect(await screen.findByRole('button', { name: '正在提交并保存…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '正在提交并保存…' }))
    gate.release()
    await waitFor(() => expect(predictionCalls()).toHaveLength(1))
  })

  it('422 把服务端字段原因贴回对应输入框', async () => {
    const user = userEvent.setup()
    renderPage(async (path) =>
      path === '/api/v1/predictions'
        ? errorResponse(422, 'INPUT_SCHEMA_MISMATCH', '输入与所选模型的 schema 不匹配或未支持', {
            details: [{ field: 'record.features.la', reason: '必须是非负整数' }],
          })
        : catalogOnly([modelPayload()])(path),
    )
    await selectModel(user)
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: '提交并保存预测' }))

    expect(await screen.findByText('需要修正输入或重新选择')).toBeVisible()
    // 同一条原因既出现在字段旁，也出现在失败汇总里。
    expect(document.getElementById('predict-error-la')).toHaveTextContent('必须是非负整数')
    expect(screen.getByLabelText(/增加行数/)).toHaveFocus()
    expect(screen.getByLabelText(/增加行数/)).toHaveAttribute('aria-invalid', 'true')
    expect(predictionCalls()).toHaveLength(1)
  })

  it('断线只提示未能确认保存结果，不展示任何风险', async () => {
    const user = userEvent.setup()
    const onCreated = renderPage(async (path) => {
      if (path !== '/api/v1/predictions') return catalogOnly([modelPayload()])(path)
      throw new TypeError('Failed to fetch')
    })
    await selectModel(user)
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: '提交并保存预测' }))

    expect(await screen.findByText('未能确认保存结果')).toBeVisible()
    expect(screen.getByText(/这不代表保存失败，也不代表成功/)).toBeVisible()
    expect(screen.getByRole('link', { name: '打开已有结果' })).toBeVisible()
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(predictionCalls()).toHaveLength(1)
  })

  it('503 模型不可用时只说明原因并可跳转模型中心', async () => {
    const user = userEvent.setup()
    renderPage(async (path) =>
      path === '/api/v1/predictions'
        ? errorResponse(503, 'MODEL_NOT_READY', '模型不可用，请由管理员重新校验登记')
        : catalogOnly([modelPayload()])(path),
    )
    await selectModel(user)
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: '提交并保存预测' }))

    expect(await screen.findByText('模型当前不可用')).toBeVisible()
    expect(screen.getByText('模型不可用，请由管理员重新校验登记')).toBeVisible()
    expect(predictionCalls()).toHaveLength(1)
  })
})

describe('schema 说明', () => {
  it('后端逐字段给出的重复变换与局限按值去重后才渲染', async () => {
    // 真实 /api/v1/feature-schemas 的 transforms 是「每个入模字段一条」，六个字段会给出多条 log1p。
    const perField = ['log1p', 'log1p', 'log1p', 'raw', 'log1p', 'log1p']
    renderPage(async (path) =>
      path.startsWith('/api/v1/feature-schemas/')
        ? jsonResponse(200, schemaPayload({ transforms: perField, limitations: ['同一原因', '同一原因'] }))
        : jsonResponse(200, { models: [modelPayload()] }),
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: /逻辑回归 · 六字段/ }))
    await waitFor(() => expect(document.querySelector('.schema-list')).not.toBeNull())
    const lists = document.querySelectorAll('.schema-list')
    const texts = (index: number) =>
      Array.from(lists[index]?.querySelectorAll('li') ?? []).map((item) => item.textContent)
    expect(texts(0)).toEqual(['log1p', 'raw'])
    expect(texts(1)).toEqual(['同一原因'])
  })
})
