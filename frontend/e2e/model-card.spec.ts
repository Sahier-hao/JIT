import { expect, test } from '@playwright/test'
import { REPOSITORY } from './repository-setup.ts'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

const account = { username: 'e2e-admin', password: 'isolated-e2e-admin-password' }

test('项目与管理端复用只读模型卡并保持分析草稿', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '模型卡闭环只跑一个浏览器项目')
  test.setTimeout(180_000)
  const modelsResponse = await page.request.get('/api/v1/repository-models')
  expect(modelsResponse.ok()).toBeTruthy()
  const models = (await modelsResponse.json()).models as Array<{ modelId: string; repositoryPredictionSupported: boolean }>
  const model = models.find(item => item.repositoryPredictionSupported)
  expect(model).toBeTruthy()

  const projectResponse = await page.request.post('/api/v1/repositories', {
    data: { repositoryUrl: REPOSITORY.replaceAll('\\', '/') },
  })
  expect(projectResponse.ok()).toBeTruthy()
  const project = await projectResponse.json()
  const cardResponse = await page.request.get(`/api/v1/model-cards/${model!.modelId}`)
  expect(cardResponse.ok()).toBeTruthy()
  const card = await cardResponse.json()
  expect(card.modelId).toBe(model!.modelId)
  expect(card.metricsByPartition.test.available).toBe(true)
  expect(card.metricsByPartition.train.available).toBe(true)
  expect(card.benefit.available).toBe(true)
  expect(JSON.stringify(card)).not.toContain('artifactPath')
  expect(JSON.stringify(card)).not.toContain('sqlite')

  await page.goto(`/#/projects/${project.repositoryId}`)
  await page.getByRole('button', { name: '发起分析', exact: true }).first().click()
  const branch = page.getByLabel('分支', { exact: true })
  await branch.fill('model-card-draft')
  await page.getByLabel('模型来源', { exact: true }).selectOption(model!.modelId)
  await page.getByRole('button', { name: '查看模型卡', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '模型卡' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: card.name, exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '拟合诊断', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '模型选择背景', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '冻结泛化评价', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '审查收益', exact: true })).toBeVisible()
  await expect(dialog.getByText(card.benefit.conclusion.sentence, { exact: true })).toBeVisible()
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/model-card-project-1280.png`, fullPage: true })
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  await expect(page.getByLabel('模型来源', { exact: true })).toHaveValue(model!.modelId)
  await expect(branch).toHaveValue('model-card-draft')

  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) {
    expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBeTruthy()
  } else {
    expect(setup.status()).toBe(201)
  }
  await page.goto(`/#/admin/models/${model!.modelId}`)
  await expect(page.getByRole('heading', { name: card.name, exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '分区指标', exact: true })).toBeVisible()
  await expect(page.getByText('原产物运行', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`).toBe(true)
    await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/model-card-admin-${width}.png`, fullPage: true })
  }
})
