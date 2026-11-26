import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import { LARGE_REPOSITORY } from './repository-setup.ts'

const account = { username: 'large-repo-admin', password: 'isolated-large-repo-password' }

async function completeSync(request: APIRequestContext, syncId: string) {
  let job: Record<string, unknown> = {}
  await expect.poll(async () => {
    job = await (await request.get(`/api/v1/repository-syncs/${syncId}`)).json()
    return job.status
  }, { timeout: 180000, intervals: [300, 500, 1000] }).toMatch(/completed|failed/)
  expect(job.status, JSON.stringify(job)).toBe('completed')
  return job
}

async function startAnalysis(page: Page) {
  await page.getByRole('button', { name: '分析分支提交', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '开始分析', exact: true })).toBeEnabled()
  await expect(dialog.getByLabel('时间切分预设')).toHaveCount(0)
  const response = page.waitForResponse(item => item.url().endsWith('/api/v1/repository-syncs') && item.request().method() === 'POST')
  await dialog.getByRole('button', { name: '开始分析', exact: true }).click()
  return (await response).json()
}

test('大型仓库完成现成模型、自动训练、强制训练和管理员指标回看', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '大型仓库闭环只跑一个浏览器项目')
  test.setTimeout(600000)
  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
  else expect(setup.status()).toBe(201)
  const project = await (await page.request.post('/api/v1/repositories', {
    data: { repositoryUrl: LARGE_REPOSITORY.replaceAll('\\', '/') },
  })).json()
  await page.goto(`/#/projects/${project.repositoryId}/analyses`)

  const generic = await startAnalysis(page)
  const genericDone = await completeSync(page.request, generic.syncId)
  expect(genericDone.modelStrategy).toBe('generic-model')
  expect(genericDone.modelId).toBeTruthy()

  // 旧策略只用于回归历史训练和管理员回看。项目界面只发起现成模型打分。
  const legacyTraining = async (strategy: 'auto' | 'force-train') => {
    const response = await page.request.post('/api/v1/repository-syncs', {
      data: { repositoryUrl: LARGE_REPOSITORY.replaceAll('\\', '/'), strategy },
    })
    expect(response.ok()).toBeTruthy()
    return response.json()
  }
  const automatic = await legacyTraining('auto')
  const automaticDone = await completeSync(page.request, automatic.syncId)
  expect(automaticDone.modelStrategy).toBe('repository-trained')
  expect(Number(automaticDone.trainRecords)).toBeGreaterThanOrEqual(200)
  expect(Number(automaticDone.trainPositives)).toBeGreaterThanOrEqual(20)
  expect(automaticDone.modelId).toBeTruthy()

  const forced = await legacyTraining('force-train')
  const forcedDone = await completeSync(page.request, forced.syncId)
  expect(forcedDone.modelStrategy).toBe('repository-trained')
  expect(forcedDone.modelId).toBeTruthy()

  const datasetResponse = await page.request.get('/api/v1/datasets/kamei14-git-v2-e2e-large-repo/versions')
  expect(datasetResponse.ok()).toBe(true)
  const largeDataset = (await datasetResponse.json()).versions.find((item: { version: string }) => item.version === automaticDone.datasetVersion)
  expect(largeDataset).toBeTruthy()
  expect(largeDataset.source.head).toMatch(/^[0-9a-f]{40}$/)
  expect(largeDataset.labelRule).toBeTruthy()
  expect(largeDataset.limitations.join(' ')).toContain('特征为提交级聚合')
  expect(largeDataset.quality.includedRows).toBeGreaterThanOrEqual(200)

  await page.goto(`/#/admin/models/${automaticDone.modelId}`)
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toHaveCount(0)
  await expect(page.getByText('训练来源', { exact: true })).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('AP', { exact: true })).toBeVisible()
  await expect(page.getByText('ROC-AUC', { exact: true })).toBeVisible()
  const detail = await (await page.request.get(`/api/v1/models/${automaticDone.modelId}`)).json()
  expect(typeof detail.metrics.averagePrecision.value).toBe('number')
  expect(detail.artifactDatasetVersion).toBe(automaticDone.datasetVersion)
  expect(detail.split.test.positiveCount).toBeGreaterThanOrEqual(3)

  await page.goto(`/#/admin/datasets/kamei14-git-v2-e2e-large-repo/${automaticDone.datasetVersion}`)
  await expect(page.getByText('提交级聚合', { exact: false }).first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: '用于训练', exact: true }).click()
  const trainingResponse = page.waitForResponse(item => item.url().endsWith('/api/v1/training-tasks') && item.request().method() === 'POST')
  await page.getByRole('button', { name: '创建训练任务', exact: true }).click()
  const training = await (await trainingResponse).json()
  let completed: Record<string, unknown> = {}
  await expect.poll(async () => {
    completed = await (await page.request.get(`/api/v1/training-tasks/${training.taskId}`)).json()
    return completed.status
  }, { timeout: 180000, intervals: [300, 500, 1000] }).toBe('succeeded')
  await page.goto(`/#/admin/training/${training.taskId}`)
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toBeVisible()
  await expect(page.getByText('AP', { exact: true })).toBeVisible()
  await expect(page.getByText(String(completed.runId), { exact: true })).toBeVisible()

  // 返回列表先清除旧详情，再从列表重新打开同一任务。
  await page.getByRole('button', { name: '返回任务列表', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练任务', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toHaveCount(0)
  await page.getByRole('button', { name: '查看', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toBeVisible()
  await expect(page.getByText(String(completed.runId), { exact: true })).toBeVisible()

  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/admin-large-repository-training-${width}.png`, fullPage: true })
  }
})
