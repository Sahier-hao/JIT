import { apiRequest } from '@/lib/apiClient'
import { record, recordList, text, textOrNull } from '@/lib/apiContract'

export type EvidenceStatus = 'available' | 'stale' | 'invalid'
const ADMIN_READ_TIMEOUT_MS = 30_000

export interface EvaluationEvidenceEntry {
  evidenceId: string
  kind: string
  status: EvidenceStatus
  reason: string | null
  source: string
  sha256: string
  generatedUtc: string | null
  summary: Record<string, unknown> | null
}

function status(value: unknown): EvidenceStatus {
  return value === 'available' || value === 'stale' ? value : 'invalid'
}

export async function fetchEvaluationEvidence(signal?: AbortSignal): Promise<EvaluationEvidenceEntry[]> {
  const body = record(await apiRequest({ path: '/api/admin/evaluation-evidence', method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
  return recordList(body.evidence).map(item => {
    const value = record(item)
    return {
      evidenceId: text(value.evidenceId),
      kind: text(value.kind),
      status: status(value.status),
      reason: textOrNull(value.reason),
      source: text(value.source),
      sha256: text(value.sha256),
      generatedUtc: textOrNull(value.generatedUtc),
      summary: value.summary == null ? null : record(value.summary),
    }
  })
}
