import { render, screen } from '../test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelEvaluationEvidence } from './ModelEvaluationEvidence'
import { response } from '../projectActivity.fixture'

afterEach(() => vi.restoreAllMocks())

const MATRIX = {
  evidenceId: 'a'.repeat(24), kind: 'evaluation-matrix', status: 'available', reason: null,
  source: '2026-11-11-python.json', sha256: 'b'.repeat(64),
  generatedUtc: '2026-11-11T04:00:00Z',
  summary: {
    datasets: 3, withinRepoCells: 24, leaveOneRepoOutCells: 24, failures: 1,
    languages: ['python'], methods: ['logistic-regression-l2-v1'], schemas: ['kamei14-git-v2'],
  },
}
const OTHER_METHOD = {
  ...MATRIX, evidenceId: 'c'.repeat(24), source: '2026-11-11-javascript.json',
  summary: { ...MATRIX.summary, languages: ['javascript'], methods: ['random-forest-v1'] },
}
const LINE = {
  evidenceId: 'd'.repeat(24), kind: 'line-candidate-evaluation', status: 'stale',
  reason: 'kamei14-git-v2-flask-mature 未登记', source: 'evaluation-python.json',
  sha256: 'e'.repeat(64), generatedUtc: '2026-11-11T05:00:00Z',
  summary: { repos: 2, candidates: 57910, positives: 2254, scorers: ['structure-v1'] },
}

it('shows method-matched cross-repository evidence and line coverage', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/api/admin/evaluation-evidence')) {
      return response({ evidence: [MATRIX, OTHER_METHOD, LINE], total: 3 })
    }
    return response({})
  })
  render(<ModelEvaluationEvidence method="logistic-regression-l2-v1" expired={vi.fn()}/>)
  expect(await screen.findByText('跨仓库 / 时间外评价')).toBeVisible()
  expect(screen.getByText(/python · 时间外 24 格 · 留一仓库 24 格/)).toBeVisible()
  expect(screen.getByText('完整候选集定位')).toBeVisible()
  expect(screen.getByText(/候选 57,910 行 · 正例 2,254/)).toBeVisible()
  expect(screen.getByText(/未登记/)).toBeVisible()
  expect(screen.queryByText(/javascript/)).toBeNull()
  expect(screen.getByText(/不绑定当前模型产物/)).toBeVisible()
})

it('states when no evidence matches the model method', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/api/admin/evaluation-evidence')) {
      return response({ evidence: [OTHER_METHOD], total: 1 })
    }
    return response({})
  })
  render(<ModelEvaluationEvidence method="logistic-regression-l2-v1" expired={vi.fn()}/>)
  expect(await screen.findByText(/没有与该模型方法匹配的跨仓库评价/)).toBeVisible()
})
