import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
// 浏览器验收只声明实际读取的公开字段，不把应用的 Bundler 模块图拉入 NodeNext。
interface PRWork {
  viewedSnapshotId: string
  interest: string
  rounds: Record<string, {
    scratch: string
    progress: Record<string, { state: string }>
    questions: { requiresRecheck: boolean; evidence: { snapshotId: string }[] }[]
  }>
}
interface ProjectEvent { kind: string; snapshotId: string | null; modelId: string | null; title: string }
interface ProjectPRPage { pullRequests: { snapshotId: string | null; analysisStatus: string | null }[] }
interface TrendView {
  mode: 'group' | 'single'
  sourceSyncIds: string[]
  summary: { commitCount: number | null }
  buckets: { commitCount: number | null; highRate: number | null }[]
}

const api = 'http://127.0.0.1:18769'
const evidence = fileURLToPath(new URL('../../docs/evidence/_run/project-workspace-browser/', import.meta.url))
const workKey = 'jit:pr-review:works:v1'
interface PreviewContext { repositoryId: string; modelId: string; branchSyncId: string; headSha: string; nextHeadSha: string }

async function readWork(page: Page): Promise<PRWork> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}')['preview/project#1'], workKey)
}
async function readEvents(request: APIRequestContext, repositoryId: string): Promise<ProjectEvent[]> {
  const response = await request.get(`${api}/api/v1/repositories/${repositoryId}/events`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()).events
}
async function readPRs(request: APIRequestContext, repositoryId: string): Promise<ProjectPRPage> {
  const response = await request.get(`${api}/api/v1/repositories/${repositoryId}/pull-requests`)
  expect(response.ok()).toBeTruthy()
  return response.json()
}
async function assertPageFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
}

test('项目持续审查保留私人轮次，后台更新绑定固定提醒，趋势显式刷新', async ({ page: initialPage, context, request }, info) => {
  let page = initialPage
  await expect.poll(async () => (await request.get(`${api}/__test/context`)).status(), { timeout: 120_000 }).toBe(200)
  const fixture: PreviewContext = await (await request.get(`${api}/__test/context`)).json()
  const project = `${api}/api/v1/repositories/${fixture.repositoryId}`
  const tracking = `${project}/pr-tracking`
  expect((await request.patch(tracking, { data: { enabled: false } })).ok()).toBeTruthy()
  await expect.poll(async () => (await (await request.get(tracking)).json()).status).not.toBe('checking')
  expect((await request.post(`${api}/__test/remote`, { data: { index: 25, draft: false, remoteState: 'open', fail: false } })).ok()).toBeTruthy()

  await page.goto('/')
  await expect(page).toHaveURL(/#\/projects$/)
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开项目 project', exact: true }).click()
  await expect(page.getByRole('region', { name: '仓库概览' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '仓库活跃度' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '语言构成' })).toBeVisible()
  await page.screenshot({ path: `${evidence}/${info.project.name}-repo-overview.png`, fullPage: true })
  await page.getByRole('button', { name: 'PR 审查', exact: true }).click()
  await page.getByRole('button', { name: '检查远端 PR', exact: true }).click()
  await expect(page.getByRole('heading', { name: '#1 修正审查示例 · 版本 25', exact: true })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), workKey)).toBeNull()
  await page.getByRole('button', { name: '自动分析', exact: true }).click()
  await page.getByRole('combobox', { name: '固定自动分析模型' }).click()
  await page.getByRole('option', { name: new RegExp(fixture.modelId) }).click()
  await page.getByRole('button', { name: '启用自动分析', exact: true }).click()
  await expect(page.getByRole('alertdialog', { name: '确认项目 PR 自动分析' })).toContainText(fixture.modelId)
  await page.getByRole('button', { name: '确认启用并处理现有开放 PR', exact: true }).click()
  await expect(page.locator('.update-status-title')).toHaveText('自动分析已开启')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(async () => {
    await request.post(`${api}/__test/observe`)
    return (await readPRs(request, fixture.repositoryId)).pullRequests[0]?.analysisStatus
  }, { timeout: 120_000 }).toBe('completed')

  await page.getByRole('button', { name: '查看 PR', exact: true }).click()
  await expect(page.getByText(/只读预览。先看提交风险排序/)).toBeVisible()
  await page.screenshot({ path: `${evidence}/${info.project.name}-pr-preview.png`, fullPage: true })
  expect(await page.evaluate(key => localStorage.getItem(key), workKey)).toBeNull()
  await page.getByRole('button', { name: '开始审查', exact: true }).click()
  await page.getByText('调整审查示例 25', { exact: true }).click()
  await expect(page.getByLabel('个人笔记', { exact: true })).toBeVisible()
  await page.screenshot({ path: `${evidence}/${info.project.name}-workbench.png` })
  await page.getByLabel('个人笔记', { exact: true }).fill('固定旧轮次的私人笔记：作者更新不能覆盖。')
  await page.getByLabel('审查问题内容', { exact: true }).fill('请核对作者更新后的赋值与测试。')
  await page.getByRole('button', { name: '关联 review.py:head:1', exact: true }).click()
  await page.getByLabel('证据说明 1', { exact: true }).fill('原目标第一行，保留固定代码版本。')
  await page.getByRole('button', { name: '标记已阅读', exact: true }).click()
  await page.getByRole('combobox', { name: '个人关注状态' }).click(); await page.getByText('已暂停', { exact: true }).click()
  const original = await readWork(page)
  const originalRound = original.viewedSnapshotId
  expect(original.rounds[originalRound].progress['review.py'].state).toBe('read')
  expect(original.rounds[originalRound].questions[0].evidence[0].snapshotId).toBe(originalRound)
  expect((await (await request.get(tracking)).json()).enabled).toBe(true)
  await assertPageFits(page)

  // 浏览器不再打开审查页，实际后台服务仍按固定来源采集和评分。
  await page.close()
  await request.post(`${api}/__test/remote`, { data: { index: 26 } })
  expect((await request.post(`${tracking}/check`)).status()).toBe(202)
  let latestSnapshot = ''
  await expect.poll(async () => {
    await request.post(`${api}/__test/observe`)
    const pr = (await readPRs(request, fixture.repositoryId)).pullRequests[0]
    latestSnapshot = pr?.snapshotId ?? ''
    return latestSnapshot !== originalRound && pr?.analysisStatus === 'completed'
  }, { timeout: 120_000 }).toBe(true)
  const ready = (await readEvents(request, fixture.repositoryId)).find(e => e.kind === 'pr-analysis-ready' && e.snapshotId === latestSnapshot)
  expect(ready).toBeTruthy()
  expect(ready!.modelId).toBe(fixture.modelId)

  page = await context.newPage()
  await page.goto('/#/notifications')
  const event = page.locator('.project-event').filter({ has: page.locator('small', { hasText: latestSnapshot.slice(0, 12) }) }).filter({ hasText: ready!.title }).first()
  await expect(event).toBeVisible()
  const beforeRead = await readWork(page)
  await event.getByRole('button', { name: '标为已读', exact: true }).click()
  expect(await readWork(page)).toEqual(beforeRead)
  await event.getByRole('button', { name: '查看固定来源', exact: true }).click()
  await expect(page.getByRole('heading', { name: '固定快照 · PR #1', exact: true })).toBeVisible()
  await expect(page.locator('.pr-fixed-preview')).toContainText(fixture.nextHeadSha.slice(0, 12))
  expect(await readWork(page)).toEqual(beforeRead)
  await page.getByRole('button', { name: '明确开始此版本新一轮', exact: true }).click()
  await page.getByText('调整审查示例 26', { exact: true }).click()
  await expect(page.getByLabel('个人笔记', { exact: true })).toHaveValue(original.rounds[originalRound].scratch)
  const updated = await readWork(page)
  expect(updated.viewedSnapshotId).toBe(latestSnapshot)
  expect(updated.rounds[originalRound]).toEqual(original.rounds[originalRound])
  expect(updated.rounds[latestSnapshot].progress['review.py'].state).toBe('recheck')
  expect(updated.rounds[latestSnapshot].questions[0].requiresRecheck).toBe(true)
  expect(updated.interest).toBe('paused')
  await page.getByRole('button', { name: /review\.py:1 .*原版本/ }).click()
  await expect.poll(async () => (await readWork(page)).viewedSnapshotId).toBe(originalRound)
  await expect(page.locator('.wb-hunk').filter({ has: page.getByRole('button', { name: '关联 review.py:head:1', exact: true }) })).toContainText('value = 25')
  const revisitedRound = { ...original.rounds[originalRound], location: { side: 'head', line: 1 } }
  expect((await readWork(page)).rounds[originalRound]).toEqual(revisitedRound)
  await page.screenshot({ path: `${evidence}/${info.project.name}-old-evidence.png`, fullPage: true })

  await page.getByRole('button', { name: '返回项目 PR 审查', exact: true }).click()
  await page.getByRole('button', { name: '分析', exact: true }).click()
  await page.getByRole('button', { name: '风险趋势', exact: true }).click()
  await expect(page.locator('.project-trends .trend-line').first()).toHaveCSS('stroke', 'rgb(42, 120, 214)')
  await expect(page.getByRole('table', { name: '趋势等价数据表：风险分为模型估计，高分占比不是缺陷率' })).toBeVisible()
  const oldViewId = page.url().split('/').at(-1)!
  const oldView: TrendView = await (await request.get(`${project}/trend-views/${oldViewId}`)).json()
  expect(oldView.mode).toBe('group')
  expect(oldView.summary.commitCount).toBe(27)
  expect(oldView.buckets.some(b => b.commitCount == null && b.highRate == null)).toBe(true)
  const mark = page.locator('.project-trend-figure').first().getByRole('button', { name: /27 个已分析提交/ })
  await mark.focus()
  await expect(page.locator('.trend-tooltip').first()).toContainText('27 个已分析提交')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.trend-tooltip').first()).not.toContainText('27 个已分析提交')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '趋势固定来源提交' })).toContainText('共 27 条')
  await page.getByRole('region', { name: '趋势固定来源提交' }).getByRole('button', { name: /调整审查示例/ }).first().click()
  await expect(page).toHaveURL(new RegExp(`/analyses/${oldView.sourceSyncIds[0]}/commits/`))
  await page.goto(`/#/projects/${fixture.repositoryId}/trends/${oldViewId}`)
  await expect(page.locator('.project-trends .trend-line').first()).toHaveCSS('stroke', 'rgb(42, 120, 214)')
  await assertPageFits(page)
  await page.screenshot({ path: `${evidence}/${info.project.name}-trend-light.png`, fullPage: true })
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.locator('.project-trends .trend-line').first()).toHaveCSS('stroke', 'rgb(57, 135, 229)')
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()
  await page.screenshot({ path: `${evidence}/${info.project.name}-trend-dark.png`, fullPage: true })
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()

  // 同口径新采集保留旧视图；显式刷新仍按组，而不是误变成单次分析。
  const created = await request.post(`${api}/api/v1/repository-syncs`, { data: { repositoryUrl: 'https://github.com/preview/project', branch: 'main', strategy: 'generic-model', modelId: fixture.modelId, commitLimit: 100 } })
  expect(created.ok()).toBeTruthy()
  const newJob = await created.json()
  await expect.poll(async () => (await (await request.get(`${api}/api/v1/repository-syncs/${newJob.syncId}`)).json()).status, { timeout: 120_000 }).toBe('completed')
  await page.reload()
  await expect(page.getByText('有新的分支分析来源，当前视图保持不变。', { exact: true })).toBeVisible()
  const unchanged: TrendView = await (await request.get(`${project}/trend-views/${oldViewId}`)).json()
  expect(unchanged.sourceSyncIds).toEqual(oldView.sourceSyncIds)
  expect(unchanged.summary).toEqual(oldView.summary)
  await page.getByRole('button', { name: '生成新的固定视图', exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`${oldViewId}$`))
  const refreshedId = page.url().split('/').at(-1)!
  const refreshed: TrendView = await (await request.get(`${project}/trend-views/${refreshedId}`)).json()
  expect(refreshed.mode).toBe('group')
  expect(refreshed.sourceSyncIds).toContain(newJob.syncId)
  expect(refreshed.summary.commitCount).toBe(27)
  const repositories = await (await request.get(`${api}/api/v1/repositories`)).json()
  expect(repositories.repositories).toHaveLength(1)
  expect(repositories.repositories[0].defaultBranch).toBe('main')
  expect(repositories.repositories[0].commitCount).toBe(27)
  expect((await (await request.get(tracking)).json()).enabled).toBe(true)
  expect((await readWork(page)).rounds[originalRound]).toEqual(revisitedRound)
  await assertPageFits(page)
  await page.close()
})
