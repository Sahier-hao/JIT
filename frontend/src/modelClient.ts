import { apiRequest } from './apiClient'
import { record, recordList, text } from './apiContract'
import { useQuery } from '@tanstack/react-query'

export interface ModelChoice { modelId: string; name: string; method: string; state: string; featureSchemaVersion?: string; repositoryPredictionSupported: boolean; enabled: boolean; isDefault: boolean }
export interface MethodParam { name: string; type: 'int' | 'float'; min: number; max: number; default: number | null }
export interface MethodChoice { method: string; name: string; label: string; category: string; available: boolean; supportedSchema: boolean; reason: string | null; requires: string[]; params: MethodParam[] }
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
      params: Array.isArray(raw.params) ? recordList(raw.params).map(param => ({
        name: text(param.name),
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
export function useRepositoryModels() {
  return useQuery({
    queryKey: ['repository-models'],
    queryFn: ({ signal }) => repositoryModels(signal),
    staleTime: 60_000,
  })
}

export function useModelName(modelId: string | null | undefined): string | null {
  const models = useRepositoryModels()
  return modelId ? models.data?.find(model => model.modelId === modelId)?.name ?? null : null
}
