import { test, expect } from '@playwright/test'
import { LARGE_REPOSITORY } from './repository-setup.ts'

const account = { username: 'multi-method-admin', password: 'isolated-multi-method-password' }

test.describe('多方法实验与项目使用', () => {
  test('从固定数据版本创建多方法实验、核对曲线与比较、显式登记并用于项目分析', async ({ page }) => {
    test.setTimeout(600000)
    const setup = await page.request.post('/api/admin/setup', { data: account })
    if (setup.status() === 409) {
      expect((await page.request.post('/api/admin/login', { data: account })).ok()).toBe(true)
    } else {
      expect(setup.status()).toBe(201)
    }

    await page.goto('/#/admin/datasets')
    const card = page.locator('.admin-dataset-card').filter({
      has: page.getByRole('heading', { name: 'kamei14-git-v2-claude-scholar', exact: true }),
    })
    await card.getByRole('button', { name: '查看详情' }).click()
    await page.getByRole('combobox', { name: '数据集版本' }).click()
    await page.getByRole('option', { name: 'kamei14-git-v2-claude-scholar-2026-01-25_2026-10-19' }).click()
    const panel = page.locator('section.admin-train-panel').filter({ hasText: '多方法实验' })
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
    const table = page.locator('table.admin-compare-table')
    await expect(table).toContainText('逻辑回归')
    await expect(table).toContainText('C=0.5')
    await expect(page.getByText(/各方法使用相同数据与切分成员/)).toBeVisible()

    const tasks = await (await page.request.get(`/api/v1/training-experiments/${experimentId}`)).json()
    expect(tasks.tasks.every((task: { modelId: string | null }) => task.modelId === null)).toBe(true)

    await page.goto('/#/admin/experiment-runs?registrationState=unregistered')
    await expect(page.locator('.admin-table tbody tr').first()).toBeVisible({ timeout: 60000 })
    const rows = page.locator('.admin-table tbody input[type=checkbox]')
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

    const project = await (await page.request.post('/api/v1/repositories', {
      data: { repositoryUrl: LARGE_REPOSITORY.replaceAll('\\', '/') },
    })).json()
    await page.goto(`/#/projects/${project.repositoryId}`)
    await page.getByRole('button', { name: '发起分析', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const option = dialog.getByLabel('模型来源').locator('option', { hasText: 'C=0.5' })
    const value = await option.getAttribute('value')
    expect(value).toBeTruthy()
    await dialog.getByLabel('模型来源').selectOption(value!)
    const response = page.waitForResponse(item => item.url().endsWith('/api/v1/repository-syncs') && item.request().method() === 'POST')
    await dialog.getByRole('button', { name: '开始分析', exact: true }).click()
    const job = await (await response).json()
    await expect.poll(async () => {
      const body = await (await page.request.get(`/api/v1/repository-syncs/${job.syncId}`)).json()
      return body.status
    }, { timeout: 300000, intervals: [1000, 2000, 4000] }).toBe('completed')
    const completed = await (await page.request.get(`/api/v1/repository-syncs/${job.syncId}`)).json()
    expect(completed.modelId).toBe(logistic.modelId)
    expect(completed.modelStrategy).toBe('generic-model')
  })
})
