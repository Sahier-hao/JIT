import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { REPOSITORY } from './repository-setup.ts'
import { ensureDir, runScreenshotDir } from '../evidence.ts'

async function overflowMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const viewportWidth = innerWidth
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .map(element => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.left < -1 || box.right > viewportWidth + 1)
      .slice(0, 20)
      .map(({ element, box }) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.textContent ?? '').trim().slice(0, 80),
        left: Math.round(box.left),
        right: Math.round(box.right),
      }))
    return { viewportWidth, scrollWidth: document.documentElement.scrollWidth, offenders }
  })
}

test('当前成功分析可核对并下载绑定数据集', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '项目数据集闭环只跑一个浏览器项目')
  test.setTimeout(180_000)
  const project = await (await page.request.post('/api/v1/repositories', {
    data: { repositoryUrl: REPOSITORY.replaceAll('\\', '/') },
  })).json()
  const started = await page.request.post('/api/v1/repository-syncs', {
    data: { repositoryUrl: REPOSITORY.replaceAll('\\', '/'), branch: 'main', strategy: 'generic-model' },
  })
  expect(started.ok()).toBeTruthy()
  const sync = await started.json()
  let completed: Record<string, unknown> = {}
  await expect.poll(async () => {
    completed = await (await page.request.get(`/api/v1/repository-syncs/${sync.syncId}`)).json()
    return completed.status
  }, { timeout: 120_000, intervals: [300, 500, 1000] }).toMatch(/completed|failed/)
  expect(completed.status, JSON.stringify(completed)).toBe('completed')

  const metadata = await page.request.get(
    `/api/v1/repositories/${project.repositoryId}/analyses/${sync.syncId}/dataset`)
  expect(metadata.ok()).toBeTruthy()
  const dataset = await metadata.json()
  expect(dataset.syncId).toBe(sync.syncId)
  expect(dataset.version).toBe(completed.datasetVersion)
  expect(JSON.stringify(dataset)).not.toContain('manifestPath')

  await page.goto(`/#/projects/${project.repositoryId}`)
  await page.getByRole('navigation', { name: '项目工作台视图' }).getByRole('button', { name: '分析', exact: true }).click()
  const trigger = page.getByRole('button', { name: '数据来源', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '本次分析的数据集' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(dataset.version, { exact: true })).toBeVisible()
  await expect(dialog.getByText(dataset.file.sha256, { exact: true })).toBeVisible()
  await expect(dialog).toContainText(`${dataset.quality.rawRows.toLocaleString()} / ${dataset.quality.includedRows.toLocaleString()}`)

  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    const metrics = await overflowMetrics(page)
    expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewportWidth)
    await page.screenshot({
      path: `${ensureDir(runScreenshotDir)}/project-dataset-${width}.png`,
      fullPage: true,
    })
  }

  const [zip] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '下载 CSV 包', exact: true }).click(),
  ])
  const zipPath = await zip.path()
  expect(zip.suggestedFilename()).toContain(String(dataset.version))
  expect(zip.suggestedFilename()).toContain(String(dataset.file.sha256).slice(0, 8))
  expect(zipPath).toBeTruthy()
  expect(readFileSync(zipPath!).length).toBeGreaterThan(100)

  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '下载 XLSX', exact: true }).click(),
  ])
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/)
  expect(xlsx.suggestedFilename()).toContain(String(dataset.version))

  await dialog.getByRole('button', { name: '返回结果', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看提交明细', exact: true })).toBeVisible()
  await expect(page.locator('nav').getByRole('button', { name: '数据集', exact: true })).toHaveCount(0)
})
