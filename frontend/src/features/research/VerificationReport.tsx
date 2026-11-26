import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { linkTo } from '@/app/navigation'

import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

import { useState } from 'react'

import { historicalLoader, useDataset } from '@/features/research/useDataset'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'

import { BaselineRecord } from '@/components/shared/BaselineRecord'
import { TrendPage } from '@/features/research/TrendPage'
import { CommitDetail } from '@/features/projects/components/CommitDetail'

import { Risk } from '@/components/shared/Risk'
import { applyQuery, displayTime, emptyQuery, queryCommits, readSeedQuery, type Dataset } from '@/lib/domain'
import type { Route } from '@/app/navigation'

export function VerificationReport({ route, navigate }: { route: Extract<Route, { name: 'report' }>; navigate: (route: Route) => void }) {
  const { resource, retry } = useDataset(historicalLoader, 'historical')
  if (resource.state !== 'ready') return <section className="grid gap-4"><WorkspacePageHeader title="验证报告"/>{resource.state === 'loading' ? <LoadingNotice label="正在读取真实历史运行"/> : <EmptyState title="报告暂时不可用" description={resource.error} tone="alert"><Button onClick={retry} variant="outline" type="button">重新加载</Button></EmptyState>}</section>
  const data = resource.data
  if (route.runId && route.runId !== data.runId) return <EmptyState title="该历史运行未供给" description="服务目前配置了另一运行，没有替换此地址的来源。"><Button onClick={() => navigate({ name: 'report', view: 'overview' })} variant="outline" type="button">查看当前运行</Button></EmptyState>
  const go = (view: 'overview' | 'commits' | 'trends') => navigate({ name: 'report', runId: data.runId, view })
  const summary = data.summary
  return <section className="grid gap-4">
    <WorkspacePageHeader title="验证报告" meta={[data.project, data.model?.name, '公开历史数据'].filter(Boolean).join(' · ')}
      actions={route.view === 'overview' ? <Button onClick={() => go('commits')} variant="outline" type="button">查看测试提交</Button> : null}/>
    <p className="text-xs leading-body text-foreground-3">模型分数未经概率校准，不代表已确认缺陷。</p>
    <nav aria-label="验证报告视图" className="flex flex-wrap gap-1 border-b border-border-soft">{([{ value: 'overview', label: '运行概览' }, { value: 'trends', label: '时间趋势' }, { value: 'commits', label: '提交记录' }]).map(option => <Button key={option.value} asChild variant="ghost" className={`rounded-none border-b-2 ${String(route.view ?? 'overview') === String(option.value) ? 'border-primary' : 'border-transparent'}`}><a {...linkTo({ name: 'report', runId: data.runId, view: option.value as 'overview' | 'commits' | 'trends' }, navigate)} aria-current={String(route.view ?? 'overview') === String(option.value) ? 'page' : undefined}>{option.label}</a></Button>)}</nav>
    {route.view === 'overview' ? <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="grid gap-0.5 rounded-sm border border-border-soft bg-card p-3"><span className="text-xs text-foreground-3">测试提交</span><strong className="text-xl font-semibold tabular-nums text-foreground">{data.records.length.toLocaleString()}</strong></div>
        <div className="grid gap-0.5 rounded-sm border border-border-soft bg-card p-3"><span className="text-xs text-foreground-3">Average Precision</span><strong className="text-xl font-semibold tabular-nums text-foreground">{summary?.metrics.averagePrecision.value?.toFixed(3) ?? '未提供'}</strong></div>
        <div className="grid gap-0.5 rounded-sm border border-border-soft bg-card p-3"><span className="text-xs text-foreground-3">ROC-AUC</span><strong className="text-xl font-semibold tabular-nums text-foreground">{summary?.metrics.rocAuc.value?.toFixed(3) ?? '未提供'}</strong></div>
        <div className="grid gap-0.5 rounded-sm border border-border-soft bg-card p-3"><span className="text-xs text-foreground-3">Recall@20%LOC</span><strong className="text-xl font-semibold tabular-nums text-foreground">{summary?.metrics.recall20Loc.value?.toFixed(3) ?? '未提供'}</strong></div>
      </div>
      <BaselineRecord data={data}/>
    </> : route.view === 'trends' ? <TrendPage embedded expectedRunId={data.runId} navigate={search => { const url = new URL(search, window.location.href); const target = new URL(window.location.href); target.search = url.search; window.history.replaceState({}, '', target); go('commits') }}/> : <HistoricalCommits key={`${data.runId}:${window.location.search}`} data={data}/>}
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
  return <><div className="flex flex-wrap items-end gap-2" aria-label="历史提交筛选"><Input className="flex-1 basis-36" aria-label="提交标识搜索" placeholder="搜索提交标识" value={query.draft.search} onChange={event => update({ search: event.target.value })}/><DatePicker className="w-36" ariaLabel="起始日期" placeholder="选择日期" value={query.draft.start} max={query.draft.end || undefined} onChange={value => update({ start: value })}/><DatePicker className="w-36" ariaLabel="结束日期" placeholder="选择日期" value={query.draft.end} min={query.draft.start || undefined} onChange={value => update({ end: value })}/><Select value={query.draft.sort == null ? '' : String(query.draft.sort)} onValueChange={nextValue => (sort => update({ sort }))(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="排序" style={{ width: 132 }} size="sm"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([{ value: 'risk', label: '模型分数' }, { value: 'time', label: '提交时间' }]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select><Button variant="link" size="sm" onClick={() => { setPage(0); setQuery({ draft: emptyQuery, applied: emptyQuery, error: '' }) }} type="button">清除筛选</Button></div>{query.error ? <p role="alert">{query.error}</p> : null}{seed.ignored ? <p role="status">地址中的日期范围无效，已忽略。</p> : null}<div className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><section className="overflow-x-auto"><Table className="w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1.5"><TableHeader><TableRow><TableHead>提交标识</TableHead><TableHead>模型分数</TableHead><TableHead>提交时间</TableHead><TableHead className="tabular-nums text-right">变更行</TableHead></TableRow></TableHeader><TableBody>{visible.map(record => <TableRow key={record.id}><TableCell><Button variant="ghost" className="block w-full border-0 bg-transparent p-0 text-left text-sm text-foreground hover:text-accent" title={record.id} aria-label={`查看 ${record.id}`} onClick={() => setSelected(record.id)}>{record.id.slice(0, 12)}</Button></TableCell><TableCell><Risk risk={record.risk}/></TableCell><TableCell>{displayTime(record.time)}</TableCell><TableCell className="tabular-nums text-right">{record.lines ?? '未提供'}</TableCell></TableRow>)}</TableBody></Table>{records.length === 0 ? <p className="text-xs text-foreground-3">没有符合条件的提交</p> : null}<nav className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-label="历史提交分页"><span>{records.length} 条提交 · 第 {page+1} 页</span><Button size="sm" disabled={!page} onClick={() => setPage(page-1)} variant="outline" type="button">上一页</Button><Button size="sm" disabled={(page+1)*25 >= records.length} onClick={() => setPage(page+1)} variant="outline" type="button">下一页</Button></nav></section></div><Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${720}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"提交详情"}</DialogTitle></DialogHeader>{selected ? <CommitDetail data={data} id={selected} onClose={() => setSelected(null)}/> : null}</DialogContent></Dialog></>
}
