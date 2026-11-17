import { expect, test, type Page } from '@playwright/test'

async function expectNoPageOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth,
    nodes: [...document.querySelectorAll('body *')].filter(node => {
      const rect = node.getBoundingClientRect()
      return rect.right > innerWidth + 1 && getComputedStyle(node).position !== 'fixed'
    }).slice(0, 8).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right })),
  }))
  expect(overflow.fits, `${label}: ${JSON.stringify(overflow.nodes)}`).toBe(true)
}

async function expectButtonContentInside(page: Page, locator: string, label: string) {
  const violations = await page.locator(locator).evaluateAll((buttons: Element[]) => buttons.map(button => {
    const buttonRect = button.getBoundingClientRect()
    const contentBottom = Math.max(buttonRect.bottom, ...[...button.children].map(child => child.getBoundingClientRect().bottom))
    return { text: button.textContent?.trim().slice(0, 80), buttonBottom: buttonRect.bottom, contentBottom }
  }).filter(item => item.contentBottom > item.buttonBottom + 1))
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([])
}

test('四主题和窄屏下的标准控件、分析草稿与角色工作区', async ({ page, request }, info) => {
  const state = await (await request.get('http://127.0.0.1:18860/__test/context')).json() as { repositoryId: string }
  const username = `shadcn${Date.now()}`
  const registered = await page.request.post('/api/user/register', { data: { username, password: 'shadcn-test-pass-1' } })
  expect(registered.ok()).toBeTruthy()
  await page.goto(`/#/projects/${state.repositoryId}/analyses`)
  await expect(page.getByRole('button', { name: '查看提交明细' })).toBeVisible()

  await page.goto('/#/projects')
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
  await expectButtonContentInside(page, 'main article > button[aria-label^="打开项目"]', '项目卡片内容')
  await expectNoPageOverflow(page, '项目列表')

  await page.goto('/#/my-data')
  await expect(page.getByRole('heading', { name: '我的数据', exact: true })).toBeVisible()
  await expectButtonContentInside(page, '[role="listbox"] > button[role="option"]', '数据版本列表')

  await page.goto('/#/my-training')
  await expect(page.getByRole('heading', { name: '我的训练', exact: true })).toBeVisible()
  await expectButtonContentInside(page, 'main > section > div > button', '训练实验列表')

  await page.goto(`/#/projects/${state.repositoryId}/prs`)
  await expect(page.getByRole('heading', { name: 'PR 审查', exact: true })).toBeVisible()
  await expectButtonContentInside(page, '[aria-label="待处理 PR"] button', '待处理 PR 列表')
  await expectNoPageOverflow(page, '项目 PR 审查')

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
      await expectNoPageOverflow(page, `项目分析 ${theme} ${width}`)
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
