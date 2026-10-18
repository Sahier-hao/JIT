/**
 * 创建预测与重开结果的契约解析（任务 2.1、MPW-07、MPW-08、MPW-09）。
 *
 * 两条路径的严格程度不同：创建响应必须与本次提交快照逐项一致，重开响应只核对批次身份
 * （该模型此刻是否可用、是否仍支持预测都不影响历史结果的可读性）。
 */

import { describe, expect, it } from 'vitest'
import { ContractError } from './apiContract'
import type { Submission } from './predictionContract'
import { normalizedBatchId, parseBatchPrediction, parseCreatedPrediction } from './predictionContract'
import { BATCH_ID, COMMIT_ID, EXPLANATION_ITEMS, MODEL_ID, SIX_VALUES, explainedRecord, modelPayload, predictionPayload } from './testFixtures'

const CREATE_MESSAGE = '预测结果不符合约定，未确认保存结果'
const BATCH_MESSAGE = '预测结果不符合约定，未展示该批次'

const submission: Submission = {
  modelId: MODEL_ID,
  project: 'openstack',
  recordId: 'demo-0001',
  features: { ...SIX_VALUES },
  commitId: COMMIT_ID,
  time: '2026-10-15T18:00:00Z',
}

function expectContractError(action: () => unknown, message: string) {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ContractError)
  expect((thrown as Error).message).toBe(message)
}

describe('parseCreatedPrediction', () => {
  it('逐项核对通过后给出可展示的结果', () => {
    const result = parseCreatedPrediction(predictionPayload(), submission)
    expect(result.batchId).toBe(BATCH_ID)
    expect(result.mode).toBe('feature-input')
    expect(result.sourceKind).toBe('client-features')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.risk).toBeCloseTo(0.115752862320787, 12)
    expect(result.records[0]?.explanationStatus).toBe('not-supported')
    expect(result.records[0]?.explanationReason).toBe('该模型的真实预测解释尚未接入')
    expect(result.model.name).toBe('逻辑回归 · 六字段')
  })

  it('服务端把时间规范化成 UTC 也仍然算同一次提交', () => {
    const result = parseCreatedPrediction(
      predictionPayload({
        records: [
          {
            ...predictionPayload().records[0],
            time: '2026-10-16T02:00:00+08:00',
          },
        ],
      }),
      { ...submission, time: '2026-10-15T18:00:00Z' },
    )
    expect(result.records[0]?.time).toBe('2026-10-16T02:00:00+08:00')
  })

  it('返回的模型不是本次提交的模型时不能展示风险', () => {
    expectContractError(
      () => parseCreatedPrediction(predictionPayload({ model: modelPayload({ modelId: '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d' }) }), submission),
      CREATE_MESSAGE,
    )
  })

  it('六项特征与提交值不一致时不能展示风险', () => {
    expectContractError(
      () =>
        parseCreatedPrediction(
          predictionPayload({
            records: [{ ...predictionPayload().records[0], features: { ...SIX_VALUES, la: 121 } }],
          }),
          submission,
        ),
      CREATE_MESSAGE,
    )
  })

  it('项目、记录编号与提交 SHA 任一不一致都整体失败', () => {
    expectContractError(() => parseCreatedPrediction(predictionPayload({ project: 'nova' }), submission), CREATE_MESSAGE)
    expectContractError(
      () => parseCreatedPrediction(predictionPayload({ records: [{ ...predictionPayload().records[0], recordId: 'demo-0002' }] }), submission),
      CREATE_MESSAGE,
    )
    expectContractError(
      () =>
        parseCreatedPrediction(
          predictionPayload({ records: [{ ...predictionPayload().records[0], commitId: 'b'.repeat(40) }] }),
          submission,
        ),
      CREATE_MESSAGE,
    )
  })

  it('没有提交时间时返回体也不能凭空多出时间', () => {
    expectContractError(
      () => parseCreatedPrediction(predictionPayload(), { ...submission, time: null }),
      CREATE_MESSAGE,
    )
  })

  it('多记录、非单条 JSON 来源与未就绪模型都不能算成功', () => {
    const twoRecords = predictionPayload()
    expectContractError(
      () => parseCreatedPrediction(predictionPayload({ records: [twoRecords.records[0], twoRecords.records[0]] }), submission),
      CREATE_MESSAGE,
    )
    expectContractError(() => parseCreatedPrediction(predictionPayload({ mode: 'test-batch' }), submission), CREATE_MESSAGE)
    expectContractError(() => parseCreatedPrediction(predictionPayload({ sourceKind: 'snapshot' }), submission), CREATE_MESSAGE)
    expectContractError(
      () => parseCreatedPrediction(predictionPayload({ model: modelPayload({ state: 'invalid' }) }), submission),
      CREATE_MESSAGE,
    )
  })

  it('特征字段集必须恰好是模型声明的入模字段', () => {
    const records = predictionPayload().records
    expectContractError(
      () =>
        parseCreatedPrediction(
          predictionPayload({
            records: [{ ...records[0], features: { ...SIX_VALUES, extra: 1 } }],
          }),
          submission,
        ),
      CREATE_MESSAGE,
    )
    const { ld: _dropped, ...missing } = SIX_VALUES
    expectContractError(
      () => parseCreatedPrediction(predictionPayload({ records: [{ ...records[0], features: missing }] }), submission),
      CREATE_MESSAGE,
    )
  })

  it('风险必须是 0 到 1 之间的有限数', () => {
    const records = predictionPayload().records
    for (const risk of [-0.1, 1.5, Number.NaN]) {
      expectContractError(
        () => parseCreatedPrediction(predictionPayload({ records: [{ ...records[0], risk }] }), submission),
        CREATE_MESSAGE,
      )
    }
  })

  it('批次编号与输入哈希必须是规范身份', () => {
    expectContractError(() => parseCreatedPrediction(predictionPayload({ batchId: 'not-a-uuid' }), submission), CREATE_MESSAGE)
    expectContractError(() => parseCreatedPrediction(predictionPayload({ inputSha256: 'abc' }), submission), CREATE_MESSAGE)
    expectContractError(() => parseCreatedPrediction(predictionPayload({ createdAt: '2026-10-16 03:20:11' }), submission), CREATE_MESSAGE)
  })

  it('支持时解析归因条目与方法，未支持时只解析原因', () => {
    const supported = parseCreatedPrediction(predictionPayload({ records: [explainedRecord()] }), submission)
    expect(supported.records[0]?.explanationStatus).toBe('supported')
    expect(supported.records[0]?.explanationMethod).toBe('occlusion-mean-v1')
    expect(supported.records[0]?.explanation).toEqual(EXPLANATION_ITEMS)
    expect(supported.records[0]?.explanationSummary).toContain('影响最大的是 ns')
    expect(supported.records[0]?.explanationReason).toBeNull()

    const unsupported = parseCreatedPrediction(predictionPayload(), submission)
    expect(unsupported.records[0]?.explanationStatus).toBe('not-supported')
    expect(unsupported.records[0]?.explanation).toBeNull()
    expect(unsupported.records[0]?.explanationMethod).toBeNull()
    expect(unsupported.records[0]?.explanationReason).toBe('该模型的真实预测解释尚未接入')
  })

  it('归因条目形状不符约定时整体失败，不展示半份归因', () => {
    const bad = [
      { ...EXPLANATION_ITEMS[0], direction: 'raises' },
      { ...EXPLANATION_ITEMS[0], delta: 2 },
      { ...EXPLANATION_ITEMS[0], baseline: null },
      { ...EXPLANATION_ITEMS[0], feature: '' },
    ]
    for (const item of bad) {
      expectContractError(
        () => parseCreatedPrediction(predictionPayload({ records: [explainedRecord({ explanation: [item] })] }), submission),
        CREATE_MESSAGE,
      )
    }
    expectContractError(
      () =>
        parseCreatedPrediction(
          predictionPayload({ records: [explainedRecord({ explanation: Array(6).fill(EXPLANATION_ITEMS[0]) })] }),
          submission,
        ),
      CREATE_MESSAGE,
    )
    expectContractError(
      () => parseCreatedPrediction(predictionPayload({ records: [explainedRecord({ explanationMethod: null })] }), submission),
      CREATE_MESSAGE,
    )
  })

  it('正文完全不是对象时失败而不是抛出 TypeError', () => {
    expectContractError(() => parseCreatedPrediction(null, submission), CREATE_MESSAGE)
    expectContractError(() => parseCreatedPrediction([predictionPayload()], submission), CREATE_MESSAGE)
  })
})

describe('parseBatchPrediction', () => {
  it('重开只核对批次身份，模型此刻不可用也能展示历史结果', () => {
    const result = parseBatchPrediction(
      predictionPayload({ model: modelPayload({ state: 'invalid', error: { code: 'MODEL_NOT_READY', message: '模型不可用，请由管理员重新校验登记' } }) }),
      BATCH_ID,
    )
    expect(result.batchId).toBe(BATCH_ID)
    expect(result.model.state).toBe('invalid')
    expect(result.records[0]?.risk).toBeCloseTo(0.115752862320787, 12)
  })

  it('返回的批次不是地址里的批次时不能展示', () => {
    expectContractError(
      () => parseBatchPrediction(predictionPayload({ batchId: '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6e' }), BATCH_ID),
      BATCH_MESSAGE,
    )
  })

  it('多记录或坏记录的历史正文也不能展示', () => {
    const record = predictionPayload().records[0]
    expectContractError(() => parseBatchPrediction(predictionPayload({ records: [] }), BATCH_ID), BATCH_MESSAGE)
    expectContractError(
      () => parseBatchPrediction(predictionPayload({ records: [record, record] }), BATCH_ID),
      BATCH_MESSAGE,
    )
    expectContractError(
      () => parseBatchPrediction(predictionPayload({ records: [{ ...record, features: { ns: 1 } }] }), BATCH_ID),
      BATCH_MESSAGE,
    )
  })
})

describe('normalizedBatchId', () => {
  it('只接受规范 UUID，其他形式在发请求前就被拒绝', () => {
    expect(normalizedBatchId(` ${BATCH_ID.toUpperCase()} `)).toBe(BATCH_ID)
    expect(normalizedBatchId('2b3c4d5e6f704a8b9c0d1e2f3a4b5c6d')).toBeNull()
    expect(normalizedBatchId('')).toBeNull()
    expect(normalizedBatchId('../../etc/passwd')).toBeNull()
  })
})
