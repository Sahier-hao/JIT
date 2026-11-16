import { expect, test, type APIRequestContext } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import { LARGE_REPOSITORY } from './repository-setup.ts'
import { loginOrCreateUser } from './support/user-session.ts'

const account = { username: 'current-schema-admin', password: 'isolated-current-schema-password' }

async function waitForSync(request: APIRequestContext, syncId: string) {
  let job: Record<string, unknown> = {}
  await expect.poll(async () => {
    job = await (await request.get(`/api/v1/repository-syncs/${syncId}`)).json()
    return job.status
  }, { timeout: 180000, intervals: [300, 500, 1000] }).toMatch(/completed|failed/)
  expect(job.status, JSON.stringify(job)).toBe('completed')
  return job
}

test('当前 v2 正式包、项目分析、模型卡与发布报告形成真实闭环', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '当前 schema 闭环只跑一个浏览器项目')
  test.setTimeout(240000)
  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) {
    expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
  } else {
    expect(setup.status()).toBe(201)
  }
  await loginOrCreateUser(page)

  const catalog = await (await page.request.get('/api/v1/models')).json()
  const current = catalog.models.filter((model: {
    featureSchemaVersion: string
    state: string
    enabled: boolean
  }) => model.featureSchemaVersion === 'kamei14-git-v2' && model.state === 'ready' && model.enabled)
  expect(current.length).toBeGreaterThanOrEqual(8)
  const defaults = current.filter((model: { isDefault: boolean }) => model.isDefault)
  expect(defaults).toHaveLength(1)
  const model = defaults[0]
  const release = await (await page.request.get(`/api/v1/models/${model.modelId}/release`)).json()
  expect(release.available).toBe(true)
  expect(release.report.status).toBe('qualified')
  expect(release.report.approvedDefault.approvedBy).toBeTruthy()
  expect((await request.get(`/api/v1/models/${model.modelId}/release`)).status()).toBe(401)

  const projectResponse = await page.request.post('/api/v1/repositories', {
    data: { repositoryUrl: LARGE_REPOSITORY.replaceAll('\\', '/') },
  })
  expect(projectResponse.ok()).toBeTruthy()
  const project = await projectResponse.json()
  await page.goto(`/#/projects/${project.repositoryId}`)
  await page.getByRole('button', { name: '发起分析', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('模型来源', { exact: true }).selectOption('default')
  await expect(dialog.getByLabel('模型来源', { exact: true })).toHaveValue('default')
  const response = page.waitForResponse(item =>
    item.url().endsWith('/api/v1/repository-syncs') && item.request().method() === 'POST')
  await dialog.getByRole('button', { name: '开始分析', exact: true }).click()
  const sync = await (await response).json()
  const completed = await waitForSync(page.request, sync.syncId)
  expect(completed.modelStrategy).toBe('generic-model')
  expect(completed.modelId).toBe(model.modelId)
  expect(completed.datasetVersion).toContain('kamei14-git-v2')

  await page.goto(`/#/admin/models/${model.modelId}`)
  await expect(page.getByRole('heading', { name: '发布资格', exact: true })).toBeVisible()
  await expect(page.getByText('已通过 jit-release-v1 发布门槛', { exact: true })).toBeVisible()
  await expect(page.getByText(release.reportId, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /停用|重训/ })).toHaveCount(0)

  await page.goto('/#/admin/models')
  const packagePanel = page.getByLabel('模型包交付')
  await expect(packagePanel).toContainText('jit-current-v2-models-v1.zip', { timeout: 30000 })
  await expect(packagePanel).toContainText('完成')
  await page.screenshot({
    path: `${ensureDir(runScreenshotDir)}/current-schema-model-package-1280.png`,
    fullPage: true,
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
