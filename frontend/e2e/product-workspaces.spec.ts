import { test, expect, type Page } from '@playwright/test'
import { REPOSITORY } from './repository-setup.ts'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

async function connect(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  if (await page.locator('#credential-input').count()) {
    await page.getByLabel('团队访问凭据').fill('e2e-member-token')
    await page.getByRole('button', { name: '使用凭据' }).click()
  }
  await page.getByRole('button', { name: '返回之前页面' }).click()
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('真实本地仓库：接入、固定分析、详情、计划和跨空间返回', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#/connect')
  await connect(page)
  await page.getByLabel('仓库地址').fill(REPOSITORY.replaceAll('\\', '/'))
  await page.getByText('高级参数：分支、时间范围与模型策略', { exact: true }).click()
  await page.getByLabel('从哪天开始').fill('2024-01-01')
  await page.getByLabel('到哪天结束').fill('2024-01-08')
  await page.getByLabel('最多提交数').fill(info.project.name === 'desktop-1280' ? '498' : '499')
  const posted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/repository-syncs'))
  await page.getByRole('button', { name: '开始同步' }).click()
  const job = await (await posted).json()
  const open = page.getByRole('article', { name: `同步作业 ${job.syncId}` }).getByRole('button', { name: '去工作台看这批提交的风险' })
  await expect(open).toBeVisible({ timeout: 120_000 })
  await open.click()
  await expect(page).toHaveURL(/\/analyses\/[0-9a-f-]{36}\/commits$/)
  expect(page.url()).toContain(`/analyses/${job.syncId}/`)
  await expect(page.getByText('7 个已分析提交')).toBeVisible()
  const rows = page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ })
  await expect(rows).toHaveCount(7)
  const readability = await page.locator('.space-link, .review-toolbar input, .review-toolbar select, .review-table .commit-title, .primary-button, .clear-button').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => ({ text: element.textContent?.slice(0, 30), size: Number.parseFloat(getComputedStyle(element).fontSize) })))
  expect(readability.filter(item => item.size < 14)).toEqual([])
  const sha = (await rows.first().getAttribute('title'))!
  await rows.first().focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '提交详情' })
  await expect(dialog).toContainText(sha)
  await expect(dialog).toContainText('E2E')
  await expect(dialog).toContainText('预测解释未提供')
  await expect(dialog).toContainText('未提供可用外链')
  await page.keyboard.press('Escape')
  await expect(rows.first()).toBeFocused()
  await page.getByRole('button', { name: `加入 ${sha} 到清单` }).click()
  const pinned = page.url()
  await page.getByRole('button', { name: '审查计划', exact: true }).click()
  await expect(page.getByText('已知规模', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '外观与阅读' }).click()
  await page.getByRole('button', { name: '紧凑' }).click()
  await page.getByRole('button', { name: '返回之前页面' }).click()
  await expect(page.url()).toContain('/plan')
  await page.getByRole('button', { name: '已分析提交', exact: true }).click()
  await expect(page).toHaveURL(pinned)
  await expect(page.getByRole('button', { name: `${sha} 已在清单` })).toBeDisabled()
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/product-${info.project.name}.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: `查看 ${sha}` }).click()
  await expect(dialog).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/product-narrow-${info.project.name}.png`, fullPage: true })
})

test('公开历史验证、同一运行趋势与下钻无需团队凭据', async ({ page }) => {
  await page.goto('/#/validation')
  await expect(page).toHaveURL(/\/lab\/history\/[a-f0-9]{64}\/commits$/)
  const run = page.url().split('/history/')[1].split('/')[0]
  await page.getByRole('button', { name: '历史趋势', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/history/${run}/trends$`))
  await expect(page.getByRole('heading', { name: '历史趋势', exact: true })).toBeVisible()
  const drill = page.getByRole('button', { name: /^查看该桶提交/ }).first()
  if (await drill.count()) {
    await drill.click()
    await expect(page).toHaveURL(new RegExp(`/history/${run}/commits$`))
    await expect(page.getByLabel('起始日期')).not.toHaveValue('')
  } else {
    await expect(page.getByText('该运行未提供趋势聚合')).toBeVisible()
  }
  await noOverflow(page)
})

test('手工预测与旧地址只读重开保存结果', async ({ page }) => {
  await page.goto('/#/lab/predict')
  await connect(page)
  const select = page.getByRole('radio').first()
  await expect(select).toBeVisible()
  // Field labels and source checks are exercised against the actual model catalog.
  await select.check()
  await page.locator('#predict-field-project').fill('product-browser-fixture')
  await page.locator('#predict-field-recordId').fill('product-record')
  for (const [label, value] of Object.entries({ ns: '1', nd: '2', nf: '3', ent: '0.8', la: '10', ld: '2' })) await page.locator(`#predict-field-${label}`).fill(value)
  await page.getByRole('button', { name: '提交并保存预测' }).click()
  await expect(page).toHaveURL(/\/lab\/results\/[0-9a-f-]{36}$/)
  const batchId = page.url().split('/results/')[1]
  await expect(page.getByRole('region', { name: '风险估计' }).getByText('product-record', { exact: true })).toBeVisible()
  await page.goto(`/#/predictions/${batchId}`)
  await page.reload()
  await connect(page)
  await expect(page.getByRole('region', { name: '风险估计' }).getByText('product-record', { exact: true })).toBeVisible()
  await noOverflow(page)
})

test('规范地址与旧地址矩阵可定位，未知与冲突来源有反馈', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const batch = await (await page.request.get('/api/review-batch')).json()
  for (const path of ['/#/projects', '/#/repositories', '/#/sources', '/#/connect', '/#/models', '/#/lab/models', '/#/predict', '/#/lab/predict', '/#/predictions', '/#/lab/results', '/#/settings/appearance', '/#/settings/connection', '/#/shortlist', '/#/lab/demo/commits', `/#/lab/history/${batch.runId}/commits`, `/#/lab/history/${batch.runId}/trends`]) {
    await page.goto(path)
    await expect(page.locator('#product-main')).not.toHaveText('')
    await expect(page.getByText('未识别的页面地址', { exact: true })).toHaveCount(0)
  }
  await page.goto('/?mode=repository&sync=11111111-1111-4111-8111-111111111111')
  await expect(page).toHaveURL(/\/legacy\/sync\/11111111-1111-4111-8111-111111111111\/commits/)
  await page.getByRole('button', { name: '设置团队连接' }).click()
  await page.getByRole('button', { name: '返回之前页面' }).click()
  await expect(page).toHaveURL(/\/legacy\/sync\/11111111-1111-4111-8111-111111111111\/commits/)
  await page.goto('/?mode=demo&sync=conflicting')
  await expect(page.getByText('地址来源冲突', { exact: true })).toBeVisible()
  await page.goto('/#/unknown-page')
  await expect(page.getByText('未识别的页面地址', { exact: true })).toBeVisible()
  await page.goto(`/#/lab/history/${'0'.repeat(64)}/commits`)
  await expect(page.getByText('该历史运行未供给')).toBeVisible()
  expect(errors).toEqual([])
})

test('本地素材可独立加载，主题首帧与 reduced-motion 保留', async ({ page }) => {
  const external: string[] = []
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.origin); return route.abort() }
    return route.continue()
  })
  await page.addInitScript(() => { localStorage.setItem('jit.theme', 'charcoal'); localStorage.setItem('jit.density', 'compact') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/lab/demo/commits')
  await expect(page.getByRole('button', { name: '查看 demo-0001' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const preferences = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, density: document.documentElement.dataset.density, motion: getComputedStyle(document.querySelector('.space-link')!).transitionDuration }))
  expect(preferences).toEqual({ theme: 'charcoal', density: 'compact', motion: '0s' })
  expect(external).toEqual([])
})
