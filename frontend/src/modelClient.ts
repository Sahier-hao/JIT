import { apiRequest } from './apiClient'
import { record, recordList, text } from './apiContract'
import { useEffect, useState } from 'react'

export interface ModelChoice { modelId: string; name: string; method: string; state: string; featureSchemaVersion?: string; repositoryPredictionSupported: boolean; enabled: boolean; isDefault: boolean }
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
