import { render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AlgorithmLibraryPage } from '@/features/training/pages/AlgorithmLibraryPage'
import type { MethodChoice } from '@/features/models/modelClient'

afterEach(() => vi.restoreAllMocks())

const DEFINITIONS: [string, string, 'classic' | 'deep', string][] = [
  ['logistic-regression-l2-v1', '逻辑回归 · L2', 'classic', 'linear'],
  ['decision-tree-v1', '决策树 · CART', 'classic', 'tree'],
  ['random-forest-v1', '随机森林 · 200 棵 CART', 'classic', 'forest'],
  ['gaussian-naive-bayes-v1', '高斯朴素贝叶斯', 'classic', 'probabilistic'],
  ['gradient-boosting-v1', '梯度提升树 · 200 棵小树', 'classic', 'boosting'],
  ['mlp-v1', '多层感知机', 'deep', 'mlp'],
  ['tabular-resnet-v1', '表格残差网络', 'deep', 'resnet'],
  ['ft-transformer-v1', '特征 token Transformer', 'deep', 'transformer'],
  ['wide-deep-v1', '宽深双塔', 'deep', 'wide-deep'],
]

function method([id, name, category, kind]: typeof DEFINITIONS[number], index: number): MethodChoice {
  return {
    method: id, name, label: name, category, available: id !== 'tabular-resnet-v1',
    supportedSchema: true, reason: id === 'tabular-resnet-v1' ? '缺少依赖：torch' : null,
    requires: category === 'deep' ? ['torch'] : [], detail: '冻结训练参数',
    preprocess: category === 'deep' ? ['scale'] : [],
    explanation: { method: 'occlusion-mean-v1', reason: null },
    guide: {
      summary: `${name} 的结构说明。`, strengths: ['结构清楚'], tradeoffs: ['需要验证'],
      whenToUse: '用于算法对照。',
      visual: {
        kind, input: '提交特征', output: '风险分',
        stages: ['输入处理', '模型计算', '风险输出'],
      },
    },
    params: index === 0 ? [{
      name: 'C', label: '正则强度倒数 C', description: '值越大限制越弱。',
      type: 'float', min: 0.01, max: 100, default: 1,
    }] : [],
  }
}

it('browses visual algorithm structures and method details', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/training-methods')) return Response.json({
      schema: 'kamei14-git-v2',
      methods: DEFINITIONS.map(method),
    })
    return Response.json({})
  })
  render(<AlgorithmLibraryPage onLoginRequired={vi.fn()}/>)

  expect(await screen.findByRole('heading', { name: '算法库', level: 1 })).toBeVisible()
  expect(await screen.findByText('9 个方法')).toBeVisible()
  expect(screen.getByRole('img', { name: /逻辑回归 · L2 算法结构图/ })).toBeVisible()
  expect(screen.getByText('正则强度倒数 C')).toBeVisible()

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /决策树 · CART/ }))
  expect(screen.getByRole('img', { name: /决策树 · CART 算法结构图/ })).toBeVisible()

  await user.click(screen.getByRole('radio', { name: /深度 4/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /逻辑回归 · L2/ })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /表格残差网络/ }))
  expect(screen.getByRole('img', { name: /表格残差网络 算法结构图/ })).toBeVisible()
  expect(screen.getByText('缺少依赖：torch')).toBeVisible()
  expect(screen.getByText('特征标准化')).toBeVisible()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('opens the method named by the address and hands it to training', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/training-methods')) return Response.json({
      schema: 'kamei14-git-v2',
      methods: DEFINITIONS.map(method),
    })
    return Response.json({})
  })
  const navigate = vi.fn()
  render(<AlgorithmLibraryPage method="random-forest-v1" navigate={navigate} onLoginRequired={vi.fn()}/>)

  expect(await screen.findByRole('heading', { name: '随机森林 · 200 棵 CART', level: 2 })).toBeVisible()
  expect(screen.getByRole('img', { name: /随机森林 · 200 棵 CART 算法结构图/ })).toBeVisible()

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '以此方法训练' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-training', method: 'random-forest-v1' })

  await user.click(screen.getByRole('button', { name: /决策树 · CART/ }))
  expect(navigate).toHaveBeenCalledWith({ name: 'algorithms', method: 'decision-tree-v1' })
})

it('focuses the selected method parameter region and falls back for unknown methods', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/training-methods')) return Response.json({
      schema: 'kamei14-git-v2',
      methods: DEFINITIONS.map(method),
    })
    return Response.json({})
  })
  const view = render(<AlgorithmLibraryPage method="logistic-regression-l2-v1"
    onLoginRequired={vi.fn()}/>)

  const region = await screen.findByRole('region', { name: '可配置参数' })
  await waitFor(() => expect(region).toHaveFocus())
  expect(region).toHaveAttribute('tabindex', '-1')

  view.rerender(<AlgorithmLibraryPage method="missing-method" onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '逻辑回归 · L2', level: 2 })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps an unavailable method from starting a training', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/training-methods')) return Response.json({
      schema: 'kamei14-git-v2',
      methods: DEFINITIONS.map(method),
    })
    return Response.json({})
  })
  render(<AlgorithmLibraryPage method="tabular-resnet-v1" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)

  expect(await screen.findByRole('heading', { name: '表格残差网络', level: 2 })).toBeVisible()
  expect(screen.queryByRole('button', { name: '以此方法训练' })).not.toBeInTheDocument()
})
