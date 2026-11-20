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

async function themeColor(page: Page, token: string) {
  return page.evaluate(token => {
    const sample = document.createElement('span')
    sample.style.color = `var(${token})`
    document.body.append(sample)
    const color = getComputedStyle(sample).color
    sample.remove()
    return color
  }, token)
}

test('四主题和窄屏下的标准控件、分析草稿与角色工作区', async ({ page, request }, info) => {
  const state = await (await request.get('http://127.0.0.1:18860/__test/context')).json() as { repositoryId: string; branchSyncId: string }
  const username = `shadcn${Date.now()}`
  const registered = await page.request.post('/api/user/register', { data: { username, password: 'shadcn-test-pass-1' } })
  expect(registered.ok()).toBeTruthy()
  await page.goto(`/#/projects/${state.repositoryId}/analyses`)
  await expect(page.getByRole('button', { name: '查看提交明细' })).toBeVisible()

  await page.goto('/#/projects')
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
  const userNav = page.getByRole('navigation', { name: '主导航' })
  await userNav.getByRole('link', { name: '我的审查', exact: true }).click()
  await expect(page).toHaveURL(/#\/reviews$/)
  await expect(page.getByRole('heading', { name: '我的审查', exact: true })).toBeVisible()
  await expect(userNav.getByRole('link', { name: '我的审查', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '新建项目' })).toHaveCount(0)
  await userNav.getByRole('link', { name: '项目', exact: true }).click()
  const projectCard = page.getByRole('button', { name: '打开项目 project', exact: true })
  await projectCard.hover()
  await expect(projectCard).toHaveCSS('background-color', await themeColor(page, '--hover'))
  await expectButtonContentInside(page, 'main article > button[aria-label^="打开项目"]', '项目卡片内容')
  await expectNoPageOverflow(page, '项目列表')

  await projectCard.click()
  const overview = page.getByRole('region', { name: '仓库概览' })
  await expect(overview.getByRole('button', { name: '刷新仓库信息' })).toBeVisible()
  await overview.getByRole('button', { name: /订阅分支更新/ }).click()
  await expect(page.getByRole('dialog', { name: '订阅分支更新' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overview.getByRole('button', { name: '查看分析结果' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '批量分析 PR' })).toHaveCount(0)
  await overview.getByRole('link', { name: '在我的数据中构建' }).click()
  await expect(page).toHaveURL(/#\/my-data\?view=builds&buildProjectId=/)
  const build = page.getByRole('dialog', { name: '从仓库构建数据集' })
  await expect(build.getByLabel('公开仓库')).toHaveValue('https://github.com/preview/project')
  await expect(build.getByLabel('构建分支')).toHaveValue('main')
  await build.getByRole('button', { name: '关闭', exact: true }).last().click()
  await expect(page).toHaveURL(/#\/my-data$/)
  await page.goBack()
  await overview.getByRole('link', { name: '在我的数据中构建' }).click()
  const buildRequest = page.waitForResponse(response => response.url().endsWith('/dataset-builds') && response.request().method() === 'POST')
  await build.getByRole('button', { name: '开始构建' }).click()
  const created = await buildRequest
  expect(created.ok()).toBeTruthy()
  const task = await created.json() as { taskId: string; repositoryId: string }
  expect(task.repositoryId).toBe(state.repositoryId)
  await expect(build.getByRole('button', { name: '查看数据' })).toBeVisible({ timeout: 60_000 })
  await build.getByRole('button', { name: '查看数据' }).click()
  await expect(page.getByRole('region', { name: '数据详情' })).toContainText('kamei14-git-v2', { timeout: 30_000 })
  await page.goto(`/#/projects/${state.repositoryId}?buildTaskId=${task.taskId}`)
  await expect(page).toHaveURL(/#\/my-data\?view=builds&taskId=/)
  await expect(page.getByRole('dialog', { name: '数据集构建任务' }).getByRole('button', { name: '查看数据' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/#/my-data')
  await expect(page.getByRole('heading', { name: '我的数据', exact: true })).toBeVisible()
  await expectButtonContentInside(page, '[role="listbox"] > button[role="option"]', '数据版本列表')

  await page.goto('/#/my-training')
  await expect(page.getByRole('heading', { name: '我的训练', exact: true })).toBeVisible()
  await expectButtonContentInside(page, 'main > section > div > button', '训练实验列表')

  await page.goto(`/#/projects/${state.repositoryId}/prs`)
  await expect(page.getByRole('heading', { name: 'PR 审查', exact: true })).toBeVisible()
  const openFilter = page.getByRole('radio', { name: '开放', exact: true })
  await expect(openFilter).toBeChecked()
  await expect(openFilter).toHaveCSS('background-color', await themeColor(page, '--accent-soft'))
  const batchButton = page.getByRole('region', { name: '项目 PR 审查' }).getByRole('button', { name: '批量分析 PR' })
  await batchButton.click()
  const batchDialog = page.getByRole('dialog', { name: '批量分析 PR' })
  await expect(batchDialog.getByRole('combobox', { name: '批量分析模型' })).toBeVisible()
  await batchDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(batchButton).toBeFocused()
  const prFilter = page.getByRole('combobox', { name: '本页分析状态' })
  await expect(prFilter).toBeEnabled()
  await prFilter.selectOption('unscored')
  await expect(page.getByText(/本页显示/)).toBeVisible()
  await prFilter.selectOption('all')
  await expect(page.getByRole('complementary', { name: '待处理 PR' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /PR 自动打分设置/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '同步 PR 列表', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '分析分支提交', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '当前分析进度' })).toHaveCount(0)
  await expectNoPageOverflow(page, '项目 PR 审查')

  await page.getByRole('link', { name: '分支分析', exact: true }).click()
  await page.getByRole('button', { name: '分析分支提交', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分析分支提交' })
  await expect(dialog.getByLabel('时间切分预设')).toHaveCount(0)
  await expect(dialog.getByLabel('训练方法')).toHaveCount(0)
  await dialog.getByLabel('分支', { exact: true }).fill('release-ui-check')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '分析分支提交', exact: true })).toBeFocused()
  await page.getByRole('link', { name: 'PR 审查', exact: true }).click()
  await expect(page.getByRole('button', { name: '分析分支提交', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '分支分析', exact: true }).click()
  await page.getByRole('button', { name: '分析分支提交', exact: true }).click()
  await expect(dialog.getByLabel('分支', { exact: true })).toHaveValue('release-ui-check')
  await dialog.getByLabel('分支', { exact: true }).fill('main')
  const scoreRequest = page.waitForResponse(response => response.url().endsWith('/repository-syncs') && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: '开始分析', exact: true }).click()
  const submittedScore = await scoreRequest
  expect(submittedScore.ok()).toBeTruthy()
  const scoreInput = submittedScore.request().postDataJSON() as { modelId: string; strategy: string; splitPreset?: string }
  expect(scoreInput.strategy).toBe('generic-model')
  expect(scoreInput.modelId).toBeTruthy()
  expect(scoreInput.splitPreset).toBeUndefined()
  const startedScore = await submittedScore.json() as { syncId: string }
  await expect.poll(async () => {
    const result = await page.request.get(`/api/v1/repository-syncs/${startedScore.syncId}`)
    if (!result.ok()) return result.status()
    const saved = await result.json()
    return { status: saved.status, modelId: saved.modelId, splitPolicy: saved.splitPolicy, trainRecords: saved.trainRecords }
  }, { timeout: 45_000 }).toEqual({ status: 'completed', modelId: scoreInput.modelId, splitPolicy: null, trainRecords: null })
  const priorities = page.getByRole('region', { name: '提交分数与缺陷证据' })
  await expect(priorities.getByText(/有引入证据|观察期内未发现|观察期未满|观察覆盖未知/).first()).toBeVisible()

  for (const theme of ['冷灰', '钢青', '炭黑', '纸墨']) {
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    await page.getByRole('button', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('button', { name: '分析分支提交', exact: true })).toBeVisible()
      await expectNoPageOverflow(page, `项目分析 ${theme} ${width}`)
      await page.screenshot({ path: info.outputPath(`analysis-${theme}-${width}.png`), fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const route of ['my-data', 'my-training', 'my-models', 'profile']) {
    await page.goto(`/#/${route}`)
    await expect(page.locator('main h1')).toBeVisible()
    await expect(page.locator('main [aria-busy="true"]'), `用户页 ${route} 完成读取`).toHaveCount(0, { timeout: 25_000 })
    await page.screenshot({ path: info.outputPath(`${route}.png`) })
  }
  await page.goto(`/#/projects/${state.repositoryId}/prs`)
  await page.getByRole('button', { name: '查看 PR', exact: true }).first().click()
  await expect(page.getByText('只读预览', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('pr-preview.png'), fullPage: true })
  await page.goto('/#/login?role=admin')
  await expect(page.getByLabel('管理员账户名')).toBeVisible()
  await page.getByLabel('管理员账户名').fill(`admin${Date.now()}`)
  await page.getByLabel('管理员密码', { exact: true }).fill('shadcn-admin-test-1')
  await page.getByLabel('确认管理员密码').fill('shadcn-admin-test-1')
  const diagnostics: string[] = []
  page.on('request', request => {
    if (/\/models\/coverage|\/model-candidates|view=diagnostics/.test(request.url())) diagnostics.push(request.url())
  })
  await page.getByRole('button', { name: '建立管理员并进入' }).click()
  await expect(page).toHaveURL(/#\/admin\/models/)
  await expect(page.locator('main h1')).toBeVisible()
  await expect(page.getByRole('heading', { name: /已登记模型/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('上次校验通过', { exact: true }).first()).toBeVisible()
  const modelList = page.getByRole('navigation', { name: '模型列表' })
  const modelPanel = page.getByRole('region', { name: '选中模型' })
  const modelSearch = page.getByRole('textbox', { name: '搜索模型' })
  await modelSearch.fill('找不到这个模型的测试查询')
  await expect(modelList.getByText('没有匹配的模型')).toBeVisible()
  await expect(modelPanel.getByRole('button', { name: '查看详情' })).toHaveCount(0)
  await modelSearch.clear()
  const modelLink = modelList.getByRole('link').first()
  const modelUrl = await modelLink.getAttribute('href')
  await modelLink.click()
  await expect(page).toHaveURL(url => url.hash === modelUrl)
  await expect(modelLink).toHaveAttribute('aria-current', 'page')
  await modelPanel.getByRole('button', { name: '查看详情' }).click()
  await expect(page.getByRole('button', { name: '返回模型列表' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '返回模型列表' }).click()
  await expect(page).toHaveURL(url => url.hash === modelUrl)
  await expect(modelLink).toHaveAttribute('aria-current', 'page')
  await page.setViewportSize({ width: 390, height: 900 })
  await expectNoPageOverflow(page, '管理员模型管理窄屏')
  await page.screenshot({ path: info.outputPath('admin-models-390.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  const adminNav = page.getByRole('navigation', { name: '管理导航' })
  await expect(adminNav.getByRole('button', { name: '模型评估' })).toBeVisible()
  await expect(adminNav.getByRole('button', { name: '模型比较' })).toHaveCount(0)
  expect(diagnostics).toHaveLength(0)
  const diagnosticResponses = Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/v1/models?view=diagnostics')),
    page.waitForResponse(response => response.url().includes('/models/coverage')),
  ])
  await page.getByRole('button', { name: '查看产物诊断' }).click()
  for (const response of await diagnosticResponses) expect(response.ok()).toBeTruthy()
  expect(diagnostics.some(url => url.includes('/model-candidates'))).toBe(false)
  const modelDiagnostics = page.getByRole('dialog', { name: '产物诊断' })
  await modelDiagnostics.getByRole('tab', { name: '本机产物' }).click()
  await expect(modelDiagnostics.getByRole('heading', { name: '本机模型产物', exact: true })).toBeVisible()
  await modelDiagnostics.getByRole('button', { name: '关闭' }).click()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('admin-models.png'), fullPage: true })
  const evaluationRequests: string[] = []
  page.on('request', request => {
    if (/\/api\/v1\/models|\/api\/admin\/multi-project-reports|\/api\/review-batch/.test(request.url())) evaluationRequests.push(request.url())
  })
  await adminNav.getByRole('button', { name: '模型评估' }).click()
  await expect(page).toHaveURL(/#\/admin\/evaluation$/)
  await expect(page.getByRole('heading', { name: '模型评估' })).toBeVisible()
  await expect(page.getByRole('link', { name: /模型比较/ })).toBeVisible()
  expect(evaluationRequests).toHaveLength(0)
  await page.getByRole('link', { name: /模型比较/ }).click()
  await expect(page.getByText('至少需要两个已登记模型')).toBeVisible()
  expect(evaluationRequests.some(url => /\/api\/v1\/models\//.test(url))).toBe(false)
  await page.getByRole('navigation', { name: '模型评估视图' }).getByRole('link', { name: '多项目实验' }).click()
  await expect(page.getByRole('heading', { name: '多项目实验' })).toBeVisible()
  await expect(adminNav.getByRole('button', { name: '模型评估' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('navigation', { name: '模型评估视图' }).getByRole('link', { name: '验证报告' }).click()
  await expect(page).toHaveURL(/#\/admin\/reports$/)

  const trainingReads: string[] = []
  page.on('request', req => {
    if (/\/training-methods|\/split-preview/.test(req.url())) trainingReads.push(req.url())
  })
  await adminNav.getByRole('button', { name: '数据集', exact: true }).click()
  const catalog = page.getByRole('navigation', { name: '数据集列表' })
  const dataDetail = page.getByRole('region', { name: '数据集详情' })
  await page.getByRole('textbox', { name: '搜索数据集' }).fill('flask-3y')
  await catalog.getByRole('link', { name: /^flask-3y \d/ }).click({ timeout: 25_000 })
  await expect(dataDetail.getByRole('heading', { name: 'flask-3y', exact: true })).toBeVisible()
  await expect(catalog.getByRole('link', { name: /^flask-3y \d/ })).toHaveAttribute('aria-current', 'page')
  await expect(dataDetail.getByText('CSV SHA-256')).toBeHidden()
  expect(trainingReads).toHaveLength(0)
  await dataDetail.getByText('文件、归属与引用').click()
  await expect(dataDetail.getByText('CSV SHA-256')).toBeVisible()
  await dataDetail.getByText('文件、归属与引用').click()
  await page.setViewportSize({ width: 390, height: 900 })
  await expectNoPageOverflow(page, '管理员数据集窄屏')
  await page.screenshot({ path: info.outputPath('admin-datasets-detail-390.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: info.outputPath('admin-datasets-detail-1440.png'), fullPage: true })

  // 使用隔离服务实际采集、已登记到目录库的版本验证共享写入和撤销。
  const seedResponse = await page.request.get(`/api/v1/repository-syncs/${state.branchSyncId}`)
  expect(seedResponse.ok()).toBeTruthy()
  const seed = await seedResponse.json() as { datasetVersion: string }
  await page.getByRole('textbox', { name: '搜索数据集' }).fill(seed.datasetVersion)
  await catalog.getByRole('link').first().click()
  await expect(page).toHaveURL(url => decodeURIComponent(url.hash).endsWith(`/${seed.datasetVersion}`))
  const share = dataDetail.getByRole('switch', { name: '开放给普通用户' })
  await expect(share).not.toBeChecked()
  await share.click()
  await expect(share).toBeChecked()
  await page.reload()
  await expect(share).toBeChecked({ timeout: 25_000 })
  await share.click()
  await expect(share).not.toBeChecked()
  await dataDetail.getByRole('button', { name: '用于训练' }).click()
  const trainingDialog = page.getByRole('dialog', { name: '用于训练' })
  await expect(trainingDialog.getByRole('region', { name: '切分预览' })).toBeVisible()
  await expect.poll(() => trainingReads.length).toBeGreaterThanOrEqual(2)
  await page.keyboard.press('Escape')

  for (const theme of ['纸墨', '炭黑']) {
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    await page.getByRole('button', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    for (const section of ['models', 'datasets', 'training', 'experiment-runs', 'reports']) {
      await page.goto(`/#/admin/${section}`)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('main [aria-busy="true"]'), `管理页 ${section} 完成读取`).toHaveCount(0, { timeout: 25_000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`admin-${section}-${theme}.png`), fullPage: true })
    }
  }
})
