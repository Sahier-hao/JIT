/**
 * 项目状态：项目列表与项目页共用同一套说法，避免两处各写一份判断。
 *
 * 顺序有讲究：进行中的分析优先于历史结果——项目已有成功结果时又发起新分析，
 * 列表应显示「正在分析」，而不是让人以为可以立即打开旧结果（旧结果在项目页仍可打开）。
 */
import { ACTIVE_STATUSES, STATUS_LABELS, type SyncView } from './repositoryContract'
import type { RepositoryView } from './repositoryWorkspace'

export type ProjectState = 'running' | 'analyzed' | 'failed' | 'waiting'
export type ProjectTone = 'active' | 'ok' | 'alert' | 'muted'

export interface ProjectStatus {
  state: ProjectState
  label: string
  tone: ProjectTone
}

export function projectStatus(repository: RepositoryView, latest: SyncView | null | undefined): ProjectStatus {
  const active = latest !== null && latest !== undefined && (ACTIVE_STATUSES as readonly string[]).includes(latest.status)
  if (active && latest) return { state: 'running', label: latest.cancelRequestedAt ? '正在取消分析' : STATUS_LABELS[latest.stage], tone: 'active' }
  if (repository.viewSyncId) return { state: 'analyzed', label: '已有分析结果', tone: 'ok' }
  if (latest?.status === 'failed') return { state: 'failed', label: '上次分析失败', tone: 'alert' }
  if (latest?.status === 'interrupted') return { state: 'failed', label: '上次分析中断', tone: 'alert' }
  if (latest?.status === 'cancelled') return { state: 'waiting', label: '上次分析已取消', tone: 'muted' }
  return { state: 'waiting', label: '等待分析', tone: 'muted' }
}
