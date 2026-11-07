import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import {
  fetchExperimentRun,
  fetchExperimentRuns,
  metricValue,
  promoteExperimentRuns,
  type ExperimentPromotionItem,
  type ExperimentRun,
  type ExperimentRunPage,
  type Row,
} from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice, MetricGrid } from './AdminShared'

interface Filters {
  registrationState?: string
  compatibility?: string
  artifactState?: string
  offset?: number
}

const PAGE_SIZE = 20
const STATUS_LABELS: Record<string, string> = {
  'repository-analysis': '可用于仓库分析',
  'offline-only': '仅离线基准',
  'input-unsupported': '当前输入不支持',
  'schema-incompatible': 'schema 不兼容',
  registered: '已登记',
  unregistered: '未登记',
  complete: '完整',
  invalid: '产物无效',
  failed: '训练失败',
  registeredResult: '已登记',
  reused: '复用已有模型',
  'already-registered': '此前已登记',
}

function experimentLabel(run: ExperimentRun) {
  return run.name || run.method || run.displayName
}

function metricSummary(metrics: Row) {
  const ap = metricValue(metrics, 'averagePrecision')
  const auc = metricValue(metrics, 'rocAuc')
  if (ap === null && auc === null) return '未定义'
  return `AP ${ap === null ? '未定义' : ap.toFixed(4)} · ROC-AUC ${auc === null ? '未定义' : auc.toFixed(4)}`
}

function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return <label className="admin-filter-field"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>
}

export function AdminExperimentRunsPage({ candidateId, filters, navigate, expired }: {
  candidateId?: string
  filters: Filters
  navigate: (route: Route) => void
  expired: () => void
}) {
  if (candidateId) return <ExperimentDetail candidateId={candidateId} navigate={navigate} expired={expired}/>
  return <ExperimentList filters={filters} navigate={navigate} expired={expired}/>
}

function ExperimentList({ filters, navigate, expired }: {
  filters: Filters
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [page, setPage] = useState<ExperimentRunPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ExperimentPromotionItem[]>([])

  const fail = useCallback((failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) expired()
    else setError(failure instanceof Error ? failure.message : fallback)
  }, [expired])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchExperimentRuns({
      registrationState: filters.registrationState,
      compatibility: filters.compatibility,
      artifactState: filters.artifactState,
      offset: filters.offset ?? 0,
      limit: PAGE_SIZE,
      signal: controller.signal,
    }).then(result => {
      if (!controller.signal.aborted) {
        setPage(result)
        setSelected([])
        setError('')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) fail(failure, '实验运行读取失败')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [filters.registrationState, filters.compatibility, filters.artifactState, filters.offset, revision, fail])

  function setFilter(key: 'registrationState' | 'compatibility' | 'artifactState', value: string) {
    const route: Extract<Route, { name: 'admin' }> = {
      name: 'admin',
      view: 'experiment-runs',
      ...(key === 'registrationState' && value ? { registrationState: value as 'registered' | 'unregistered' } : {}),
      ...(key === 'compatibility' && value ? { compatibility: value as Extract<Route, { name: 'admin' }>['compatibility'] } : {}),
      ...(key === 'artifactState' && value ? { artifactState: value as 'complete' | 'invalid' | 'failed' } : {}),
    }
    if (key !== 'registrationState' && filters.registrationState) route.registrationState = filters.registrationState as 'registered' | 'unregistered'
    if (key !== 'compatibility' && filters.compatibility) route.compatibility = filters.compatibility as Extract<Route, { name: 'admin' }>['compatibility']
    if (key !== 'artifactState' && filters.artifactState) route.artifactState = filters.artifactState as 'complete' | 'invalid' | 'failed'
    navigate(route)
  }

  function goTo(offset: number) {
    navigate({
      name: 'admin',
      view: 'experiment-runs',
      ...(filters.registrationState ? { registrationState: filters.registrationState as 'registered' | 'unregistered' } : {}),
      ...(filters.compatibility ? { compatibility: filters.compatibility as Extract<Route, { name: 'admin' }>['compatibility'] } : {}),
      ...(filters.artifactState ? { artifactState: filters.artifactState as 'complete' | 'invalid' | 'failed' } : {}),
      ...(offset > 0 ? { offset } : {}),
    })
  }

  async function promote() {
    if (!page || !selected.length) return
    const items = page.runs
      .filter(run => selected.includes(run.candidateId))
      .map(run => {
        const location = run.locations.find(item => item.candidateId === run.candidateId)
        return { candidateId: run.candidateId, expectedManifestSha256: location?.manifestSha256 ?? run.manifestSha256 ?? '' }
      })
    if (items.some(item => !item.expectedManifestSha256)) {
      setError('所选运行缺少 manifest 校验值，不能登记。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await promoteExperimentRuns(items)
      setResults(result.items)
      setConfirming(false)
      setSelected([])
      setRevision(value => value + 1)
    } catch (failure) {
      fail(failure, '实验运行登记失败')
    } finally {
      setBusy(false)
    }
  }

  const offset = filters.offset ?? 0
  const total = page?.total ?? 0
  const options = (all: string, values: [string, string][]) => [
    { value: '', label: all },
    ...values.map(([value, label]) => ({ value, label })),
  ]
  return <section>
    <AdminPageHeader
      title="实验运行"
      onRefresh={() => setRevision(value => value + 1)}
    />
    <ErrorNotice>{error}</ErrorNotice>
    <div className="admin-experiment-filters">
      <FilterSelect label="登记状态" value={filters.registrationState ?? ''} onChange={value => setFilter('registrationState', value)} options={options('全部登记状态', [['unregistered', '未登记'], ['registered', '已登记']])}/>
      <FilterSelect label="服务兼容性" value={filters.compatibility ?? ''} onChange={value => setFilter('compatibility', value)} options={options('全部兼容性', [['repository-analysis', '可用于仓库分析'], ['offline-only', '仅离线基准'], ['input-unsupported', '当前输入不支持'], ['schema-incompatible', 'schema 不兼容']])}/>
      <FilterSelect label="产物状态" value={filters.artifactState ?? ''} onChange={value => setFilter('artifactState', value)} options={options('全部产物状态', [['complete', '完整'], ['invalid', '产物无效'], ['failed', '训练失败']])}/>
    </div>
    {loading ? <LoadingNotice label="正在盘点实验运行"/> : null}
    {!loading && !page?.runs.length ? <p className="quiet-empty">当前筛选没有实验运行。</p> : null}
    {page?.runs.length ? <div className="admin-table-wrap"><table className="admin-table admin-experiment-table">
      <thead><tr><th><span className="sr-only">选择</span></th><th>数据集 / 方法</th><th>指标</th><th>状态</th><th>运行</th><th><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{page.runs.map(run => {
        const checked = selected.includes(run.candidateId)
        return <tr key={run.candidateId}>
          <td><input type="checkbox" aria-label={`选择实验 ${run.artifactRunId ?? run.displayName}`} checked={checked} disabled={!run.promotable || !run.manifestSha256}
            onChange={event => setSelected(current => event.target.checked ? [...current, run.candidateId] : current.filter(id => id !== run.candidateId))}/></td>
          <td><strong>{experimentLabel(run)}</strong><small>{run.datasetVersion ?? '数据集未知'} · {run.method ?? '方法未知'}</small></td>
          <td>{metricSummary(run.metrics)}</td>
          <td><span className="source-chip">{STATUS_LABELS[run.registrationState]}</span><small>{STATUS_LABELS[run.artifactState]} · {STATUS_LABELS[run.serviceCompatibility]}</small>{run.serviceCompatibilityReason ? <small>{run.serviceCompatibilityReason}</small> : null}{run.artifactStateReason ? <small>{run.artifactStateReason}</small> : null}</td>
          <td><code>{run.artifactRunId ?? '无运行身份'}</code><small>{run.featureSchemaVersion ?? 'schema 未知'} · {run.locations.length} 个位置</small></td>
          <td><div className="admin-row-actions"><Button size="sm" onClick={() => navigate({ name: 'admin', view: 'experiment-runs', resourceId: run.candidateId })}>查看</Button>{run.promotable ? <Button size="sm" onClick={() => { setSelected([run.candidateId]); setConfirming(true) }}>登记实验运行</Button> : run.modelId ? <Button size="sm" onClick={() => navigate({ name: 'admin', view: 'models', resourceId: run.modelId! })}>查看模型</Button> : null}</div></td>
        </tr>
      })}</tbody>
    </table></div> : null}
    {selected.length ? <section className="admin-promotion-panel" aria-label="登记所选实验">
      <strong>已选择 {selected.length} 个运行</strong>
      {confirming ? <><p>确认后会重新校验产物并按运行身份登记；不会自动设置默认模型。</p><div className="admin-detail-actions"><Button variant="primary" loading={busy} onClick={() => void promote()}>确认登记实验运行</Button><Button disabled={busy} onClick={() => setConfirming(false)}>取消</Button></div></> : <Button onClick={() => setConfirming(true)}>登记所选实验运行</Button>}
    </section> : null}
    {results.length ? <section className="admin-promotion-results" aria-label="登记结果"><h2>登记结果</h2>{results.map(result => <div key={result.candidateId} data-status={result.status}><span className="source-chip">{STATUS_LABELS[result.status] ?? result.status}</span><code>{result.candidateId}</code>{result.message ? <p>{result.message}</p> : null}{result.modelId ? <Button size="sm" onClick={() => navigate({ name: 'admin', view: 'models', resourceId: result.modelId! })}>查看模型</Button> : null}</div>)}</section> : null}
    {page?.reports.length ? <section className="admin-report-only"><h2>不可登记报告</h2><p>聚合报告不包含完整模型产物，只能用于比较。</p>{page.reports.map(report => <div key={report.artifactKey}><code>{report.artifactKey}</code><p>{report.reason}</p></div>)}</section> : null}
    {total > PAGE_SIZE ? <nav className="pager" aria-label="实验运行分页"><Button disabled={offset === 0} onClick={() => goTo(Math.max(0, offset - PAGE_SIZE))}>上一页</Button><span>第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span><Button disabled={offset + PAGE_SIZE >= total} onClick={() => goTo(offset + PAGE_SIZE)}>下一页</Button></nav> : null}
  </section>
}

function ExperimentDetail({ candidateId, navigate, expired }: {
  candidateId: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [run, setRun] = useState<ExperimentRun | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetchExperimentRun(candidateId, controller.signal).then(setRun).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '实验运行详情读取失败')
    })
    return () => controller.abort()
  }, [candidateId, expired])
  if (error) return <EmptyState title="实验运行不可用" description={error}><Button onClick={() => navigate({ name: 'admin', view: 'experiment-runs' })}>返回实验运行</Button></EmptyState>
  if (!run) return <LoadingNotice label="正在读取实验运行详情"/>
  return <section>
    <AdminPageHeader title={experimentLabel(run)} meta={`${run.datasetVersion ?? '数据集未知'} · ${run.method ?? '方法未知'}`}/>
    <div className="admin-detail-actions"><Button onClick={() => navigate({ name: 'admin', view: 'experiment-runs' })}>返回实验运行</Button>{run.modelId ? <Button onClick={() => navigate({ name: 'admin', view: 'models', resourceId: run.modelId! })}>查看模型详情</Button> : null}</div>
    <div className="admin-status-line"><span className="source-chip">{STATUS_LABELS[run.registrationState]}</span><span>{STATUS_LABELS[run.artifactState]}</span><span>{STATUS_LABELS[run.serviceCompatibility]}</span></div>
    {run.serviceCompatibilityReason ? <p className="admin-notice">{run.serviceCompatibilityReason}</p> : null}
    {run.artifactStateReason ? <p className="field-error">{run.artifactStateReason}</p> : null}
    <MetricGrid metrics={run.metrics}/>
    <div className="admin-detail-grid">
      <section><h2>运行身份</h2><dl className="admin-facts">
        <div><dt>artifact run</dt><dd><code>{run.artifactRunId ?? '无'}</code></dd></div>
        <div><dt>业务运行</dt><dd><code>{run.runId ?? '未登记'}</code></dd></div>
        <div><dt>模型</dt><dd><code>{run.modelId ?? '未登记'}</code></dd></div>
        <div><dt>数据集</dt><dd><code>{run.datasetVersion ?? '未提供'}</code></dd></div>
        <div><dt>schema</dt><dd>{run.featureSchemaVersion ?? '未提供'}</dd></div>
        <div><dt>指标集</dt><dd>{run.metricSet ?? '未提供'}</dd></div>
      </dl></section>
      <section><h2>产物位置</h2><div className="admin-location-list">{run.locations.map(location => <div key={location.candidateId}><code>{location.artifactKey}</code><span>{STATUS_LABELS[location.artifactState]}</span>{location.reason ? <p>{location.reason}</p> : null}</div>)}</div></section>
    </div>
    <section><h2>训练限制</h2><ul className="admin-limitations">{run.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
  </section>
}
