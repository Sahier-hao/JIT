import { useEffect, useRef, type ReactNode } from 'react'
import { FailureNotice, LoadingNotice } from '@/components/shared/Feedback'
import type { SyncView } from '@/features/projects/repositoryContract'

export interface AnalysisRecordState {
  state: 'idle' | 'loading' | 'error' | 'ready'
  syncs: SyncView[]
  total: number
  error: unknown
  retry: () => void
}

/**
 * 记录卡与右侧结果卡同高：大屏上卡片高度取右侧列，记录在卡片内滚动；
 * 窄屏退回自然高度，避免卡片被压成一行。
 */
export function ProjectAnalysisHistory({
  records,
  currentNotice,
  recordError,
  stretch,
  children,
}: {
  records: AnalysisRecordState
  currentNotice: string
  recordError: string
  /** 有分析结果时与右侧结果卡同高；没有结果时退回自然高度。 */
  stretch: boolean
  children: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const latest = records.syncs[0]?.syncId
  useEffect(() => {
    // 新分析完成后回到最新的那一条，而不是停在原来的滚动位置。
    if (latest && scroller.current) scroller.current.scrollTop = 0
  }, [latest])
  return <aside className={`flex min-h-0 flex-col gap-3 rounded-md border border-border-soft bg-card p-3${stretch ? ' lg:absolute lg:inset-0' : ''}`} aria-label="分析记录">
    <div className="flex shrink-0 items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground">分析记录</h2>
      <span className="text-xs text-foreground-4">{records.state === 'ready' ? `${records.total} 次` : ''}</span>
    </div>
    {currentNotice ? <p className="shrink-0 text-xs text-teal-deep" role="status">{currentNotice}</p> : null}
    {recordError ? <p className="shrink-0 text-xs text-rose" role="alert">{recordError}</p> : null}
    {records.state === 'loading' && records.syncs.length === 0
      ? <LoadingNotice label="正在读取分析记录"/>
      : records.state === 'error'
        ? <FailureNotice error={records.error} onRetry={records.retry}/>
        : records.syncs.length === 0
          ? <p className="py-6 text-center text-xs text-foreground-3">还没有分析记录。发起第一次分析后，这里按时间排列。</p>
          : <div ref={scroller} className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-1">
            {children}
          </div>}
    {records.state === 'ready' && records.total > 0
      ? <p className="shrink-0 border-t border-border-soft pt-2 text-center text-xs text-foreground-4">
        共 {records.total} 次分析{records.total > records.syncs.length ? `（显示最近 ${records.syncs.length} 次）` : ''}
      </p>
      : null}
  </aside>
}
