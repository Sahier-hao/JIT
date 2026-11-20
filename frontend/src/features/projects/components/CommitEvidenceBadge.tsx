import { cn } from '@/lib/utils'
import type { CommitLabelStatus } from '@/features/projects/repositoryContract'

const LABELS: Record<CommitLabelStatus, string> = {
  positive: '有引入证据',
  unobserved: '观察期内未发现',
  immature: '观察期未满',
  unknown: '观察覆盖未知',
}

export function CommitEvidenceBadge({ status = 'unknown' }: { status?: CommitLabelStatus }) {
  return <span className={cn('inline-flex rounded-sm px-2 py-0.5 text-xs',
    status === 'positive' ? 'bg-rose-soft text-rose-deep'
      : status === 'immature' ? 'bg-amber-soft text-amber-deep' : 'bg-soft text-foreground-3')}>{LABELS[status]}</span>
}
