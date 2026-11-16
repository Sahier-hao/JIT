import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '../apiContract'
import {
  fetchEvaluationEvidence, type EvaluationEvidenceEntry, type EvidenceStatus,
} from '../evaluationEvidenceClient'


const STATUS_LABEL: Record<EvidenceStatus, string> = {
  available: '可用', stale: '陈旧', invalid: '无效',
}

function text(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

function methodList(entry: EvaluationEvidenceEntry) {
  const value = entry.summary?.methods
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function languageList(entry: EvaluationEvidenceEntry) {
  const value = entry.summary?.languages
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function scaleText(entry: EvaluationEvidenceEntry) {
  const summary = entry.summary ?? {}
  if (entry.kind === 'evaluation-matrix') {
    return `${languageList(entry).join('/') || '语言未记录'} · 时间外 ${count(summary.withinRepoCells)} 格 · 留一仓库 ${count(summary.leaveOneRepoOutCells)} 格 · 失败 ${count(summary.failures)} 格 · ${text(summary.budgetProtocol, '旧预算协议')}`
  }
  if (entry.kind === 'review-benefit') {
    return `${languageList(entry).join('/') || '语言未记录'} · ${count(summary.datasets)} 个数据集 · ${count(summary.cells)} 个方法格 · review-benefit-v3`
  }
  if (entry.kind === 'line-candidate-evaluation') {
    return `${count(summary.repos)} 仓库 · 候选 ${count(summary.candidates)} 行 · 正例 ${count(summary.positives)}`
  }
  if (entry.kind === 'line-candidates') {
    return `候选 ${count(summary.candidates)} 行 · 正例 ${count(summary.positives)} · 不可覆盖 ${count(summary.uncoverable)}`
  }
  return text(summary.datasets)
}

function kindText(entry: EvaluationEvidenceEntry) {
  if (entry.kind === 'evaluation-matrix') return '跨仓库 / 时间外评价'
  if (entry.kind === 'review-benefit') return '审查收益评价（review-benefit-v3）'
  if (entry.kind === 'line-candidate-evaluation') return '完整候选集定位'
  if (entry.kind === 'line-candidates') return '完整候选集导出'
  return entry.kind
}

export function ModelEvaluationEvidence({ method, expired }: {
  method: string | null
  expired: () => void
}) {
  const [entries, setEntries] = useState<EvaluationEvidenceEntry[] | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchEvaluationEvidence(controller.signal)
      .then(value => { if (!controller.signal.aborted) { setEntries(value); setError('') } })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '评价证据读取失败')
      })
    return () => controller.abort()
  }, [expired, revision])
  if (error) {
    return <section className="grid gap-2 rounded-sm border border-border-soft p-3">
      <h2>评价证据</h2>
      <div className="text-xs text-rose" role="alert">{error}<Button size="sm" onClick={() => setRevision(value => value + 1)} variant="outline" type="button">重试</Button></div>
    </section>
  }
  if (entries === null) {
    return <section className="grid gap-2 rounded-sm border border-border-soft p-3"><h2>评价证据</h2><p className="text-xs text-foreground-3" role="status">正在读取固定目录中的评价证据。</p></section>
  }
  const relevant = entries.filter(entry => entry.kind === 'evaluation-matrix'
    ? method !== null && methodList(entry).includes(method)
    : entry.kind === 'review-benefit'
      ? method !== null && methodList(entry).includes(method)
      : entry.kind === 'line-candidate-evaluation' || entry.kind === 'line-candidates')
  return <section className="grid gap-2 rounded-sm border border-border-soft p-3">
    <h2>评价证据</h2>
    {relevant.length ? <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
      <TableHeader><TableRow><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>规模</TableHead><TableHead>来源</TableHead></TableRow></TableHeader>
      <TableBody>{relevant.map(entry => <TableRow key={entry.evidenceId}>
        <TableHead>{kindText(entry)}</TableHead>
        <TableCell>{STATUS_LABEL[entry.status]}{entry.reason ? <small>{entry.reason}</small> : null}</TableCell>
        <TableCell>{scaleText(entry)}</TableCell>
        <TableCell><code>{entry.source}</code><small>{entry.evidenceId}</small></TableCell>
      </TableRow>)}</TableBody>
    </Table></div> : <p className="text-xs text-foreground-3">固定目录中没有与该模型方法匹配的跨仓库评价，也没有完整候选集报告。</p>}
    <p className="text-xs leading-body text-foreground-3">方法级评价来自独立仓库的时间外与留一仓库实验，不绑定当前模型产物；行级候选是独立结构基线。数据版本变化时证据标为陈旧。</p>
  </section>
}
