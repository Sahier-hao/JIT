import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.DOCS_PREVIEW_URL ?? 'http://127.0.0.1:14273'
const OUT = resolve(process.cwd(), '../docs/evidence/add-product-documentation-center')
const SESSION = { authenticated: true, username: 'docs-acceptance', status: 'active' }
const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-10-22T12:00:00Z'

const snapshot = {
  snapshotId: 'v1', repositoryId: 'repo', owner: 'example', name: 'project', number: 12,
  title: 'Reset token', author: 'author', url: 'https://github.com/example/project/pull/12',
  body: 'Add expiry handling', remoteState: 'open', updatedAt: '2026-10-26T00:00:00Z',
  capturedAt: '2026-10-26T01:00:00Z', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  baseBranch: 'main', headBranch: 'feature', baseRepository: 'example/project',
  headRepository: 'example/project', filesComplete: true, totalFiles: 2, commitsComplete: true,
  totalCommits: 1, commits: [{ sha: 'b'.repeat(40), message: 'handle expiry' }],
  files: [
    { path: 'src/token.py', previousPath: null, blobSha: 'c'.repeat(40), status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new', patchComplete: true },
    { path: 'tests/token.py', previousPath: null, blobSha: 'd'.repeat(40), status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+test', patchComplete: true },
  ],
}

const workKey = `${snapshot.owner}/${snapshot.name}#${snapshot.number}`
const work = {
  key: workKey, owner: 'example', name: 'project', number: 12,
  latestSnapshotId: 'v1', viewedSnapshotId: 'v1', remoteState: 'open',
  checkedAt: snapshot.capturedAt, checkError: '', interest: 'active',
  rounds: {
    v1: {
      source: snapshot,
      progress: {
        'src/token.py': { state: 'read', originSnapshotId: 'v1' },
        'tests/token.py': { state: 'unread', originSnapshotId: 'v1' },
      },
      questions: [{
        id: 'q-draft', body: 'Keep this draft finding', kind: 'finding', source: 'manual',
        originSnapshotId: 'v1', relatedFiles: ['src/token.py'],
        evidence: [{ snapshotId: 'v1', path: 'src/token.py', side: 'head', line: 1, blobSha: 'c'.repeat(40), note: 'expiry branch' }],
        status: 'open', judgment: 'Draft judgment', reason: '', requiresRecheck: false,
        feedback: '', feedbackReason: '',
      }],
      currentFile: 'src/token.py', scratch: 'Draft scratch text', conclusion: null,
      reviewView: 'files', location: { side: 'head', line: 1 }, selectedQuestionId: 'q-draft',
      candidateDecisions: {},
    },
  },
  revision: 1, savedAt: '2026-10-26T01:01:00Z',
}

const projectJob = {
  syncId: SYNC, repositoryId: REPO, repositoryUrl: 'https://github.com/example/demo',
  branch: 'main', since: null, until: null, commitLimit: 500,
  requestedStrategy: 'generic-model', status: 'completed', stage: 'completed',
  datasetVersion: 'data-1', runId: '33333333-3333-4333-8333-333333333333',
  modelId: null, requestedModelId: null, modelStrategy: 'repository-trained',
  degradeReason: null, trainRecords: null, trainPositives: null,
  createdAt: NOW, updatedAt: NOW, requestId: null, error: null,
}

const projectDetail = {
  repositoryId: REPO, url: 'https://github.com/example/demo', displayName: 'demo-project',
  defaultBranch: 'main', latestSyncId: SYNC, latestSyncAt: NOW, viewSyncId: SYNC,
  headCommit: 'a'.repeat(40), commitCount: 4,
  distribution: { high: 2, medium: 1, low: 1, unknown: 0 },
  distributionRule: 'repo-distribution-v1', createdAt: NOW, updatedAt: NOW,
  modelStrategy: 'repository-trained', degradeReason: null,
  runId: '33333333-3333-4333-8333-333333333333', modelId: null, datasetVersion: 'data-1',
  limitations: [], latestSync: projectJob,
  viewContext: {
    repositoryId: REPO, syncId: SYNC, branch: 'main', completedAt: NOW, headCommit: 'a'.repeat(40),
    datasetVersion: 'data-1', modelId: null, runId: '33333333-3333-4333-8333-333333333333',
    missingMetadata: [],
  },
}

const projectCommits = [
  ['1'.repeat(40), 0.9, 'raise boundary'], ['2'.repeat(40), 0.6, 'adjust loader'],
  ['3'.repeat(40), 0.2, 'add validation'], ['4'.repeat(40), 0.05, 'update copy'],
].map(([commitId, risk, subject], index) => ({
  commitId, epoch: index + 1, risk, addedLines: 10, deletedLines: 1, files: 1,
  label: index < 2 ? 1 : 0, labelNote: null, subject, features: {}, partition: 'holdout',
}))

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function screenshot(page, name, fullPage = true) {
  await page.screenshot({ path: resolve(OUT, name), fullPage })
}

async function assertNoPageOverflow(page, label) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(size.scrollWidth <= size.clientWidth, `${label}: ${size.scrollWidth} > ${size.clientWidth}`)
  return size
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const summary = {}

try {
  const anonymous = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const apiRequests = []
  await anonymous.route('**/api/**', async route => {
    apiRequests.push(new URL(route.request().url()).pathname)
    await json(route, { detail: 'offline acceptance fixture' }, 503)
  })
  const page = await anonymous.newPage()
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' })
  const landingEntry = page.getByRole('link', { name: '文档', exact: true })
  await landingEntry.waitFor()
  await landingEntry.click()
  await page.getByRole('heading', { name: '产品文档' }).waitFor()
  assert.match(page.url(), /#\/docs$/)
  summary.landingEntry = 'text link opened docs anonymously'
  await page.getByRole('link', { name: /完成第一次 PR 审查/ }).waitFor()
  for (const group of ['快速开始', '使用指南', '背景知识', '常见问题']) {
    await page.getByRole('heading', { name: group }).waitFor()
  }
  assert.deepEqual([...new Set(apiRequests)], ['/api/user/session'])
  summary.backendOffline = { docsLoaded: true, apiRequests: [...new Set(apiRequests)] }
  summary.desktopHomeOverflow = await assertNoPageOverflow(page, 'desktop home')
  await screenshot(page, 'docs-home-1280.png')

  const search = page.getByRole('textbox', { name: '搜索文档' })
  for (const term of ['风险分', '私有仓库', '模型兼容', 'VS Code']) {
    await search.fill(term)
    await page.getByRole('listbox', { name: '文档搜索结果' }).waitFor()
    assert.ok(await page.getByRole('option').count() > 0, `${term} should return results`)
  }
  await search.fill('私有仓库')
  await page.getByRole('option').first().click()
  await page.waitForURL(/#\/docs\/faq\?section=/)
  const faqSection = new URL(page.url()).hash.split('section=')[1]
  await page.locator(`#${faqSection}`).waitFor()
  summary.search = { opened: page.url(), section: faqSection }

  await page.goto(`${BASE}/#/docs`, { waitUntil: 'domcontentloaded' })
  const keyboardSearch = page.getByRole('textbox', { name: '搜索文档' })
  await keyboardSearch.fill('VS Code')
  const keyboardOptions = await page.getByRole('option').all()
  assert.ok(keyboardOptions.length > 1)
  await keyboardSearch.press('ArrowDown')
  await keyboardSearch.press('Enter')
  await page.waitForURL(/#\/docs\/vscode-commit-check\?section=/)
  summary.keyboardSearch = page.url()

  await page.goto(`${BASE}/#/docs/reading-results?section=commit-score`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '提交级风险分是什么' }).waitFor()
  await page.waitForTimeout(150)
  const anchored = await page.locator('#commit-score').evaluate(element => ({
    top: Math.round(element.getBoundingClientRect().top),
    scrollY: window.scrollY,
  }))
  assert.ok(anchored.top >= 0 && anchored.top < 180, JSON.stringify(anchored))
  summary.directSection = anchored
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '提交级风险分是什么' }).waitFor()
  await page.waitForTimeout(150)
  const reloaded = await page.locator('#commit-score').evaluate(element => Math.round(element.getBoundingClientRect().top))
  assert.ok(reloaded >= 0 && reloaded < 180, String(reloaded))
  summary.reloadedSection = reloaded
  await screenshot(page, 'docs-reading-results-1280.png')

  await page.getByRole('link', { name: '代码线索先看哪一层' }).click()
  await page.waitForURL(/#\/docs\/reading-results\?section=code-clues/)
  await page.goBack()
  await page.waitForURL(/#\/docs\/reading-results\?section=commit-score/)
  await page.goForward()
  await page.waitForURL(/#\/docs\/reading-results\?section=code-clues/)
  summary.history = { back: 'commit-score', forward: 'code-clues' }

  await page.goto(`${BASE}/#/docs/reading-results?section=not-here`, { waitUntil: 'domcontentloaded' })
  assert.equal(await page.getByRole('alert').textContent(), '没有找到“not-here”这个本节。请从本页目录重新选择。')
  summary.invalidSection = 'kept article and showed alert'

  await page.goto(`${BASE}/#/docs/not-a-published-article`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '没有这篇文档' }).waitFor()
  await page.getByRole('button', { name: '返回文档首页' }).waitFor()
  summary.unknownArticle = 'docs-local empty state'
  await anonymous.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  await mobile.route('**/api/**', route => json(route, { detail: 'offline acceptance fixture' }, 503))
  const phone = await mobile.newPage()
  await phone.goto(`${BASE}/#/docs`, { waitUntil: 'domcontentloaded' })
  await phone.getByRole('heading', { name: '产品文档' }).waitFor()
  summary.mobileHomeOverflow = await assertNoPageOverflow(phone, '390 home')
  await screenshot(phone, 'docs-home-390.png')
  await phone.getByRole('link', { name: /完成第一次 PR 审查/ }).click()
  await phone.getByRole('heading', { name: '完成第一次 PR 审查' }).waitFor()
  await phone.locator('img[alt="第一次 PR 审查的入口与操作顺序"]').waitFor()
  assert.equal(await phone.locator('table').count() > 0, true)
  const tableScroll = await phone.locator('table').first().evaluate(table => {
    const wrapper = table.parentElement
    return {
      overflowX: wrapper ? getComputedStyle(wrapper).overflowX : '',
      scrollWidth: wrapper?.scrollWidth ?? 0,
      clientWidth: wrapper?.clientWidth ?? 0,
    }
  })
  assert.equal(tableScroll.overflowX, 'auto')
  summary.mobileArticleOverflow = await assertNoPageOverflow(phone, '390 first review')
  summary.mobileTable = tableScroll
  await phone.locator('summary').filter({ hasText: '章节导航' }).click()
  await phone.getByRole('navigation', { name: '文档章节（窄屏）' }).waitFor()
  await screenshot(phone, 'docs-first-review-390.png')

  await phone.goto(`${BASE}/#/docs/vscode-commit-check`, { waitUntil: 'domcontentloaded' })
  await phone.getByRole('heading', { name: '在 VS Code 中检查提交' }).waitFor()
  const code = phone.locator('pre').first()
  await code.waitFor()
  assert.equal(await code.evaluate(element => getComputedStyle(element).overflowX), 'auto')
  summary.mobileCodeOverflow = await assertNoPageOverflow(phone, '390 VS Code article')
  await screenshot(phone, 'docs-vscode-390.png')
  await mobile.close()

  const authenticated = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  await authenticated.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/user/session') return json(route, SESSION)
    if (path === '/api/v1/repositories') return json(route, { repositories: [], total: 0, limit: 100, offset: 0 })
    return json(route, { detail: 'not part of acceptance fixture' }, 503)
  })
  const workspace = await authenticated.newPage()
  await workspace.goto(`${BASE}/#/projects`, { waitUntil: 'domcontentloaded' })
  await workspace.getByRole('heading', { name: '项目', exact: true }).waitFor()
  const docsEntry = workspace.getByRole('link', { name: '打开产品文档' })
  await docsEntry.waitFor()
  const [popup] = await Promise.all([workspace.waitForEvent('popup'), docsEntry.click()])
  await popup.waitForLoadState('domcontentloaded')
  await popup.getByRole('heading', { name: '产品文档' }).waitFor()
  assert.match(popup.url(), /#\/docs$/)
  await popup.getByRole('link', { name: /完成第一次 PR 审查/ }).click()
  await popup.getByRole('heading', { name: '完成第一次 PR 审查' }).waitFor()
  await popup.getByRole('link', { name: '项目', exact: true }).click()
  await popup.getByRole('heading', { name: '项目', exact: true }).waitFor()
  assert.match(popup.url(), /#\/projects$/)
  summary.authenticatedEntry = { workspaceOpenedDocs: true, docsOpenedProtectedProjects: true }
  await authenticated.close()

  const workbenchContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  await workbenchContext.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/user/session') return json(route, SESSION)
    if (path === '/api/v1/repositories') return json(route, { repositories: [], total: 0, limit: 100, offset: 0 })
    if (path === '/api/v1/repository-models') return json(route, { models: [] })
    if (path === '/api/v1/pr-snapshots/v1') return json(route, snapshot)
    if (path === '/api/v1/pr-snapshots/v1/analyses') return json(route, { snapshotId: 'v1', analyses: [] })
    if (path === '/api/v1/pr-snapshots/v1/candidates') return json(route, { snapshotId: 'v1', coverage: null, candidates: [] })
    if (path === '/api/v1/pr-snapshots/v1/context') {
      const side = new URL(route.request().url()).searchParams.get('side')
      return json(route, { snapshotId: 'v1', path: 'src/token.py', side, ref: side === 'head' ? snapshot.headSha : snapshot.baseSha, content: 'old\nnew', complete: true, absent: false, totalLines: 2 })
    }
    if (path === '/api/v1/project-events') return json(route, { events: [], total: 0, limit: 20, offset: 0 })
    return json(route, { detail: 'not part of acceptance fixture' }, 503)
  })
  const bench = await workbenchContext.newPage()
  await bench.goto(`${BASE}/#/docs`, { waitUntil: 'domcontentloaded' })
  await bench.evaluate(({ account, key, value }) => {
    localStorage.setItem(`jit:pr-review:works:v2:${encodeURIComponent(account)}`, JSON.stringify({ [key]: value }))
  }, { account: SESSION.username, key: workKey, value: work })
  await bench.goto(`${BASE}/#/reviews/example/project/12`, { waitUntil: 'domcontentloaded' })
  await bench.getByRole('heading', { name: 'Reset token' }).waitFor()
  await bench.getByRole('textbox', { name: '个人笔记' }).waitFor()
  assert.equal(await bench.getByRole('textbox', { name: '个人笔记' }).inputValue(), 'Draft scratch text')
  assert.equal(await bench.getByRole('option', { name: /token.py/, selected: true }).getAttribute('aria-selected'), 'true')
  const help = bench.getByRole('link', { name: /怎么看代码线索/ })
  await help.waitFor()
  await screenshot(bench, 'pr-workbench-help-1280.png')
  const [helpPopup] = await Promise.all([bench.waitForEvent('popup'), help.click()])
  await helpPopup.waitForLoadState('domcontentloaded')
  await helpPopup.getByRole('heading', { name: '怎么看风险分和代码线索' }).waitFor()
  assert.match(helpPopup.url(), /#\/docs\/reading-results\?section=code-clues$/)
  await helpPopup.close()
  assert.equal(await bench.getByRole('textbox', { name: '个人笔记' }).inputValue(), 'Draft scratch text')
  assert.equal(await bench.getByRole('option', { name: /token.py/, selected: true }).getAttribute('aria-selected'), 'true')
  summary.workbenchDraft = { helpOpenedInNewTab: true, diffAndDraftPreserved: true }
  await workbenchContext.close()

  const branchContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  await branchContext.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/user/session') return json(route, SESSION)
    if (path === '/api/v1/repositories') return json(route, { repositories: [], total: 0, limit: 100, offset: 0 })
    if (path === `/api/v1/repositories/${REPO}`) return json(route, projectDetail)
    if (path === `/api/v1/repositories/${REPO}/syncs`) return json(route, { repositoryId: REPO, syncs: [projectJob], total: 1, limit: 100, offset: 0 })
    if (path === `/api/v1/repository-syncs/${SYNC}/commits`) return json(route, { syncId: SYNC, status: 'completed', total: projectCommits.length, limit: 200, offset: 0, commits: projectCommits })
    if (path === '/api/v1/repository-models') return json(route, { models: [{ modelId: 'model-1', name: '逻辑回归 · 演示模型', method: 'logistic-regression-l2-v1', state: 'ready', enabled: true, isDefault: true, mine: false, shared: true, repositoryPredictionSupported: true, featureSchemaVersion: 'kamei14-git-v1' }] })
    if (path === '/api/v1/project-events') return json(route, { events: [], total: 0, limit: 20, offset: 0 })
    return json(route, { detail: 'not part of acceptance fixture' }, 503)
  })
  const branchPage = await branchContext.newPage()
  await branchPage.goto(`${BASE}/#/projects/${REPO}/analyses`, { waitUntil: 'domcontentloaded' })
  await branchPage.getByRole('heading', { name: 'demo-project' }).waitFor()
  const branchHelp = branchPage.getByRole('link', { name: /怎么看分数/ })
  await branchHelp.waitFor()
  assert.equal(await branchHelp.getAttribute('href'), '#/docs/reading-results?section=commit-score')
  await screenshot(branchPage, 'branch-analysis-help-1280.png')
  const [branchPopup] = await Promise.all([branchPage.waitForEvent('popup'), branchHelp.click()])
  await branchPopup.waitForLoadState('domcontentloaded')
  await branchPopup.getByRole('heading', { name: '怎么看风险分和代码线索' }).waitFor()
  assert.match(branchPopup.url(), /#\/docs\/reading-results\?section=commit-score$/)
  await branchPopup.close()
  await branchPage.getByRole('heading', { name: 'demo-project' }).waitFor()
  summary.branchHelp = { target: 'reading-results#commit-score', pagePreserved: true }
  await branchContext.close()

  await writeFile(resolve(OUT, 'docs-acceptance.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await browser.close()
}
