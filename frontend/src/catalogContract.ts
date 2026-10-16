/**
 * 模型中心与登记用的契约解析：只解析既有四个接口的正文。
 *
 * GET /api/v1/models、GET /api/v1/model-candidates、POST /api/v1/models/register 与
 * GET /api/v1/feature-schemas/{version}。解析器不复用历史契约，也不要求正文里出现
 * 任何服务器绝对路径。
 */

import {
  contractFailed,
  flag,
  hexDigest,
  plainData,
  plainDataOrNull,
  type PlainData,
  record,
  recordList,
  text,
  textList,
  textOrNull,
  uuidText,
} from './apiContract'

const MODEL_MESSAGE = '模型目录数据不符合约定，未展示模型'
const CANDIDATE_MESSAGE = '候选数据不符合约定，未展示候选'
const SCHEMA_MESSAGE = '输入说明数据不符合约定，未展示字段说明'
const REGISTRATION_MESSAGE = '登记结果不符合约定，未确认登记状态'

export interface FeatureField {
  name: string
  type: 'boolean' | 'integer' | 'number'
  unit: string
  description: string
  sourceStatus: 'missing' | 'verified'
  inModel: boolean
  sourceColumn: string
  transform: string
  reason: string | null
}

export interface FeatureSchema {
  featureSchemaVersion: string
  state: string
  schemaSha256: string
  inModel: string[]
  jsonPredictionSupported: boolean
  fields: FeatureField[]
  transforms: string[]
  limitations: string[]
}

export interface ModelEntry {
  modelId: string
  runId: string
  datasetVersion: string
  artifactRunId: string
  artifactDatasetVersion: string
  artifactModelId: string
  name: string
  method: string
  sha256: string
  featureSchemaVersion: string
  featureSchema: FeatureSchema
  jsonPredictionSupported: boolean
  trainingEnvironment: PlainData | null
  origin: string
  verificationEnvironment: PlainData
  reproducibility: PlainData
  limitations: string[]
  state: 'ready' | 'invalid'
  error: { code: string; message: string } | null
}

export interface ModelCandidate {
  candidateId: string
  displayName: string
  state: 'candidate' | 'invalid'
  manifestSha256: string | null
  artifactRunId: string | null
  method: string | null
  featureSchemaVersion: string | null
  error: { code: string; message: string } | null
}

export interface RegistrationOutcome {
  created: boolean
  model: ModelEntry
}

function fieldType(value: unknown): FeatureField['type'] {
  const raw = text(value, SCHEMA_MESSAGE)
  if (raw !== 'boolean' && raw !== 'integer' && raw !== 'number') contractFailed(SCHEMA_MESSAGE)
  return raw
}

function sourceStatus(value: unknown): FeatureField['sourceStatus'] {
  const raw = text(value, SCHEMA_MESSAGE)
  if (raw !== 'missing' && raw !== 'verified') contractFailed(SCHEMA_MESSAGE)
  return raw
}

function errorEntry(value: unknown, message: string): { code: string; message: string } | null {
  if (value === null || value === undefined) return null
  const raw = record(value, message)
  return { code: text(raw.code, message), message: text(raw.message, message) }
}

export function parseFeatureSchema(input: unknown): FeatureSchema {
  const raw = record(input, SCHEMA_MESSAGE)
  const fields = recordList(raw.fields, SCHEMA_MESSAGE).map((field) => ({
    name: text(field.name, SCHEMA_MESSAGE),
    type: fieldType(field.type),
    unit: text(field.unit, SCHEMA_MESSAGE),
    description: text(field.description, SCHEMA_MESSAGE),
    sourceStatus: sourceStatus(field.sourceStatus),
    inModel: flag(field.inModel, SCHEMA_MESSAGE),
    sourceColumn: text(field.sourceColumn, SCHEMA_MESSAGE),
    transform: text(field.transform, SCHEMA_MESSAGE),
    reason: textOrNull(field.reason, SCHEMA_MESSAGE),
  }))
  return {
    featureSchemaVersion: text(raw.featureSchemaVersion, SCHEMA_MESSAGE),
    state: text(raw.state, SCHEMA_MESSAGE),
    schemaSha256: hexDigest(raw.schemaSha256, SCHEMA_MESSAGE),
    inModel: textList(raw.inModel, SCHEMA_MESSAGE),
    jsonPredictionSupported: flag(raw.jsonPredictionSupported, SCHEMA_MESSAGE),
    fields,
    transforms: textList(raw.transforms, SCHEMA_MESSAGE),
    limitations: textList(raw.limitations, SCHEMA_MESSAGE),
  }
}

export function parseModelEntry(input: unknown): ModelEntry {
  const raw = record(input, MODEL_MESSAGE)
  const state = text(raw.state, MODEL_MESSAGE)
  if (state !== 'ready' && state !== 'invalid') contractFailed(MODEL_MESSAGE)
  const featureSchema = parseFeatureSchema(raw.featureSchema)
  const featureSchemaVersion = text(raw.featureSchemaVersion, MODEL_MESSAGE)
  const jsonPredictionSupported = flag(raw.jsonPredictionSupported, MODEL_MESSAGE)
  // 模型内的 schema 与原产物身份必须自洽，否则这张模型卡不能作为可操作对象展示。
  if (featureSchema.featureSchemaVersion !== featureSchemaVersion) contractFailed(MODEL_MESSAGE)
  if (featureSchema.jsonPredictionSupported !== jsonPredictionSupported) contractFailed(MODEL_MESSAGE)
  return {
    modelId: uuidText(raw.modelId, MODEL_MESSAGE),
    runId: uuidText(raw.runId, MODEL_MESSAGE),
    datasetVersion: uuidText(raw.datasetVersion, MODEL_MESSAGE),
    artifactRunId: text(raw.artifactRunId, MODEL_MESSAGE),
    artifactDatasetVersion: text(raw.artifactDatasetVersion, MODEL_MESSAGE),
    artifactModelId: text(raw.artifactModelId, MODEL_MESSAGE),
    name: text(raw.name, MODEL_MESSAGE),
    method: text(raw.method, MODEL_MESSAGE),
    sha256: hexDigest(raw.sha256, MODEL_MESSAGE),
    featureSchemaVersion,
    featureSchema,
    jsonPredictionSupported,
    trainingEnvironment: plainDataOrNull(raw.trainingEnvironment, MODEL_MESSAGE),
    origin: text(raw.origin, MODEL_MESSAGE),
    verificationEnvironment: plainData(raw.verificationEnvironment, MODEL_MESSAGE),
    reproducibility: plainData(raw.reproducibility, MODEL_MESSAGE),
    limitations: textList(raw.limitations, MODEL_MESSAGE),
    state,
    error: errorEntry(raw.error, MODEL_MESSAGE),
  }
}

export function parseModelList(input: unknown): ModelEntry[] {
  const raw = record(input, MODEL_MESSAGE)
  return recordList(raw.models, MODEL_MESSAGE).map(parseModelEntry)
}

export function parseCandidateList(input: unknown): ModelCandidate[] {
  const raw = record(input, CANDIDATE_MESSAGE)
  return recordList(raw.candidates, CANDIDATE_MESSAGE).map((candidate) => {
    const state = text(candidate.state, CANDIDATE_MESSAGE)
    if (state !== 'candidate' && state !== 'invalid') contractFailed(CANDIDATE_MESSAGE)
    return {
      candidateId: hexDigest(candidate.candidateId, CANDIDATE_MESSAGE),
      displayName: text(candidate.displayName, CANDIDATE_MESSAGE),
      state,
      manifestSha256: textOrNull(candidate.manifestSha256, CANDIDATE_MESSAGE),
      artifactRunId: textOrNull(candidate.artifactRunId, CANDIDATE_MESSAGE),
      method: textOrNull(candidate.method, CANDIDATE_MESSAGE),
      featureSchemaVersion: textOrNull(candidate.featureSchemaVersion, CANDIDATE_MESSAGE),
      error: errorEntry(candidate.error, CANDIDATE_MESSAGE),
    }
  })
}

export function parseRegistration(input: unknown): RegistrationOutcome {
  const raw = record(input, REGISTRATION_MESSAGE)
  const model = parseModelEntry(raw.model)
  // 登记成功的正文只有已发布模型才有意义：状态不是 ready 就不能当作登记成功。
  if (model.state !== 'ready') contractFailed(REGISTRATION_MESSAGE)
  return { created: flag(raw.created, REGISTRATION_MESSAGE), model }
}

export function schemaFieldsInModel(schema: FeatureSchema): FeatureField[] {
  const inModel = new Set(schema.inModel)
  return schema.fields.filter((field) => field.inModel && inModel.has(field.name))
}

/** 一个模型是否可被新建预测页选为单条 JSON 预测目标。 */
export function predictionSelectable(model: ModelEntry): boolean {
  return model.state === 'ready' && model.jsonPredictionSupported && model.featureSchemaVersion === 'openstack-six-v1'
}

export function unavailableSchemaField(schema: FeatureSchema): FeatureField[] {
  return schema.fields.filter((field) => field.sourceStatus === 'missing')
}
