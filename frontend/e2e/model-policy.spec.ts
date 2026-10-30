import { test, expect, type APIRequestContext } from '@playwright/test'
import { REPOSITORY } from './repository-setup.ts'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

const account = { username: 'e2e-admin', password: 'isolated-e2e-admin-password' }
const timeout = 30_000
async function expectNoOverflow(page: import('@playwright/test').Page) {
  const offenders = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
    .map(element => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.left < -1 || box.right > innerWidth + 1)
    .slice(0, 20)
    .map(({ element, box }) => ({
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className : '',
      text: (element.textContent ?? '').trim().slice(0, 80),
      left: Math.round(box.left),
      right: Math.round(box.right),
    })))
  expect(offenders, JSON.stringify(offenders)).toEqual([])
}
async function finished(request: APIRequestContext, id: string) {
  let job: Record<string, unknown> = {}
  await expect.poll(async () => {
    job = await (await request.get(`/api/v1/repository-syncs/${id}`)).json()
    return job.status
  }, { timeout: 90000, intervals: [300, 500, 1000] }).toMatch(/completed|failed/)
  expect(job.status, JSON.stringify(job)).toBe('completed')
  return job
}

test('管理员设置默认、用户指定优先、停用拦截及历史保留', async ({ page }, info) => {
  test.setTimeout(180000)
  if (info.project.name === 'desktop-1440') await page.setViewportSize({ width: 390, height: 844 })
  const setup = await page.request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
  else expect(setup.status()).toBe(201)
  const models = (await (await page.request.get('/api/v1/repository-models')).json()).models
  const original = models.find((m: { isDefault: boolean }) => m.isDefault)
  const lr = models.find((m: { method: string }) => m.method === 'logistic-regression-l2-v1')
  const tree = models.find((m: { method: string }) => m.method === 'decision-tree-v1')
  expect(lr && tree && original).toBeTruthy()
  try {
    await page.goto('/#/admin/models')
    const treeCard = page.getByRole('heading', { name: tree.name, exact: true }).locator('..')
    await expect(treeCard).toBeVisible({ timeout })
    await treeCard.getByRole('button', { name: '设为默认', exact: true }).click()
    await expect(treeCard.getByText('默认模型', { exact: true })).toBeVisible({ timeout })
    await expect(treeCard.getByRole('button', { name: '停用模型' })).toBeDisabled()
    const project = await (await page.request.post('/api/v1/repositories', { data: { repositoryUrl: REPOSITORY.replaceAll('\\', '/') } })).json()
    await page.goto(`/#/projects/${project.repositoryId}`)
    await page.getByRole('button', { name: '发起分析', exact: true }).first().click()
    await expect(page.getByText(`管理员默认模型：${tree.name}。`, { exact: false })).toBeVisible({ timeout })
    await page.getByLabel('起始日期', { exact: true }).fill('2024-01-01')
    const until = page.getByLabel('结束日期', { exact: true })
    if (!await until.isVisible()) await page.locator('details.advanced-options summary').click()
    await until.fill('2024-01-08')
    await page.getByLabel('提交上限', { exact: true }).fill(info.project.name === 'desktop-1280' ? '441' : '442')
    await page.getByLabel('模型来源', { exact: true }).selectOption('default')
    let response = page.waitForResponse(r => r.url().endsWith('/api/v1/repository-syncs') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '开始分析', exact: true }).click()
    const defaultJob = await (await response).json()
    expect(defaultJob.resolvedModelId).toBe(tree.modelId)
    expect(defaultJob.requestedModelId).toBeNull()
    expect((await finished(page.request, defaultJob.syncId)).modelId).toBe(tree.modelId)
    await page.getByRole('button', { name: '发起分析', exact: true }).first().click()
    await page.getByLabel('模型来源', { exact: true }).selectOption(lr.modelId)
    response = page.waitForResponse(r => r.url().endsWith('/api/v1/repository-syncs') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '开始分析', exact: true }).click()
    const explicit = await (await response).json()
    expect((await finished(page.request, explicit.syncId)).modelId).toBe(lr.modelId)
    await page.goto('/#/admin/models')
    const lrCard = page.getByRole('heading', { name: lr.name, exact: true }).locator('..')
    await expect(lrCard).toBeVisible({ timeout })
    await lrCard.getByRole('button', { name: '停用模型', exact: true }).click()
    await expect(page.getByRole('group', { name: '确认停用模型' })).toBeVisible()
    await page.getByRole('button', { name: '确认停用', exact: true }).click()
    await expect(lrCard.getByText('已停用', { exact: true })).toBeVisible({ timeout })
    await expectNoOverflow(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/model-policy-admin-${info.project.name}.png`, fullPage: true })
    expect((await page.request.post('/api/v1/repository-syncs', { data: { repositoryUrl: REPOSITORY.replaceAll('\\', '/'), strategy: 'generic-model', modelId: lr.modelId } })).status()).toBe(409)
    expect((await page.request.get(`/api/v1/repository-syncs/${explicit.syncId}/commits`)).ok()).toBe(true)
    await page.goto(`/#/projects/${project.repositoryId}`)
    await page.getByRole('button', { name: '发起分析', exact: true }).first().click()
    await expect(page.getByText(/原选模型已停用或不可用/)).toBeVisible({ timeout })
    await expect(page.getByRole('button', { name: '开始分析', exact: true })).toBeDisabled()
    await page.getByLabel('模型来源', { exact: true }).selectOption('default')
    await expect(page.getByRole('button', { name: '开始分析', exact: true })).toBeEnabled()
    await expect(page.getByText(`管理员默认模型：${tree.name}。`, { exact: false })).toBeVisible({ timeout })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/model-policy-project-${info.project.name}.png`, fullPage: true })
    await expectNoOverflow(page)
    await page.request.post('/api/admin/logout')
    expect((await page.request.patch(`/api/v1/models/${lr.modelId}/policy`, { data: { enabled: true } })).status()).toBe(401)
  } finally {
    await page.request.post('/api/admin/login', { data: account })
    expect((await page.request.patch(`/api/v1/models/${lr.modelId}/policy`, { data: { enabled: true } })).ok()).toBe(true)
    expect((await page.request.patch(`/api/v1/models/${original.modelId}/policy`, { data: { isDefault: true } })).ok()).toBe(true)
  }
})
