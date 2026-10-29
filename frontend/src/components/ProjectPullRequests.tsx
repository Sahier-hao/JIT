import { useEffect, useRef, useState } from 'react'
import { Empty } from '../ui/feedback'
import { Segmented } from '../ui/segmented'
import { Button } from '../ui/controls'
import { Dialog } from '../ui/dialog'
import { EmptyState, FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { getTracking, projectPRs, type PRState, type PRTracking, type ProjectPRPage } from '../projectActivityClient'
import { readWorks, workKey } from '../prReview'
import type { Route } from '../navigation'
import { PRTrackingPanel } from './PRTrackingPanel'

const remoteLabel = { open: '开放中', closed: '已关闭', merged: '已合并' }
const analysisLabel: Record<string, string> = { checking: '检查中', unchanged: '版本未变', 'snapshot-ready': '快照就绪', queued: '排队中', running: '分析中', completed: '分析完成', failed: '分析失败', cancelled: '已取消', interrupted: '已中断', collecting: '采集中', scoring: '评分中' }

/** 项目 PR 审查：只负责发现、筛选与打开 PR；后台自动分析在工具栏的「自动分析」里配置。 */
export function ProjectPullRequests({ repositoryId, navigate }: { repositoryId: string; navigate: (r: Route) => void }) {
  const [state, setState] = useState<PRState>('open')
  const [sortBy, setSortBy] = useState<'updated' | 'risk'>('updated')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<ProjectPRPage | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [tracking, setTracking] = useState<PRTracking | null>(null)
  const [trackingOpen, setTrackingOpen] = useState(false)
  const automatic = useRef(new Set<string>()), refreshRequested = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null); setResult(null)
    const refresh = refreshRequested.current; refreshRequested.current = false
    async function load() {
      let value = await projectPRs(repositoryId, state, page, refresh, controller.signal)
      const key = `${repositoryId}:${state}:${page}`
      if (!refresh && value.supported && !value.checkedAt && !value.errorCode && !automatic.current.has(key)) { automatic.current.add(key); value = await projectPRs(repositoryId, state, page, true, controller.signal) }
      if (!controller.signal.aborted) setResult(value)
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(e) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [repositoryId, state, page, attempt])
  useEffect(() => {
    const controller = new AbortController()
    getTracking(repositoryId, controller.signal).then(value => { if (!controller.signal.aborted) setTracking(value) }).catch(() => { if (!controller.signal.aborted) setTracking(null) })
    return () => controller.abort()
  }, [repositoryId, trackingOpen])
  let localWorks: Set<string> = new Set()
  try { localWorks = new Set(readWorks().map(work => work.key)) } catch { /* 本地存储损坏时仍允许查看远端 PR */ }
  const refresh = () => { refreshRequested.current = true; setAttempt(v => v + 1) }
  const rows = result ? (sortBy === 'risk' ? [...result.pullRequests].sort((a, b) => (b.maxRisk ?? -1) - (a.maxRisk ?? -1) || b.updatedAt.localeCompare(a.updatedAt)) : result.pullRequests) : []
  return <section className="pr-hub" aria-label="项目 PR 审查">
    <h2 className="sr-only">PR 审查</h2>
    {result?.supported === false ? null : <>
      <div className="pr-hub-toolbar">
        <div className="pr-hub-filters">
          <Segmented aria-label="PR 范围" value={state} onChange={value => { setState(value as PRState); setPage(1) }} options={[{ label: '开放', value: 'open' }, { label: '已关闭 / 合并', value: 'closed' }, { label: '全部', value: 'all' }]}/>
          <Segmented aria-label="PR 排序" value={sortBy} onChange={value => setSortBy(value as 'updated' | 'risk')} options={[{ label: '按更新', value: 'updated' }, { label: '按风险', value: 'risk' }]}/>
        </div>
        <div className="pr-hub-actions">
          {tracking?.supported === false ? null : <Button icon={<span className="pr-auto-dot" data-on={tracking?.enabled ? 'true' : undefined} aria-hidden="true"/>} onClick={() => setTrackingOpen(true)}>{tracking?.enabled ? '自动分析已开启' : '自动分析'}</Button>}
          <Button variant="primary" disabled={busy} onClick={refresh}>{busy ? '正在检查…' : '检查远端 PR'}</Button>
        </div>
      </div>
      <p className="pr-hub-note">读取公开 GitHub PR。打开是只读详情，只有点「开始审查」才会创建个人工作单。{sortBy === 'risk' ? '按风险只排序当前页；未分析的 PR 排在最后，不能当作低风险。' : ''}</p>
    </>}
    {error ? <FailureNotice error={error} onRetry={refresh}/> : null}
    {busy && !result ? <LoadingNotice label="正在读取项目 PR 清单"/> : null}
    {result && !result.supported ? <EmptyState title="此项目不是公开 GitHub 来源" description="PR 发现和自动分析只读取公开 GitHub；分支分析和风险趋势仍可使用。"/> : null}
    {result?.supported ? <div className="pr-hub-panel">
      {result.errorCode ? <div className="pr-hub-alert" role="alert"><span>远端检查未完成（{result.errorCode}）；以下是上次缓存，缺失条目不能认定为已关闭。</span><Button size="sm" disabled={busy} onClick={refresh}>重试检查</Button></div> : null}
      {rows.length ? <div className="pr-hub-list">{rows.map(pr => {
        const hasWork = Boolean(result.owner && result.name && localWorks.has(workKey(result.owner, result.name, pr.number)))
        return <article className="pr-row" key={pr.number}>
          <div className="pr-row-main">
            <div className="pr-row-title"><h3><span className="pr-row-number">#{pr.number}</span> {pr.title}</h3><span className="pr-row-state" data-state={pr.remoteState}>{remoteLabel[pr.remoteState]}</span>{pr.draft ? <span className="pr-row-draft">草稿</span> : null}</div>
            <p className="pr-row-meta"><span>{pr.author}</span><span>更新于 {displayTime(pr.updatedAt)}</span><span>{pr.analysisStatus ? analysisLabel[pr.analysisStatus] ?? pr.analysisStatus : '尚无分析'}</span>{pr.maxRisk != null ? <span className="pr-row-risk" title="该 PR 已分析提交中的最高分数；排序参考，不是 PR 整体缺陷概率">{`最高风险 ${pr.maxRisk.toFixed(3)}${pr.scoredCommits != null ? ` · ${pr.scoredCommits} 条有分数` : ''}`}</span> : null}</p>
          </div>
          {result.owner && result.name ? <Button variant={hasWork ? 'primary' : 'secondary'} onClick={() => navigate({ name: 'pr-work', repositoryId, owner: result.owner!, repositoryName: result.name!, number: pr.number })}>{hasWork ? '继续审查' : '查看 PR'}</Button> : <a href={pr.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>}
        </article>
      })}</div> : <div className="pr-hub-empty"><Empty description="当前范围没有 PR"/></div>}
      <div className="pr-hub-foot">
        <span>{result.checkedAt ? `检查于 ${displayTime(result.checkedAt)}` : '尚未检查远端'}{rows.length ? ` · 本页 ${rows.length} 个` : ''}{result.hasMore ? ' · 还有更多页' : ''}</span>
        {page > 1 || result.hasMore ? <nav className="pr-hub-pager" aria-label="PR 分页"><Button size="sm" disabled={busy || page <= 1} onClick={() => setPage(v => v - 1)}>上一页</Button><span>第 {page} 页</span><Button size="sm" disabled={busy || !result.hasMore} onClick={() => setPage(v => v + 1)}>下一页</Button></nav> : null}
      </div>
    </div> : null}
    <Dialog open={trackingOpen} onOpenChange={setTrackingOpen} title="PR 自动分析" width={620}>
      <PRTrackingPanel repositoryId={repositoryId} onTracking={setTracking}/>
    </Dialog>
  </section>
}
