import { expect, it } from 'vitest'
import type { LineScore } from '@/features/research/lineResearch'
import { addedHeadLines, lineRiskLanguage, rankChangedLineScores } from '@/features/reviews/lineRisk'

function line(line: number, score: number): LineScore {
  return {
    rank: 0,
    line,
    text: `line-${line}`,
    score,
    logit: null,
    contributions: [],
    contributionTotal: null,
    otherContribution: null,
  }
}

it('recognizes only JavaScript and TypeScript files', () => {
  expect(lineRiskLanguage('src/app.ts')).toBe('typescript')
  expect(lineRiskLanguage('src/app.tsx')).toBe('typescript')
  expect(lineRiskLanguage('src/app.jsx')).toBe('javascript')
  expect(lineRiskLanguage('src/app.mjs')).toBe('javascript')
  expect(lineRiskLanguage('src/review.py')).toBeNull()
})

it('takes only added or modified target-side lines and ignores file headers', () => {
  expect(addedHeadLines('@@ -1,2 +1,3 @@\n old\n+new\n+newer\n-older')).toEqual([2, 3])
  expect(addedHeadLines('@@ -1 +1 @@\n-old\n+new')).toEqual([1])
  expect(addedHeadLines('+++ b/src/app.ts\n@@ -0,0 +1 @@\n+new')).toEqual([1])
  expect(addedHeadLines(null)).toEqual([])
})

it('ranks only changed lines and keeps the highest scores', () => {
  const rows = rankChangedLineScores(
    [line(1, 0.1), line(2, 0.8), line(3, 0.4), line(4, 0.9)],
    new Set([2, 3, 4]),
    2,
  )
  expect(rows.map(row => row.line)).toEqual([4, 2])
})
