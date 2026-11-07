import { expect, test, type APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { ensureDir, runScreenshotDir } from '../evidence.ts'
import { DATABASE, LARGE_REPOSITORY } from './repository-setup.ts'

const account = { username: 'e2e-admin', password: 'isolated-e2e-admin-password' }
const PYTHON = resolve(process.cwd(), '../backend/.venv/Scripts/python.exe')

function seedSql(script: string, ...args: string[]) {
  execFileSync(PYTHON, ['-c', script, DATABASE, ...args], { stdio: 'pipe' })
}

function duplicateSync(syncId: string, replicaId: string) {
  seedSql(`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
source, target = sys.argv[2], sys.argv[3]
columns = [row[1] for row in db.execute('PRAGMA table_info(repository_sync)')]
values = db.execute('SELECT * FROM repository_sync WHERE id=?', (source,)).fetchone()
record = dict(zip(columns, values))
record['id'] = target
db.execute('INSERT INTO repository_sync (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', tuple(record[column] for column in columns))
commit_columns = [row[1] for row in db.execute('PRAGMA table_info(repository_commit)')]
for saved in db.execute('SELECT * FROM repository_commit WHERE sync_id=?', (source,)).fetchall():
    copy = dict(zip(commit_columns, saved))
    copy['sync_id'] = target
    db.execute('INSERT INTO repository_commit (' + ','.join(commit_columns) + ') VALUES (' + ','.join('?' for _ in commit_columns) + ')', tuple(copy[column] for column in commit_columns))
db.commit()
`, syncId, replicaId)
}

function markLegacySource(syncId: string) {
  seedSql(`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("UPDATE repository_sync SET model_id='legacy-model-without-artifact',run_id='legacy-run-without-artifact',model_strategy='repository-trained',split_policy_json=NULL WHERE id=?", (sys.argv[2],))
db.commit()
`, syncId)
}

async function waitTask(request: APIRequestContext, url: string, timeout = 180_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const response = await request.get(url)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    if (['completed', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(body.status)) return body
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`task did not finish: ${url}`)
}

test('large repository builds a dataset, trains with a preset, and renders verified trend partitions', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-1280', '数据集与趋势闭环只跑一个浏览器项目')
  test.setTimeout(420_000)
  const projectResponse = await request.post('/api/v1/repositories', {
    data: { repositoryUrl: LARGE_REPOSITORY.replaceAll('\\', '/') },
  })
  expect(projectResponse.ok()).toBeTruthy()
  const project = await projectResponse.json()

  await page.goto(`/#/projects/${project.repositoryId}`)
  await page.getByRole('button', { name: '构建数据集' }).click()
  const buildDialog = page.getByRole('dialog', { name: '从当前项目构建数据集' })
  await expect(buildDialog).toBeVisible()
  await buildDialog.getByLabel('数据集构建分支').fill('main')
  await buildDialog.getByRole('button', { name: '开始构建' }).click()
  await expect(buildDialog.getByText('已完成', { exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(buildDialog.getByText(/不会自动训练或替换当前模型/)).toBeVisible()
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/dataset-build-complete-1280.png`, fullPage: true })

  const builds = await (await request.get(
    `/api/v1/repositories/${project.repositoryId}/dataset-builds?limit=20&offset=0`,
  )).json()
  const build = builds.tasks.find((item: { status: string }) => item.status === 'completed')
  expect(build).toBeTruthy()
  expect(build.datasetName).toBeTruthy()
  expect(build.datasetVersion).toBeTruthy()

  const setup = await request.post('/api/admin/setup', { data: account })
  if (setup.status() === 409) {
    expect((await request.post('/api/admin/login', { data: account })).ok()).toBeTruthy()
  } else {
    expect(setup.status()).toBe(201)
  }
  for (const preset of ['temporal-70-15-15', 'temporal-80-10-10', 'temporal-60-20-20']) {
    const preview = await request.get(
      `/api/admin/datasets/${encodeURIComponent(build.datasetVersion)}/split-preview?preset=${preset}`,
    )
    expect(preview.ok()).toBeTruthy()
    const body = await preview.json()
    expect(body.available).toBe(true)
    expect(body.policy.id).toBe(preset)
    expect(body.policy.partitionCounts.train.records).toBeGreaterThan(0)
    expect(body.policy.partitionCounts.validation.records).toBeGreaterThan(0)
    expect(body.policy.partitionCounts.test.records).toBeGreaterThan(0)
  }

  await buildDialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  const trainingResponse = await request.post('/api/v1/training-tasks', {
    data: {
      datasetVersion: build.datasetVersion,
      method: 'logistic-regression-l2-v1',
      metricSet: 'metric-set-v2',
      splitPreset: 'temporal-80-10-10',
    },
  })
  expect(trainingResponse.ok()).toBeTruthy()
  const trainingStart = await trainingResponse.json()
  const training = await waitTask(request, `/api/v1/training-tasks/${trainingStart.taskId}`)
  expect(training.status).toBe('succeeded')
  expect(training.splitPreset).toBe('temporal-80-10-10')
  expect(training.splitPolicy.id).toBe('temporal-80-10-10')

  const startResponsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/v1/repository-syncs')
    && response.request().method() === 'POST'
    && response.ok())
  await page.goto(`/#/projects/${project.repositoryId}`)
  await page.getByRole('button', { name: '发起分析' }).first().click()
  await page.getByLabel('模型来源').selectOption('train')
  await page.getByLabel('时间切分预设').selectOption('temporal-80-10-10')
  await page.getByRole('button', { name: '开始分析' }).click()
  const sync = await (await startResponsePromise).json()
  const completedSync = await waitTask(request, `/api/v1/repository-syncs/${sync.syncId}`, 300_000)
  expect(completedSync.modelStrategy).toBe('repository-trained')
  expect(completedSync.splitPreset).toBe('temporal-80-10-10')
  expect(completedSync.splitPolicy.id).toBe('temporal-80-10-10')

  let trendResponse = await request.post(`/api/v1/repositories/${project.repositoryId}/trend-views`, {
    data: { start: '2024-01-01', end: '2024-12-31', grain: 'week' },
  })
  for (let attempt = 0; !trendResponse.ok() && attempt < 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
    trendResponse = await request.post(`/api/v1/repositories/${project.repositoryId}/trend-views`, {
      data: { start: '2024-01-01', end: '2024-12-31', grain: 'week' },
    })
  }
  expect(trendResponse.ok()).toBeTruthy()
  const trend = await trendResponse.json()
  expect(trend.partitionCoverage.status).toBe('verified')
  expect(Object.values(trend.buckets).some((bucket) => {
    const counts = (bucket as { partitions?: { recentUnseen?: number } }).partitions
    return (counts?.recentUnseen ?? 0) > 0
  })).toBe(true)
  await page.goto(`/#/projects/${project.repositoryId}/trends/${trend.viewId}`)
  const coverage = page.getByRole('region', { name: '训练分区覆盖' })
  await expect(coverage).toBeVisible({ timeout: 60_000 })
  await expect(coverage).toContainText('训练')
  await expect(coverage).toContainText('验证')
  await expect(coverage).toContainText('测试')
  await expect(coverage).toContainText('近期未训练')
  await page.getByText(/逐周数据/).click()
  await expect(page.getByRole('table', { name: /趋势等价数据表/ })).toContainText('训练分区覆盖')
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/trend-partitions-1280.png`, fullPage: true })

  const replicaId = '22222222-2222-4222-8222-222222222222'
  duplicateSync(sync.syncId, replicaId)
  const mergedResponse = await request.post(`/api/v1/repositories/${project.repositoryId}/trend-views`, {
    data: { start: '2024-01-01', end: '2024-12-31', grain: 'week' },
  })
  expect(mergedResponse.ok()).toBeTruthy()
  const merged = await mergedResponse.json()
  expect(merged.sourceSyncIds).toEqual(expect.arrayContaining([sync.syncId, replicaId]))
  await page.goto(`/#/projects/${project.repositoryId}/trends/${merged.viewId}`)
  await expect(page.getByText('口径与来源（2 次分析）')).toBeVisible()
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/trend-partitions-merged-1280.png`, fullPage: true })

  const genericResponse = await request.post('/api/v1/repository-syncs', {
    data: { repositoryUrl: LARGE_REPOSITORY.replaceAll('\\', '/'), branch: 'main', strategy: 'generic-model' },
  })
  expect(genericResponse.ok()).toBeTruthy()
  const genericStart = await genericResponse.json()
  const generic = await waitTask(request, `/api/v1/repository-syncs/${genericStart.syncId}`)
  const externalViewResponse = await request.post(`/api/v1/repositories/${project.repositoryId}/trend-views`, {
    data: { sourceSyncId: generic.syncId, start: '2024-01-01', end: '2024-12-31', grain: 'week' },
  })
  expect(externalViewResponse.ok()).toBeTruthy()
  const externalView = await externalViewResponse.json()
  expect(externalView.partitionCoverage.status).toBe('external')
  await page.goto(`/#/projects/${project.repositoryId}/trends/${externalView.viewId}`)
  await expect(page.getByRole('region', { name: '训练分区覆盖' })).toContainText('外部模型，无本项目切分标签')
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/trend-external-1280.png`, fullPage: true })

  markLegacySource(sync.syncId)
  const legacyViewResponse = await request.post(`/api/v1/repositories/${project.repositoryId}/trend-views`, {
    data: { sourceSyncId: sync.syncId, start: '2024-01-01', end: '2024-12-31', grain: 'week' },
  })
  expect(legacyViewResponse.ok()).toBeTruthy()
  const legacyView = await legacyViewResponse.json()
  expect(legacyView.partitionCoverage.status).toBe('unknown')
  await page.goto(`/#/projects/${project.repositoryId}/trends/${legacyView.viewId}`)
  await expect(page.getByRole('region', { name: '训练分区覆盖' })).toContainText('训练分区未知')
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/trend-legacy-unknown-1280.png`, fullPage: true })
})
