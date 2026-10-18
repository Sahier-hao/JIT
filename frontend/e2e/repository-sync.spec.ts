/**
 * 仓库同步的浏览器端到端（任务 7.6）。
 *
 * 环境由 `repository-setup.ts` 的 globalSetup 准备：固定日期的小仓库、独立目录库、
 * 一个现成的六字段模型；后端以 `JIT_SYNC_ALLOW_LOCAL=1` 启动，所以表单里可以填
 * 本地绝对路径而不依赖网络。同步只在 1280 视口跑一次，1440 只验证"没有凭据时不
 * 发请求"的提示，避免两个 project 同时操作同一套作业记录。
 */
import { test, expect, type Page } from '@playwright/test'
import { REPOSITORY } from './repository-setup.ts'

const MEMBER = 'e2e-member-token'
/** 与 globalSetup 的提交日期一致；窗口覆盖全部 7 个提交。 */
const SINCE = '2024-01-01'
const UNTIL = '2024-01-08'

async function enterCredential(page: Page) {
  await page.locator('#credential-input').fill(MEMBER)
  await page.getByRole('button', { name: '使用凭据' }).click()
  await expect(page.getByText('已输入凭据（仅本页内存）')).toBeVisible()
}

test('没有凭据时数据来源页说明为什么不能同步', async ({ page }) => {
  await page.goto('/#/sources')
  await expect(page.getByRole('heading', { name: '把真实仓库变成可以评审的提交' })).toBeVisible()
  await expect(page.getByText('同步需要团队凭据；请在左侧输入后再填写仓库地址。')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始同步' })).toBeDisabled()
  await expect(page.getByText('输入团队凭据后，这里会显示本机发起过的同步。')).toBeVisible()
})

test('从数据来源页发起同步，轮询到完成，工作台出现仓库数据与徽章', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '同步只在一个视口跑，避免并发操作同一套作业')
  await page.goto('/#/sources')
  await enterCredential(page)

  await page.getByLabel('仓库地址').fill(REPOSITORY.replaceAll('\\', '/'))
  await page.getByLabel('从哪天开始').fill(SINCE)
  await page.getByLabel('到哪天结束').fill(UNTIL)
  await page.getByLabel('最多提交数').fill('500')
  await page.getByLabel('打分模型').selectOption('auto')
  await page.getByRole('button', { name: '开始同步' }).click()

  // 轮询到终态：本地仓库 + 7 条提交，样本不足会自动降级到现成模型。
  await expect(page.getByText('已完成', { exact: true })).toBeVisible({ timeout: 180_000 })
  await expect(page.getByText('没有按数据训练，原因：提交数量太少，不足以训练。')).toBeVisible()
  await expect(page.getByText('上面的风险由现成通用模型给出，只用于排序线索。')).toBeVisible()
  // 7 个提交都落在最近 90 天内，训练前缀为空——界面要说明"只做打分"，而不是显示 0 条。
  await expect(page.getByText('没有早于最近 90 天的提交，只做打分')).toBeVisible()

  await page.getByRole('button', { name: '去工作台看这批提交的风险' }).click()
  await expect(page).toHaveURL(/mode=repository/)
  await expect(page).toHaveURL(/sync=[0-9a-f-]{36}/)
  await expect(page.getByText('仓库同步数据', { exact: true })).toBeVisible()
  await expect(page.getByText('条同步提交')).toBeVisible()
  await expect(page.getByText('7', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('现成通用模型')).toBeVisible()
  await expect(page.getByText(/本作业共 7 条|本次同步的提交按模型风险排序/)).toBeVisible()

  const rows = page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ })
  await expect(rows).toHaveCount(7)
  // 一页装得下 7 条，分页条仍要显示范围与总数；筛选交给服务端，不在浏览器里筛这一页。
  await expect(page.getByText('第 1–7 条，共 7 条')).toBeVisible()
  const firstId = await rows.first().getAttribute('title')
  expect(firstId).toMatch(/^[a-f0-9]{40}$/)
  await page.getByLabel('提交标识搜索').fill(firstId!.slice(8, 16))
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(rows).toHaveCount(7)
  await rows.first().click()
  const detail = page.getByRole('dialog')
  await expect(detail).toBeVisible()
  // 详情列出采集得到的 14 个原始度量；解释仍明确"未提供"。
  await expect(detail.locator('.metric-list > div')).toHaveCount(14)
  await expect(detail).toContainText('预测解释未提供')
  await expect(detail).not.toContainText('人工说明')

  // 刷新后凭据要从内存重新输入，但同一个同步身份仍能打开（mode 与 sync 都在地址里）。
  await page.reload()
  await enterCredential(page)
  await expect(rows).toHaveCount(7)
})
