const { test } = require('node:test')
const assert = require('node:assert/strict')
const { modelChoices, parseModelList, parseModelListOutput } = require('../out/models.js')

function payload() {
  return {
    format: 'jit-pr-check-models-v1',
    models: [
      {
        modelId: 'model-a', name: '逻辑回归', method: 'logistic-regression-l2-v1',
        featureSchema: 'kamei14-git-v2', isDefault: true, runId: 'run-a',
      },
      {
        modelId: 'model-b', name: '随机森林', method: 'random-forest-v1',
        featureSchema: 'kamei14-git-v1', isDefault: false, runId: 'run-b',
      },
    ],
  }
}

test('parses only the declared CLI model list contract', () => {
  const models = parseModelList(payload())
  assert.equal(models.length, 2)
  assert.equal(models[0].modelId, 'model-a')
  assert.equal(models[0].featureSchema, 'kamei14-git-v2')
  assert.throws(() => parseModelList({ ...payload(), format: 'other' }), /受支持/)
  assert.throws(() => parseModelListOutput('{bad'), /有效 JSON/)
})

test('rejects duplicate model IDs and incomplete identity', () => {
  const duplicate = payload()
  duplicate.models[1].modelId = duplicate.models[0].modelId
  assert.throws(() => parseModelList(duplicate), /重复/)
  const missingRun = payload()
  missingRun.models[0].runId = ''
  assert.throws(() => parseModelList(missingRun), /runId/)
})

test('builds visible default and current markers without inventing models', () => {
  const choices = modelChoices(parseModelList(payload()), 'model-a')
  assert.match(choices[0].label, /默认/)
  assert.match(choices[0].label, /当前/)
  assert.match(choices[0].description, /logistic-regression-l2-v1/)
  assert.match(choices[0].detail, /model-a/)
  assert.equal(choices.length, 2)
})
