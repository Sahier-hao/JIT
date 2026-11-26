import type { SyncStatus } from '@/features/projects/repositoryContract'

export const SYNC_STAGES = [
  { key: 'queued', label: '排队' },
  { key: 'collecting', label: '采集' },
  { key: 'registering', label: '登记' },
  { key: 'training', label: '训练' },
  { key: 'scoring', label: '评分' },
] as const

export const SYNC_ACTIVE_STAGES: readonly SyncStatus[] = ['queued', 'collecting', 'registering', 'training', 'scoring']
export const SYNC_RUNNING_STAGES: readonly SyncStatus[] = ['collecting', 'registering', 'training', 'scoring']
export const SYNC_SCORING_STAGES = SYNC_STAGES.filter(stage => stage.key !== 'training')

export function syncStageIndex(status: SyncStatus, stage: SyncStatus, stages: ReadonlyArray<typeof SYNC_STAGES[number]>) {
  if (status === 'completed') return stages.length
  if (status === 'queued') return 0
  const current = (SYNC_RUNNING_STAGES.includes(status) ? status : stage) as string
  const index = stages.findIndex(item => item.key === current)
  return index < 0 ? 0 : index
}

export function syncProgressValue(status: SyncStatus, stage: SyncStatus, scoresOnly = false): number {
  const stages = scoresOnly && status !== 'training' && stage !== 'training' ? SYNC_SCORING_STAGES : SYNC_STAGES
  const index = syncStageIndex(status, stage, stages)
  if (status === 'completed') return 100
  if (status === 'queued') return 0
  return Math.min(99, Math.round(((index + .5) / stages.length) * 100))
}
