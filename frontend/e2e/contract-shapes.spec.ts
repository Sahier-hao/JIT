import { test, expect } from '@playwright/test'
import { historicalFixture } from '../src/historical-fixture.ts'
import { namedFixture } from '../src/named-fixture.ts'
import { trendFixture } from '../src/trend-fixture.ts'

// 具名形态契约（CRR-13/CRR-14）：用 route-mock 注入 kamei14-v1 形态批次，
// 不依赖后端冻结新运行；后端切换具名运行后补真实链路 e2e（tasks.md Workflow follow-up）。
test('具名形态按声明解析与展示，未提供字段带原因，旧文案不出现', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/review-batch', route => route.fulfill({ json: namedFixture() }))
  await page.goto('/?mode=historical#/validation')
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

// 趋势聚合的存在性驱动（DTD-02）：缺少该键时工作台照常、趋势页如实说明未提供。
test('不含聚合键的既有运行：工作台照常可用，趋势页显示未提供', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/review-batch', route => route.fulfill({ json: historicalFixture() }))
  await page.goto('/?mode=historical#/validation')
  await expect(page.getByRole('button', { name: `查看 ${'0'.repeat(40)}` })).toBeVisible()
  await page.goto('/?mode=historical#/trends')
  await expect(page.getByText('该运行未提供趋势聚合')).toBeVisible()
  await expect(page.locator('.trend-chart')).toHaveCount(0)
  expect(errors).toEqual([])
})

// 含合法聚合键：图与文本视图同时可读，观测与模型估计分别标注，空值桶给原因。
test('含聚合键的运行：趋势图与文本视图可读，空值桶给原因', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/review-batch', route => route.fulfill({ json: trendFixture() }))
  await page.goto('/?mode=historical#/trends')
  await expect(page.getByRole('heading', { name: '历史趋势' })).toBeVisible()
  await expect(page.getByText(/观测正标签比例 · 历史观测 · 覆盖全部纳入记录/)).toBeVisible()
  await expect(page.getByText(/模型风险中位数 · 模型估计 · 仅测试区间/)).toBeVisible()
  const table = page.getByRole('table', { name: /历史趋势文本视图/ })
  // 行名以月份开头；不能用 /2012-02/，否则上一桶的结束时刻也会命中。
  await expect(table.getByRole('row', { name: /^2012-02/ })).toContainText('样本不足：该桶提交数 8 低于最小样本 20')
  await expect(table.getByRole('row', { name: /^2013-12/ })).toContainText('0.09（测试记录 56 条）')
  expect(errors).toEqual([])
})
