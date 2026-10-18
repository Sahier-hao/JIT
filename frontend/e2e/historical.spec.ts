import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { ensureDir, runEvidenceDir, runFixtureDir, runScreenshotDir } from '../evidence.ts'
interface Batch { mode: string; runId: string; summary: { runId: string }; records: { id: string; time: string; risk: number; metrics: Record<string, number> }[] }

const reference = JSON.parse(readFileSync('../backend/artifacts/baseline/reference-predictions.json', 'utf8')) as { id: string; risk: number }[]
const commits = (page: Page) => page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ })
const label = (risk: number) => `${Number((risk * 100).toFixed(1))}%`
const day = (time: string) => new Date(Date.parse(time) + 8 * 3600000).toISOString().slice(0, 10)
async function photo(page: Page, name: string, viewport: string) {
  ensureDir(runScreenshotDir)
  await page.screenshot({ path: `${runScreenshotDir}/${viewport}-real-${name}.png`, fullPage: true, animations: 'disabled' })
}

test('真实 HTTP 完整批次→查询→详情→清单→刷新（没有拦截模型响应）', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const started = Date.now()
  const result = page.waitForResponse(r => r.url().endsWith('/api/review-batch'))
  await page.goto('/')
  const response = await result
  expect(response.status()).toBe(200)
  const data = await response.json() as Batch
  expect(data.mode).toBe('historical')
  expect(data.summary.runId).toBe(data.runId)
  await expect(commits(page)).toHaveCount(1853)
  const loadedMs = Date.now() - started
  expect(data.records.map(r => r.id)).toEqual(reference.map(r => r.id))
  data.records.forEach((r, i) => expect(Math.abs((r.risk as number) - reference[i].risk)).toBeLessThanOrEqual(1e-8))
  const expected = [...data.records].sort((a, b) => (b.risk as number) - (a.risk as number) || Date.parse(b.time) - Date.parse(a.time) || a.id.localeCompare(b.id))
  const rendered = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
    id: row.querySelector('.commit-link')!.getAttribute('aria-label')!.slice(3),
    risk: row.querySelector('.risk-number')!.textContent,
  })))
  expect(rendered).toEqual(expected.map(r => ({ id: r.id, risk: label(r.risk as number) })))
  await expect(page.getByText('真实历史回放', { exact: true })).toBeVisible()
  await photo(page, 'list', info.project.name)
  const first = expected[0]
  const queryStarted = Date.now()
  await page.getByLabel('提交标识搜索').fill(` ${first.id.toUpperCase()} `)
  await expect(commits(page)).toHaveCount(1)
  const searchMs = Date.now() - queryStarted
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  const date = day(first.time)
  await page.getByLabel('起始日期', { exact: true }).fill(date)
  await page.getByLabel('结束日期', { exact: true }).fill(date)
  await expect(commits(page)).toHaveCount(data.records.filter(r => day(r.time) === date).length)
  await page.getByLabel('提交标识搜索').fill(first.id)
  await page.getByLabel('排序', { exact: true }).selectOption('time')
  await page.getByRole('button', { name: `查看 ${first.id}` }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText(first.id)
  await expect(detail.getByText(label(first.risk as number), { exact: true })).toBeVisible()
  for (const [key, value] of Object.entries(first.metrics!)) {
    await expect(detail.locator('.metric-list > div').filter({ has: page.getByText(key, { exact: true }) }).locator('dd')).toHaveText(String(value))
  }
  await expect(detail).toContainText('预测解释未提供')
  await expect(detail).not.toContainText('人工说明')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await photo(page, 'detail', info.project.name)
  await detail.getByRole('button', { name: '加入清单', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('提交标识搜索')).toHaveValue(first.id)
  await expect(page.getByLabel('排序', { exact: true })).toHaveValue('time')
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  await expect(commits(page)).toHaveCount(1)
  await photo(page, 'shortlist', info.project.name)
  await page.reload()
  await expect(commits(page)).toHaveCount(1853, { timeout: 10000 })
  await expect(page.getByRole('button', { name: `${first.id} 已在清单` })).toBeDisabled()
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  await expect(commits(page)).toHaveCount(1)
  await page.getByRole('button', { name: `移除 ${first.id}` }).click()
  await expect(page.getByText('清单为空', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  ensureDir(runEvidenceDir)
  writeFileSync(`${runEvidenceDir}/${info.project.name}-real-chain.json`, JSON.stringify({
    kind: 'real-http-browser-chain', viewport: info.project.use.viewport, runId: data.runId, count: 1853,
    fullIdentitiesAndRoundedRisksMatched: true, loadedMs, searchMs, measuredUnderConcurrentTests: true,
    matchedReferenceTolerance: 1e-8, consoleErrors: errors, passed: true,
  }, null, 2))
})

test('真实基线摘要保持完整批次指标，演示清单与真实隔离', async ({ page }, info) => {
  await page.goto('/')
  await expect(commits(page)).toHaveCount(1853)
  const real = (await commits(page).first().getAttribute('aria-label'))!.slice(3)
  await page.getByRole('button', { name: `加入 ${real} 到清单` }).click()
  await page.locator('details > summary').click()
  const summary = page.getByRole('region', { name: '基线记录' })
  await expect(summary).toContainText('1,853 条测试提交')
  await expect(summary).toContainText('0.7710')
  await expect(summary).toContainText('无法计算：没有预测为正的提交')
  await expect(summary).toContainText('尚非完整 Kamei14')
  const metrics = await summary.locator('.baseline-scores').allTextContents()
  await photo(page, 'baseline', info.project.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByLabel('提交标识搜索').fill(real)
  expect(await summary.locator('.baseline-scores').allTextContents()).toEqual(metrics)
  await page.getByRole('button', { name: '选择演示模式' }).click()
  await expect(page.getByRole('button', { name: '加入 demo-0001 到清单' })).toBeEnabled()
  await expect(summary).toHaveCount(0)
  await page.getByRole('button', { name: '加入 demo-0001 到清单' }).click()
  await page.getByRole('button', { name: '选择真实历史回放' }).click()
  await expect(commits(page)).toHaveCount(1853, { timeout: 10000 })
  await expect(page.getByRole('button', { name: `${real} 已在清单` })).toBeDisabled()
  await expect(page.getByLabel('提交标识搜索')).toHaveValue('')
  await page.getByRole('button', { name: '选择演示模式' }).click()
  await expect(page.getByRole('button', { name: 'demo-0001 已在清单' })).toBeDisabled()
})

test('真实完整列表键盘详情与焦点返回', async ({ page }, info) => {
  // 这条用例刻意跑真实 1853 行整表：初次布局加上整表上的键盘走查单独就要 29–33s，
  // 用默认 30s 会在并行时恰好越界。这里只在"确实需要真实体积"的用例上给预算，
  // 而不是把全局默认值抬高（键盘可达性本身另由 accessibility.spec 用行为夹具覆盖）。
  test.setTimeout(90_000)
  await page.goto('/')
  await expect(commits(page)).toHaveCount(1853)
  const first = commits(page).first()
  const id = (await first.getAttribute('aria-label'))!.slice(3)
  let found = false
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab')
    if (await first.evaluate(el => el === document.activeElement)) { found = true; break }
  }
  expect(found).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '关闭详情' })).toBeFocused()
  await page.keyboard.press('Tab')
  const content = page.getByRole('region', { name: '提交详情内容' })
  await expect(content).toBeFocused()
  await page.keyboard.press('End')
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  // 详情内新增了「来源与局限」折叠项，Tab 站数会随之变化：按"可达"断言而不是固定站数
  const addButton = page.getByRole('dialog').getByRole('button', { name: '加入清单', exact: true })
  for (let count = 0; count < 4; count++) {
    if (await addButton.evaluate(element => element === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(addButton).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(first).toBeFocused()
  await expect(page.getByRole('button', { name: `${id} 已在清单` })).toBeDisabled()
  await photo(page, 'keyboard', info.project.name)
})

test('网络失败不回退演示，恢复重试实际 HTTP', async ({ page }, info) => {
  await page.route('**/api/review-batch', route => route.abort('connectionfailed'))
  await page.goto('/')
  await expect(page.getByText('数据不可用', { exact: true })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '选择演示模式' })).toBeEnabled()
  await photo(page, 'service-error', info.project.name)
  await page.unroute('**/api/review-batch')
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(commits(page)).toHaveCount(1853)
  await expect(page.getByText('数据不可用', { exact: true })).toHaveCount(0)
})

test('错误真实来源不能展示旧批次（行为夹具）', async ({ page }) => {
  const response = await page.request.get('/api/review-batch')
  const actual = await response.json() as Batch
  actual.summary.runId = '0'.repeat(64)
  await page.route('**/api/review-batch', route => route.fulfill({ json: actual }))
  await page.goto('/')
  await expect(page.getByText('数据不可用', { exact: true })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('不一致')
})

test('实际模型另一序列化上下文隔离清单（TCP产物行为夹具）', async ({ page }) => {
  await page.goto('/')
  await expect(commits(page)).toHaveCount(1853)
  const original = await (await page.request.get('/api/review-batch')).json() as Batch
  const variant = JSON.parse(readFileSync(`${runFixtureDir}/runtime-context-fixture-batch.json`, 'utf8')) as Batch
  expect(variant.runId).not.toBe(original.runId)
  expect(variant.records).toEqual(original.records)
  const id = (await commits(page).first().getAttribute('aria-label'))!.slice(3)
  await page.getByRole('button', { name: `加入 ${id} 到清单` }).click()
  // The alternate payload was generated by an actual TCP model service in the lifecycle check.
  // This checks UI context behavior; the primary acceptance chain has no response interception.
  await page.route('**/api/review-batch', route => route.fulfill({ json: variant }))
  await page.reload()
  // Wait for the reloaded list before asserting a row's button state: the row is also the
  // readiness probe otherwise, and 1853 rows do not always render within the default timeout.
  await expect(commits(page)).toHaveCount(1853, { timeout: 10000 })
  await expect(page.getByRole('button', { name: `加入 ${id} 到清单` })).toBeEnabled()
  await page.getByRole('button', { name: `加入 ${id} 到清单` }).click()
  await page.unroute('**/api/review-batch')
  await page.reload()
  await expect(commits(page)).toHaveCount(1853, { timeout: 10000 })
  await expect(page.getByRole('button', { name: `${id} 已在清单` })).toBeDisabled()
})
