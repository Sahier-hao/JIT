import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import { ARTIFACT_ROOT } from './repository-setup.ts'

const account = { username: 'experiment-admin', password: 'isolated-experiment-password' }

async function expectNoOverflow(page: import('@playwright/test').Page) {
  const size = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(size.scrollWidth, JSON.stringify(size)).toBeLessThanOrEqual(size.innerWidth)
}

test('空目录库从实验运行登记到用户可用模型', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '实验登记闭环只跑一个浏览器项目')
  test.setTimeout(180000)
  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
  else expect(setup.status()).toBe(201)

  const before = await (await page.request.get('/api/v1/experiment-runs?limit=100')).json()
  expect(before.total).toBeGreaterThanOrEqual(11)
  expect((await (await page.request.get('/api/v1/models')).json()).models).toEqual([])
  const compatible = before.runs.find((run: { displayName: string; artifactState: string; registrationState: string }) =>
    run.displayName === 'baseline' && run.artifactState === 'complete' && run.registrationState === 'unregistered')
  const secondCompatible = before.runs.find((run: { method: string; artifactState: string; registrationState: string }) =>
    run.method === 'decision-tree-v1' && run.artifactState === 'complete' && run.registrationState === 'unregistered')
  const offline = before.runs.find((run: { serviceCompatibility: string }) => run.serviceCompatibility === 'offline-only')
  const failed = before.runs.find((run: { artifactState: string }) => run.artifactState === 'failed')
  expect(compatible && secondCompatible && offline && failed).toBeTruthy()

  await page.goto('/#/admin/experiments?registrationState=unregistered&compatibility=repository-analysis&artifactState=complete')
  await expect(page.getByRole('heading', { name: '实验运行', exact: true })).toBeVisible()
  await expect(page.getByText('逻辑回归 · 六字段', { exact: true }).first()).toBeVisible({ timeout: 30000 })
  const checkbox = page.getByRole('checkbox', { name: `选择实验 ${compatible.artifactRunId}` })
  await checkbox.check()
  await page.getByRole('button', { name: '登记所选', exact: true }).click()
  const promoted = page.waitForResponse(response => response.url().endsWith('/api/v1/experiment-runs/promote') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认登记', exact: true }).click()
  const promotion = await (await promoted).json()
  expect(promotion.items[0].status).toBe('registered')
  expect(promotion.items[0].modelId).toBeTruthy()
  await expect(page.getByRole('heading', { name: '登记结果', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看模型', exact: true }).click()
  await expect(page.getByRole('heading', { name: '逻辑回归 · 六字段', exact: true })).toBeVisible()
  const repositoryModels = await (await page.request.get('/api/v1/repository-models')).json()
  expect(repositoryModels.models.some((model: { modelId: string }) => model.modelId === promotion.items[0].modelId)).toBe(true)

  await page.goto('/#/admin/experiments')
  await page.getByRole('checkbox', { name: `选择实验 ${secondCompatible.artifactRunId}` }).check()
  await page.getByRole('checkbox', { name: `选择实验 ${offline.artifactRunId}` }).check()
  writeFileSync(resolve(ARTIFACT_ROOT, 'decision-tree-v1', 'model.joblib'), 'broken fixture')
  await page.getByRole('button', { name: '登记所选', exact: true }).click()
  const mixedResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/experiment-runs/promote') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认登记', exact: true }).click()
  const mixed = await (await mixedResponse).json()
  expect(mixed.items.map((item: { status: string }) => item.status).sort()).toEqual(['failed', 'registered'])
  await expect(page.getByRole('heading', { name: '登记结果', exact: true })).toBeVisible()

  await page.goto('/#/admin/experiments')
  const offlineRow = page.getByRole('row').filter({ hasText: 'kamei14-benchmark-v1' })
  await expect(offlineRow).toContainText('仅离线基准')
  await expect(offlineRow).toContainText('已登记')
  await expect(page.getByRole('heading', { name: '不可登记报告', exact: true })).toBeVisible()
  await expect(page.getByText('聚合报告不含完整模型产物，不能登记为模型。', { exact: true })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: '夹具失败方法' })).toContainText('训练失败')
  const finalRepositoryModels = await (await page.request.get('/api/v1/repository-models')).json()
  const benchmarkModels = finalRepositoryModels.models.filter((model: { featureSchemaVersion: string }) =>
    model.featureSchemaVersion === 'kamei14-benchmark-v1')
  expect(benchmarkModels.length).toBeGreaterThan(0)
  expect(benchmarkModels.every((model: { repositoryPredictionSupported: boolean }) =>
    model.repositoryPredictionSupported === false)).toBe(true)

  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/admin-experiments-${width}.png`, fullPage: true })
    await expectNoOverflow(page)
  }
})
