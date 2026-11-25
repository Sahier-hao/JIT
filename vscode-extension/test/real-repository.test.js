// [AI生成] 真实仓库身份与定位回归；不依赖 VS Code 宿主。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseReport, identity, validLine } = require('../out/report.js')

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function report(headSha) {
  return {
    format: 'jit-commit-analysis-v1',
    analysisId: 'real-repo', contentSha256: 'c'.repeat(64),
    repository: { path: 'real-repo', baseSha: 'a'.repeat(40), headSha, commitsInRange: 1 },
    model: { modelId: 'm', name: '模型', runId: 'r', method: 'logistic-regression-l2-v1', featureSchema: 'kamei14-git-v2' },
    coverage: { commitsTotal: 1, commitsScored: 1, candidateFiles: 1 },
    commits: [{ commitId: headSha, risk: 0.4, subject: 'change', authorName: 'a', time: 't',
      addedLines: 1, deletedLines: 0, files: 1, filePaths: ['src/app.py'] }],
    candidates: [{ side: 'head', path: 'src/app.py', line: 3, ruleId: 'rule-v1', ruleVersion: '1',
      message: '候选', evidence: 'line', suggestion: null }],
    limitations: ['不是缺陷概率'],
  }
}

// [AI生成]
test('real repository identity handles match, dirty, branch switch, stale, rename and delete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jit-real-repo-'))
  try {
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 'real@example.com')
    git(root, 'config', 'user.name', 'Real Repo')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'app.py'), 'a\nb\nc\nd\ne\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'first')
    const head1 = git(root, 'rev-parse', 'HEAD')
    const parsed = parseReport(report(head1))
    assert.equal(identity(parsed, head1, false).state, 'match')
    assert.equal(validLine(fs.readFileSync(path.join(root, 'src', 'app.py'), 'utf8'), 3), true)

    fs.appendFileSync(path.join(root, 'src', 'app.py'), 'f\n')
    assert.equal(identity(parsed, head1, true).state, 'dirty')
    assert.match(identity(parsed, head1, true).message, /未提交改动/)

    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'second')
    const head2 = git(root, 'rev-parse', 'HEAD')
    assert.equal(identity(parsed, head2, false).state, 'stale')
    git(root, 'checkout', '-q', '-b', 'old', head1)
    assert.equal(identity(parsed, head1, false).state, 'match')
    git(root, 'checkout', '-q', 'main')
    assert.equal(identity(parsed, head2, false).state, 'stale')

    fs.renameSync(path.join(root, 'src', 'app.py'), path.join(root, 'src', 'moved.py'))
    assert.equal(fs.existsSync(path.join(root, 'src', 'app.py')), false)
    assert.equal(validLine(fs.readFileSync(path.join(root, 'src', 'moved.py'), 'utf8'), 3), true)
    fs.rmSync(path.join(root, 'src', 'moved.py'))
    assert.equal(fs.existsSync(path.join(root, 'src', 'app.py')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
