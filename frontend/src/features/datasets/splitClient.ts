import { apiRequest } from '@/lib/apiClient'
import { finiteNumber, record, text, textOrNull } from '@/lib/apiContract'

export const SPLIT_PRESETS = [
  { value: 'temporal-70-15-15', label: '70 / 15 / 15（默认）' },
  { value: 'temporal-90-5-5', label: '90 / 5 / 5（更多训练）' },
  { value: 'temporal-80-5-15', label: '80 / 5 / 15（少验证）' },
  { value: 'temporal-80-10-10', label: '80 / 10 / 10' },
  { value: 'temporal-70-10-20', label: '70 / 10 / 20' },
  { value: 'temporal-60-15-25', label: '60 / 15 / 25' },
  { value: 'temporal-60-20-20', label: '60 / 20 / 20' },
  { value: 'temporal-50-25-25', label: '50 / 25 / 25（更多测试）' },
] as const

export interface SplitPreview {
  datasetVersion: string
  schemaName: string
  preset: { id: string; ratios: { train: number; validation: number; test: number }; timezone: string }
  timezone: string
  datasetRecords: number
  eligibleRecords: number
  maturityPolicy: string
  maturity: Record<string, unknown> | null
  admission: Record<string, unknown> | null
  available: boolean
  reason: { code: string; message: string } | null
  partitions: null | Record<'train' | 'validation' | 'test', {
    records: number
    positives: number
    start: string
    end: string
  }>
}

export async function previewDatasetSplit(datasetVersion: string, preset: string, signal?: AbortSignal,
                                          maturityPolicy = 'mature-only'): Promise<SplitPreview> {
  const query = new URLSearchParams({ preset, maturityPolicy })
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
      eligibleRecords: finiteNumber(value.eligibleRecords ?? value.datasetRecords),
      maturityPolicy: textOrNull(value.maturityPolicy) ?? 'mature-only',
      maturity: value.maturity == null ? null : record(value.maturity),
      admission: value.admission == null ? null : record(value.admission),
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
