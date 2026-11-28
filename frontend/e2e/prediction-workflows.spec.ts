import { expect, test } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import { loginOrCreateUser } from './support/user-session.ts'

const DATASET_VERSION = 'e2e-prediction-2024-01-01_2024-01-12'

async function overflowMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    viewportWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
}

async function firstResult(page: import('@playwright/test').Page) {
  const row = page.getByRole('table').first().locator('tbody tr').first()
  await expect(row).toBeVisible()
  return {
    recordId: (await row.locator('td').nth(0).innerText()).trim(),
    score: (await row.locator('td').nth(1).innerText()).trim(),
  }
}

test.beforeEach(async ({ page }) => {
  await loginOrCreateUser(page)
})

test('缺陷预测单条与批量同分、无标签 CSV、刷新重开和评估交接', async ({ page }, info) => {
  test.skip(info.project.name !== 'predictions', '缺陷预测专用隔离服务只跑一个项目')
  test.setTimeout(180_000)

  await page.goto('/#/my-predictions')
  await expect(page.getByRole('heading', { name: '缺陷预测' })).toBeVisible()
  const batchSubmit = page.getByRole('button', { name: '开始批量预测' })
  await expect(batchSubmit).toBeEnabled({ timeout: 30_000 })
  await batchSubmit.click()
  await expect(page).toHaveURL(/#\/my-predictions\/[0-9a-f-]+/)
  await expect(page.getByRole('heading', { name: 'e2e-prediction' })).toBeVisible()
  const batch = await firstResult(page)
  expect(batch.recordId).toHaveLength(40)
  expect(batch.score).toMatch(/^\d\.\d{4}$/)
  await page.screenshot({
    path: `${ensureDir(runScreenshotDir)}/prediction-result-1440.png`,
    fullPage: true,
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'e2e-prediction' })).toBeVisible()
  const reopened = await firstResult(page)
  expect(reopened).toEqual(batch)

  await page.getByRole('button', { name: '新建预测' }).click()
  await page.getByRole('tab', { name: '单条预测' }).click()
  await page.getByLabel('搜索数据行').fill(batch.recordId)
  await page.getByRole('button', { name: '搜索' }).click()
  const sampleRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: batch.recordId.slice(0, 14), exact: true }),
  })
  await expect(sampleRow).toBeVisible()
  await sampleRow.getByRole('button', { name: '选用' }).click()
  const singleSubmit = page.getByRole('button', { name: '开始单条预测' })
  await expect(singleSubmit).toBeEnabled()
  await singleSubmit.click()
  await expect(page).toHaveURL(/#\/my-predictions\/[0-9a-f-]+/)
  const single = await firstResult(page)
  expect(single.recordId).toBe(batch.recordId)
  expect(single.score).toBe(batch.score)
  await expect(page.getByText('单条预测', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新建预测' }).click()
  await page.getByLabel('批量来源').selectOption('csv')
  await page.getByLabel('无标签 CSV').setInputFiles({
    name: 'missing-column.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('ns,nd,nf,ent,la\n1,1,1,0.5,4\n', 'utf8'),
  })
  await page.getByRole('button', { name: '开始批量预测' }).click()
  await expect(page.getByRole('alert')).toContainText('缺少入模字段')
  await page.getByLabel('无标签 CSV').setInputFiles({
    name: 'unlabeled.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'recordId,ns,nd,nf,ent,la,ld\ncsv-1,1,1,1,0.5,4,1\ncsv-2,2,1,1,0.7,8,2\n',
      'utf8',
    ),
  })
  await page.getByRole('button', { name: '开始批量预测' }).click()
  await expect(page).toHaveURL(/#\/my-predictions\/[0-9a-f-]+/)
  await expect(page.getByText(/所有记录均无可用真实标签/)).toBeVisible()
  await expect(page.getByRole('button', { name: '去评估' })).toHaveCount(0)
  await expect(page.getByText(/无标签/).first()).toBeVisible()
  await page.screenshot({
    path: `${ensureDir(runScreenshotDir)}/prediction-unlabeled-1440.png`,
    fullPage: true,
  })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /导出 CSV/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.csv$/)
  await download.cancel()

  await page.getByRole('button', { name: '新建预测' }).click()
  await page.getByLabel('评分范围').selectOption('frozen')
  await expect(page.getByLabel('分区来源')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('预测分区')).toHaveValue('test')
  const frozenSubmit = page.getByRole('button', { name: '开始批量预测' })
  await expect(frozenSubmit).toBeEnabled()
  await frozenSubmit.click()
  await expect(page).toHaveURL(/#\/my-predictions\/[0-9a-f-]+/)
  await expect(page.getByText('分区 测试集')).toBeVisible()
  await page.getByRole('button', { name: '去评估' }).click()
  const hash = new URL(page.url()).hash
  const query = new URLSearchParams(hash.split('?')[1] ?? '')
  expect(query.get('batchId')).toBeTruthy()
  expect(query.get('modelId')).toBeTruthy()
  expect(query.get('datasetVersion')).toBe(DATASET_VERSION)
  expect(query.get('partition')).toBe('test')
  expect(query.get('splitPreset')).toBeTruthy()
  await expect(page.getByRole('heading', { name: '预测评估' })).toBeVisible()
  await expect(page.getByText('测试集').first()).toBeVisible()
  await expect(page.getByRole('table', { name: '混淆矩阵' })).toBeVisible()

  await page.screenshot({
    path: `${ensureDir(runScreenshotDir)}/prediction-evaluation-1440.png`,
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const metrics = await overflowMetrics(page)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  await page.screenshot({
    path: `${ensureDir(runScreenshotDir)}/prediction-evaluation-390.png`,
    fullPage: true,
  })
  await page.context().close()
})
