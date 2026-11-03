import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

const account = { username: 'package-admin', password: 'isolated-package-password' }
const evidencePath = resolve(
  process.cwd(),
  '../docs/evidence/_run/fixtures/model-packages/recovery-evidence.json',
)

async function expectNoOverflow(page: import('@playwright/test').Page) {
  const size = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(size.scrollWidth, JSON.stringify(size)).toBeLessThanOrEqual(size.innerWidth)
}

test('空目录库恢复九模型并显示部分导入的真实原因', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '模型包恢复闭环只跑一个浏览器项目')
  test.setTimeout(180000)
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'))
  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) {
    expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
  } else {
    expect(setup.status()).toBe(201)
  }

  const models = await (await page.request.get('/api/v1/models')).json()
  expect(models.models).toHaveLength(10)
  for (const [index, modelId] of evidence.baseModelIds.entries()) {
    const model = models.models.find((item: { modelId: string }) => item.modelId === modelId)
    expect(model, `缺少恢复模型 ${modelId}`).toBeTruthy()
    expect(model.artifactRunId).toBe(evidence.baseArtifactRunIds[index])
    expect(model.state).toBe('ready')
  }

  const coverage = await (await page.request.get('/api/v1/models/coverage?limit=100')).json()
  expect(coverage.latestImport.status).toBe('partial')
  expect(coverage.latestImport.packageSha256).toBe(evidence.mixedPackageSha256)
  expect(coverage.latestImport.registeredCount).toBe(1)
  expect(coverage.latestImport.conflictCount).toBe(1)
  expect(coverage.latestImport.failedCount).toBe(1)
  expect(coverage.datasets[0].methods).toHaveLength(9)

  const publicModels = await (await page.request.get('/api/v1/repository-models')).json()
  const publicSelectable = publicModels.models
    .filter((model: { repositoryPredictionSupported: boolean }) => model.repositoryPredictionSupported)
    .map((model: { modelId: string }) => model.modelId)
    .sort()
  const adminSelectable = models.models
    .filter((model: { state: string; enabled: boolean; featureSchemaVersion: string }) =>
      model.state === 'ready' && model.enabled
      && ['openstack-six-v1', 'kamei14-git-v1'].includes(model.featureSchemaVersion))
    .map((model: { modelId: string }) => model.modelId)
    .sort()
  expect(publicSelectable).toEqual(adminSelectable)
  expect(models.readiness.userSelectableModels).toBe(publicSelectable.length)

  await page.goto('/#/admin/models')
  await expect(page.getByRole('heading', { name: '模型管理', exact: true }))
    .toBeVisible({ timeout: 30000 })
  await expect(page.getByLabel('数据集与方法训练覆盖')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('公开大型 JIT 基准')).toBeVisible({ timeout: 30000 })
  const packagePanel = page.getByLabel('模型包交付')
  await expect(packagePanel).toContainText('部分导入', { timeout: 30000 })
  for (const item of evidence.mixed.items.filter((entry: { status: string }) =>
    entry.status === 'conflict' || entry.status === 'failed')) {
    await expect(packagePanel).toContainText(item.message)
  }
  await expect(page.getByText('10 个已登记', { exact: true })).toBeVisible()
  await expect(page.getByText(`${publicSelectable.length} 个用户可选`, { exact: true })).toBeVisible()
  const detail = page.getByRole('button', { name: /查看模型详情$/ }).first()
  await detail.focus()
  await expect(detail).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/admin\/models\/[^/]+$/)
  await page.goto('/#/admin/models')
  await expect(page.getByLabel('模型包交付')).toContainText('部分导入', { timeout: 30000 })

  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.screenshot({
      path: `${ensureDir(runScreenshotDir)}/model-package-recovery-${width}.png`,
      fullPage: true,
    })
    await expectNoOverflow(page)
  }
})
