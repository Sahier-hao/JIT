import { ArrowRight, Bell, CheckCheck, ChevronRight, RefreshCw } from 'lucide-react'
import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'

import { EmptyState, FailureNotice, LoadingNotice } from '@/components/shared/Feedback'
import { displayTime } from '@/lib/domain'
import { projectEvents, type EventPage, type ProjectEvent } from '@/features/projects/projectActivityClient'
import { analysisRoute, linkTo, repositoryRoute, type Route } from '@/app/navigation'

export const EVENT_READ_KEY = 'jit:project-events:read:v1'
const KIND_LABELS: Record<string, string> = {
  'pr-discovered': '发现 PR',
  'pr-updated': 'PR 更新',
  'pr-open': 'PR 重新打开',
  'pr-closed': 'PR 已关闭',
  'pr-merged': 'PR 已合并',
  'pr-initial-summary': '初次接入',
  'pr-analysis-ready': 'PR 分析完成',
  'pr-analysis-failed': 'PR 分析失败',
  'branch-updated': '分支更新',
  'analysis-completed': '分析完成',
  'analysis-failed': '分析失败',
}
function readEventIds(): Set<string> { const raw = JSON.parse(localStorage.getItem(EVENT_READ_KEY) ?? '[]'); if (!Array.isArray(raw) || !raw.every(v => typeof v === 'string')) throw new Error('提醒已读记录不可读，原数据未修改'); return new Set(raw) }
export function eventRoute(event: ProjectEvent): Route {
  if (event.snapshotId && event.owner && event.name && event.number) return { name: 'pr-work', repositoryId: event.repositoryId, owner: event.owner, repositoryName: event.name, number: event.number, snapshotId: event.snapshotId }
  if (event.syncId) return analysisRoute(event.repositoryId, event.syncId)
  return repositoryRoute(event.repositoryId, event.number ? 'prs' : 'overview')
}
const PAGE_SIZE = 20
const READ_EVENT = 'jit:event-read'

function useEventReadState() {
  const [read, setRead] = useState<Set<string> | null>(null)
  const [readError, setReadError] = useState('')
  useEffect(() => {
    function sync() {
      try { setRead(readEventIds()); setReadError('') }
      catch (error) { setReadError(error instanceof Error ? error.message : '已读状态读取失败') }
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener(READ_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(READ_EVENT, sync)
    }
  }, [])

  function mark(ids: string[]) {
    try {
      const next = readEventIds()
      for (const id of ids) next.add(id)
      localStorage.setItem(EVENT_READ_KEY, JSON.stringify([...next]))
      window.dispatchEvent(new Event(READ_EVENT))
    } catch (error) {
      setReadError(error instanceof Error ? error.message : '已读状态未保存')
    }
  }
  return { read, readError, mark }
}

function useEventPage(offset: number) {
  const [page, setPage] = useState<EventPage | null>(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    const timer = window.setInterval(() => { if (!document.hidden) refresh() }, 60000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    projectEvents(undefined, offset, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, revision])

  return { page, loading, error, refresh: () => setRevision(value => value + 1) }
}

export function NotificationEntry({ navigate }: { navigate: (r: Route) => void }) {
  const [open, setOpen] = useState(false)
  const { read, readError, mark } = useEventReadState()
  const { page, loading, error, refresh } = useEventPage(0)
  const unread = read && !readError ? page?.events.filter(event => !read.has(event.eventId)).length ?? 0 : 0
  function go(route: Route) {
    setOpen(false)
    navigate(route)
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="relative gap-1.5 px-2" aria-label="站内提醒" aria-description={unread > 0 ? `最近提醒中 ${unread} 条未读` : undefined} type="button">
        <Bell className="size-4 text-foreground-3" aria-hidden="true"/>
        <span className="hidden lg:inline">站内提醒</span>
        {unread > 0 ? <span className="min-w-4 rounded-full bg-rose-soft px-1 text-center text-[11px] font-semibold tabular-nums text-rose-deep" title={`最近提醒中 ${unread} 条未读`}>{unread}</span> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={9} aria-label="最近提醒" className="flex max-h-(--radix-popover-content-available-height) w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
        <h2 className="text-sm font-semibold">最近提醒</h2>
        {unread > 0 ? <span className="text-xs tabular-nums text-foreground-3">{unread} 条未读</span> : null}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {readError ? <p role="alert" className="px-4 py-2 text-xs text-rose-deep">{readError}</p> : null}
        {error ? <div className="p-3"><FailureNotice error={error} onRetry={refresh}/></div> : null}
        {loading && !page ? <div className="p-3"><LoadingNotice label="正在读取提醒"/></div> : null}
        {page && !page.events.length ? <p className="px-4 py-6 text-sm text-foreground-3">暂无提醒</p> : null}
        <ul className="divide-y divide-border-soft">{page?.events.slice(0, 5).map(event => {
          const isUnread = read !== null && !readError && !read.has(event.eventId)
          return <li key={event.eventId}>
            <button type="button" onClick={() => { if (isUnread) mark([event.eventId]); go(eventRoute(event)) }}
              className="grid w-full grid-cols-[0.4rem_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
              <span className={`size-1.5 self-start rounded-full ${isUnread ? 'mt-1.5 bg-accent' : ''}`} aria-hidden="true"/>
              <span className="min-w-0">
                <span className={`block text-sm [overflow-wrap:anywhere] ${isUnread ? 'font-semibold' : 'font-medium'}`}>{isUnread ? <span className="sr-only">未读 · </span> : null}{event.title}</span>
                <time dateTime={event.createdAt} className="mt-0.5 block text-xs tabular-nums text-foreground-3">{displayTime(event.createdAt)}</time>
              </span>
              <ChevronRight size={15} className="text-foreground-3" aria-hidden="true"/>
            </button>
          </li>
        })}</ul>
      </div>
      <div className="border-t border-border-soft p-2">
        <Button variant="ghost" size="sm" asChild className="w-full justify-between text-accent">
          <a {...linkTo({ name: 'notifications' }, go)}>查看全部提醒<ArrowRight aria-hidden="true"/></a>
        </Button>
      </div>
    </PopoverContent>
  </Popover>
}

export function ProjectEvents({ navigate }: { navigate: (r: Route) => void }) {
  const [offset, setOffset] = useState(0)
  const { read, readError, mark } = useEventReadState()
  const { page, loading, error, refresh } = useEventPage(offset)
  const unread = read && !readError && page ? page.events.filter(event => !read.has(event.eventId)) : []
  return <section className="grid gap-4" aria-label="站内提醒">
    <WorkspacePageHeader title="站内提醒"
      meta={page ? `共 ${page.total} 条${!readError && read ? ` · 本页 ${unread.length} 条未读` : ''}` : undefined}
      actions={<>
        <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={refresh}><RefreshCw aria-hidden="true"/>刷新动态</Button>
        {page?.events.length ? <Button type="button" size="sm" variant="outline" disabled={loading || page.offset !== offset || !unread.length} onClick={() => mark(unread.map(event => event.eventId))}><CheckCheck aria-hidden="true"/>本页标为已读</Button> : null}
      </>}/>
    {readError ? <p role="alert" className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose-deep">{readError}</p> : null}
    {error ? <FailureNotice error={error} onRetry={refresh}/> : null}
    {loading && !page ? <LoadingNotice label="正在读取项目动态"/> : null}
    {page?.offset === offset && page.events.length ? <ul aria-busy={loading} className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card">
      {page.events.map(event => {
        const isUnread = read !== null && !readError && !read.has(event.eventId)
        return <li key={event.eventId} className={`grid min-w-0 gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 ${isUnread ? 'bg-accent-soft/25' : ''}`}>
          <div className="grid min-w-0 gap-1 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-3">
              {isUnread ? <span className="inline-flex items-center gap-1.5 font-medium text-accent"><span className="size-1.5 rounded-full bg-accent" aria-hidden="true"/>未读</span> : null}
              <span>{KIND_LABELS[event.kind] ?? event.kind}</span>
              <time dateTime={event.createdAt}>{displayTime(event.createdAt)}</time>
            </div>
            <h2 className="text-sm font-semibold text-foreground">{event.title}</h2>
            <p className="text-sm leading-body text-foreground-3">{event.message}</p>
            {event.modelId || event.snapshotId ? <p className="text-xs text-foreground-3">
              {[event.modelId && `模型 ${event.modelId}`, event.snapshotId && `固定版本 ${event.snapshotId.slice(0, 12)}`].filter(Boolean).join(' · ')}
            </p> : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {isUnread ? <Button type="button" size="sm" variant="ghost" onClick={() => mark([event.eventId])}>标为已读</Button> : null}
            <Button type="button" size="sm" variant="outline" onClick={() => { if (isUnread) mark([event.eventId]); navigate(eventRoute(event)) }}>
              {event.snapshotId || event.syncId ? '查看固定来源' : '查看项目'}<ChevronRight aria-hidden="true"/>
            </Button>
          </div>
        </li>
      })}
    </ul> : !loading && page?.offset === offset ? <EmptyState title="暂无提醒"/> : null}
    {page && (page.total > PAGE_SIZE || offset > 0) ? <nav className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-3" aria-label="动态分页">
      <span>第 {offset / PAGE_SIZE + 1} 页</span>
      <div className="flex gap-2">
        <Button disabled={loading || offset === 0} onClick={() => setOffset(value => value - PAGE_SIZE)} variant="outline" size="sm" type="button">上一页</Button>
        <Button disabled={loading || offset + PAGE_SIZE >= page.total} onClick={() => setOffset(value => value + PAGE_SIZE)} variant="outline" size="sm" type="button">下一页</Button>
      </div>
    </nav> : null}
  </section>
}
