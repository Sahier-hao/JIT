import { expect, test } from '@playwright/test'

// 固定仓库项目分析到 PR 续审的浏览器旅程：真实隔离服务、独立数据库、两个账户。
// 服务由 playwright.regression-pr.config.ts 启动，不能用默认套件冒充该旅程。
const API = process.env.JIT_REGRESSION_API ?? 'http://127.0.0.1:18860'

async function context(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`${API}/__test/context`)
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<{ repositoryId: string }>
}

async function register(page: import('@playwright/test').Page, user: string, password: string) {
  await page.goto('/#/login?role=user')
  await page.getByRole('button', { name: '还没有账户？注册一个' }).click()
  await page.getByLabel('用户账户名').fill(user)
  await page.getByLabel('用户密码').fill(password)
  await page.getByRole('button', { name: '注册并进入' }).click()
  await expect(page).toHaveURL(/#\/projects/)
}

async function login(page: import('@playwright/test').Page, user: string, password: string) {
  const response = await page.request.post('/api/user/login', { data: { username: user, password } })
  expect(response.ok()).toBeTruthy()
  await page.goto('/#/projects')
  await page.reload()
  await expect(page).toHaveURL(/#\/projects/)
}

async function openPreview(page: import('@playwright/test').Page, repositoryId: string) {
  await page.goto(`/#/projects/${repositoryId}/prs`)
  const row = page.getByRole('article').filter({ has: page.getByRole('heading', { name: /^#1 修正审查示例/ }) })
  await row.getByRole('button', { name: /^(查看 PR|继续审查)$/ }).click({ timeout: 20_000 })
}

async function enterWork(page: import('@playwright/test').Page) {
  const readOnly = page.getByRole('button', { name: '查看只读版本' })
  const enter = page.getByRole('button', { name: '进入工作单' })
  const create = page.getByRole('button', { name: '创建审查工作单' })
  await expect.poll(async () => (await readOnly.count()) + (await enter.count()) + (await create.count()),
    { timeout: 30_000 }).toBeGreaterThan(0)
  if (await readOnly.count()) return
  if (await enter.count()) await enter.first().click()
  else await create.click()
}

async function seedNote(page: import('@playwright/test').Page, note: string) {
  await page.getByText('调整审查示例 1', { exact: false }).first().click()
  await page.getByLabel('个人笔记').fill(note)
  await expect(page.getByText('草稿已保存', { exact: false })).toBeVisible()
}

test('同一浏览器两个账户的个人工作单隔离并可分别续审', async ({ page, request }) => {
  const stamp = Date.now()
  const userA = `alice${stamp}`, userB = `bob${stamp}`
  const password = 'regression-pass-1'
  const { repositoryId } = await context(request)

  await register(page, userA, password)
  await openPreview(page, repositoryId)
  await enterWork(page)
  await seedNote(page, 'A 的回归旅程笔记')

  await page.reload()
  await page.getByText('调整审查示例 1', { exact: false }).first().click()
  await expect(page.getByLabel('个人笔记')).toHaveValue('A 的回归旅程笔记')

  const advanced = await request.post(`${API}/__test/remote`, { data: { index: 26 } })
  expect(advanced.ok()).toBeTruthy()
  await page.getByRole('button', { name: '检查 PR 更新' }).click()
  await page.getByRole('button', { name: '开始复核新版本' }).click()
  await expect(page.getByText('版本 26', { exact: false }).first()).toBeVisible()
  await page.getByText('调整审查示例 1', { exact: false }).first().click()
  await expect(page.getByLabel('个人笔记')).toHaveValue('A 的回归旅程笔记')

  await page.getByRole('button', { name: userA }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/#\/$/)

  await register(page, userB, password)
  await openPreview(page, repositoryId)
  await expect(page.getByText('A 的回归旅程笔记')).toHaveCount(0)
  await enterWork(page)
  await seedNote(page, 'B 的独立回归笔记')

  await page.getByRole('button', { name: userB }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await login(page, userA, password)
  await openPreview(page, repositoryId)
  await enterWork(page)
  await page.getByText('调整审查示例 1', { exact: false }).first().click()
  await expect(page.getByLabel('个人笔记')).toHaveValue('A 的回归旅程笔记')
  await expect(page.getByText('B 的独立回归笔记')).toHaveCount(0)
})
