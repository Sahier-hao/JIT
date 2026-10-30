import { useState } from 'react'
import { Button, Input, Select } from './ui/controls'
import { historicalLoader, useDataset } from './useDataset'
import { EmptyState, LoadingNotice } from './Feedback'
import { BaselineRecord } from './BaselineRecord'
import { TrendPage } from './TrendPage'
import { CommitDetail } from './CommitDetail'
import { Dialog } from './ui/dialog'
import { Risk } from './Risk'
import { applyQuery, displayTime, emptyQuery, queryCommits, readSeedQuery, type Dataset } from './domain'
import type { Route } from './navigation'

export function VerificationReport({ route, navigate }: { route: Extract<Route, { name: 'report' }>; navigate: (route: Route) => void }) {
  const { resource, retry } = useDataset(historicalLoader, 'historical')
  if (resource.state !== 'ready') return <section><header className="page-heading"><h1>验证报告</h1></header>{resource.state === 'loading' ? <LoadingNotice label="正在读取真实历史运行"/> : <EmptyState title="报告暂时不可用" description={resource.error} tone="alert"><Button onClick={retry}>重新加载</Button></EmptyState>}</section>
  const data = resource.data
  if (route.runId && route.runId !== data.runId) return <EmptyState title="该历史运行未供给" description="服务目前配置了另一运行，没有替换此地址的来源。"><Button onClick={() => navigate({ name: 'report', view: 'overview' })}>查看当前运行</Button></EmptyState>
  const go = (view: 'overview' | 'commits' | 'trends') => navigate({ name: 'report', runId: data.runId, view })
  const summary = data.summary
  return <section className="verification-report"><header className="page-heading"><div><h1>验证报告</h1><p className="page-intro">{data.project} · {data.model?.name} <span className="source-chip">公开历史数据</span></p></div></header>
    <p className="report-boundary">回顾性评价，描述当前历史运行；不代表其他仓库效果，模型分数未经概率校准。</p>
    <nav className="view-tabs" aria-label="验证报告视图"><Button variant='ghost' size='sm' aria-current={route.view === 'overview' ? 'page' : undefined} onClick={() => go('overview')}>运行概览</Button><Button variant='ghost' size='sm' aria-current={route.view === 'trends' ? 'page' : undefined} onClick={() => go('trends')}>时间趋势</Button><Button variant='ghost' size='sm' aria-current={route.view === 'commits' ? 'page' : undefined} onClick={() => go('commits')}>提交记录</Button></nav>
    {route.view === 'overview' ? <><div className="report-metrics"><div><span>测试提交</span><strong>{data.records.length.toLocaleString()}</strong></div><div><span>Average Precision</span><strong>{summary?.metrics.averagePrecision.value?.toFixed(3) ?? '未提供'}</strong></div><div><span>ROC-AUC</span><strong>{summary?.metrics.rocAuc.value?.toFixed(3) ?? '未提供'}</strong></div><div><span>Recall@20%LOC</span><strong>{summary?.metrics.recall20Loc.value?.toFixed(3) ?? '未提供'}</strong></div></div><div className="report-summary"><h2>一份可核对的模型验证</h2><p>该报告来自服务当前供给的固定运行。评价使用历史观测标签；尚未验证标签在历史当时的可获得性。完整数据版本、分区、方法、指标口径和限制可在下方核对。</p><Button onClick={() => go('commits')}>查看测试提交</Button></div><BaselineRecord data={data}/></> : route.view === 'trends' ? <TrendPage embedded expectedRunId={data.runId} navigate={search => { const url = new URL(search, window.location.href); const target = new URL(window.location.href); target.search = url.search; window.history.replaceState({}, '', target); go('commits') }}/> : <HistoricalCommits key={`${data.runId}:${window.location.search}`} data={data}/>}
  </section>
}
function HistoricalCommits({ data }: { data: Dataset }) {
  const [seed] = useState(() => readSeedQuery(window.location.search))
  const [query, setQuery] = useState({ draft: seed.query, applied: seed.query, error: '' })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const records = queryCommits(data.records, query.applied)
  const visible = records.slice(page*25, (page+1)*25)
  const update = (patch: Partial<typeof emptyQuery>) => { setPage(0); setQuery(previous => { const draft = { ...previous.draft, ...patch }; const result = applyQuery(previous.applied, draft); return { draft, applied: result.query, error: result.error } }) }
  return <><div className="review-toolbar" aria-label="历史提交筛选"><Input aria-label="提交标识搜索" placeholder="搜索提交标识" value={query.draft.search} onChange={event => update({ search: event.target.value })}/><Input aria-label="起始日期" placeholder="YYYY-MM-DD" value={query.draft.start} onChange={event => update({ start: event.target.value })}/><Input aria-label="结束日期" placeholder="YYYY-MM-DD" value={query.draft.end} onChange={event => update({ end: event.target.value })}/><Select aria-label="排序" size="sm" value={query.draft.sort} onChange={sort => update({ sort })} options={[{ value: 'risk', label: '模型分数' }, { value: 'time', label: '提交时间' }]} style={{ width: 132 }} /><Button variant="link" size="sm" onClick={() => { setPage(0); setQuery({ draft: emptyQuery, applied: emptyQuery, error: '' }) }}>清除筛选</Button></div>{query.error ? <p role="alert">{query.error}</p> : null}{seed.ignored ? <p role="status">地址中的日期范围无效，已忽略。</p> : null}<div className="report-commits"><section className="review-table-wrap"><table><thead><tr><th>提交标识</th><th>模型分数</th><th>提交时间</th><th className="numeric">变更行</th></tr></thead><tbody>{visible.map(record => <tr key={record.id}><td><button className="commit-link" title={record.id} aria-label={`查看 ${record.id}`} onClick={() => setSelected(record.id)}>{record.id.slice(0, 12)}</button></td><td><Risk risk={record.risk}/></td><td>{displayTime(record.time)}</td><td className="numeric">{record.lines ?? '未提供'}</td></tr>)}</tbody></table>{records.length === 0 ? <p className="quiet-empty">没有符合条件的提交</p> : null}<nav className="pager" aria-label="历史提交分页"><span>{records.length} 条提交 · 第 {page+1} 页</span><Button size="sm" disabled={!page} onClick={() => setPage(page-1)}>上一页</Button><Button size="sm" disabled={(page+1)*25 >= records.length} onClick={() => setPage(page+1)}>下一页</Button></nav></section></div><Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null) }} title="提交详情" width={720}>{selected ? <CommitDetail data={data} id={selected} onClose={() => setSelected(null)}/> : null}</Dialog></>
}
