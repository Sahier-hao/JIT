import { expect, it } from 'vitest'
import { parseLineReviewEvidence, type LineEvidenceContext } from '@/features/research/lineEvidence'

const CONTEXT: LineEvidenceContext = {
  sourceKind: 'pr-snapshot',
  resourceId: 'snapshot-1',
  repositoryId: 'repository-1',
  commitId: 'a'.repeat(40),
  path: 'src/value.ts',
  side: 'head',
}

function evidence() {
  return {
    schema: 'line-review-evidence-v1',
    status: 'supported',
    reason: null,
    sourceKind: 'pr-snapshot',
    resourceId: 'snapshot-1',
    repositoryId: 'repository-1',
    commitId: 'a'.repeat(40),
    ref: 'a'.repeat(40),
    path: 'src/value.ts',
    side: 'head',
    language: 'typescript',
    coverage: { patchComplete: true, status: 'supported', addedLines: 2, eligibleLines: 2, skippedBlank: 0,
      textSource: 'patch', usesFullFile: false },
    explanationMethod: 'linear-logodds-line-v1',
    explanationUnit: 'logit',
    contributionCaveat: '行级特征贡献，不是缺陷原因。',
    artifactSha256: 'b'.repeat(64),
    intercept: -1,
    lines: [
      {
        rank: 1, path: 'src/value.ts', side: 'head', line: 12, text: 'return value',
        score: .8, logit: 1.386, languageContribution: .2,
        contributions: [
          { feature: 'lineLength', label: '行长', value: 12, weight: 2, contribution: 24, direction: 'increases' },
          { feature: 'return', label: 'return 语句', value: 1, weight: -1.4, contribution: -1.4, direction: 'decreases' },
        ],
        contributionTotal: 22.6, otherContribution: 22.6,
      },
      {
        rank: 2, path: 'src/value.ts', side: 'head', line: 3, text: 'const value = 1',
        score: .4, logit: -.405, languageContribution: .2,
        contributions: [],
        contributionTotal: 0, otherContribution: 0,
      },
    ],
    caveats: ['研究预览，不是缺陷概率。'],
  }
}

it('accepts logit contributions outside [-1,1] and binds immutable identity', () => {
  const parsed = parseLineReviewEvidence(evidence(), CONTEXT)
  expect(parsed.lines[0].contributions[0].contribution).toBe(24)
  expect(parsed.explanationUnit).toBe('logit')
  expect(parsed.lines.map(row => row.line)).toEqual([12, 3])
})

it('rejects mismatched identity, ordering and malformed contributions', () => {
  expect(() => parseLineReviewEvidence({ ...evidence(), commitId: 'c'.repeat(40) }, CONTEXT)).toThrow()
  const descending = evidence()
  descending.lines[0].score = .2
  expect(() => parseLineReviewEvidence(descending, CONTEXT)).toThrow()
  const direction = evidence()
  direction.lines[0].contributions[0].direction = 'decreases'
  expect(() => parseLineReviewEvidence(direction, CONTEXT)).toThrow()
})

it('requires unsupported evidence to have no rows', () => {
  const unsupported = {
    ...evidence(),
    status: 'unsupported-language',
    reason: 'unsupported-language',
    language: null,
    artifactSha256: null,
    intercept: null,
    lines: [],
  }
  expect(parseLineReviewEvidence(unsupported, CONTEXT).status).toBe('unsupported-language')
  expect(() => parseLineReviewEvidence({ ...unsupported, lines: evidence().lines }, CONTEXT)).toThrow()
})
