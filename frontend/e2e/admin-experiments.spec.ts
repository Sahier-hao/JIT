import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const api = 'http://127.0.0.1:18769'
const evidence = fileURLToPath(new URL('../../docs/evidence/_run/admin-experiments-browser/', import.meta.url))
mkdirSync(evidence, { recursive: true })

async function signIn(page: Page) {
  const credentials = { username: 'report-admin', password: 'report-password-2026' }
  const setup = await page.request.post(`${api}/api/admin/setup`, { data: credentials })
  if (setup.status() === 409) {
    const login = await page.request.post(`${api}/api/admin/login`, { data: credentials })
    expect(login.ok()).toBeTruthy()
  } else {
    expect(setup.status()).toBe(201)
  }
}

test('管理员查看真实多项目报告并保持只读边界', async ({ page, request }) => {
  await expect.poll(async () => (await request.get(`${api}/__test/context`)).status(), { timeout: 120_000 }).toBe(200)
  const anonymous = await request.get(`${api}/api/admin/multi-project-reports`)
  expect(anonymous.status()).toBe(401)
  expect((await anonymous.json()).error.code).toBe('AUTH_REQUIRED')
  await signIn(page)

  await page.goto('/#/admin/experiments')
  await expect(page.getByRole('heading', { name: '多项目实验', exact: true })).toBeVisible()
  await expect(page.getByText('完整', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看', exact: true }).first().click()

  await expect(page.getByRole('heading', { name: '多项目实验报告' })).toBeVisible()
  await expect(page.getByText(/multi-project-report\.json/).first()).toBeVisible()
  await expect(page.getByText(/只读报告；宏平均不是全局最佳模型/)).toBeVisible()
  await expect(page.getByText('本地训练', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('0.4953').first()).toBeVisible()
  await expect(page.getByText('报告没有失败记录。')).toBeVisible()

  await page.locator('summary', { hasText: '全局+本地' }).click()
  await expect(page.getByText(/验证 Brier/).first()).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${evidence}report-detail.png`, fullPage: true })
})

test('管理员在模型详情看到模型并不优于时间或随机顺序的审查收益', async ({ page, request }) => {
  const context = await (await request.get(`${api}/__test/context`)).json()
  await signIn(page)
  await page.goto(`/#/admin/models/${context.modelId}`)
  await expect(page.getByRole('heading', { name: '审查收益' })).toBeVisible()
  await expect(page.getByText(/模型排序覆盖/)).toBeVisible()
  await expect(page.getByRole('rowheader', { name: '模型分数' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: '时间顺序' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: /随机（均值 ± 标准差）/ })).toBeVisible()
  await expect(page.getByText(/风险分数不是缺陷概率/)).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${evidence}model-benefit.png`, fullPage: true })
})
