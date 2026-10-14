import { test, expect } from '@playwright/test'
import { namedFixture } from '../src/named-fixture.ts'

// 具名形态契约（CRR-13/CRR-14）：用 route-mock 注入 kamei14-v1 形态批次，
// 不依赖后端冻结新运行；后端切换具名运行后补真实链路 e2e（tasks.md Workflow follow-up）。
test('具名形态按声明解析与展示，未提供字段带原因，旧文案不出现', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/review-batch', route => route.fulfill({ json: namedFixture() }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: `查看 ${'1'.repeat(40)}` })).toBeVisible()
  await expect(page.getByText('真实历史回放', { exact: true })).toBeVisible()
  await expect(page.getByText('逻辑回归 · Kamei14（12 字段入模）', { exact: true })).toBeVisible()
  await expect(page.getByText(/历史测试批次 · kamei14-v1 基线/)).toBeVisible()
  // 键盘打开基线记录（CRR-12 抽查）
  await page.locator('details > summary').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('details > summary')).toContainText('固定测试批次 · kamei14-v1 · 回顾性评价')
  const summary = page.getByRole('region', { name: '基线记录' })
  await expect(summary).toContainText('未提供字段：lt（固定快照不含变更前文件规模')
  await expect(summary).toContainText('rexp（同名列 rexp 是 Reviewer experience')
  await expect(summary).toContainText('logistic-regression-l2-v1')
  await expect(summary).toContainText('metric-set-v1')
  await expect(summary).toContainText('预测解释未提供')
  await expect(summary).not.toContainText('尚非完整 Kamei14')
  // 详情文案按 schema 生成，不带旧形态表述
  await page.getByRole('button', { name: `查看 ${'1'.repeat(40)}` }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText('上方度量为当前 schema 声明的原始字段值')
  await expect(detail).not.toContainText('尚非完整 Kamei14')
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  expect(errors).toEqual([])
})
