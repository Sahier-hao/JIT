import { useEffect, useState } from 'react'
import { Button } from '../ui/controls'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { projectEvents, type EventPage, type ProjectEvent } from '../projectActivityClient'
import { analysisRoute, type Route } from '../navigation'

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
  return { name: 'repository', repositoryId: event.repositoryId, tab: event.number ? 'prs' : 'overview' }
}
export function NotificationEntry({ navigate }: { navigate: (r: Route) => void }) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const check = () => projectEvents(undefined, 0, controller.signal).then(page => { if (!controller.signal.aborted) { const ids = readEventIds(); setUnread(page.events.filter(e => !ids.has(e.eventId)).length) } }).catch(() => undefined)
    void check(); const timer = setInterval(check, 60000)
    window.addEventListener('jit:event-read', check); window.addEventListener('storage', check)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('jit:event-read', check); window.removeEventListener('storage', check) }
  }, [])
  return <Button variant="link" className="notification-entry" onClick={() => navigate({ name: 'notifications' })}>站内提醒{unread ? <span aria-label={`最近提醒中 ${unread} 条未读`}>{unread}</span> : null}</Button>
}
export function ProjectEvents({ navigate }: { navigate: (r: Route) => void }) {
  const [page, setPage] = useState<EventPage | null>(null), [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [read, setRead] = useState<Set<string>>(new Set()), [readError, setReadError] = useState('')
  useEffect(() => { const load = () => { try { setRead(readEventIds()); setReadError('') } catch (e) { setReadError(e instanceof Error ? e.message : '已读状态读取失败') } }; load(); window.addEventListener('storage', load); return () => window.removeEventListener('storage', load) }, [])
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setAttempt(v => v + 1) }, 60000); return () => clearInterval(timer) }, [])
  useEffect(() => { const onFocus = () => setAttempt(v => v + 1); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus) }, [])
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null)
    projectEvents(undefined, offset, controller.signal).then(value => { if (!controller.signal.aborted) setPage(value) }).catch(e => { if (!controller.signal.aborted) setError(e) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, attempt])
  function mark(ids: string[]) { try { const next = readEventIds(); ids.forEach(id => next.add(id)); localStorage.setItem(EVENT_READ_KEY, JSON.stringify([...next])); setRead(next); setReadError(''); window.dispatchEvent(new Event('jit:event-read')) } catch (e) { setReadError(e instanceof Error ? e.message : '已读状态未保存') } }
  const unreadCount = page ? page.events.filter(event => !read.has(event.eventId)).length : 0
  return <section className="project-events" aria-label="站内提醒"><div className="section-label"><h2>站内提醒</h2><span className="event-count">{page ? `本页 ${unreadCount} 条未读 · 共 ${page.total} 条` : ''}</span><div className="panel-actions"><Button type="button" disabled={loading} onClick={() => setAttempt(v => v + 1)}>刷新动态</Button>{page?.events.length ? <Button type="button" disabled={Boolean(readError)} onClick={() => mark(page.events.map(e => e.eventId))}>本页标为已读</Button> : null}</div></div>
    {readError ? <p role="alert" className="field-error">{readError}</p> : null}{error ? <FailureNotice error={error} onRetry={() => setAttempt(v => v + 1)}/> : null}
    {loading && !page ? <LoadingNotice label="正在读取项目动态"/> : null}
    <div aria-busy={loading}>{page?.events.map(event => <article key={event.eventId} className={`project-event ${read.has(event.eventId) ? 'is-read' : ''}`}><div><h3>{!read.has(event.eventId) ? <span className="unread-label">未读</span> : null}<span className="event-kind">{KIND_LABELS[event.kind] ?? event.kind}</span>{event.title}</h3><p>{event.message}</p><small>{displayTime(event.createdAt)}{event.modelId ? ` · 模型 ${event.modelId}` : ''}{event.snapshotId ? ` · 固定版本 ${event.snapshotId.slice(0, 12)}` : ''}</small></div><div className="panel-actions"><Button type="button" onClick={() => { mark([event.eventId]); navigate(eventRoute(event)) }}>{event.snapshotId || event.syncId ? '查看固定来源' : '查看项目'}</Button>{!read.has(event.eventId) ? <Button type="button" onClick={() => mark([event.eventId])}>标为已读</Button> : null}</div></article>)}</div>
    {!loading && page && !page.events.length ? <p className="quiet-empty">暂无提醒。</p> : null}
    {page && (page.total > 20 || offset > 0) ? <nav className="pager" aria-label="动态分页"><span>共 {page.total} 条 · 第 {offset / 20 + 1} 页</span><Button disabled={loading || offset === 0} onClick={() => setOffset(v => v - 20)}>上一页</Button><Button disabled={loading || offset + 20 >= page.total} onClick={() => setOffset(v => v + 20)}>下一页</Button></nav> : null}
  </section>
}
