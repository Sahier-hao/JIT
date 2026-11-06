import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

const account = { username: 'bundled-admin', password: 'isolated-bundled-password' }
const evidencePath = resolve(
  process.cwd(),
  '../docs/evidence/_run/fixtures/bundled-model-bootstrap.json',
)
const coveragePath = resolve(
  process.cwd(),
  '../docs/evidence/_run/bundled-model-bootstrap-coverage.json',
)

async function expectNoOverflow(page: import('@playwright/test').Page) {
  const size = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(size.scrollWidth, JSON.stringify(size)).toBeLessThanOrEqual(size.innerWidth)
}

test('空仓标准初始化后九个仓库内置模型直接可见', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '内置模型恢复闭环只跑一个浏览器项目')
  test.setTimeout(180000)
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'))
  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) {
    expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
  } else {
    expect(setup.status()).toBe(201)
  }

  const listing = await (await page.request.get('/api/v1/models')).json()
  expect(listing.models).toHaveLength(9)
  expect(listing.readiness.readyModels).toBe(9)
  expect(listing.readiness.userSelectableModels).toBe(9)
  const importedIds = new Set(evidence.models.map((item: { sourceModelId: string }) => item.sourceModelId))
  const importedRuns = new Set(evidence.models.map((item: { artifactRunId: string }) => item.artifactRunId))
  expect(new Set(listing.models.map((item: { modelId: string }) => item.modelId))).toEqual(importedIds)
  expect(new Set(listing.models.map((item: { artifactRunId: string }) => item.artifactRunId))).toEqual(importedRuns)

  const choices = await (await page.request.get('/api/v1/repository-models')).json()
  const selectable = choices.models.filter((item: { repositoryPredictionSupported: boolean }) =>
    item.repositoryPredictionSupported)
  expect(selectable).toHaveLength(9)
  expect(new Set(selectable.map((item: { method: string }) => item.method))).toEqual(
    new Set(evidence.models.map((item: { method: string }) => item.method)),
  )

  const coverage = await (await page.request.get('/api/v1/models/coverage?limit=100')).json()
  expect(coverage.datasets).toHaveLength(1)
  expect(coverage.datasets[0].methods).toHaveLength(9)
  expect(coverage.latestImport.status).toBe('completed')
  expect(coverage.latestImport.packageName).toBe(evidence.packageName)
  expect(coverage.latestImport.packageSha256).toBe(evidence.packageSha256)
  mkdirSync(resolve(coveragePath, '..'), { recursive: true })
  writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, 'utf-8')

  await page.goto('/#/admin/models')
  await expect(page.getByRole('heading', { name: '模型管理', exact: true }))
    .toBeVisible({ timeout: 30000 })
  const packagePanel = page.getByLabel('模型包交付')
  await expect(packagePanel).toContainText('导入完成', { timeout: 30000 })
  await expect(packagePanel).toContainText(evidence.packageSha256)
  await expect(page.getByText('9 个已登记', { exact: true })).toBeVisible()
  await expect(page.getByText('9 个用户可选', { exact: true })).toBeVisible()
  await expect(page.getByLabel('数据集与方法训练覆盖')).toBeVisible()

  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.screenshot({
      path: `${ensureDir(runScreenshotDir)}/bundled-model-bootstrap-${width}.png`,
      fullPage: true,
    })
    await expectNoOverflow(page)
  }
})
