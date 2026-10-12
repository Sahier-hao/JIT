import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import demo from '../public/demo-dataset.json' with { type: 'json' }

const evidence = '../docs/evidence/connect-public-data-baseline-review/screenshots'
async function screenshot(page: Page, name: string, project: string) {
  mkdirSync(evidence, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${evidence}/${project}-${name}.png`, fullPage: true, animations: 'disabled' })
}
const rows = (page: Page) => page.getByRole('table').getByRole('row').filter({ has: page.getByRole('button', { name: /查看 demo-/ }) })

test('CRR-01/02/03/07/08/12 桌面完整评审链路', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?mode=demo')
  await expect(rows(page)).toHaveCount(12)
  await expect(page.getByText('演示模式', { exact: true })).toBeVisible()
  await expect(page.getByText('demo-v1', { exact: true })).toBeVisible()
  await expect(page.getByText('100%', { exact: true })).toBeVisible()
  await expect(page.getByText('0%', { exact: true })).toBeVisible()
  await expect(page.getByText('暂无预测', { exact: true })).toBeVisible()
  await screenshot(page, 'workbench', info.project.name)
  await page.getByRole('button', { name: '加入 demo-0001 到清单' }).click()
  await page.getByRole('button', { name: '查看 demo-0002' }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText('demo-0002')
  await expect(detail.getByText('86%', { exact: true })).toBeVisible()
  await detail.getByRole('button', { name: '加入清单', exact: true }).click()
  await expect(detail.getByRole('button', { name: '已在清单', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'demo-0002 已在清单' })).toBeDisabled()
  await screenshot(page, 'detail', info.project.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '关闭详情' }).click()
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText('demo-0001')
  await expect(rows(page).nth(1)).toContainText('demo-0002')
  await screenshot(page, 'shortlist', info.project.name)
  await page.getByRole('button', { name: '查看 demo-0001' }).click()
  await expect(detail).toContainText('demo-0001')
  await page.getByRole('button', { name: '关闭详情' }).click()
  await page.getByRole('button', { name: '移除 demo-0001' }).click()
  await page.getByRole('button', { name: '移除 demo-0002' }).click()
  await expect(page.getByText('清单为空', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回列表选择提交' }).click()
  await expect(page.getByRole('button', { name: '加入 demo-0001 到清单' })).toBeEnabled()
  expect(errors).toEqual([])
})

test('CRR-04/05/06/07 查询、日期、排序与详情上下文', async ({ page }) => {
  await page.goto('/?mode=demo')
  await expect(rows(page).first()).toContainText('demo-0003')
  await expect(rows(page).nth(1)).toContainText('demo-0001')
  await expect(rows(page).nth(2)).toContainText('demo-0002')
  await expect(rows(page).last()).toContainText('demo-0010')
  await page.getByLabel('起始日期', { exact: true }).fill('2026-10-08')
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-08')
  await expect(rows(page)).toHaveCount(2)
  await page.getByLabel('提交标识搜索').fill(' DEMO-0001 ')
  await expect(rows(page)).toHaveCount(1)
  await page.getByLabel('提交标识搜索').fill('')
  await expect(rows(page)).toHaveCount(2)
  await page.getByLabel('起始日期', { exact: true }).fill('2026-10-09')
  await expect(page.getByRole('alert')).toContainText('请修正日期范围')
  await expect(rows(page)).toHaveCount(2)
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByLabel('排序', { exact: true }).selectOption('time')
  await expect(rows(page).first()).toContainText('demo-0010')
  await page.getByRole('button', { name: '查看 demo-0010' }).click()
  await expect(page.getByRole('dialog')).toContainText('未提供')
  await page.getByLabel('排序', { exact: true }).selectOption('risk')
  await expect(page.getByRole('dialog')).toContainText('demo-0010')
  await page.getByLabel('排序', { exact: true }).selectOption('time')
  await page.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.getByLabel('排序', { exact: true })).toHaveValue('time')
  await page.getByLabel('排序', { exact: true }).selectOption('risk')
  await expect(rows(page).first()).toContainText('demo-0003')
  await page.getByLabel('提交标识搜索').fill('missing')
  await expect(page.getByText('没有符合条件的提交')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(rows(page)).toHaveCount(12)
})

test('CRR-12 仅键盘完整操作及可见焦点', async ({ page }, info) => {
  await page.goto('/?mode=demo')
  await expect(rows(page)).toHaveCount(12)
  // 从页面起点以 Tab 寻找首条提交，不使用鼠标或程序化 focus。
  let triggerFound = false
  for (let count = 0; count < 20; count++) {
    await page.keyboard.press('Tab')
    if (await page.getByRole('button', { name: '查看 demo-0003' }).evaluate(element => element === document.activeElement)) { triggerFound = true; break }
  }
  expect(triggerFound).toBe(true)
  const trigger = page.getByRole('button', { name: '查看 demo-0003' })
  expect(await trigger.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '关闭详情' })).toBeFocused()
  await page.keyboard.press('Tab')
  const content = page.getByRole('region', { name: '提交详情内容', exact: true })
  await expect(content).toBeFocused()
  expect(await content.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await page.keyboard.press('End')
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('dialog').getByRole('button', { name: '加入清单', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('button', { name: 'demo-0003 已在清单' })).toBeDisabled()
  await screenshot(page, 'keyboard-focus', info.project.name)
})

test('CRR-11 加载可见、失败重试、空数据区分', async ({ page }, info) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let failed = true
  let empty = false
  await page.route('**/demo-dataset.json', async route => {
    if (failed) { await gate; await route.fulfill({ status: 503 }); }
    else await route.fulfill({ json: empty ? { ...demo, records: [] } : demo })
  })
  await page.goto('/?mode=demo')
  await expect(page.getByText('正在读取演示提交')).toBeVisible()
  release()
  await expect(page.getByText('数据不可用', { exact: true })).toBeVisible()
  await screenshot(page, 'load-error', info.project.name)
  failed = false
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(rows(page)).toHaveCount(12)
  await expect(page.getByText('数据不可用', { exact: true })).toHaveCount(0)
  empty = true
  await page.reload()
  await expect(page.getByText('暂无提交', { exact: true })).toBeVisible()
  await expect(page.getByText('数据不可用', { exact: true })).toHaveCount(0)
})

for (const [name, data] of [
  ['缺少来源', { ...demo, project: '' }],
  ['重复标识', { ...demo, records: [demo.records[0], demo.records[0]] }],
  ['无效时间', { ...demo, records: [{ ...demo.records[0], time: 'invalid' }] }],
] as const) {
  test(`CRR-01/11 ${name}不显示猜测记录`, async ({ page }) => {
    await page.route('**/demo-dataset.json', route => route.fulfill({ json: data }))
    await page.goto('/?mode=demo')
    await expect(page.getByText('数据不可用', { exact: true })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重新加载' })).toBeEnabled()
  })
}

test('CRR-03 无效风险有文字反馈且排在有效分数之后', async ({ page }) => {
  await page.route('**/demo-dataset.json', route => route.fulfill({ json: { ...demo, records: [{ ...demo.records[0], risk: -1 }, { ...demo.records[1], risk: 0 }] } }))
  await page.goto('/?mode=demo')
  await expect(rows(page).first()).toContainText('demo-0002')
  await expect(rows(page).last()).toContainText('风险数据无效')
  await page.getByRole('button', { name: '查看 demo-0001' }).click()
  await expect(page.getByRole('dialog')).toContainText('风险数据无效')
})
