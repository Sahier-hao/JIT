import { apiRequest } from './apiClient'
import { finiteNumber, record, text, textOrNull } from './apiContract'

export const SPLIT_PRESETS = [
  { value: 'temporal-70-15-15', label: '70 / 15 / 15（默认）' },
  { value: 'temporal-80-10-10', label: '80 / 10 / 10' },
  { value: 'temporal-60-20-20', label: '60 / 20 / 20' },
] as const

export interface SplitPreview {
  datasetVersion: string
  schemaName: string
  preset: { id: string; ratios: { train: number; validation: number; test: number }; timezone: string }
  timezone: string
  datasetRecords: number
  available: boolean
  reason: { code: string; message: string } | null
  partitions: null | Record<'train' | 'validation' | 'test', {
    records: number
    positives: number
    start: string
    end: string
  }>
}

export async function previewDatasetSplit(datasetVersion: string, preset: string, signal?: AbortSignal): Promise<SplitPreview> {
  const query = new URLSearchParams({ preset })
  const value = record(await apiRequest({
    path: `/api/admin/datasets/${encodeURIComponent(datasetVersion)}/split-preview?${query}`,
    method: 'GET',
    signal,
  }))
  const profile = record(value.preset)
  const ratios = record(profile.ratios)
  const parts = value.partitions == null ? null : record(value.partitions)
  const reason = value.reason == null ? null : record(value.reason)
  return {
    datasetVersion: text(value.datasetVersion),
    schemaName: text(value.schemaName),
    preset: {
      id: text(profile.id),
      ratios: {
        train: finiteNumber(ratios.train),
        validation: finiteNumber(ratios.validation),
        test: finiteNumber(ratios.test),
      },
      timezone: text(profile.timezone),
    },
    timezone: text(value.timezone),
    datasetRecords: finiteNumber(value.datasetRecords),
    available: value.available === true,
    reason: reason ? { code: text(reason.code), message: text(reason.message) } : null,
    partitions: parts == null ? null : {
      train: partition(parts.train),
      validation: partition(parts.validation),
      test: partition(parts.test),
    },
  }
}

function partition(raw: unknown) {
  const value = record(raw)
  return {
    records: finiteNumber(value.records),
    positives: finiteNumber(value.positives),
    start: textOrNull(value.start) ?? '',
    end: textOrNull(value.end) ?? '',
  }
}
