/**
 * 模型中心四个既有接口的契约解析（任务 2.1）。
 *
 * 每个用例都对应一条真实可发生的正文：合法正文必须被完整解析，任何一处不合法都必须整体
 * 失败，而不是留下一张字段缺失的模型卡。
 */

import { describe, expect, it } from 'vitest'
import {
  parseCandidateList,
  parseFeatureSchema,
  parseModelEntry,
  parseModelList,
  parseRegistration,
  predictionSelectable,
  schemaFieldsInModel,
  unavailableSchemaField,
} from './catalogContract'
import { ContractError } from './apiContract'
import {
  CANDIDATE_ID,
  MANIFEST_SHA,
  MODEL_SHA,
  candidatePayload,
  modelPayload,
  schemaPayload,
} from './testFixtures'

const MODEL_MESSAGE = '模型目录数据不符合约定，未展示模型'
const CANDIDATE_MESSAGE = '候选数据不符合约定，未展示候选'
const SCHEMA_MESSAGE = '输入说明数据不符合约定，未展示字段说明'

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

describe('parseFeatureSchema', () => {
  it('解析六字段说明，并保留未提供字段的原因', () => {
    const schema = parseFeatureSchema(schemaPayload())
    expect(schema.featureSchemaVersion).toBe('openstack-six-v1')
    expect(schema.jsonPredictionSupported).toBe(true)
    expect(schema.inModel).toEqual(['ns', 'nd', 'nf', 'ent', 'la', 'ld'])
    expect(schemaFieldsInModel(schema).map((field) => field.name)).toEqual([
      'ns',
      'nd',
      'nf',
      'ent',
      'la',
      'ld',
    ])
    expect(unavailableSchemaField(schema)).toEqual([])
  })

  it('十二字段模型如实带出未提供的字段与原因', () => {
    const schema = parseFeatureSchema(
      schemaPayload({
        featureSchemaVersion: 'kamei14-v1',
        jsonPredictionSupported: false,
        inModel: ['ns', 'nd', 'nf', 'ent', 'la', 'ld', 'ndev', 'age', 'nuc', 'exp', 'sexp', 'fix'],
        fields: [
          ...schemaPayload().fields,
          {
            name: 'lt',
            type: 'integer',
            unit: '发布者原生单位',
            description: 'lt',
            sourceStatus: 'missing',
            inModel: false,
            sourceColumn: 'lt',
            transform: 'raw',
            reason: '固定快照不含变更前文件规模（Size 家族只有 la、ld），不能用 la+ld 替代',
          },
        ],
      }),
    )
    expect(schema.jsonPredictionSupported).toBe(false)
    expect(unavailableSchemaField(schema).map((field) => field.name)).toEqual(['lt'])
    expect(unavailableSchemaField(schema)[0]?.reason).toContain('不能用 la+ld 替代')
  })

  it('schemaSha256 不是裸 64 位小写十六进制时整体失败', () => {
    expectContractError(
      () => parseFeatureSchema(schemaPayload({ schemaSha256: 'sha256:' + 'a'.repeat(64) })),
      SCHEMA_MESSAGE,
    )
    expectContractError(
      () => parseFeatureSchema(schemaPayload({ schemaSha256: 'A'.repeat(64) })),
      SCHEMA_MESSAGE,
    )
  })

  it('字段类型与来源状态只接受枚举内的取值', () => {
    const fields = schemaPayload().fields
    expectContractError(
      () => parseFeatureSchema(schemaPayload({ fields: [{ ...fields[0], type: 'float' }] })),
      SCHEMA_MESSAGE,
    )
    expectContractError(
      () => parseFeatureSchema(schemaPayload({ fields: [{ ...fields[0], sourceStatus: 'unknown' }] })),
      SCHEMA_MESSAGE,
    )
  })
})

describe('parseModelEntry', () => {
  it('解析可用模型，不要求正文出现任何服务器路径', () => {
    const model = parseModelEntry(modelPayload())
    expect(model.state).toBe('ready')
    expect(model.error).toBeNull()
    expect(model.modelId).toBe('1f2b0e5c-8a41-4c3d-9f60-7a1d2e3b4c50')
    expect(model.sha256).toBe(MODEL_SHA)
    expect(model.featureSchema.featureSchemaVersion).toBe(model.featureSchemaVersion)
    expect(model.origin).toBe('local')
    expect(model.reproducibility).toEqual({ mode: 'tolerance', atol: 1e-8, rtol: 0 })
    expect(model.limitations).toHaveLength(2)
    expect(JSON.stringify(model)).not.toMatch(/[A-Za-z]:[\\/]/)
  })

  it('失效模型保留可公开的失败原因', () => {
    const model = parseModelEntry(
      modelPayload({ state: 'invalid', error: { code: 'INTEGRITY_ERROR', message: '运行文件校验不匹配，请核验并重新登记' } }),
    )
    expect(model.state).toBe('invalid')
    expect(model.error?.code).toBe('INTEGRITY_ERROR')
    expect(predictionSelectable(model)).toBe(false)
  })

  it('模型内的 schema 与原产物身份必须自洽', () => {
    expectContractError(
      () => parseModelEntry(modelPayload({ featureSchema: schemaPayload({ featureSchemaVersion: 'kamei14-v1' }) })),
      MODEL_MESSAGE,
    )
    expectContractError(
      () => parseModelEntry(modelPayload({ featureSchema: schemaPayload({ jsonPredictionSupported: false }) })),
      MODEL_MESSAGE,
    )
  })

  it('空目录是合法的空列表，不是错误', () => {
    expect(parseModelList({ models: [] })).toEqual([])
    expectContractError(() => parseModelList({ models: {} }), MODEL_MESSAGE)
    expectContractError(() => parseModelList({ candidates: [] }), MODEL_MESSAGE)
  })

  it('训练环境可以为 null，来源信息里的非有限数一律拒绝', () => {
    expect(parseModelEntry(modelPayload({ trainingEnvironment: null })).trainingEnvironment).toBeNull()
    expect(parseModelEntry(modelPayload({ trainingEnvironment: 'Windows', verificationEnvironment: 'Windows' })).origin).toBe('local')
    expectContractError(
      () => parseModelEntry(modelPayload({ reproducibility: { mode: 'tolerance', atol: Number.POSITIVE_INFINITY } })),
      MODEL_MESSAGE,
    )
    expectContractError(
      () => parseModelEntry(modelPayload({ verificationEnvironment: { packages: { sklearn: Number.NaN } } })),
      MODEL_MESSAGE,
    )
  })
})

describe('predictionSelectable', () => {
  it('只有 ready、支持单条 JSON 预测且 schema 为六字段时才可被选为预测目标', () => {
    expect(predictionSelectable(parseModelEntry(modelPayload()))).toBe(true)
    expect(predictionSelectable(parseModelEntry(modelPayload({ jsonPredictionSupported: false, featureSchema: schemaPayload({ jsonPredictionSupported: false }) })))).toBe(false)
    expect(predictionSelectable(parseModelEntry(modelPayload({ state: 'invalid' })))).toBe(false)
  })
})

describe('parseCandidateList', () => {
  it('解析候选并保留可用于显式校验的清单哈希', () => {
    const [candidate] = parseCandidateList({ candidates: [candidatePayload()] })
    expect(candidate?.candidateId).toBe(CANDIDATE_ID)
    expect(candidate?.manifestSha256).toBe(MANIFEST_SHA)
    expect(candidate?.state).toBe('candidate')
    expect(candidate?.error).toBeNull()
  })

  it('失效候选没有可用哈希，且带出原因', () => {
    const [candidate] = parseCandidateList({
      candidates: [
        candidatePayload({
          state: 'invalid',
          manifestSha256: null,
          error: { code: 'ARTIFACT_INVALID', message: '运行声明或环境无效，请核验产物' },
        }),
      ],
    })
    expect(candidate?.state).toBe('invalid')
    expect(candidate?.manifestSha256).toBeNull()
    expect(candidate?.error?.code).toBe('ARTIFACT_INVALID')
  })

  it('candidateId 必须是裸 64 位哈希，不接受路径或任意字符串', () => {
    expectContractError(
      () => parseCandidateList({ candidates: [candidatePayload({ candidateId: 'baseline' })] }),
      CANDIDATE_MESSAGE,
    )
  })
})

describe('parseRegistration', () => {
  it('201 新增与 200 复用都以 created 区分', () => {
    expect(parseRegistration({ created: true, model: modelPayload() }).created).toBe(true)
    expect(parseRegistration({ created: false, model: modelPayload() }).created).toBe(false)
  })

  it('正文里的模型不是 ready 时不能当成登记成功', () => {
    expectContractError(
      () => parseRegistration({ created: true, model: modelPayload({ state: 'invalid' }) }),
      '登记结果不符合约定，未确认登记状态',
    )
  })

  it('缺少 created 或 model 时整体失败', () => {
    expectContractError(() => parseRegistration({ model: modelPayload() }), '登记结果不符合约定，未确认登记状态')
    expectContractError(() => parseRegistration({ created: true }), MODEL_MESSAGE)
    expectContractError(() => parseRegistration({ created: 'true', model: modelPayload() }), '登记结果不符合约定，未确认登记状态')
  })
})
