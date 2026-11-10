const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseReport, identity, validLine } = require('../out/report.js')

function report(overrides = {}) {
  return {
    format: 'jit-commit-analysis-v1',
    analysisId: 'abc', contentSha256: 'def',
    repository: { path: 'D:/repo', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), commitsInRange: 1 },
    model: { modelId: 'm', name: '模型', runId: 'r', method: 'logistic-regression-l2-v1', featureSchema: 'kamei14-git-v2' },
    coverage: { commitsTotal: 1, commitsScored: 1, candidateFiles: 1, candidates: [], candidatesSkipped: [] },
    commits: [{ commitId: 'b'.repeat(40), risk: 0.42, subject: 'fix', authorName: 'a', time: 't',
      addedLines: 2, deletedLines: 1, files: 1, filePaths: ['src/app.py'] }],
    candidates: [{ side: 'head', path: 'src/app.py', line: 3, ruleId: 'py-bare-except', ruleVersion: '1',
      message: '裸 except', evidence: 'except:', suggestion: { title: '指明异常', rationale: '理由', manualChecks: ['确认'] } }],
    limitations: ['不是缺陷概率'],
    ...overrides,
  }
}

test('parses a supported report and keeps suggestion text as data', () => {
  const parsed = parseReport(report())
  assert.equal(parsed.commits.length, 1)
  assert.equal(parsed.commits[0].filePaths[0], 'src/app.py')
  assert.equal(parsed.candidates[0].suggestion.title, '指明异常')
})

test('rejects wrong format and missing identity', () => {
  assert.throws(() => parseReport({ format: 'other' }), /受支持/)
  assert.throws(() => parseReport(report({ repository: {} })), /repository/)
})

test('rejects absolute or traversing candidate paths', () => {
  const base = report()
  for (const path of ['/etc/passwd', 'C:/Windows/system32', '../outside.py']) {
    const candidate = { ...base.candidates[0], path }
    assert.throws(() => parseReport(report({ candidates: [candidate] })), /路径/)
  }
})

test('identity distinguishes match, stale and unknown', () => {
  const parsed = parseReport(report())
  assert.equal(identity(parsed, 'b'.repeat(40)).state, 'match')
  assert.equal(identity(parsed, 'c'.repeat(40)).state, 'stale')
  assert.match(identity(parsed, 'c'.repeat(40)).message, /不在当前代码上标注/)
  assert.equal(identity(parsed, null).state, 'unknown')
  assert.equal(identity(parsed, 'b'.repeat(40), true).state, 'dirty')
  assert.match(identity(parsed, 'b'.repeat(40), true).message, /未提交改动/)
})

test('line numbers must stay inside the document', () => {
  assert.equal(validLine('a\nb\nc', 3), true)
  assert.equal(validLine('a\nb\nc', 4), false)
  assert.equal(validLine('a', 0), false)
})
