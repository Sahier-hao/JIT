import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../ui/controls'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { ApiError } from '../apiContract'
import { createTrendView, getTrendView, trendCommits, trendGroups, type TrendBucket, type TrendCommit, type TrendGroup, type TrendView } from '../projectActivityClient'
import type { Route } from '../navigation'
import { displayTime } from '../domain'

const number = (v: number | null) => v == null ? '未知' : v.toLocaleString()
const percent = (v: number | null) => v == null ? '不展示' : `${(v * 100).toFixed(1)}%`
const score = (v: number | null) => v == null ? '—' : v.toFixed(2)
const GRAIN_LABELS: Record<TrendView['grain'], string> = { day: '按日', week: '按周', month: '按月' }
export function rateReason(reason: string | null): string { return reason ? ({ insufficient_sample: '已评分样本不足 20', small_sample: '已评分样本不足 20', no_scored_commits: '无已评分提交', uncovered: '未覆盖', no_commits: '无提交', insufficientSample: '已评分样本不足 20', noScoredCommits: '无已评分提交' }[reason] ?? reason) : '比例不可用' }
export function coverageLabel(value: unknown): string { if (value == null) return '未知覆盖'; if (typeof value === 'string') return ({ complete: '完整覆盖', partial: '部分覆盖', unknown: '未知覆盖', uncovered: '未覆盖', observed: '仅已保存观测' }[value] ?? value); return JSON.stringify(value) }
export function ProjectTrends({ repositoryId, viewId, currentSyncId, navigate }: { repositoryId: string; viewId?: string; currentSyncId?: string; navigate: (r: Route, replace?: boolean) => void }) {
  const [groups, setGroups] = useState<TrendGroup[]>([]), [limitations, setLimitations] = useState<string[]>([]), [groupId, setGroupId] = useState(''), [sourceId, setSourceId] = useState('')
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [grain, setGrain] = useState<TrendView['grain']>('week')
  const [view, setView] = useState<TrendView | null>(null), [error, setError] = useState<unknown>(null), [groupsError, setGroupsError] = useState<unknown>(null), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0)
  const [bucket, setBucket] = useState<TrendBucket | null>(null), lock = useRef(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [groupsReady, setGroupsReady] = useState(false), [preparing, setPreparing] = useState(false)
  const auto = useRef(''), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { const controller = new AbortController(); setGroupsReady(false); trendGroups(repositoryId, controller.signal).then(v => { if (!controller.signal.aborted) { setGroups(v.groups); setLimitations(v.limitations); setGroupsError(null); setGroupsReady(true) } }).catch(e => { if (!controller.signal.aborted) { setGroupsError(e); setGroupsReady(true) } }); return () => controller.abort() }, [repositoryId, attempt])
  useEffect(() => {
    // 进入趋势视图且地址没有 viewId 时，按当前口径自动准备默认固定视图；相同来源与查询由服务端复用同一视图。
    if (viewId || !groupsReady || groupsError || !groups.length || auto.current === repositoryId) return
    auto.current = repositoryId
    const preferred = groups.find(group => group.sourceSyncIds.includes(currentSyncId ?? '')) ?? groups[0]
    setGroupId(preferred.groupId ?? ''); setSourceId('')
    setPreparing(true); setError(null)
    createTrendView(repositoryId, { ...(preferred.groupId ? { groupId: preferred.groupId } : {}), grain: 'week' })
      .then(next => { if (alive.current) { setView(next); navigate({ name: 'repository', repositoryId, tab: 'trends', viewId: next.viewId }, true) } })
      .catch(e => { if (alive.current) setError(e) })
      .finally(() => { if (alive.current) setPreparing(false) })
  }, [viewId, groupsReady, groupsError, groups, currentSyncId, repositoryId, navigate])
  useEffect(() => {
    if (!viewId) { setView(null); return }
    const controller = new AbortController(); setBusy(true); setError(null); setBucket(null); setView(null)
    getTrendView(repositoryId, viewId, controller.signal).then(v => { if (controller.signal.aborted) return; setView(v); setGroupId(v.group.groupId ?? ''); setStart(v.start.slice(0, 10)); setEnd(v.end.slice(0, 10)); setGrain(v.grain); setSourceId(v.mode === 'single' ? v.sourceSyncIds[0] ?? '' : '') }).catch(e => { if (!controller.signal.aborted) setError(e) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [repositoryId, viewId, attempt])
  async function generate() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const next = await createTrendView(repositoryId, { ...(sourceId ? { sourceSyncId: sourceId } : { groupId }), ...(start ? { start } : {}), ...(end ? { end } : {}), grain })
      setView(next); setBucket(null); setFiltersOpen(false); navigate({ name: 'repository', repositoryId, tab: 'trends', viewId: next.viewId })
    } catch (e) { setError(e) } finally { lock.current = false; setBusy(false) }
  }
  const selected = groups.find(g => g.groupId === groupId) ?? (view?.group.groupId === groupId ? view.group : null)
  const conflict = error instanceof ApiError && error.code === 'TREND_SOURCE_CONFLICT'
  const pendingFilters = view && (start !== view.start.slice(0, 10) || end !== view.end.slice(0, 10) || grain !== view.grain || groupId !== (view.group.groupId ?? '') || sourceId !== (view.mode === 'single' ? view.sourceSyncIds[0] ?? '' : ''))
  return <section className="project-trends"><div className="section-label"><h2>项目风险趋势</h2>{view ? <span>固定视图 {view.viewId.slice(0, 12)}</span> : null}</div>
    {view ? <div className="trend-view-bar">
      <p className="trend-view-line"><b>{view.group.branch ?? '未登记分支'} · 模型 {view.group.modelId?.slice(0, 8) ?? '未登记'}</b><span> · {view.start.slice(0, 10)} 至 {view.end.slice(0, 10)}（不含） · {GRAIN_LABELS[view.grain]}</span></p>
      <div className="trend-view-actions">
        {view.hasNewSources && !filtersOpen && !pendingFilters ? <Button size="sm" variant="primary" onClick={() => void generate()}>生成新的固定视图</Button> : null}
        <Button size="sm" variant="ghost" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{filtersOpen ? '收起筛选' : '调整口径'}</Button>
      </div>
    </div> : null}
    {!view || filtersOpen ? <><form className="project-filter-row trend-filters" onSubmit={e => { e.preventDefault(); void generate() }}><label>开始日期<input type="date" aria-label="趋势开始日期" value={start} onChange={e => setStart(e.target.value)}/></label><label>结束日期（不含）<input type="date" aria-label="趋势结束日期（不含）" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)}/></label><label>聚合<select aria-label="趋势聚合粒度" value={grain} onChange={e => setGrain(e.target.value as TrendView['grain'])}><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select></label><label>可比分析口径<select aria-label="趋势分析口径" value={groupId} onChange={e => { setGroupId(e.target.value); setSourceId('') }}><option value="">请选择分支与模型口径</option>{view && view.group.groupId && !groups.some(g => g.groupId === view.group.groupId) ? <option value={view.group.groupId}>原视图：{view.group.branch} / {view.group.modelId}</option> : null}{groups.map(g => <option key={g.groupId ?? g.sourceSyncIds.join(',')} value={g.groupId ?? ''}>{g.branch} / {g.modelId} / 运行 {g.runId?.slice(0, 8) ?? '未登记'} / {g.featureSchemaVersion} / {g.distributionRule}</option>)}</select></label><label>来源范围<select aria-label="趋势来源范围" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">合并同口径分析（按 SHA 去重）</option>{selected?.sourceSyncIds.map(id => <option key={id} value={id}>仅单次分析 {id}</option>)}</select></label><label>单次固定分析（可选）<input aria-label="单次固定分析标识" value={sourceId} onChange={e => setSourceId(e.target.value.trim())} placeholder="粘贴原 syncId，单独查看旧来源"/></label><Button variant="primary" disabled={busy || preparing || (!groupId && !sourceId) || Boolean(start && end && start >= end)}>{busy ? '正在读取…' : preparing ? '正在准备…' : view ? '生成新的固定视图' : '生成固定趋势'}</Button></form>
    {pendingFilters ? <p className="status-note" role="status">筛选尚未应用。图表和数据表仍属于原固定视图；生成新的固定视图后才采用这些条件。</p> : null}
    </> : null}
    {groupsError ? <FailureNotice error={groupsError} onRetry={() => setAttempt(v => v + 1)}/> : null}
    {error ? <FailureNotice error={error} onRetry={() => viewId ? setAttempt(v => v + 1) : void generate()}/> : null}
    {conflict ? <div role="alert" className="field-error"><p>同 SHA 的保存观测存在冲突，未自动选另一组或丢弃样本。请在“来源范围”明确选择一次分析后重新生成。</p>{error.details.some(detail => detail.commitId) ? <ul>{error.details.filter(detail => detail.commitId).map(detail => <li key={`${detail.commitId}:${detail.sourceSyncIds?.join(',')}`}><code>{detail.commitId}</code> · 冲突来源 {detail.sourceSyncIds?.join('、')} · 字段 {detail.conflictingFields?.join('、')}</li>)}</ul> : null}</div> : null}
    {busy && !view ? <LoadingNotice label="正在准备固定趋势来源"/> : null}
    {preparing && !view ? <LoadingNotice label="正在按当前口径准备默认固定视图"/> : null}
    {!view && !busy && !preparing && !error && groupsReady && !groupsError ? <p className="quiet-empty">{groups.length ? '暂未生成趋势视图。核对口径后可手动生成，地址可用于返回同一份来源。' : '尚无可比较的成功分支分析。请到分析记录发起分支分析；PR 与旧来源不自动拼入主线。'}</p> : null}
    {view ? <div className="trend-content" aria-busy={busy}>
      {view.hasNewSources ? <p className="pr-update-note" role="status"><strong>有新的分支分析来源，当前视图保持不变。</strong></p> : null}
      <dl className="trend-summary"><div><dt>去重已分析提交</dt><dd>{number(view.summary.commitCount)}</dd></div><div><dt>平均模型风险分</dt><dd>{score(view.summary.riskMean)}</dd></div><div><dt>已评分 / 未知分数</dt><dd>{number(view.summary.scoredCount)} / {number(view.summary.unknownCount)}</dd></div><div><dt>高分提交</dt><dd>{number(view.summary.highCount)}</dd></div><div><dt>高分占已评分</dt><dd>{percent(view.summary.highRate)}</dd>{view.summary.highRate == null ? <small>{rateReason(view.summary.rateReason)}</small> : null}</div></dl>
      {view.buckets.length ? <><TrendPlot key={`risk:${view.viewId}`} buckets={view.buckets} kind="risk" onBucket={setBucket}/><TrendPlot key={`rate:${view.viewId}`} buckets={view.buckets} kind="rate" onBucket={setBucket}/></> : <p className="quiet-empty">此固定范围没有可展示的时间桶；未推断为零。</p>}
      <div className="trend-table-wrap"><table className="trend-data-table"><caption>趋势等价数据表：风险分为模型估计，高分占比不是缺陷率</caption><thead><tr><th scope="col">时间段（结束不含）</th><th scope="col">已分析</th><th scope="col">已评分</th><th scope="col">未知分数</th><th scope="col">高分</th><th scope="col">高分占比</th><th scope="col">平均风险分</th><th scope="col">覆盖 / 比例说明</th><th scope="col">固定来源下钻</th></tr></thead><tbody>{view.buckets.map(b => <tr key={b.start}><th scope="row">{b.start.slice(0, 10)} 至 {b.end.slice(0, 10)}</th><td>{number(b.commitCount)}</td><td>{number(b.scoredCount)}</td><td>{number(b.unknownCount)}</td><td>{number(b.highCount)}</td><td>{percent(b.highRate)}</td><td>{score(b.riskMean)}</td><td>{coverageLabel(b.coverage)}{b.highRate == null ? `；${rateReason(b.rateReason)}` : ''}</td><td><Button type="button" onClick={() => setBucket(b)}>查看提交</Button></td></tr>)}</tbody></table></div>
      {bucket ? <TrendDrilldown key={`${view.viewId}:${bucket.start}`} repositoryId={repositoryId} view={view} bucket={bucket} navigate={navigate} onClose={() => setBucket(null)}/> : null}
      <details className="trend-sources"><summary>固定口径与来源（{view.sourceSyncIds.length} 次分析）</summary><dl><div><dt>分支 / 固定模型</dt><dd>{view.group.branch} / {view.group.modelId}</dd></div><div><dt>训练运行</dt><dd>{view.group.runId ?? '未登记'}</dd></div><div><dt>特征 schema / 分档</dt><dd>{view.group.featureSchemaVersion} / {view.group.distributionRule}</dd></div><div><dt>视图建立</dt><dd>{displayTime(view.createdAt)}</dd></div></dl><ul>{view.sourceSyncIds.map(id => <li key={id}><Button type="button" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: id, view: 'commits' })}>打开原分析 {id}</Button></li>)}</ul>{view.sources.map((source, i) => <pre key={i}>{JSON.stringify(source, null, 2)}</pre>)}</details>
    </div> : null}
    <details className="trend-notes">
      <summary>口径与数据说明</summary>
      <p>仅使用本项目已保存的分支分析。体量与高分提交占比分开呈现，不是实际缺陷率，也不代表完整仓库历史。</p>
      <p>日期留空默认为最近 90 天、按周。统一 UTC+08:00，按提交作者时间分桶，区间左闭右开。不同模型、训练运行、schema 或分档规则不混合。</p>
      {view ? <p>原视图范围 {view.start} 至 {view.end}（不含），时区 {view.timezone}；最小已评分样本 {view.minSample}。采集上限或缺口不能按 0 处理；变基 / 强推后仍仅代表保存观测。</p> : null}
      {limitations.map((v, i) => <p key={i}>{v}</p>)}
      {view?.limitations.map((v, i) => <p key={i}>{v}</p>)}
    </details>
  </section>
}
function TrendPlot({ buckets, kind, onBucket }: { buckets: TrendBucket[]; kind: 'risk' | 'rate'; onBucket: (b: TrendBucket) => void }) {
  const [active, setActive] = useState<number | null>(null), refs = useRef<(SVGGElement | null)[]>([])
  const width = Math.max(720, buckets.length * 32 + 100), height = 248, left = 54, right = width - 50, top = 20, bottom = 195, slot = (right - left) / buckets.length
  const values = buckets.map(b => kind === 'risk' ? b.riskMean : b.highRate), axisMax = 1
  const x = (i: number) => left + slot * (i + 0.5), y = (v: number) => bottom - v / axisMax * (bottom - top)
  const title = kind === 'risk' ? '平均模型风险分' : '高分提交占已评分提交比例'
  let path = '', joined = false
  values.forEach((v, i) => { if (v == null) { joined = false; return } path += `${joined ? 'L' : 'M'}${x(i)},${y(v)} `; joined = true })
  function keys(e: KeyboardEvent<SVGGElement>, i: number) { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const target = e.key === 'Home' ? 0 : e.key === 'End' ? buckets.length - 1 : Math.max(0, Math.min(buckets.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1))); setActive(target); refs.current[target]?.focus() } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBucket(buckets[i]) } else if (e.key === 'Escape') setActive(null) }
  const current = active == null ? null : buckets[active], currentValue = active == null ? null : values[active]
  return <figure className="project-trend-figure"><figcaption><h3>{title}</h3><p>{kind === 'risk' ? '单轴折线图；按已评分提交取平均，空白表示该时间段没有已评分提交' : '单轴折线图；样本不足或无评分时断开，不画成 0'}</p></figcaption><div className="trend-plot-scroll"><svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="group" aria-label={`${title}，左右方向键选择时间段，回车查看提交`} onPointerLeave={() => setActive(null)}>
    {[0, 1, 2, 3, 4].map(t => { const v = axisMax * t / 4; return <g key={t}><line className="trend-grid" x1={left} x2={right} y1={y(v)} y2={y(v)}/><text className="trend-axis-label" x={left - 10} y={y(v) + 4} textAnchor="end">{kind === 'risk' ? v.toFixed(2) : `${v * 100}%`}</text></g> })}
    <path className="trend-line" d={path}/>
    {active != null ? <line className="trend-crosshair" x1={x(active)} x2={x(active)} y1={top} y2={bottom}/> : null}
    {buckets.map((b, i) => { const v = values[i], step = Math.max(1, Math.ceil(buckets.length / 8)), label = kind === 'risk' ? `${b.start.slice(0, 10)}，${number(b.commitCount)} 个已分析提交，平均风险 ${score(v)}，已评分 ${number(b.scoredCount)}` : `${b.start.slice(0, 10)}，${percent(v)}，${coverageLabel(b.coverage)}${v == null ? '，' + rateReason(b.rateReason) : ''}`; return <g key={b.start} ref={node => { refs.current[i] = node }} role="button" tabIndex={0} aria-label={label} onFocus={() => setActive(i)} onKeyDown={e => keys(e, i)} onPointerMove={() => setActive(i)} onClick={() => { setActive(i); onBucket(b) }} className={`trend-mark-target${active === i ? ' is-active' : ''}`}>
      {v != null ? <circle className="trend-dot" cx={x(i)} cy={y(v)} r="4"/> : null}
      {v == null ? <text className="trend-axis-label" x={x(i)} y={bottom - 8} textAnchor="middle">—</text> : null}
      <rect className="trend-hit" x={x(i) - slot / 2} y={top} width={slot} height={bottom - top}/>
      {i % step === 0 || i === buckets.length - 1 ? <text className="trend-axis-label" x={x(i)} y={bottom + 23} textAnchor="middle">{b.start.slice(5, 10)}</text> : null}
    </g> })}
  </svg></div><div className="trend-tooltip" role="status" aria-live="polite">{current ? <><strong>{current.start.slice(0, 10)} 至 {current.end.slice(0, 10)}（不含）</strong><span>{kind === 'risk' ? `平均风险 ${score(currentValue)}；${number(current.commitCount)} 个已分析提交；已评分 ${number(current.scoredCount)} / 未知 ${number(current.unknownCount)}；${coverageLabel(current.coverage)}` : `${percent(current.highRate)} 高分占比${current.highRate == null ? '：' + rateReason(current.rateReason) : ''}；已评分 ${number(current.scoredCount)} / 未知 ${number(current.unknownCount)}；${coverageLabel(current.coverage)}`}</span></> : <span>悬停、聚焦或触碰时间段查看详情；等价数据表提供所有数值和提交入口。</span>}</div></figure>
}
function TrendDrilldown({ repositoryId, view, bucket, navigate, onClose }: { repositoryId: string; view: TrendView; bucket: TrendBucket; navigate: (r: Route) => void; onClose: () => void }) {
  const [items, setItems] = useState<TrendCommit[]>([]), [offset, setOffset] = useState(0), [total, setTotal] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0)
  useEffect(() => { const controller = new AbortController(); setBusy(true); setError(null); trendCommits(repositoryId, view, bucket, offset, controller.signal).then(p => { if (!controller.signal.aborted) { setItems(p.commits); setTotal(p.total) } }).catch(e => { if (!controller.signal.aborted) setError(e) }).finally(() => { if (!controller.signal.aborted) setBusy(false) }); return () => controller.abort() }, [repositoryId, view, bucket, offset, attempt])
  return <section className="trend-drilldown" aria-label="趋势固定来源提交"><div className="section-label"><h3>{bucket.start.slice(0, 10)} 至 {bucket.end.slice(0, 10)} 的提交</h3><Button type="button" onClick={onClose}>关闭提交下钻</Button></div>{error ? <FailureNotice error={error} onRetry={() => setAttempt(v => v + 1)}/> : busy ? <LoadingNotice label="读取固定视图提交"/> : <><p>共 {total} 条；打开结果保持每条提交的原 sourceSyncId。</p><ul>{items.map(c => <li key={c.commitId}><Button type="button" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: c.sourceSyncId, commitId: c.commitId, view: 'commits' })}><code>{c.commitId.slice(0, 12)}</code> {c.subject ?? '无标题'} · {c.risk == null ? '分数未知' : c.risk.toFixed(4)}</Button></li>)}</ul></>}<nav className="pager" aria-label="趋势提交分页"><Button disabled={busy || !offset} onClick={() => setOffset(v => v - 50)}>上一页</Button><span>第 {offset / 50 + 1} 页</span><Button disabled={busy || offset + 50 >= total} onClick={() => setOffset(v => v + 50)}>下一页</Button></nav></section>
}
