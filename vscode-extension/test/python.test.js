const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolvePython } = require('../out/python.js')

test('uses a configured interpreter that runs', () => {
  const result = resolvePython('D:/no-such-backend', process.execPath)
  assert.equal(result.command, process.execPath)
  assert.deepEqual(result.args, [])
})

test('does not return a missing configured interpreter', () => {
  const result = resolvePython('D:/no-such-backend', 'D:/no-such-python.exe')
  assert.notEqual(result?.command, 'D:/no-such-python.exe')
})
