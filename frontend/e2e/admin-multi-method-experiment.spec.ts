import { test, expect } from '@playwright/test'

const account = { username: 'multi-method-admin', password: 'isolated-multi-method-password' }

test.describe('多方法实验与项目使用', () => {
  test('从固定数据版本创建多方法实验、核对三档比较并显式登记', async ({ page }) => {
    test.setTimeout(600000)
    const setup = await page.request.post('/api/admin/setup', { data: account })
    if (setup.status() === 409) {
      expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
    } else {
      expect(setup.status()).toBe(201)
    }

    await page.goto('/#/admin/datasets/mp-redis-v2/mp-redis-v2-2022-01-01_2024-12-31')
    await page.getByRole('button', { name: '用于训练' }).click()
    const panel = page.getByRole('dialog', { name: '用于训练' })
    await panel.getByRole('radio', { name: '多方法实验' }).click()
    await expect(panel.getByRole('checkbox', { name: /逻辑回归/ })).toBeEnabled()
    await panel.getByRole('checkbox', { name: /逻辑回归/ }).check()
    await panel.getByRole('checkbox', { name: /决策树/ }).check()
    await panel.getByRole('checkbox', { name: /多层感知机/ }).check()
    await panel.getByLabel('逻辑回归 · L2 C').fill('0.5')
    await panel.getByLabel('决策树 · CART max_depth').fill('4')
    await panel.getByLabel('多层感知机（2 隐层） epochs').fill('3')
    await panel.getByRole('button', { name: '创建实验（3 个方法）' }).click()

    await expect(page).toHaveURL(/#\/admin\/training-experiment\//)
    const experimentId = page.url().split('/').pop()!
    await expect.poll(async () => {
      const body = await (await page.request.get(`/api/v1/training-experiments/${experimentId}`)).json()
      return body.status
    }, { timeout: 240000, intervals: [500, 1000, 2000] }).toBe('succeeded')

    await page.reload()
    await expect(page.getByRole('heading', { name: '训练实验' })).toBeVisible()
    await expect(page.getByText('训练曲线')).toBeVisible()
    await expect(page.locator('.ui-chart')).toHaveCount(1)
    const comparison = page.getByRole('region', { name: '训练实验比较' })
    await expect(comparison).toContainText('逻辑回归')
    await expect(comparison).toContainText('C=0.5')
    await expect(comparison.getByRole('heading', { name: '模型对比' })).toBeVisible()
    await expect(comparison).toContainText(/测试集 .* 条 · 正例 /)
    await comparison.getByText('训练集与验证集指标').click()
    await expect(comparison.getByText('训练集').first()).toBeVisible()
    await expect(comparison.getByText('验证集').first()).toBeVisible()
    await expect(comparison.getByText('用于拟合模型').first()).toBeVisible()
    await expect(page.getByText(/各方法使用相同数据与切分成员/)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(comparison).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const tasks = await (await page.request.get(`/api/v1/training-experiments/${experimentId}`)).json()
    expect(tasks.tasks.every((task: { modelId: string | null }) => task.modelId === null)).toBe(true)

    await page.goto('/#/admin/experiment-runs?registrationState=unregistered')
    const rows = page.getByRole('checkbox', { name: /选择实验/ })
    await expect(rows.first()).toBeVisible({ timeout: 60000 })
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(3)
    for (let index = 0; index < count; index += 1) await rows.nth(index).check()
    await page.getByRole('button', { name: '登记所选实验运行' }).click()
    await page.getByRole('button', { name: '确认登记实验运行' }).click()
    await expect(page.getByText('登记结果')).toBeVisible()
    await expect(page.getByRole('region', { name: '登记结果' }).getByText('已登记').first()).toBeVisible()
    await expect(page.getByText('当前筛选没有实验运行。')).toBeVisible({ timeout: 60000 })

    const models = await (await page.request.get('/api/v1/models')).json()
    const logistic = models.models.find((model: { name: string; state: string; enabled: boolean }) =>
      model.name?.includes('C=0.5') && model.state === 'ready' && model.enabled)
    expect(logistic).toBeTruthy()
  })
})
