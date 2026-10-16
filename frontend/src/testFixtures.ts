/**
 * 契约测试用的响应夹具（不是生产代码）。
 *
 * 形状严格照抄后端既有正文：字段名、哈希格式（裸 64 位小写十六进制）与 UUID 都必须是
 * 真实契约下合法的值，否则解析器会先因为格式不合法而失败，测不到真正的分支。
 */

export const MODEL_ID = '1f2b0e5c-8a41-4c3d-9f60-7a1d2e3b4c50'
export const RUN_ID = '9c7d6e5f-4a3b-4c2d-8e1f-0a9b8c7d6e5f'
export const DATASET_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
export const BATCH_ID = '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d'
export const PREDICTION_ID = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d'
export const MODEL_SHA =
  '58189649967abc2ea9a9f0f6f4d1c2b3a4e5d6c7b8a9f0e1d2c3b4a596877869'
export const SCHEMA_SHA =
  'aa11bb22cc33dd44ee55ff6600778899aabbccddeeff00112233445566778899'
export const INPUT_SHA =
  'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100'
export const CANDIDATE_ID =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export const MANIFEST_SHA =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
export const COMMIT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

export const SIX_VALUES = { ns: 4, nd: 7, nf: 12, ent: 2.25, la: 120, ld: 9 }

export function schemaPayload(overrides: Record<string, unknown> = {}) {
  const names = ['ns', 'nd', 'nf', 'ent', 'la', 'ld']
  const descriptions: Record<string, string> = {
    ns: '涉及子系统数',
    nd: '涉及目录数',
    nf: '修改文件数',
    ent: '修改在文件间的分散程度',
    la: '增加行数',
    ld: '删除行数',
  }
  return {
    featureSchemaVersion: 'openstack-six-v1',
    state: 'ready',
    schemaSha256: SCHEMA_SHA,
    inModel: names,
    jsonPredictionSupported: true,
    fields: names.map((name) => ({
      name,
      type: name === 'ent' ? 'number' : 'integer',
      unit: '发布者原生单位',
      description: descriptions[name],
      sourceStatus: 'verified',
      inModel: true,
      sourceColumn: name,
      transform: name === 'ent' ? 'raw' : 'log1p',
      reason: null,
    })),
    transforms: ['log1p'],
    limitations: [],
    ...overrides,
  }
}

export function modelPayload(overrides: Record<string, unknown> = {}) {
  return {
    modelId: MODEL_ID,
    runId: RUN_ID,
    datasetVersion: DATASET_ID,
    artifactRunId: 'baseline',
    artifactDatasetVersion: 'openstack-six-v1-snapshot',
    artifactModelId: 'logistic-regression-l2-v1',
    name: '逻辑回归 · 六字段',
    method: 'logistic-regression-l2-v1',
    sha256: MODEL_SHA,
    featureSchemaVersion: 'openstack-six-v1',
    featureSchema: schemaPayload(),
    jsonPredictionSupported: true,
    trainingEnvironment: { python: '3.14.2', platform: 'Windows', packages: { sklearn: '1.7.0' } },
    origin: 'local',
    verificationEnvironment: { python: '3.14.2', platform: 'Windows', packages: {} },
    reproducibility: { mode: 'tolerance', atol: 1e-8, rtol: 0 },
    limitations: ['公开历史数据，标签为发布者观测。', '未验证在线仓库效果。'],
    state: 'ready',
    error: null,
    ...overrides,
  }
}

export function candidatePayload(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: CANDIDATE_ID,
    displayName: 'baseline',
    state: 'candidate',
    manifestSha256: MANIFEST_SHA,
    artifactRunId: 'baseline',
    method: 'logistic-regression-l2-v1',
    featureSchemaVersion: 'openstack-six-v1',
    error: null,
    ...overrides,
  }
}

export function predictionPayload(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'feature-input',
    sourceKind: 'client-features',
    batchId: BATCH_ID,
    project: 'openstack',
    runId: RUN_ID,
    model: modelPayload(),
    featureSchemaVersion: 'openstack-six-v1',
    inputSha256: INPUT_SHA,
    createdAt: '2026-10-16T03:20:11Z',
    records: [
      {
        predictionId: PREDICTION_ID,
        recordId: 'demo-0001',
        features: { ...SIX_VALUES },
        commitId: COMMIT_ID,
        time: '2026-10-15T18:00:00Z',
        risk: 0.115752862320787,
        explanationStatus: 'not-supported',
        explanationReason: '该模型的真实预测解释尚未接入',
      },
    ],
    limitations: ['原始特征由调用方提供，尚未核验源码提取或真实标签。'],
    ...overrides,
  }
}

/** 一次成功的 `fetch` 响应；`body` 为 null 表示成功状态但正文不可解析。 */
export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => {
      if (body === null) throw new SyntaxError('Unexpected token')
      return body
    },
  } as unknown as Response
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  options: { requestId?: string; details?: { field: string; reason: string }[] } = {},
) {
  return jsonResponse(
    status,
    {
      error: {
        code,
        message,
        requestId: options.requestId ?? 'req-0001',
        ...(options.details === undefined ? {} : { details: options.details }),
      },
    },
    { 'X-Request-Id': options.requestId ?? 'req-0001' },
  )
}
