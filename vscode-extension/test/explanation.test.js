const { test } = require('node:test')
const assert = require('node:assert/strict')
const { explanationMarkdown, featureLabel, localizeExplanationSummary } = require('../out/explanation.js')

function report(explanation) {
  return {
    format: 'jit-commit-analysis-v1',
    analysisId: 'a', contentSha256: 'b',
    repository: { path: 'repo', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), commitsInRange: 1 },
    model: {
      modelId: 'model-a', name: '逻辑回归', runId: 'run-a',
      method: 'logistic-regression-l2-v1', featureSchema: 'kamei14-git-v2',
    },
    coverage: { commitsTotal: 1, commitsScored: 1, candidateFiles: 0 },
    commits: [{
      commitId: 'b'.repeat(40), risk: 0.4231, subject: 'fix', authorName: 'a', time: 't',
      addedLines: 1, deletedLines: 0, files: 1, filePaths: ['app.py'], explanation,
    }],
    candidates: [],
    limitations: [],
  }
}

test('localizes known feature names and preserves unknown text', () => {
  assert.equal(featureLabel('la'), '新增行数')
  assert.equal(localizeExplanationSummary('la 推高，foo 不变'), '新增行数 推高，foo 不变')
  assert.equal(localizeExplanationSummary('本次预测风险为 0.2'), '本次提交级预测分数为 0.2')
})

test('renders a read-only data view with commit, model, score and contributions', () => {
  const value = report({
    status: 'supported', method: 'occlusion-mean-v1',
    items: [{ feature: 'la', value: 4, baseline: 2, delta: 0.12, direction: 'increases' }],
    summary: '本次预测风险为 0.423，影响最大的是 la（推高 0.120）。',
  })
  const markdown = explanationMarkdown(value, value.commits[0])
  assert.match(markdown, /提交 SHA/)
  assert.match(markdown, /提交级预测分数：0.423100/)
  assert.match(markdown, /逻辑回归/)
  assert.match(markdown, /新增行数/)
  assert.match(markdown, /不是已确认缺陷/)
  assert.match(markdown, /Top 特征贡献/)
})

test('states when an explanation is not supported without changing the score', () => {
  const value = report({
    status: 'not-supported', method: null, items: [],
    summary: '本次归因计算不可用。 提交级预测分数仍然有效。',
  })
  const markdown = explanationMarkdown(value, value.commits[0])
  assert.match(markdown, /本次归因计算不可用/)
  assert.match(markdown, /提交级预测分数：0.423100/)
  assert.match(markdown, /没有可展示的特征归因/)
})
