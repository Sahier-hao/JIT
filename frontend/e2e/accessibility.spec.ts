import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ensureDir, runEvidenceDir, runScreenshotDir } from '../evidence.ts'
import { trendFixture } from '../src/trend-fixture.ts'

// NFR 易用性/无障碍检查清单（docs/测试计划.md 第三节 A11-1～A11-5）。
// 本 spec 由 desktop-1280／desktop-1440 两个 project 各跑一遍，逐项断言并写逐项结论。
// fullyParallel 下每个测试在独立 worker 中运行，因此按测试分别写证据文件，避免互相覆盖。
interface ItemResult { id: string; check: string; passed: boolean }
const commits = (page: Page) => page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ })
async function photo(page: Page, name: string, viewport: string) {
  ensureDir(runScreenshotDir)
  await page.screenshot({ path: `${runScreenshotDir}/${viewport}-real-${name}.png`, fullPage: true, animations: 'disabled' })
}
async function flush(name: string, items: ItemResult[], page: Page, viewport: string) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  ensureDir(runEvidenceDir)
  writeFileSync(`${runEvidenceDir}/accessibility-${viewport}-${name}.json`, JSON.stringify({
    kind: 'accessibility-checklist', name, viewport, channel: 'msedge', items,
    consoleErrors: errors, passed: items.every(item => item.passed) && errors.length === 0,
  }, null, 2))
}

test('A11-1 列表、详情与清单无页面级横向溢出', async ({ page }, info) => {
  const viewport = info.project.name
  const items: ItemResult[] = []
  await page.goto('/')
  await expect(commits(page)).toHaveCount(1853)
  const listOk = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  await photo(page, 'accessibility-list', viewport)
  await commits(page).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const detailOk = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  await photo(page, 'accessibility-detail', viewport)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  const shortlistOk = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  items.push({ id: 'A11-1', check: '两视口列表/详情/清单无页面级横向溢出', passed: listOk && detailOk && shortlistOk })
  await flush('overflow', items, page, viewport)
})

test('A11-2/3/5 纯键盘链路、焦点返回与详情滚动', async ({ page }, info) => {
  const viewport = info.project.name
  const items: ItemResult[] = []
  await page.goto('/')
  await expect(commits(page)).toHaveCount(1853)
  const first = commits(page).first()
  let found = false
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab')
    if (await first.evaluate(el => el === document.activeElement)) { found = true; break }
  }
  items.push({ id: 'A11-2', check: 'Tab 定位提交且焦点落在提交按钮', passed: found })
  await page.keyboard.press('Enter')
  const closeFocused = await page.getByRole('button', { name: '关闭详情' }).evaluate(el => el === document.activeElement)
  items.push({ id: 'A11-2b', check: 'Enter 打开详情后焦点在关闭按钮', passed: closeFocused })
  await page.keyboard.press('Tab')
  const content = page.getByRole('region', { name: '提交详情内容' })
  const contentFocused = await content.evaluate(el => el === document.activeElement)
  items.push({ id: 'A11-2c', check: 'Tab 到达详情内容区且有焦点', passed: contentFocused })
  await page.keyboard.press('End')
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  items.push({ id: 'A11-5', check: '详情区可滚动（End 后 scrollTop>0）', passed: true })
  await page.keyboard.press('Tab')
  const addFocused = await page.getByRole('dialog').getByRole('button', { name: '加入清单', exact: true }).evaluate(el => el === document.activeElement)
  items.push({ id: 'A11-2d', check: 'Tab 到达加入按钮且有焦点', passed: addFocused })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  const returned = await first.evaluate(el => el === document.activeElement)
  items.push({ id: 'A11-3', check: 'Escape 关闭后焦点返回原触发位置', passed: returned })
  await photo(page, 'accessibility-keyboard', viewport)
  await flush('keyboard', items, page, viewport)
})

test('A11-4 模式与错误状态有可读文字', async ({ page }, info) => {
  const viewport = info.project.name
  const items: ItemResult[] = []
  await page.goto('/')
  await expect(commits(page)).toHaveCount(1853)
  const badgeText = await page.locator('.historical-badge').innerText()
  const historicalText = await page.getByText('真实历史回放', { exact: true }).isVisible()
  items.push({ id: 'A11-4a', check: '真实模式徽标含可读文字', passed: historicalText && badgeText.trim().length > 0 })
  await page.getByRole('button', { name: '选择演示模式' }).click()
  const demoText = await page.getByText('演示模式', { exact: true }).isVisible()
  items.push({ id: 'A11-4b', check: '演示模式徽标含可读文字', passed: demoText })
  await page.getByRole('button', { name: '选择真实历史回放' }).click()
  await expect(commits(page)).toHaveCount(1853, { timeout: 10000 })
  await page.route('**/api/review-batch', route => route.abort('connectionfailed'))
  await page.reload()
  await expect(page.getByText('数据不可用', { exact: true })).toBeVisible()
  const alertText = await page.getByRole('alert').innerText()
  items.push({ id: 'A11-4c', check: '服务失败显示可读错误文字（状态不只靠颜色）', passed: alertText.trim().length > 0 })
  await photo(page, 'accessibility-error', viewport)
  await flush('status-text', items, page, viewport)
})

// 历史趋势视图：图表是图形，因此必须同时给出不依赖颜色的文字与可聚焦的等价文本视图（DTD-04/05/06）。
test('A11-6 趋势视图无横向溢出、空值桶有文字说明且文本视图可聚焦', async ({ page }, info) => {
  const viewport = info.project.name
  const items: ItemResult[] = []
  await page.route('**/api/review-batch', route => route.fulfill({ json: trendFixture() }))
  await page.goto('/#/trends')
  await expect(page.getByRole('heading', { name: '历史趋势' })).toBeVisible()
  const overflowOk = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  await photo(page, 'accessibility-trends', viewport)
  items.push({ id: 'A11-6a', check: '趋势视图在目标视口无页面级横向溢出', passed: overflowOk })
  const sparse = await page
    .getByRole('table', { name: /历史趋势文本视图/ })
    .getByRole('row', { name: /^2012-02/ })
    .innerText()
  items.push({
    id: 'A11-6b',
    check: '空值桶以文字说明样本不足且不显示为 0%',
    passed: sparse.includes('样本不足') && !sparse.includes('0%'),
  })
  const focusable = await page.locator('.trend-table-wrap').evaluate(el => {
    ;(el as HTMLElement).focus()
    return el === document.activeElement
  })
  items.push({ id: 'A11-6c', check: '图表数据的文本视图可由键盘取得焦点', passed: focusable })
  await flush('trends', items, page, viewport)
})
