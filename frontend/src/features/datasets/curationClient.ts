import { apiRequest } from '@/lib/apiClient'
import { record, text } from '@/lib/apiContract'
import { parseCurationPreview, type CurationPreview } from '@/features/datasets/curationContract'

export type { CurationPreview } from '@/features/datasets/curationContract'

export interface CurationDerived {
  version: string
  preview: CurationPreview
}

export async function previewCuration(datasetVersion: string, recipe: unknown): Promise<CurationPreview> {
  return parseCurationPreview(await apiRequest({ path: '/api/admin/curation/preview', method: 'POST',
                                                  body: { datasetVersion, recipe } }))
}

export async function deriveCuration(datasetVersion: string, recipe: unknown): Promise<CurationDerived> {
  const value = record(await apiRequest({ path: '/api/admin/curation/derive', method: 'POST',
                                          body: { datasetVersion, recipe } }))
  return { version: text(record(value.dataset).version), preview: parseCurationPreview(value.preview) }
}

export async function compareCuration(source: string, derived: string): Promise<Record<string, unknown>> {
  return record(await apiRequest({ path: `/api/admin/curation/compare?source=${encodeURIComponent(source)}&derived=${encodeURIComponent(derived)}`, method: 'GET' }))
}

export async function exportCuration(version: string): Promise<void> {
  const response = await fetch(`/api/admin/curation/export?version=${encodeURIComponent(version)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('导出失败')
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `${version}.zip`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
