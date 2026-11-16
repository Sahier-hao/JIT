// 隔离前端的真实浏览器旅程：登录 → 项目 → 分析口径与分区标签。
const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:18831'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const failures = []
  page.on('pageerror', error => failures.push(String(error)))
  await page.goto(`${BASE}/#/login?role=user`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户账户名').fill('nightuser')
  await page.getByLabel('用户密码').fill('night-password-123')
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForTimeout(3000)
  console.log('URL after login:', page.url())
  console.log('body:', (await page.locator('body').innerText()).slice(0, 500))
  await page.waitForURL(/projects/, { timeout: 30000 })
  await page.getByRole('button', { name: '打开项目' }).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('tab', { name: '分析' }).click().catch(async () => {
    await page.getByRole('button', { name: '分析', exact: true }).click()
  })
  await page.waitForSelector('.analysis-scope', { timeout: 60000 })
  const scope = await page.locator('.analysis-scope').innerText()
  const chips = await page.locator('.partition-chip').allInnerTexts()
  const tabs = await page.locator('.scope-views button, [aria-pressed]').allInnerTexts().catch(() => [])
  await page.screenshot({ path: 'docs/evidence/2026-11-11-project-scope.png', fullPage: true })
  console.log(JSON.stringify({
    scope: scope.slice(0, 600), chips: chips.slice(0, 20), tabs, pageErrors: failures,
  }, null, 2))
  await browser.close()
  if (failures.length) process.exit(1)
})()
