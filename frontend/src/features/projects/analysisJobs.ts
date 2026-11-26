import type { Route } from '@/app/navigation'
import { queryClient } from '@/lib/queryClient'

export type TrackedAnalysisKind = 'branch' | 'pr' | 'pr-batch'

export interface TrackedAnalysisJob {
  id: string
  kind: TrackedAnalysisKind
  repositoryId: string
  repositoryName: string
  label: string
  route: Route
  createdAt: string
  syncId?: string
  batchId?: string
  snapshotId?: string
}

const STORAGE_KEY = 'jit:tracked-analysis-jobs'
const ACTIVE_JOBS_KEY = ['active-jobs', 'user'] as const

function read(): TrackedAnalysisJob[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(item => item && typeof item.id === 'string' && typeof item.repositoryId === 'string'
      && (typeof item.syncId === 'string' || typeof item.batchId === 'string'))
  } catch {
    return []
  }
}

function write(items: TrackedAnalysisJob[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 20)))
  } catch {
    // 存储不可用时仍保留当前页面内的进度，不阻塞分析流程。
  }
}

function notify() {
  void queryClient.invalidateQueries({ queryKey: ACTIVE_JOBS_KEY })
}

export function trackAnalysisJob(job: TrackedAnalysisJob) {
  write([job, ...read().filter(item => item.id !== job.id)])
  notify()
}

export function trackedAnalysisJobs(): TrackedAnalysisJob[] {
  return read()
}

export function hasTrackedAnalysisJob(id: string): boolean {
  return read().some(item => item.id === id)
}

export function forgetAnalysisJobs(ids: readonly string[]) {
  if (!ids.length) return
  const forgotten = new Set(ids)
  write(read().filter(item => !forgotten.has(item.id)))
}
