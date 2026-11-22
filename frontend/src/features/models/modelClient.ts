import { apiRequest } from '@/lib/apiClient'
import { record, recordList, text } from '@/lib/apiContract'
import { useQuery } from '@tanstack/react-query'

export interface ModelChoice { modelId: string; name: string; method: string; state: string; featureSchemaVersion?: string; repositoryPredictionSupported: boolean; enabled: boolean; isDefault: boolean }
export interface MethodParam {
  name: string
  label: string
  description: string
  type: 'int' | 'float'
  min: number
  max: number
  default: number | null
}
export interface MethodGuide {
  summary: string
  strengths: string[]
  tradeoffs: string[]
  whenToUse: string
  visual: {
    kind: string
    input: string
    output: string
    stages: string[]
  } | null
}
export interface MethodChoice {
  method: string
  name: string
  label: string
  category: string
  available: boolean
  supportedSchema: boolean
  reason: string | null
  requires: string[]
  detail: string
  preprocess: string[]
  explanation: { method: string; reason: string | null } | null
  guide: MethodGuide
  params: MethodParam[]
}
export async function trainingMethods(schema?: string, signal?: AbortSignal): Promise<{ schema: string; methods: MethodChoice[] }> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : ''
  const body = record(await apiRequest({ path: `/api/v1/training-methods${query}`, method: 'GET', signal }))
  return {
    schema: text(body.schema),
    methods: recordList(body.methods).map(raw => ({
      method: text(raw.method), name: text(raw.name), label: text(raw.label), category: text(raw.category),
      available: raw.available === true, supportedSchema: raw.supportedSchema === true,
      reason: raw.reason == null ? null : text(raw.reason),
      requires: Array.isArray(raw.requires) ? raw.requires.map(item => text(item)) : [],
      detail: raw.detail == null ? '' : text(raw.detail),
      preprocess: Array.isArray(raw.preprocess) ? raw.preprocess.map(item => text(item)) : [],
      explanation: (() => {
        if (raw.explanation == null) return null
        const explanation = record(raw.explanation)
        return {
          method: explanation.method == null ? '' : text(explanation.method),
          reason: explanation.reason == null ? null : text(explanation.reason),
        }
      })(),
      guide: (() => {
        const guide = raw.guide == null ? {} : record(raw.guide)
        const visual = guide.visual == null ? null : record(guide.visual)
        return {
          summary: guide.summary == null ? '' : text(guide.summary),
          strengths: Array.isArray(guide.strengths) ? guide.strengths.map(item => text(item)) : [],
          tradeoffs: Array.isArray(guide.tradeoffs) ? guide.tradeoffs.map(item => text(item)) : [],
          whenToUse: guide.whenToUse == null ? '' : text(guide.whenToUse),
          visual: visual ? {
            kind: visual.kind == null ? 'unknown' : text(visual.kind),
            input: visual.input == null ? '' : text(visual.input),
            output: visual.output == null ? '' : text(visual.output),
            stages: Array.isArray(visual.stages) ? visual.stages.map(item => text(item)) : [],
          } : null,
        }
      })(),
      params: Array.isArray(raw.params) ? recordList(raw.params).map(param => ({
        name: text(param.name),
        label: param.label == null ? text(param.name) : text(param.label),
        description: param.description == null ? '' : text(param.description),
        type: text(param.type) === 'int' ? 'int' : 'float',
        min: Number(param.min), max: Number(param.max),
        default: typeof param.default === 'number' ? param.default : null,
      })) : [],
    })),
  }
}
export async function repositoryModels(signal?: AbortSignal): Promise<ModelChoice[]> {
  const body = record(await apiRequest({ path: '/api/v1/repository-models', method: 'GET', signal }))
  return recordList(body.models).map(raw => ({ modelId: text(raw.modelId), name: text(raw.name), method: text(raw.method), state: text(raw.state), enabled: raw.enabled !== false, isDefault: raw.isDefault === true, repositoryPredictionSupported: raw.repositoryPredictionSupported === true, featureSchemaVersion: typeof raw.featureSchemaVersion === 'string' ? raw.featureSchemaVersion : undefined }))
}

/** 项目可选模型：按缓存共享，避免每个组件各自请求同一列表。 */
export function useRepositoryModels(enabled = true) {
  return useQuery({
    queryKey: ['repository-models'],
    queryFn: ({ signal }) => repositoryModels(signal),
    staleTime: 60_000,
    enabled,
  })
}

export function useModelName(modelId: string | null | undefined): string | null {
  const models = useRepositoryModels(Boolean(modelId))
  return modelId ? models.data?.find(model => model.modelId === modelId)?.name ?? null : null
}
