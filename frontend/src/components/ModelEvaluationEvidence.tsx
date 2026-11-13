import { useEffect, useState } from 'react'
import { ApiError } from '../apiContract'
import {
  fetchEvaluationEvidence, type EvaluationEvidenceEntry, type EvidenceStatus,
} from '../evaluationEvidenceClient'
import { Button } from '../ui/controls'

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
    return `${languageList(entry).join('/') || '语言未记录'} · 时间外 ${count(summary.withinRepoCells)} 格 · 留一仓库 ${count(summary.leaveOneRepoOutCells)} 格 · 失败 ${count(summary.failures)} 格`
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
    return <section className="admin-model-evidence">
      <h2>评价证据</h2>
      <div className="admin-inline-error" role="alert">{error}<Button size="sm" onClick={() => setRevision(value => value + 1)}>重试</Button></div>
    </section>
  }
  if (entries === null) {
    return <section className="admin-model-evidence"><h2>评价证据</h2><p className="quiet-empty" role="status">正在读取固定目录中的评价证据。</p></section>
  }
  const relevant = entries.filter(entry => entry.kind === 'evaluation-matrix'
    ? method !== null && methodList(entry).includes(method)
    : entry.kind === 'line-candidate-evaluation' || entry.kind === 'line-candidates')
  return <section className="admin-model-evidence">
    <h2>评价证据</h2>
    {relevant.length ? <div className="admin-table-wrap"><table className="admin-table">
      <thead><tr><th>类型</th><th>状态</th><th>规模</th><th>来源</th></tr></thead>
      <tbody>{relevant.map(entry => <tr key={entry.evidenceId}>
        <th>{kindText(entry)}</th>
        <td>{STATUS_LABEL[entry.status]}{entry.reason ? <small>{entry.reason}</small> : null}</td>
        <td>{scaleText(entry)}</td>
        <td><code>{entry.source}</code><small>{entry.evidenceId}</small></td>
      </tr>)}</tbody>
    </table></div> : <p className="quiet-empty">固定目录中没有与该模型方法匹配的跨仓库评价，也没有完整候选集报告。</p>}
    <p className="admin-report-meta">方法级评价来自独立仓库的时间外与留一仓库实验，不绑定当前模型产物；行级候选是独立结构基线。数据版本变化时证据标为陈旧。</p>
  </section>
}
