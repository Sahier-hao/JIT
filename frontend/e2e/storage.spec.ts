import { test, expect } from '@playwright/test'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import demo from '../public/demo-dataset.json' with { type: 'json' }

const key = `jit-review:shortlist:v1:${encodeURIComponent(demo.project)}:${encodeURIComponent(demo.version)}`

test('CRR-09 刷新、同地址再次打开恢复成员与顺序', async ({ page, context }) => {
  await page.goto('/?mode=demo')
  await page.getByRole('button', { name: '加入 demo-0002 到清单' }).click()
  await page.getByRole('button', { name: '加入 demo-0001 到清单' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'demo-0001 已在清单' })).toBeDisabled()
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  const rows = page.getByRole('table').getByRole('row').filter({ has: page.getByRole('button', { name: /查看 demo-/ }) })
  await expect(rows.nth(0)).toContainText('demo-0002')
  await expect(rows.nth(1)).toContainText('demo-0001')
  await page.getByRole('button', { name: '查看 demo-0001' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '已在清单' })).toBeDisabled()
  const reopened = await context.newPage()
  await reopened.goto('/?mode=demo')
  await expect(reopened.getByRole('button', { name: 'demo-0002 已在清单' })).toBeDisabled()
  await reopened.close()
})

test('CRR-09 数据版本隔离，切回原版本仍可恢复', async ({ page }) => {
  let version = demo.version
  await page.route('**/demo-dataset.json', route => route.fulfill({ json: { ...demo, version } }))
  await page.goto('/?mode=demo')
  await page.getByRole('button', { name: '加入 demo-0001 到清单' }).click()
  version = 'demo-v2'
  await page.reload()
  await expect(page.getByText('demo-v2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '加入 demo-0001 到清单' })).toBeEnabled()
  version = demo.version
  await page.reload()
  await expect(page.getByRole('button', { name: 'demo-0001 已在清单' })).toBeDisabled()
})

for (const [name, contents] of [
  ['损坏内容', '{'],
  ['格式不支持', JSON.stringify({ schema: 2, ids: ['demo-0001'] })],
  ['未知标识', JSON.stringify({ schema: 1, ids: ['ghost', 'demo-0001', 'demo-0001'] })],
] as const) {
  test(`CRR-09 ${name}恢复反馈并可重新选择`, async ({ page }) => {
    await page.addInitScript(({ key, contents }) => { localStorage.setItem(key, contents); localStorage.setItem('unrelated-demo-check', 'keep') }, { key, contents })
    await page.goto('/?mode=demo')
    await expect(page.getByRole('alert')).toContainText('恢复失败')
    await page.getByRole('button', { name: /优先审查清单/ }).click()
    await expect(page.getByRole('button', { name: '查看 ghost' })).toHaveCount(0)
    const count = await page.getByRole('button', { name: '查看 demo-0001' }).count()
    expect(count).toBe(name === '未知标识' ? 1 : 0)
    await page.getByRole('button', { name: '提交工作台', exact: true }).click()
    await page.getByRole('button', { name: '加入 demo-0002 到清单' }).click()
    await expect(page.getByRole('button', { name: 'demo-0002 已在清单' })).toBeDisabled()
    expect(await page.evaluate(() => localStorage.getItem('unrelated-demo-check'))).toBe('keep')
  })
}

test('CRR-10 保存拒绝仍可加入与移除，显示刷新风险', async ({ page }, info) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('测试保存被拒绝', 'QuotaExceededError') } })
  await page.goto('/?mode=demo')
  await page.getByRole('button', { name: '加入 demo-0001 到清单' }).click()
  await expect(page.getByRole('alert')).toHaveText('本次清单未能保存，刷新后可能丢失')
  await page.getByRole('button', { name: '查看 demo-0001' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '已在清单' })).toBeDisabled()
  await page.getByRole('button', { name: '关闭详情' }).click()
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  const directory = ensureDir(runScreenshotDir)
  await page.screenshot({ path: `${directory}/${info.project.name}-save-error.png`, fullPage: true })
  await page.getByRole('button', { name: '移除 demo-0001' }).click()
  await expect(page.getByText('清单为空', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('本次清单未能保存，刷新后可能丢失')
  await page.reload()
  await expect(page.getByRole('button', { name: '加入 demo-0001 到清单' })).toBeEnabled()
})

test('CRR-10 读取拒绝后列表、详情与内存清单仍可使用', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('测试读取被拒绝', 'SecurityError') } })
  await page.goto('/?mode=demo')
  await expect(page.getByRole('alert')).toContainText('恢复失败')
  await page.getByRole('button', { name: /优先审查清单/ }).click()
  await expect(page.getByText('清单为空', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回列表选择提交' }).click()
  await page.getByRole('button', { name: '查看 demo-0001' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '加入清单', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '已在清单' })).toBeDisabled()
})
