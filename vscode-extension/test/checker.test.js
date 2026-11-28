const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildAnalyzeArgs } = require('../out/command.js')
const { candidateEntries, formatRisk, summarize } = require('../out/checker.js')
const { parseReport } = require('../out/report.js')
const fixture = require('../scripts/fixtures/sample-report.json')

const options = {
  backend: 'D:/repo/backend',
  python: 'python',
  repo: 'D:/repo',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  modelId: '11111111-1111-4111-8111-111111111111',
  database: 'D:/repo/backend/storage/catalog.sqlite3',
  artifactRoot: 'D:/repo/backend/artifacts',
  output: 'D:/repo/report.json',
}

test('builds execFile arguments without shell quoting', () => {
  const args = buildAnalyzeArgs(options)
  assert.deepEqual(args.slice(0, 3), ['-m', 'jit_baseline.cli', 'pr-check-analyze'])
  assert.equal(args[args.indexOf('--model-id') + 1], options.modelId)
  assert.equal(args[args.indexOf('--base') + 1], options.base)
  assert.ok(!args.some(arg => arg.includes('"')))
})

test('rejects an empty model before running the backend', () => {
  assert.throws(() => buildAnalyzeArgs({ ...options, modelId: '' }), /模型 ID不能为空/)
})

test('summarizes the highest scored commit and counts candidates', () => {
  const report = parseReport(fixture)
  const summary = summarize(report)
  assert.equal(summary.commits, 1)
  assert.equal(summary.candidates, 2)
  assert.equal(summary.commitId, fixture.commits[0].commitId)
  assert.ok(Math.abs(summary.risk - fixture.commits[0].risk) < 1e-12)
})

test('treats a merge-only range as unscored', () => {
  const summary = summarize(parseReport({ ...fixture, commits: [] }))
  assert.equal(summary.risk, null)
  assert.equal(summary.commitId, null)
  assert.equal(formatRisk(null), '未评分')
})

test('builds problem entries with rule, message and suggestion', () => {
  const entries = candidateEntries(parseReport(fixture))
  assert.equal(entries.length, 2)
  const bare = entries.find(entry => entry.ruleId === 'py-bare-except')
  assert.equal(bare.path, 'app.py')
  assert.equal(bare.line, 4)
  assert.match(bare.message, /py-bare-except/)
  assert.match(bare.message, /裸 except/)
  assert.match(bare.message, /命中证据：except:/)
  assert.match(bare.message, /建议：指明需要捕获的异常类型/)
})

test('drops candidates without a usable line number', () => {
  const candidate = { ...fixture.candidates[0], line: 0 }
  const entries = candidateEntries(parseReport({ ...fixture, candidates: [candidate] }))
  assert.equal(entries.length, 0)
})

test('formats risk to two decimals', () => {
  assert.equal(formatRisk(0.6543), '0.65')
  assert.equal(formatRisk(0), '0.00')
})
