import { useState } from 'react'
import { ApiError } from '../../apiContract'
import { createTrainingTask, formatDate, valueLabel, type AdminDatasetVersion, type Row } from '../../adminContracts'
import { Button, Select } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

export function AdminDatasetDetailPage({ dataset, versions, initialVersion, methods, navigate, expired }: {
  dataset: string
  versions: AdminDatasetVersion[]
  initialVersion?: string
  methods: Row[]
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [version, setVersion] = useState(initialVersion ?? versions.at(-1)?.version ?? '')
  const [method, setMethod] = useState(methods[0]?.method ? valueLabel(methods[0].method, '') : '')
  const [metricSet, setMetricSet] = useState('metric-set-v2')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = versions.find(item => item.version === version) ?? versions.at(-1)
  if (!selected) return null
  const quality = selected.quality
  const selectedMethod = methods.some(item => item.method === method) ? method : valueLabel(methods[0]?.method, '')
  async function train() {
    setBusy(true); setError('')
    try {
      const task = await createTrainingTask(selected!.version, selectedMethod, metricSet)
      navigate({ name: 'admin', view: 'training', resourceId: task.taskId })
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '训练任务创建失败')
    } finally { setBusy(false) }
  }
  return <section>
    <AdminPageHeader title={dataset} meta={selected.schema}/>
    <div className="admin-detail-actions"><Button onClick={() => navigate({ name: 'admin', view: 'datasets' })}>返回数据集列表</Button></div>
    <div className="admin-dataset-version-picker"><span>版本</span><Select ariaLabel="数据集版本" value={version} onChange={setVersion} options={versions.map(item => ({ value: item.version, label: item.version }))}/></div>
    <div className="admin-detail-grid">
      <section><h2>版本与质量</h2><dl className="admin-facts">
        <div><dt>schema</dt><dd>{selected.schema}</dd></div>
        <div><dt>时间范围</dt><dd>{formatDate(selected.timeRange.start)} — {formatDate(selected.timeRange.end)}</dd></div>
        <div><dt>原始/纳入</dt><dd>{valueLabel(quality.rawRows)} / {valueLabel(quality.includedRows)}</dd></div>
        <div><dt>正例</dt><dd>{valueLabel(quality.positiveLabels)}</dd></div>
        <div><dt>空标签</dt><dd>{valueLabel(quality.blankLabels)}</dd></div>
        <div><dt>CSV SHA-256</dt><dd><code>{valueLabel(selected.file.sha256)}</code></dd></div>
        <div><dt>文件字节</dt><dd>{valueLabel(selected.file.bytes)}</dd></div>
        <div><dt>标签规则</dt><dd>{selected.labelRule ?? '未声明'}</dd></div>
      </dl></section>
      <section><h2>来源</h2><dl className="admin-facts">
        <div><dt>发布者</dt><dd>{valueLabel(selected.source.publisher)}</dd></div>
        <div><dt>地址</dt><dd>{valueLabel(selected.source.url)}</dd></div>
        <div><dt>修订</dt><dd><code>{valueLabel(selected.source.revision)}</code></dd></div>
        <div><dt>分支</dt><dd>{valueLabel(selected.source.branch)}</dd></div>
        <div><dt>HEAD</dt><dd><code>{valueLabel(selected.source.head)}</code></dd></div>
      </dl></section>
    </div>
    <div className="admin-detail-grid">
      <section><h2>字段缺失</h2><dl className="admin-facts">{Object.entries(quality.featureMissing ?? {}).map(([field, count]) => <div key={field}><dt>{field}</dt><dd>{valueLabel(count)}</dd></div>)}</dl></section>
      <section><h2>排除统计</h2><dl className="admin-facts">{Object.entries(quality.excluded ?? {}).map(([reason, count]) => <div key={reason}><dt>{reason}</dt><dd>{valueLabel(count)}</dd></div>)}</dl></section>
    </div>
    <section><h2>训练限制</h2><ul className="admin-limitations">{selected.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
    <section className="admin-train-panel"><h2>用此版本训练</h2><ErrorNotice>{error}</ErrorNotice><div className="admin-train-form">
      <Select ariaLabel="训练方法" value={selectedMethod} onChange={setMethod} options={methods.map(item => ({ value: valueLabel(item.method, ''), label: `${valueLabel(item.name)} · ${valueLabel(item.method)}` }))}/>
      <Select ariaLabel="指标集" value={metricSet} onChange={setMetricSet} options={[{ value: 'metric-set-v2', label: 'metric-set-v2' }, { value: 'metric-set-v1', label: 'metric-set-v1' }]}/>
      <Button variant="primary" loading={busy} disabled={!selectedMethod || !version} onClick={() => void train()}>创建训练任务</Button>
    </div></section>
  </section>
}
