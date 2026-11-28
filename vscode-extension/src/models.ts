import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface CommitModel {
  modelId: string
  name: string
  method: string | null
  featureSchema: string
  isDefault: boolean
  runId: string
}

export interface CommitModelOptions {
  backend: string
  python: string
  pythonArgs?: string[]
  database: string
  artifactRoot: string
}

export interface ModelChoice {
  label: string
  description: string
  detail: string
  model: CommitModel
}

function fail(message: string): never {
  throw new Error(message)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${field} 不是对象`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} 无效`)
  return value.trim()
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null
  return text(value, field)
}

/** 严格解析 CLI 模型列表；空模型、重复 ID 或伪造默认状态都拒绝。 */
export function parseModelList(raw: unknown): CommitModel[] {
  const root = record(raw, '模型列表')
  if (root.format !== 'jit-pr-check-models-v1') fail('不是受支持的 JIT 模型列表')
  if (!Array.isArray(root.models)) fail('模型列表字段无效')
  const seen = new Set<string>()
  return root.models.map((item, index) => {
    const value = record(item, `models[${index}]`)
    const modelId = text(value.modelId, `models[${index}].modelId`)
    if (seen.has(modelId)) fail(`模型 ID 重复：${modelId}`)
    seen.add(modelId)
    if (typeof value.isDefault !== 'boolean') fail(`模型 ${modelId} 的默认状态无效`)
    return {
      modelId,
      name: text(value.name, `models[${index}].name`),
      method: nullableText(value.method, `models[${index}].method`),
      featureSchema: text(value.featureSchema, `models[${index}].featureSchema`),
      isDefault: value.isDefault,
      runId: text(value.runId, `models[${index}].runId`),
    }
  })
}

export function parseModelListOutput(output: string): CommitModel[] {
  let raw: unknown
  try {
    raw = JSON.parse(output)
  } catch {
    fail('模型列表不是有效 JSON')
  }
  return parseModelList(raw)
}

export function modelChoices(models: CommitModel[], currentId = ''): ModelChoice[] {
  return models.map(model => ({
    label: `${model.name}${model.isDefault ? ' · 默认' : ''}${model.modelId === currentId ? ' · 当前' : ''}`,
    description: `${model.method ?? '方法未提供'} · ${model.featureSchema}`,
    detail: `modelId ${model.modelId} · run ${model.runId.slice(0, 12)}`,
    model,
  }))
}

export async function listCommitModels(options: CommitModelOptions): Promise<CommitModel[]> {
  const args = [
    ...(options.pythonArgs ?? []),
    '-m', 'jit_baseline.cli', 'pr-check-models',
    '--database', options.database,
    '--artifact-root', options.artifactRoot,
    '--json',
  ]
  const { stdout } = await run(options.python, args, {
    cwd: options.backend,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  })
  return parseModelListOutput(stdout)
}
