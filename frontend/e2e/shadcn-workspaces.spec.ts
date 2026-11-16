import { expect, test } from '@playwright/test'

test('四主题和窄屏下的标准控件、分析草稿与角色工作区', async ({ page, request }, info) => {
  const state = await (await request.get('http://127.0.0.1:18860/__test/context')).json() as { repositoryId: string }
  const username = `shadcn${Date.now()}`
  const registered = await page.request.post('/api/user/register', { data: { username, password: 'shadcn-test-pass-1' } })
  expect(registered.ok()).toBeTruthy()
  await page.goto(`/#/projects/${state.repositoryId}/analyses`)
  await expect(page.getByRole('button', { name: '查看提交明细' })).toBeVisible()

  await page.getByRole('button', { name: '发起分析', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '发起分析' })
  await dialog.getByLabel('分支', { exact: true }).fill('release-ui-check')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '发起分析', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '发起分析', exact: true }).click()
  await expect(dialog.getByLabel('分支', { exact: true })).toHaveValue('release-ui-check')
  await page.keyboard.press('Escape')

  for (const theme of ['冷灰', '钢青', '炭黑', '纸墨']) {
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    await page.getByRole('button', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('button', { name: '发起分析', exact: true })).toBeVisible()
      const overflow = await page.evaluate(() => ({
        fits: document.documentElement.scrollWidth <= innerWidth,
        nodes: [...document.querySelectorAll('body *')].filter(node => {
          const rect = node.getBoundingClientRect()
          return rect.right > innerWidth + 1 && getComputedStyle(node).position !== 'fixed'
        }).slice(0, 8).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right })),
      }))
      expect(overflow.fits, JSON.stringify(overflow.nodes)).toBe(true)
      await page.screenshot({ path: info.outputPath(`analysis-${theme}-${width}.png`), fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const route of ['my-data', 'my-training', 'my-models', 'profile']) {
    await page.goto(`/#/${route}`)
    await expect(page.locator('main h1')).toBeVisible()
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`${route}.png`) })
  }
  await page.goto(`/#/projects/${state.repositoryId}/prs`)
  await page.getByRole('button', { name: /#1 修正审查示例/ }).first().click()
  await expect(page.getByText('只读预览', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('pr-preview.png'), fullPage: true })
  await page.goto('/#/login?role=admin')
  await expect(page.getByLabel('管理员账户名')).toBeVisible()
  await page.getByLabel('管理员账户名').fill(`admin${Date.now()}`)
  await page.getByLabel('管理员密码', { exact: true }).fill('shadcn-admin-test-1')
  await page.getByLabel('确认管理员密码').fill('shadcn-admin-test-1')
  await page.getByRole('button', { name: '建立管理员并进入' }).click()
  await expect(page).toHaveURL(/#\/admin\/models/)
  await expect(page.locator('main h1')).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('admin-models.png'), fullPage: true })
  for (const theme of ['纸墨', '炭黑']) {
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    await page.getByRole('button', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    for (const section of ['models', 'datasets', 'training', 'reports']) {
      await page.goto(`/#/admin/${section}`)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`admin-${section}-${theme}.png`), fullPage: true })
    }
  }
})
