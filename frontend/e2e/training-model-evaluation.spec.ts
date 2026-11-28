import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ensureDir, runEvidenceDir, runScreenshotDir } from '../evidence.ts'
import { loginOrCreateUser } from './support/user-session.ts'

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function waitForExperimentStatus(page: Page, experimentId: string, expected: string) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/user/training-experiments/${experimentId}`)
    if (!response.ok()) return 'missing'
    const tasks = (await response.json()).tasks as Array<{ status: string }>
    return tasks[0]?.status
  }, { timeout: 60_000 }).toBe(expected)
}

test('trains, registers and evaluates exact models through the isolated service', async ({ page }, info) => {
  test.setTimeout(360_000)
  await loginOrCreateUser(page)

  const datasetsResponse = await page.request.get('/api/v1/user/datasets?scope=usable')
  expect(datasetsResponse.ok()).toBeTruthy()
  const datasets = (await datasetsResponse.json()).datasets as Array<{
    dataset: string
    version: string
    schema: string
    labelMaturity: { statusCounts: Record<string, number> | null } | null
  }>
  const labeled = datasets.find(item => item.dataset === 'model-evaluation-labeled')
  const legacy = datasets.find(item => item.dataset === 'model-evaluation-legacy')
  expect(labeled).toBeTruthy()
  expect(legacy).toBeTruthy()
  expect(labeled!.labelMaturity?.statusCounts).toMatchObject({
    positive: expect.any(Number),
    unobserved: expect.any(Number),
    immature: expect.any(Number),
  })

  const invalidPreview = await page.request.get(
    `/api/v1/user/datasets/${encodeURIComponent(labeled!.version)}/split-preview`,
    { params: { train: 70, validation: 20, test: 20 } },
  )
  expect(invalidPreview.status()).toBe(422)
  expect((await invalidPreview.json()).error.code).toBe('SPLIT_POLICY_INVALID')
  const insufficient = await page.request.get(
    `/api/v1/user/datasets/${encodeURIComponent(labeled!.version)}/split-preview`,
    { params: { train: 98, validation: 1, test: 1 } },
  )
  expect(insufficient.ok()).toBeTruthy()
  const insufficientBody = await insufficient.json()
  expect(insufficientBody.available).toBe(false)
  expect(insufficientBody.reason.code).toBe('SPLIT_INVALID')

  await page.goto(`/#/my-training?datasetVersion=${encodeURIComponent(labeled!.version)}`)
  const dialog = page.getByRole('dialog', { name: '开始训练' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '自定义比例' }).click()
  const testRatio = dialog.getByRole('spinbutton', { name: '测试比例' })
  await testRatio.fill('20')
  await expect(dialog.getByRole('alert')).toContainText('合计 105%')
  await expect(dialog.getByRole('button', { name: /开始训练/ })).toBeDisabled()
  await testRatio.fill('15')
  const trainRatio = dialog.getByRole('spinbutton', { name: '训练比例' })
  await trainRatio.fill('65')
  const validationRatio = dialog.getByRole('spinbutton', { name: '验证比例' })
  await validationRatio.fill('20')
  await expect(dialog.getByText(/temporal-custom-65-20-15/)).toBeVisible()

  const mlp = dialog.getByRole('checkbox', { name: /多层感知机|MLP/ }).first()
  await expect(mlp).toBeEnabled()
  await mlp.check()
  await dialog.locator('summary').filter({ hasText: '参数' }).click()
  const epochs = dialog.getByRole('spinbutton', { name: /多层感知机.*epochs/ })
  await epochs.fill('2')
  await dialog.getByRole('button', { name: '开始训练（1 个方法）' }).click()
  await expect(page).toHaveURL(/#\/my-training\/[^?]+/)
  const experimentId = new URL(page.url()).hash.split('/')[2].split('?')[0]

  const duplicate = await page.request.post('/api/v1/user/training-experiments', {
    data: {
      datasetVersion: labeled!.version,
      methods: [{ method: 'mlp-v1', params: { epochs: 2 } }],
      splitRatios: { train: 65, validation: 20, test: 15 },
      metricSet: 'metric-set-v2',
    },
  })
  expect(duplicate.ok()).toBeTruthy()
  expect((await duplicate.json()).experimentId).toBe(experimentId)

  await expect(page.getByText('训练实验')).toBeVisible()
  await expect(page.getByText('损失曲线')).toBeVisible({ timeout: 180_000 })
  const register = page.getByRole('button', { name: '登记到模型库' })
  await expect(register).toBeEnabled({ timeout: 180_000 })
  const unregisteredEvaluation = await page.request.post(
    `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}/comparison/thresholds`,
    { data: { taskIds: [(await (await page.request.get(
      `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}`,
    )).json()).tasks[0].taskId], strategy: 'max-f1' } },
  )
  expect(unregisteredEvaluation.status()).toBe(409)
  expect((await unregisteredEvaluation.json()).error.code).toBe('TASK_NOT_READY')

  await register.click()
  const evaluate = page.getByRole('button', { name: '评估本次训练' })
  await expect(evaluate).toBeVisible({ timeout: 60_000 })
  const experiment = await (await page.request.get(
    `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}`,
  )).json()
  const task = experiment.tasks[0]
  expect(task.status).toBe('succeeded')
  expect(task.modelId).toBeTruthy()
  expect(experiment.splitPreset).toBe('temporal-custom-65-20-15')

  const repeated = await page.request.post(
    `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}/tasks/${encodeURIComponent(task.taskId)}/register`,
  )
  expect(repeated.ok()).toBeTruthy()
  expect((await repeated.json()).status).toBe('already-registered')

  await evaluate.click()
  await expect(page.getByRole('heading', { name: '评估本次训练' })).toBeVisible()
  await page.getByRole('button', { name: '在测试集复核' }).click()
  const testResult = page.getByRole('region', { name: '测试集正式复核' })
  await expect(testResult).toBeVisible({ timeout: 60_000 })
  await expect(testResult.getByText('正式评估')).toBeVisible()
  await expect(testResult.getByRole('table', { name: '缺陷阈值指标表' })).toBeVisible()
  await expect(testResult.getByText(/以下状态未进入指标/)).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/training-evaluation-1440-${info.project.name}.png`, fullPage: true })

  await page.setViewportSize({ width: 1280, height: 720 })
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/training-evaluation-1280-${info.project.name}.png`, fullPage: true })

  const predictionResponse = await page.request.post('/api/v1/user/prediction-batches', {
    data: {
      datasetVersion: labeled!.version,
      modelId: task.modelId,
      threshold: .5,
    },
  })
  expect(predictionResponse.status()).toBe(201)
  const prediction = await predictionResponse.json()
  expect(prediction.evaluationEligible).toBe(true)
  const predictionEvaluationResponse = await page.request.get(
    `/api/v1/user/prediction-batches/${encodeURIComponent(prediction.batchId)}/evaluation`,
  )
  expect(predictionEvaluationResponse.ok()).toBeTruthy()
  const predictionEvaluation = await predictionEvaluationResponse.json()
  expect(predictionEvaluation.partition).toBeNull()
  expect(predictionEvaluation.counts.positives).toBeGreaterThan(0)
  const immatureExcluded = predictionEvaluation.labelStatusCounts.immature
  expect(immatureExcluded).toBeGreaterThan(0)

  const legacyPrediction = await page.request.post('/api/v1/user/prediction-batches', {
    data: { datasetVersion: legacy!.version, modelId: task.modelId, threshold: .5 },
  })
  expect(legacyPrediction.status()).toBe(201)
  const legacyBatch = await legacyPrediction.json()
  const legacyEvaluationResponse = await page.request.get(
    `/api/v1/user/prediction-batches/${encodeURIComponent(legacyBatch.batchId)}/evaluation`,
  )
  expect(legacyEvaluationResponse.ok()).toBeTruthy()
  const legacyEvaluation = await legacyEvaluationResponse.json()
  expect(Object.keys(legacyEvaluation.labelStatusCounts)).toContain('unknown')

  await page.goto(`/#/model-evaluation?source=prediction&batchId=${encodeURIComponent(prediction.batchId)}`)
  await expect(page.getByRole('heading', { name: '评估预测结果' })).toBeVisible()
  await expect(page.getByText('探索性复核', { exact: true })).toBeVisible()
  await expect(page.getByText(new RegExp(`immature ${immatureExcluded}`))).toBeVisible()
  await expect(page.getByRole('table', { name: '缺陷阈值指标表' })).toBeVisible()

  let delayed = false
  await page.route(new RegExp(`/api/v1/user/prediction-batches/${legacyBatch.batchId}`), async route => {
    if (!delayed) {
      delayed = true
      await new Promise(resolve => setTimeout(resolve, 900))
    }
    await route.continue()
  })
  await page.getByLabel('评估预测批次').click()
  await page.getByRole('option', { name: new RegExp(legacy!.dataset) }).click()
  await page.waitForURL(new RegExp(legacyBatch.batchId))
  await page.goBack()
  await expect(page.getByText(labeled!.version, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(legacy!.version)).toHaveCount(0)

  const unavailableModel = await page.request.post('/api/v1/user/prediction-batches', {
    data: {
      datasetVersion: labeled!.version,
      modelId: '11111111-1111-4111-8111-111111111111',
      threshold: .5,
    },
  })
  expect(unavailableModel.ok()).toBeFalsy()

  const cancellable = await page.request.post('/api/v1/user/training-experiments', {
    data: {
      datasetVersion: labeled!.version,
      methods: [{ method: 'mlp-v1', params: { epochs: 50 } }],
      splitPreset: 'temporal-70-15-15',
      metricSet: 'metric-set-v2',
    },
  })
  expect(cancellable.status()).toBe(202)
  const cancellableView = await cancellable.json()
  const cancellableTask = cancellableView.tasks[0]
  const cancelled = await page.request.post(
    `/api/v1/user/training-tasks/${cancellableTask.taskId}/cancel`,
  )
  expect(cancelled.ok()).toBeTruthy()
  await waitForExperimentStatus(page, cancellableView.experimentId, 'cancelled')
  const cannotRegister = await page.request.post(
    `/api/v1/user/training-experiments/${cancellableView.experimentId}/tasks/${cancellableTask.taskId}/register`,
  )
  expect(cannotRegister.status()).toBe(409)
  const retried = await page.request.post(
    `/api/v1/user/training-tasks/${cancellableTask.taskId}/retry`,
  )
  expect(retried.status()).toBe(202)
  const retriedTask = await retried.json()
  const cancelRetry = await page.request.post(
    `/api/v1/user/training-tasks/${retriedTask.taskId}/cancel`,
  )
  expect(cancelRetry.ok()).toBeTruthy()
  await waitForExperimentStatus(page, cancellableView.experimentId, 'cancelled')

  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  await page.screenshot({ path: `${ensureDir(runScreenshotDir)}/training-evaluation-390-${info.project.name}.png`, fullPage: true })

  const summary = {
    datasetVersion: labeled!.version,
    legacyDatasetVersion: legacy!.version,
    experimentId,
    taskId: task.taskId,
    modelId: task.modelId,
    predictionBatchId: prediction.batchId,
    legacyPredictionBatchId: legacyBatch.batchId,
    splitPreset: experiment.splitPreset,
    splitMemberSha256: task.splitPolicy.memberSha256,
    evaluationMode: 'formal-training-test',
    predictionMode: 'exploratory-saved-batch',
  }
  writeFileSync(`${ensureDir(runEvidenceDir)}/training-model-evaluation.json`,
    `${JSON.stringify(summary, null, 2)}\n`, 'utf-8')
})
