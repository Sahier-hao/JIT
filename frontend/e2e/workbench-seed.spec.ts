import { test, expect, type Page } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

/**
 * 地址上的日期是工作台的"查询种子"（CRR-05，change `make-trend-actionable`）。
 * 这些用例走真实 HTTP，验证下钻会落到真实历史回放并按范围筛选。
 */

async function screenshot(page: Page, name: string, project: string) {
  ensureDir(runScreenshotDir)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${runScreenshotDir}/${project}-${name}.png`, fullPage: false, animations: 'disabled' })
}

const dataRows = (page: Page) => page.getByRole('table').getByRole('row').filter({ has: page.getByRole('button', { name: /^查看 / }) })

test('CRR-05 地址上的日期范围成为初始筛选（真实 HTTP）', async ({ page }, info) => {
  await page.goto('/?start=2013-12-01&end=2013-12-31#/validation')
  await expect(page.getByLabel('起始日期')).toHaveValue('2013-12-01')
  await expect(page.getByLabel('结束日期')).toHaveValue('2013-12-31')
  await expect(dataRows(page).first()).toBeVisible()
  const count = await dataRows(page).count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(1853)
  const dates = await dataRows(page).locator('time').evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').slice(0, 10)))
  expect(dates.length).toBe(count)
  for (const date of dates) {
    expect(date >= '2013-12-01').toBe(true)
    expect(date <= '2013-12-31').toBe(true)
  }
  await screenshot(page, 'seed-range', info.project.name)
})

test('CRR-05 非法种子整体忽略并说明，列表不按日期筛选', async ({ page }) => {
  await page.goto('/?start=2026-10-09&end=2026-10-02#/validation')
  await expect(dataRows(page).first()).toBeVisible({ timeout: 30000 })
  await expect(page.getByLabel('起始日期')).toHaveValue('')
  await expect(page.getByRole('status').filter({ hasText: '地址中的日期范围无效' })).toBeVisible()
  const count = await dataRows(page).count()
  expect(count).toBeGreaterThan(1000)
})

test('CRR-05 范围与来源无关：演示模式下同样按种子筛选', async ({ page }) => {
  await page.goto('/?mode=demo&start=2026-10-08&end=2026-10-09#/validation')
  await expect(page.getByText('演示模式', { exact: true })).toBeVisible()
  await expect(dataRows(page)).toHaveCount(3)
  await expect(page.getByLabel('起始日期')).toHaveValue('2026-10-08')
})

test('CRR-05 范围内没有提交时显示既有空结果状态与清除入口', async ({ page }) => {
  await page.goto('/?mode=demo&start=2013-01-01&end=2013-01-31#/validation')
  await expect(page.getByText('没有符合条件的提交')).toBeVisible()
  await expect(page.getByRole('button', { name: '清除筛选' })).toBeVisible()
})
