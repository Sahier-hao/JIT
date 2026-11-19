import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { FailureNotice, LoadingNotice } from '@/components/shared/Feedback'
import type { SyncView } from '@/features/projects/repositoryContract'

export interface AnalysisRecordState {
  state: 'idle' | 'loading' | 'error' | 'ready'
  syncs: SyncView[]
  total: number
  error: unknown
  retry: () => void
}

export function ProjectAnalysisHistory({
  records,
  currentNotice,
  recordError,
  page,
  setPage,
  children,
}: {
  records: AnalysisRecordState
  currentNotice: string
  recordError: string
  page: number
  setPage: Dispatch<SetStateAction<number>>
  children: ReactNode
}) {
  return <aside className="grid content-start gap-3 rounded-md border border-border-soft bg-card p-3" aria-label="分析记录">
    <div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-foreground">分析记录</h2><span className="text-xs text-foreground-4">{records.state === 'ready' ? `${records.total} 次` : ''}</span></div>
    {currentNotice ? <p className="text-xs text-teal-deep" role="status">{currentNotice}</p> : null}
    {recordError ? <p className="text-xs text-rose" role="alert">{recordError}</p> : null}
    {records.state === 'loading' && records.syncs.length === 0 ? <LoadingNotice label="正在读取分析记录"/> : records.state === 'error' ? <FailureNotice error={records.error} onRetry={records.retry}/> : records.syncs.length === 0 ? <p className="py-6 text-center text-xs text-foreground-3">还没有分析记录。发起第一次分析后，这里按时间排列。</p> : <div className="grid gap-2">{children}</div>}
    {records.state === 'ready' && records.total > 0 && records.total <= 10 ? <p className="text-center text-xs text-foreground-4">共 {records.total} 次分析</p> : null}
    {records.total > 10 ? <nav className="flex items-center justify-between gap-2 border-t border-border-soft pt-2 text-xs text-foreground-3" aria-label="分析记录分页"><span>第 {page + 1} / {Math.ceil(records.total / 10)} 页</span><Button size="sm" disabled={page === 0 || records.state === 'loading'} onClick={() => setPage(value => value - 1)} variant="outline" type="button">上一页</Button><Button size="sm" disabled={(page + 1) * 10 >= records.total || records.state === 'loading'} onClick={() => setPage(value => value + 1)} variant="outline" type="button">下一页</Button></nav> : null}
  </aside>
}
