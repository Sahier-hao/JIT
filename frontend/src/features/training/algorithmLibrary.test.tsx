import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AlgorithmLibraryDialog } from '@/features/training/components/AlgorithmLibraryDialog'
import type { MethodChoice } from '@/features/models/modelClient'

const METHOD: MethodChoice = {
  method: 'logistic-regression-l2-v1', name: '逻辑回归 · L2', label: '逻辑回归',
  category: 'classic', available: true, supportedSchema: true, reason: null, requires: [],
  detail: 'L2/C=1/lbfgs/max_iter=1000',
  preprocess: ['scale'],
  explanation: { method: 'occlusion-mean-v1', reason: null },
  guide: {
    summary: '线性基线，按特征加权后输出风险分。',
    strengths: ['训练快、稳定', '归因容易解释'],
    tradeoffs: ['难以自动表达复杂交互'],
    whenToUse: '先建立可比基线。',
    visual: {
      kind: 'linear', input: '提交特征', output: '风险分',
      stages: ['计数变换', '标准化', '特征加权', 'logistic 输出'],
    },
  },
  params: [{
    name: 'C', label: '正则强度倒数 C', description: '值越大限制越弱。',
    type: 'float', min: 0.01, max: 100, default: 1,
  }],
}

it('explains algorithms, training flow and parameter meaning', async () => {
  render(<AlgorithmLibraryDialog open onOpenChange={vi.fn()} methods={[METHOD]} schema="openapi-six-v1"/>)
  expect(screen.getByRole('heading', { name: '算法库' })).toBeVisible()
  expect(screen.getByText('线性基线，按特征加权后输出风险分。')).toBeVisible()
  expect(screen.getByText('先建立可比基线。')).toBeVisible()
  const user = userEvent.setup()
  await user.click(screen.getByText('参数与冻结声明'))
  expect(screen.getByText('正则强度倒数 C')).toBeVisible()
  expect(screen.getByText('值越大限制越弱。')).toBeVisible()
})
