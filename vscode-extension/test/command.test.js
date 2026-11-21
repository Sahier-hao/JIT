const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildAnalyzeCommand } = require('../out/command.js')

test('builds a copyable report command with all real inputs', () => {
  const command = buildAnalyzeCommand({
    backend: 'D:/repo/backend',
    python: 'python',
    repo: 'D:/repo',
    base: 'HEAD~3',
    head: 'HEAD',
    modelId: '11111111-1111-4111-8111-111111111111',
    database: 'D:/repo/backend/storage/catalog.sqlite3',
    artifactRoot: 'D:/repo/backend/artifacts',
    output: 'D:/repo/jit-report.json',
  })
  assert.match(command, /pr-check-analyze/)
  assert.match(command, /--model-id "11111111-1111-4111-8111-111111111111"/)
  assert.match(command, /--output "D:\/repo\/jit-report.json"/)
})

test('rejects missing or multiline inputs', () => {
  const options = {
    backend: 'backend', python: 'python', repo: 'repo', base: 'HEAD~1', head: 'HEAD',
    modelId: '', database: 'db', artifactRoot: 'artifacts', output: 'report.json',
  }
  assert.throws(() => buildAnalyzeCommand(options), /不能为空/)
  assert.throws(() => buildAnalyzeCommand({ ...options, modelId: 'm\nrm -rf' }), /换行/)
})
