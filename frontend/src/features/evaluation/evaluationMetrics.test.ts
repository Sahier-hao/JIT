import { expect, it } from 'vitest'
import { evaluationPoint } from './evaluationMetrics'

function preview() {
  const truePositives = Array.from({ length: 101 }, (_, tick) => tick <= 70 ? 1 : 0)
  const falsePositives = Array.from({ length: 101 }, (_, tick) => tick <= 80 ? 1 : 0)
  return { positives: 2, negatives: 2, truePositives, falsePositives }
}

it('calculates hand-checkable threshold metrics', () => {
  expect(evaluationPoint(preview(), 70)).toEqual({
    threshold: .7,
    alerts: 2,
    hits: 1,
    falseAlarms: 1,
    missed: 1,
    precision: .5,
    recall: .5,
    f1: .5,
  })
})

it('returns null ratios instead of zero when a denominator is absent', () => {
  const empty = {
    positives: 0,
    negatives: 1,
    truePositives: Array(101).fill(0),
    falsePositives: Array(101).fill(0),
  }
  expect(evaluationPoint(empty, 50)).toMatchObject({
    alerts: 0,
    missed: 0,
    precision: null,
    recall: null,
    f1: null,
  })
})
