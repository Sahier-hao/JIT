import { expect, test } from '@playwright/test'

const NOW = '2026-11-01T00:00:00Z'

function task(index: number, id = `task-${index}`) {
  return {
    taskId: id,
    datasetVersion: `dataset-${index}`,
    datasetManifest: `data/datasets/dataset-${index}/manifest.json`,
    manifestSha256: 'a'.repeat(64),
    method: 'logistic-regression-l2-v1',
    metricSet: 'metric-set-v2',
    status: 'succeeded',
    stage: 'completed',
    error: null,
    parentTaskId: null,
    createdBy: 'admin',
    requestId: `request-${index}`,
    artifactKey: `training-task-${index}`,
    artifactRunId: 'b'.repeat(64),
    runId: 'c'.repeat(64),
    modelId: 'd'.repeat(64),
    featureSchemaVersion: 'kamei14-git-v1',
    metrics: {
      averagePrecision: { value: 0.42, reason: null },
      rocAuc: { value: 0.71, reason: null },
      recall20Loc: { value: 0.12, reason: null },
      popt: { value: 0.8, reason: null },
      f1: { value: 0.31, reason: null },
      ifa: { value: 2, reason: null },
    },
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    deadlineAt: NOW,
    cancelRequestedAt: null,
    completedAt: NOW,
    queuePosition: null,
  }
}

test('管理训练分页、返回列表清理与失败恢复可连续使用', async ({ page }) => {
  let detailCalls = 0
  await page.route('**/api/admin/session', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, setupRequired: false, username: 'admin' }),
  }))
  await page.route('**/api/v1/training-tasks**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/training-tasks') {
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const tasks = Array.from({ length: Math.max(0, Math.min(20, 45 - offset)) },
        (_, index) => task(offset + index))
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ tasks, total: 45, limit: 20, offset }),
      })
    }
    const id = url.pathname.split('/').at(-1) ?? 'task-0'
    if (id === 'fail-once') {
      detailCalls += 1
      if (detailCalls === 1) {
        return route.fulfill({
          status: 503, contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: '训练任务暂时不可用', requestId: 'detail-1' } }),
        })
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(task(0, id)) })
  })

  await page.goto('/#/admin/training')
  await expect(page.getByText('第 1 页 · 共 45 条')).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('第 2 页 · 共 45 条')).toBeVisible()
  await expect(page.getByText('dataset-20')).toBeVisible()

  await page.getByRole('button', { name: '查看' }).first().click()
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toBeVisible()
  await page.getByRole('button', { name: '返回任务列表' }).click()
  await expect(page.getByRole('heading', { name: '训练任务', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toHaveCount(0)

  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('第 3 页 · 共 45 条')).toBeVisible()
  await expect(page.getByText('dataset-40')).toBeVisible()

  await page.goto('/#/admin/training/fail-once')
  await expect(page.getByText('训练任务暂时不可用')).toBeVisible()
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByRole('heading', { name: '训练任务详情' })).toBeVisible()
  expect(detailCalls).toBe(2)
})
