import { apiRequest } from './apiClient'
import { record, recordList, text } from './apiContract'
import { useEffect, useState } from 'react'

export interface ModelChoice { modelId: string; name: string; method: string; state: string; featureSchemaVersion?: string; repositoryPredictionSupported: boolean; enabled: boolean; isDefault: boolean }
export interface MethodChoice { method: string; name: string; label: string; category: string; available: boolean; supportedSchema: boolean; reason: string | null; requires: string[] }
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
    })),
  }
}
export async function repositoryModels(signal?: AbortSignal): Promise<ModelChoice[]> {
  const body = record(await apiRequest({ path: '/api/v1/repository-models', method: 'GET', signal }))
  return recordList(body.models).map(raw => ({ modelId: text(raw.modelId), name: text(raw.name), method: text(raw.method), state: text(raw.state), enabled: raw.enabled !== false, isDefault: raw.isDefault === true, repositoryPredictionSupported: raw.repositoryPredictionSupported === true, featureSchemaVersion: typeof raw.featureSchemaVersion === 'string' ? raw.featureSchemaVersion : undefined }))
}

export function useModelName(modelId: string | null | undefined): string | null {
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    if (!modelId) return
    const controller = new AbortController()
    repositoryModels(controller.signal).then(models => { const model = models.find(item => item.modelId === modelId); if (model && !controller.signal.aborted) setSelected({ id: modelId, name: model.name }) }).catch(() => undefined)
    return () => controller.abort()
  }, [modelId])
  return selected && selected.id === modelId ? selected.name : null
}
