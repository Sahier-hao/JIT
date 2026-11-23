import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { REPOSITORY } from './repository-setup.ts'
import { ensureDir, runEvidenceDir, runScreenshotDir } from '../evidence.ts'
import { loginOrCreateUser } from './support/user-session.ts'

const explanationCalls: { method: string; url: string; status: number }[] = []

test.beforeEach(async ({ page }) => {
  explanationCalls.length = 0
  await loginOrCreateUser(page)
  page.on('response', (response) => {
    const url = response.url()
    if (/\/api\/v1\/repositories\/[^/]+\/commits\/[^/]+\/explanation/.test(url)) {
      explanationCalls.push({
        method: response.request().method(),
        url: new URL(url).pathname + new URL(url).search,
        status: response.status(),
      })
    }
  })
})

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function completedJob(request: APIRequestContext, id: string) {
  let job: Record<string, unknown> = {}
  await expect.poll(async () => {
    job = await (await request.get(`/api/v1/repository-syncs/${id}`)).json()
    return job.status
  }, { timeout: 120000, intervals: [300, 500, 1000] }).toBe('completed')
  return job
}

test('固定分析生成两种解释并刷新重开、切换提交和窄屏核对', async ({ page }, info) => {
  test.setTimeout(240000)
  const created = await page.request.post('/api/v1/repositories', { data: { repositoryUrl: REPOSITORY.replaceAll('\\', '/') } })
  expect(created.ok()).toBe(true)
  const project = await created.json()

  await page.goto(`/#/projects/${project.repositoryId}/analyses`)
  await page.getByRole('button', { name: '分析分支提交', exact: true }).first().click()
  const choices = await (await page.request.get('/api/v1/repository-models')).json()
  const logistic = choices.models.find((model: { method: string; featureSchemaVersion: string }) =>
    model.method === 'logistic-regression-l2-v1' && model.featureSchemaVersion === 'openstack-six-v1')
  expect(logistic).toBeTruthy()
  await page.getByLabel('模型来源', { exact: true }).selectOption(logistic.modelId)
  const posted = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/v1/repository-syncs'))
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  const job = await (await posted).json()
  const record = page.getByRole('article', { name: `分析记录 ${job.syncId}`, exact: true })
  await expect(record.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 120000 })
  const actual = await completedJob(page.request, job.syncId)
  expect(actual.modelId).toBe(logistic.modelId)
  await record.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '打开结果', exact: true }).click()

  const first = page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ }).first()
  await expect(first).toBeVisible()
  const sha = (await first.getAttribute('title'))!
  await first.click()
  const detail = page.getByRole('dialog', { name: '提交详情' })
  await expect(detail).toBeVisible()

  const selector = detail.getByLabel('解释方法')
  await expect(selector).toBeVisible()
  await expect(selector.locator('option')).toHaveCount(2)

  // 显式生成遮挡解释（probability）。
  await selector.selectOption('occlusion-mean-v1')
  await detail.getByRole('button', { name: '生成模型解释' }).click()
  await expect(detail.getByRole('button', { name: '生成模型解释' })).toBeHidden({ timeout: 90000 })
  await expect(detail.getByRole('columnheader', { name: /带符号贡献（概率变化）/ })).toBeVisible()
  await expect(detail.getByText('解释方法与来源')).toBeVisible()
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/explanation-occlusion-${info.project.name}.png`, fullPage: false })

  // 显式生成逻辑回归 log-odds 解释（logit），不覆盖遮挡解释。
  await selector.selectOption('linear-logodds-v1')
  await detail.getByRole('button', { name: '生成模型解释' }).click()
  await expect(detail.getByRole('button', { name: '生成模型解释' })).toBeHidden({ timeout: 90000 })
  await expect(detail.getByText(/贡献合计：.*（log-odds）/)).toBeVisible()
  await expect(detail.getByRole('columnheader', { name: /带符号贡献（log-odds 变化）/ })).toBeVisible()

  // 两种方法并列核对，不求和、不共享排名。
  await expect(detail.getByText('多方法并列核对')).toBeVisible()
  await expect(detail.getByText('不同方法单位不同，不求和、不共享排名、不自动选择“最佳解释”。')).toBeVisible()
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/explanation-methods-${info.project.name}.png`, fullPage: false })

  // 切换回遮挡解释，仍能读到已保存结果（不重新生成）。
  const postsBeforeSwitch = explanationCalls.filter((call) => call.method === 'POST' && call.url.includes('/explanation?')).length
  await selector.selectOption('occlusion-mean-v1')
  await expect(detail.getByRole('columnheader', { name: /带符号贡献（概率变化）/ })).toBeVisible()
  expect(explanationCalls.filter((call) => call.method === 'POST' && call.url.includes('/explanation?')).length).toBe(postsBeforeSwitch)

  // 刷新重开：关闭后重新打开同一提交，保存的解释仍可读。
  await page.keyboard.press('Escape')
  await expect(detail).not.toBeVisible()
  await page.getByRole('button', { name: `查看 ${sha}` }).click()
  const reopened = page.getByRole('dialog', { name: '提交详情' })
  await expect(reopened).toBeVisible()
  await expect(reopened.getByLabel('解释方法')).toBeVisible()
  await reopened.getByLabel('解释方法').selectOption('linear-logodds-v1')
  await expect(reopened.getByText(/贡献合计：.*（log-odds）/)).toBeVisible()

  // 切换提交：另一提交尚未生成解释，不应读到前一提交的结果。
  await page.keyboard.press('Escape')
  const second = page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ }).nth(1)
  await expect(second).toBeVisible()
  await second.click()
  const other = page.getByRole('dialog', { name: '提交详情' })
  await expect(other).toBeVisible()
  await expect(other.getByText(/尚未生成该方法的模型解释/)).toBeVisible()

  // 窄屏查看，确认没有横向溢出。
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/explanation-narrow-${info.project.name}.png`, fullPage: false })

  writeFileSync(`${ensureDir(runEvidenceDir)}/explanation-requests.json`, `${JSON.stringify(explanationCalls, null, 2)}\n`, 'utf-8')
  expect(explanationCalls.some((call) => call.method === 'POST' && call.url.includes('method=occlusion-mean-v1'))).toBe(true)
  expect(explanationCalls.some((call) => call.method === 'POST' && call.url.includes('method=linear-logodds-v1'))).toBe(true)
  expect(explanationCalls.some((call) => call.url.includes('/explanation-methods?'))).toBe(true)
  expect(explanationCalls.some((call) => call.url.includes('/explanations?'))).toBe(true)
})
