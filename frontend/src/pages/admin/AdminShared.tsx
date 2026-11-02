import type { ReactNode } from 'react'
import { Button } from '../../ui/controls'
import { metricReason, metricValue, type Row } from '../../adminContracts'

export function AdminPageHeader({ title, meta, actions, onRefresh }: { title: string; meta?: ReactNode; actions?: ReactNode; onRefresh?: () => void }) {
  return <header className="admin-page-head">
    <div className="admin-page-title"><h1>{title}</h1>{meta ? <p className="admin-page-meta">{meta}</p> : null}</div>
    <div className="admin-page-actions">{actions}{onRefresh ? <Button onClick={onRefresh}>刷新</Button> : null}</div>
  </header>
}

const METRICS = [
  ['averagePrecision', 'AP'],
  ['rocAuc', 'ROC-AUC'],
  ['recall20Loc', 'Recall@20%LOC'],
  ['popt', 'Popt'],
  ['f1', 'F1'],
  ['ifa', 'IFA'],
] as const

export function MetricGrid({ metrics }: { metrics: Row | null | undefined }) {
  if (!metrics) return <p className="quiet-empty">尚无训练指标。</p>
  return <div className="admin-metric-grid">
    {METRICS.map(([key, name]) => {
      const value = metricValue(metrics, key)
      return <div key={key}><span>{name}</span><strong>{value === null ? '未定义' : value.toFixed(4)}</strong>{value === null && metricReason(metrics, key) ? <small>{metricReason(metrics, key)}</small> : null}</div>
    })}
  </div>
}

export function MetricComparison({ left, right, leftName, rightName }: { left: Row; right: Row; leftName: string; rightName: string }) {
  return <div className="admin-table-wrap"><table className="admin-table admin-comparison-table">
    <thead><tr><th>指标</th><th>{leftName}</th><th>{rightName}</th></tr></thead>
    <tbody>{METRICS.map(([key, name]) => {
      return <tr key={key}><th>{name}</th><MetricCell metrics={left} metric={key}/><MetricCell metrics={right} metric={key}/></tr>
    })}</tbody>
  </table></div>
}

function MetricCell({ metrics, metric }: { metrics: Row; metric: string }) {
  const value = metricValue(metrics, metric)
  const reason = metricReason(metrics, metric)
  return <td>{value === null ? '未定义' : value.toFixed(4)}{value === null && reason ? <small>{reason}</small> : null}</td>
}

export function ErrorNotice({ children }: { children: string }) {
  return children ? <p className="field-error" role="alert">{children}</p> : null
}
