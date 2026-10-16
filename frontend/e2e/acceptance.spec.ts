/**
 * 隔离真实服务验收（任务 5.3、6.1、6.2 与 7.3）。
 *
 * 本文件只由隔离入口运行：`npm run test:e2e:acceptance`。
 * 它使用 acceptance-setup 启动的自有后端（复制的模型产物 + 独立 SQLite + 仅内存凭据），
 * 因此可以真实登记模型、真实创建预测并真实重开结果，而不触碰默认开发库。
 *
 * 用例在两种桌面视口下各跑一遍，并且刻意写成可重复执行：第二次运行时登记会走「复用」分支，
 * 断言接受「新增」与「复用」两种真实结果，而不是依赖库里的初始状态。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import {
  acceptanceBaseDirectory,
  lastServicePid,
  startService,
  stopServiceByPid,
  type PreparedEnvironment,
} from './support/acceptance-environment.ts'
import { numberFromEnv, ACCEPTANCE_SERVICE_PORT } from './support/ports.ts'

test.describe.configure({ mode: 'serial' })

/** 创建预测得到的批次编号，供后面的只读重开与重启重开用例复用。 */
let createdBatchId: string | null = null

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`夹具必须注入 ${name}`)
  return value
}

function environment(): PreparedEnvironment {
  return {
    base: required('JIT_ACCEPTANCE_BASE'),
    run: required('JIT_ACCEPTANCE_RUN'),
    database: required('JIT_ACCEPTANCE_DATABASE'),
    artifactRoot: required('JIT_ACCEPTANCE_ARTIFACT_ROOT'),
    sources: ['baseline', 'decision-tree-v1'],
    temporaryDatabaseIsNotDefault: true,
  }
}

function credentials() {
  return { member: required('JIT_ACCEPTANCE_MEMBER_TOKEN'), admin: required('JIT_ACCEPTANCE_ADMIN_TOKEN') }
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: '模型预测导航' }).getByRole('button', { name })
}

/** 结果页有多个 .identity-list（风险、原始输入、来源与身份），比对来源必须限定在「来源与身份」一节。 */
function identityBlock(page: Page) {
  return page.locator('.result-section').filter({ hasText: '来源与身份' })
}

/** innerText 会按块级元素插入换行，两边都去掉空白才能逐字比较同一块内容。 */
async function identityText(page: Page) {
  return (await identityBlock(page).innerText()).replace(/\s+/g, '')
}

/** 每次进入页面都要重新输入凭据：它只活在内存里，刷新即失效（MPW-02）。 */
async function enterCredential(page: Page, token: string) {
  await page.goto('/')
  await page.locator('#credential-input').fill(token)
  await page.getByRole('button', { name: '使用凭据' }).click()
  await expect(page.getByText('已输入凭据（仅本页内存）')).toBeVisible()
}

/** 不重新导航，只在当前页面重新输入凭据（刷新与重启后的重开场景）。 */
async function reenterCredential(page: Page, token: string) {
  await page.locator('#credential-input').fill(token)
  await page.getByRole('button', { name: '使用凭据' }).click()
  await expect(page.getByText('已输入凭据（仅本页内存）')).toBeVisible()
}

/** 布局证据截图。凭据输入是掩码控件，截图里不含凭据原文。 */
async function shot(page: Page, project: string, name: string) {
  ensureDir(runScreenshotDir)
  await page.screenshot({ path: `${runScreenshotDir}/${project}-prediction-${name}.png`, fullPage: true, animations: 'disabled' })
}

/** 页面上不允许出现横向滚动：长哈希必须换行，而不是把页面撑宽（MPW-11）。 */async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
      .slice(0, 5),
  }))
  expect(overflow.offenders).toEqual([])
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

test('隔离环境自身可辨识：自有服务在线且未使用默认开发库', async ({ page }) => {
  const base = process.env.JIT_ACCEPTANCE_BASE
  const database = process.env.JIT_ACCEPTANCE_DATABASE
  expect(base, '夹具必须注入临时根').toBeTruthy()
  expect(database, '夹具必须注入独立数据库路径').toBeTruthy()
  expect(existsSync(database as string)).toBe(true)
  expect((database as string).replace(/\\/g, '/')).not.toContain('/backend/storage/catalog.sqlite3')

  const response = await page.request.get('/api/review-batch')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.mode).toBe('historical')
})

test('MPW-02 没有凭据时不自动发请求，成员凭据读不到管理员候选', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.goto('/#/models')
  await expect(page.getByText(/请在左侧输入团队访问凭据/).first()).toBeVisible()
  await expect
    .poll(() => requests.filter((url) => url.includes('/api/v1/models')).length)
    .toBe(0)

  const { member } = credentials()
  await enterCredential(page, member)
  await nav(page, '模型中心').click()
  await expect(page.getByRole('heading', { name: '模型中心' })).toBeVisible()
  await expect(page.getByText(/个已登记模型/)).toBeVisible()

  // 成员凭据可以读目录，但登记区属于管理员路径。
  await page.getByRole('button', { name: '打开管理登记' }).click()
  await expect(page.getByText('权限不足')).toBeVisible()
  await expect(page.getByText('此操作需要管理员权限')).toBeVisible()
  // 403 时不展示任何候选，也不发起登记。
  await expect(page.locator('input[name="model-candidate"]')).toHaveCount(0)
  expect(requests.some((url) => url.includes('/api/v1/models/register'))).toBe(false)

  // 清除凭据后受保护内容立刻停止展示。
  await page.getByRole('button', { name: '清除凭据' }).click()
  await expect(page.getByText(/请在左侧输入团队访问凭据/).first()).toBeVisible()
  await expect(page.locator('.model-card')).toHaveCount(0)
})

test('MPW-04 管理员显式校验登记本机候选，新增与复用反馈不同', async ({ page }) => {
  const { admin } = credentials()
  await enterCredential(page, admin)
  await nav(page, '模型中心').click()

  await page.getByRole('button', { name: '打开管理登记' }).click()
  const candidates = page.locator('input[name="model-candidate"]')
  await expect(candidates).toHaveCount(2)

  const row = page.locator('li.candidate-row').filter({ hasText: 'baseline' })
  await row.locator('input[name="model-candidate"]').check()
  await page.getByRole('button', { name: '校验并登记所选候选' }).click()

  // 第一次是新增、后续运行是复用：两者都必须被明确区分（MPW-04）。
  const note = page.locator('.candidate-section .status-note')
  await expect(note).toContainText(/已新增登记：|该产物此前已登记，本次为复用：/)

  // 已登记的模型出现在目录里，并且处于可用状态。
  await expect(page.locator('.model-card').first()).toBeVisible()
  await expect(page.locator('.state-badge.state-ready').first()).toHaveText('已登记 · 可用')

  // 再登记同一个候选：服务端返回 200，界面必须说这是复用。
  await page.getByRole('button', { name: '刷新候选' }).click()
  await row.locator('input[name="model-candidate"]').check()
  await page.getByRole('button', { name: '校验并登记所选候选' }).click()
  await expect(note).toContainText('本次为复用')
  await expect(page.locator('.model-card')).toHaveCount(1)
})

test('MPW-05/06/07/08 六字段表单与粘贴导入提交真实预测并进入结果页', async ({ page }) => {
  const { member } = credentials()
  await enterCredential(page, member)
  await nav(page, '新建预测').click()
  await expect(page.getByRole('heading', { name: '新建预测' })).toBeVisible()

  // 提交按钮在表单有效前不可用。
  const submit = page.getByRole('button', { name: '提交并保存预测' })
  await expect(submit).toBeDisabled()

  await page.locator('input[name="prediction-model"]').first().check()
  await page.locator('#predict-field-project').fill('openstack')
  await page.locator('#predict-field-recordId').fill('demo-0001')

  // 粘贴特征 JSON：只改六个特征字段，不动项目与记录编号。
  await page
    .locator('#predict-feature-json')
    .fill('{"ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4}')
  await page.getByRole('button', { name: '导入到表单' }).click()
  await expect(page.locator('#predict-field-ns')).toHaveValue('1')
  await expect(page.locator('#predict-field-ent')).toHaveValue('1.5')
  await expect(page.locator('#predict-field-project')).toHaveValue('openstack')

  // 被拒绝的粘贴必须原子失败：草稿一个字段都不能变（MPW-06）。
  await page.locator('#predict-feature-json').fill('{"ns": 9, "nd": 9, "nf": 9, "ent": 9, "la": 9}')
  await page.getByRole('button', { name: '导入到表单' }).click()
  await expect(page.getByText(/特征 JSON 缺少字段/)).toBeVisible()
  await expect(page.locator('#predict-field-ns')).toHaveValue('1')

  await expect(submit).toBeEnabled()
  await submit.click()

  // 只有拿到 201 且来源与提交快照一致才进入结果页。
  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  await expect(page.getByText('用户提供特征 · 模型估计')).toBeVisible()
  await expect(page.locator('.risk-number')).toHaveText(/^\d+(?:\.\d+)?%$/)
  await expect(page.locator('.result-grid').getByText('openstack', { exact: true }).first()).toBeVisible()

  const link = await page.locator('#result-link').inputValue()
  expect(link).toContain('#/predictions/')
  expect(link).not.toContain('?')
  createdBatchId = link.split('#/predictions/')[1] ?? null
  expect(createdBatchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

  // 六项原始输入与完整来源都在页面上。
  for (const [name, value] of [
    ['ns', '1'],
    ['nd', '2'],
    ['nf', '3'],
    ['ent', '1.5'],
    ['la', '10'],
    ['ld', '4'],
  ]) {
    await expect(page.locator('.result-grid')).toContainText(name)
    await expect(page.locator('.result-grid')).toContainText(value)
  }
  await expect(page.locator('.result-section').first()).toContainText(createdBatchId as string)
  await expect(page.getByText(/预测解释：未支持/).first()).toBeVisible()
  await expect(page.getByText(/该模型的真实预测解释尚未接入/).first()).toBeVisible()
  await expect(page.getByText(/未验证在线仓库效果/).first()).toBeVisible()
})

test('MPW-09 结果链接与按批次编号重开是只读 GET', async ({ page }) => {
  expect(createdBatchId, '上一条用例必须已经真实创建过批次').toBeTruthy()
  const { member } = credentials()
  await enterCredential(page, member)

  const posted: string[] = []
  const readPaths: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/predictions') posted.push(request.method())
    if (url.pathname.startsWith('/api/v1/prediction-batches/')) readPaths.push(request.method())
  })

  await nav(page, '打开已有结果').click()
  await page.locator('#batch-id').fill(createdBatchId as string)
  await page.locator('form.batch-lookup').getByRole('button', { name: '打开已有结果' }).click()

  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  await expect(page.getByText(/本页直接按批次编号读取结果，没有重新预测/)).toBeVisible()
  await expect(page.locator('.risk-number')).toHaveText(/^\d+(?:\.\d+)?%$/)
  expect(posted).toEqual([])
  expect(readPaths).toEqual(['GET'])

  // 直接刷新同一地址：凭据只存内存，刷新后必须先重新输入，然后仍然是同一批次。
  await page.reload()
  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  await expect(page.getByText(/请在左侧输入团队访问凭据/).first()).toBeVisible()
  expect(readPaths).toEqual(['GET'])
  await reenterCredential(page, member)
  await expect(page.locator('#result-link')).toHaveValue(new RegExp(`${createdBatchId}$`))
  expect(posted).toEqual([])

  // 不存在的编号：明确说结果不存在，而不是展示一个空结果。
  await page.goto('/#/predictions/2f1c9a54-0000-4000-8000-000000000000')
  await expect(page.getByText('没有找到该资源')).toBeVisible()
  await expect(page.getByText('指定资源不存在')).toBeVisible()
})

test('MPW-11 两种桌面尺寸下新页面可读可操作且不横向滚动', async ({ page }, info) => {
  const { member } = credentials()
  const width = info.project.use.viewport?.width ?? 0
  test.skip(width !== 1280 && width !== 1440, '只在这两种桌面宽度下检查')

  await enterCredential(page, member)
  await nav(page, '模型中心').click()
  await expect(page.getByRole('heading', { name: '模型中心' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await expect(page.locator('.model-card').first()).toBeVisible()
  await shot(page, info.project.name, 'models')

  await page.locator('.model-card details').first().locator('summary').click()
  await expect(page.locator('.model-card .meta-block').first()).toBeVisible()
  await expectNoHorizontalScroll(page)

  await nav(page, '新建预测').click()
  await expect(page.getByRole('heading', { name: '新建预测' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  const fields = page.locator('.field-grid input')
  await expect(fields).toHaveCount(10)
  for (const input of await fields.all()) {
    const box = await input.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(60)
  }
  await shot(page, info.project.name, 'predict')

  if (createdBatchId !== null) {
    await page.goto(`/#/predictions/${createdBatchId}`)
    await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
    await expect(page.getByLabel('结果链接')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, info.project.name, 'prediction-result')
  }
})

test('MPW-11 纯键盘可以走完凭据→导航→填表→提交的完整流程', async ({ page }) => {
  const { member } = credentials()

  await page.goto('/')
  await page.locator('#credential-input').focus()
  await page.keyboard.type(member)
  await page.keyboard.press('Enter')
  await expect(page.getByText('已输入凭据（仅本页内存）')).toBeVisible()

  const modelsNav = nav(page, '模型中心')
  await expect(page.getByRole('navigation', { name: '模型预测导航' })).toBeVisible()
  await modelsNav.focus()
  await expect(modelsNav).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/models/)
  await expect(page.getByRole('heading', { name: '模型中心' })).toBeVisible()

  const predictNav = nav(page, '新建预测')
  await predictNav.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/predict/)

  // 主要操作必须有可见焦点（MPW-11）。表单未填完时提交按钮按设计是禁用的，而禁用的控件无法获得焦点，
  // 所以先检查模型单选控件的焦点样式，提交按钮的焦点样式放到表单有效之后再检查。
  const submit = page.getByRole('button', { name: '提交并保存预测' })
  const picker = page.locator('input[name="prediction-model"]').first()
  await picker.focus()
  expect(await picker.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')

  await page.keyboard.press('Space')
  await expect(page.locator('input[name="prediction-model"]').first()).toBeChecked()

  await page.locator('#predict-field-project').focus()
  await page.keyboard.type('openstack')
  await page.locator('#predict-field-recordId').focus()
  await page.keyboard.type('keyboard-0001')
  for (const [field, value] of [
    ['ns', '1'],
    ['nd', '2'],
    ['nf', '3'],
    ['ent', '1.5'],
    ['la', '10'],
    ['ld', '4'],
  ]) {
    await page.locator(`#predict-field-${field}`).focus()
    await page.keyboard.type(value)
  }

  await expect(submit).toBeEnabled()
  // 提交是这一页的主要操作：可用之后必须显示可见焦点。
  await submit.focus()
  expect(await submit.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  await expect(page.getByText('用户提供特征 · 模型估计')).toBeVisible()
})

test('MPW-09 真实服务重启后仍能按批次编号重开同一结果', async ({ page }) => {
  expect(createdBatchId, '需要一条真实创建过的批次').toBeTruthy()
  const { member } = credentials()
  const base = acceptanceBaseDirectory(process.env.JIT_ACCEPTANCE_LABEL ?? 'workbench')
  const port = numberFromEnv('JIT_ACCEPTANCE_SERVICE_PORT', ACCEPTANCE_SERVICE_PORT)

  await enterCredential(page, member)
  await page.goto(`/#/predictions/${createdBatchId}`)
  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  const riskBefore = await page.locator('.risk-number').innerText()
  const hashBefore = await identityText(page)

  // 只结束本次验收自己的服务进程，绝不碰用户正在运行的预览或开发服务。
  const pid = lastServicePid(base)
  expect(pid, '夹具必须记录自有服务 pid').toBeTruthy()
  await stopServiceByPid(pid as number)

  // 刷新后凭据按设计已经失效，页面先停在「需要团队凭据」；重新输入后才会真正发出读取请求。
  // 注意：开发服务器的 /api 代理会把「连不上后端」转成 HTTP 500，浏览器因此看到的是结构化失败反馈
  // 而不是 fetch 层的连接中断；这里如实断言真实表现，关键是任何情况下都不得给出结果或来源。
  await page.reload()
  await expect(page.getByText('需要团队凭据')).toBeVisible()
  await reenterCredential(page, member)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('.risk-number')).toHaveCount(0)
  await expect(page.getByText('来源与身份')).toHaveCount(0)

  const service = await startService(environment(), port, credentials())

  // 服务重新起来之后，同一个批次编号必须仍然给出同一份结果：结果来自独立 SQLite，
  // 而不是浏览器内存或上一次的响应缓存。
  await page.reload()
  await reenterCredential(page, member)
  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  await expect(page.getByText('来源与身份')).toBeVisible()
  await expect(page.locator('.risk-number')).toHaveText(riskBefore)
  expect(await identityText(page)).toBe(hashBefore)
  await expect(page.locator('#result-link')).toHaveValue(new RegExp(`${createdBatchId}$`))
  expect(service.pid).toBeGreaterThan(0)
})

test('历史回放、演示模式与旧工作台在新导航下仍然可用', async ({ page }) => {
  // 无 hash 的首页仍是真实历史回放。
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ }).first()).toBeVisible()

  // 演示模式仍然可用，并且新预测不会混进历史或演示批次。
  const { member } = credentials()
  await enterCredential(page, member)
  await page.getByRole('button', { name: '选择演示模式' }).click()
  await expect(page).toHaveURL(/mode=demo/)
  await expect(page.getByRole('button', { name: '查看 demo-0001' })).toBeVisible()
  await expect(page.getByText('用户提供特征 · 模型估计')).toHaveCount(0)

  // 回到历史回放后，模型预测页面依然可达。
  await page.getByRole('button', { name: '选择真实历史回放' }).click()
  await expect(page).not.toHaveURL(/mode=demo/)
  await nav(page, '模型中心').click()
  await expect(page.getByRole('heading', { name: '模型中心' })).toBeVisible()
})
