import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ensureDir, runEvidenceDir, runScreenshotDir } from '../evidence.ts'
import { loginOrCreateUser } from './support/user-session.ts'

const preview = 'https://github.com/preview/project'
const api = 'http://127.0.0.1:18860'

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('guides training, exposes the IDE page and verifies fixed PR/commit line evidence', async ({ page }, info) => {
  test.setTimeout(300_000)
  await loginOrCreateUser(page)

  // Real training method directory -> inline explanation -> restore default.
  const csv = 'commit_id,author_date,bugcount,ns,nd,nf,ent,la,ld\n'
    + `${'a'.repeat(40)},1350000000,1,1,1,1,0,1,0\n`
  const imported = await page.request.post('/api/v1/user/datasets/import?dataset=guided-evidence&schema=openstack-six-v1&filename=guided.csv', {
    headers: { 'Content-Type': 'text/csv' }, data: csv,
  })
  expect(imported.ok()).toBeTruthy()
  await page.goto('/#/my-training')
  await page.getByRole('button', { name: '开始训练', exact: true }).click()
  const training = page.getByRole('dialog', { name: '开始训练' })
  const logistic = training.getByRole('checkbox', { name: /逻辑回归/ }).first()
  await expect(logistic).toBeVisible({ timeout: 30_000 })
  await logistic.check()
  await training.locator('summary').filter({ hasText: '参数' }).click()
  await expect(training.getByText('值越大限制越弱；先围绕 1 调整。')).toBeVisible()
  await expect(training.getByText('默认 1', { exact: true })).toBeVisible()
  await expect(training.getByText('范围 0.01–100', { exact: true })).toBeVisible()
  const cInput = training.getByLabel(/逻辑回归 · L2 C/)
  await cInput.fill('2')
  await expect(training.getByText('已修改')).toBeVisible()
  await training.getByRole('button', { name: /恢复 逻辑回归 · L2 正则强度倒数 C 默认值/ }).click()
  await expect(cInput).toHaveValue('1')
  await training.getByRole('button', { name: '取消', exact: true }).click()

  // IDE guide is a stable workspace route and has no fake download.
  await page.goto('/#/plugins/vscode')
  await expect(page.getByRole('heading', { name: 'IDE 插件', exact: true })).toBeVisible()
  await expect(page.getByText('本页不提供稳定 VSIX 下载。请从本地构建产物或已核对的 CI artifact 安装，并确认包版本与当前交付一致。')).toBeVisible()
  await expect(page.getByRole('link', { name: /下载/ })).toHaveCount(0)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/ide-plugin-guide-${info.project.name}.png`, fullPage: false })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'IDE 插件', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)

  // Seed a real branch analysis and open the fixed commit that introduced TypeScript.
  const fixture = await (await page.request.get(`${api}/__test/context`)).json()
  const project = { repositoryId: fixture.repositoryId }
  const job = { syncId: fixture.branchSyncId }
  const pageCommits = await (await page.request.get(`/api/v1/repositories/${project.repositoryId}/commits`, {
    params: { viewSyncId: job.syncId, limit: 200, sort: 'time' },
  })).json()
  let commit: { commitId: string; filePaths: string[] } | null = null
  for (const item of pageCommits.commits) {
    const detail = await (await page.request.get(`/api/v1/repositories/${project.repositoryId}/commits/${item.commitId}`, {
      params: { viewSyncId: job.syncId },
    })).json()
    if (detail.filePaths?.includes('review.ts')) {
      commit = detail
      break
    }
  }
  expect(commit).toBeTruthy()
  const commitEvidence = await page.request.get(
    `/api/v1/repositories/${project.repositoryId}/commits/${commit!.commitId}/line-evidence`,
    { params: { viewSyncId: job.syncId, path: 'review.ts' } },
  )
  expect(commitEvidence.ok()).toBeTruthy()
  expect((await commitEvidence.json()).status).toBe('supported')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/#/projects/${project.repositoryId}/analyses/${job.syncId}/commits/${commit!.commitId}`)
  const detail = page.getByRole('dialog', { name: '提交详情' })
  await expect(detail).toBeVisible()
  await detail.locator('summary').filter({ hasText: '行级研究证据' }).click()
  await detail.getByLabel('文件').selectOption('review.ts')
  await expect(detail.getByRole('heading', { name: '行级研究证据' })).toBeVisible()
  await expect(detail.getByText(/第 \d+ 行排序分数/)).toBeVisible()
  await expect(detail.getByText(/不求和、不统一排名/)).toBeVisible()
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/commit-line-evidence-${info.project.name}.png`, fullPage: false })
  await page.keyboard.press('Escape')

  // A second real fixed PR contains TypeScript; delay one response before reaching the service.
  const pr2 = await page.request.post('/api/v1/review-sources', { data: { url: `${preview}/pull/2` } })
  expect(pr2.ok()).toBeTruthy()
  const source2 = (await pr2.json()).snapshot
  await page.goto(`/#/reviews/preview/project/2?snapshotId=${source2.snapshotId}&mode=preview`)
  await expect(page.getByRole('heading', { name: /TypeScript 行级证据/ })).toBeVisible()
  let delayed = false
  await page.route(/\/line-evidence\?/, async route => {
    const url = new URL(route.request().url())
    if (!delayed && url.searchParams.get('path') === 'review.ts') {
      delayed = true
      await new Promise(resolve => setTimeout(resolve, 900))
    }
    await route.continue()
  })
  await page.getByLabel('预览文件').selectOption('review.ts')
  const requestForFirst = page.waitForRequest(request => request.url().includes('/line-evidence?')
    && new URL(request.url()).searchParams.get('path') === 'review.ts')
  await page.getByRole('tab', { name: '行级证据', exact: true }).click()
  await requestForFirst
  await page.getByLabel('预览文件').selectOption('review2.ts')
  await page.getByRole('tab', { name: '行级证据', exact: true }).click()
  await expect(page.getByText('当前文件：')).toContainText('review2.ts')
  await expect(page.getByRole('heading', { name: '行级研究证据' })).toBeVisible()
  await expect(page.getByText(/不求和、不统一排名/)).toBeVisible()
  await expect(page.getByText('当前文件：')).not.toContainText('review.ts')
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/pr-line-evidence-${info.project.name}.png`, fullPage: false })

  // The Python PR remains an explicit unsupported-language result.
  const pr1 = await page.request.post('/api/v1/review-sources', { data: { url: `${preview}/pull/1` } })
  expect(pr1.ok()).toBeTruthy()
  const source1 = (await pr1.json()).snapshot
  await page.goto(`/#/reviews/preview/project/1?snapshotId=${source1.snapshotId}&mode=preview`)
  await page.getByLabel('预览文件').selectOption('review.py')
  await page.getByRole('tab', { name: '行级证据', exact: true }).click()
  await expect(page.getByText(/当前文件语言不在研究模型覆盖范围/)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  const summary = {
    projectId: project.repositoryId,
    fixedCommitId: commit!.commitId,
    fixedPrSnapshotId: source2.snapshotId,
    unsupportedPrSnapshotId: source1.snapshotId,
    reportVersion: 'jit-commit-analysis-v1',
  }
  writeFileSync(`${ensureDir(runEvidenceDir)}/guided-model-review-evidence.json`,
    `${JSON.stringify(summary, null, 2)}\n`, 'utf-8')
})
