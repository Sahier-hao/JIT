import { useState } from 'react'
import { ApiError } from '../../apiContract'
import { createTrainingTask, formatDate, valueLabel, type AdminDatasetVersion, type Row } from '../../adminContracts'
import { deriveCuration, compareCuration, exportCuration, previewCuration, type CurationPreview } from '../../curationClient'
import { Button, Select, TextArea } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

const DEFAULT_RECIPE = '{\n  "version": 1,\n  "rules": [\n    { "id": "max-value", "field": "la", "value": 10000 }\n  ]\n}'

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
  const [classPolicy, setClassPolicy] = useState<'none' | 'weights' | 'sample'>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recipeText, setRecipeText] = useState(DEFAULT_RECIPE)
  const [curationBusy, setCurationBusy] = useState(false)
  const [curationError, setCurationError] = useState('')
  const [curationPreview, setCurationPreview] = useState<CurationPreview | null>(null)
  const [derivedVersion, setDerivedVersion] = useState('')
  const [compareVersion, setCompareVersion] = useState('')
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null)
  const [compareError, setCompareError] = useState('')
  const selected = versions.find(item => item.version === version) ?? versions.at(-1)
  if (!selected) return null
  const quality = selected.quality
  const selectedMethod = methods.some(item => item.method === method) ? method : valueLabel(methods[0]?.method, '')
  async function train() {
    setBusy(true); setError('')
    try {
      const task = await createTrainingTask(selected!.version, selectedMethod, metricSet,
                                            classPolicy === 'none' ? undefined : { kind: classPolicy, seed: 0 })
      navigate({ name: 'admin', view: 'training', resourceId: task.taskId })
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '训练任务创建失败')
    } finally { setBusy(false) }
  }
  function recipe() {
    try { return JSON.parse(recipeText) } catch { throw new Error('清洗配方不是合法 JSON') }
  }
  async function previewCurationAction() {
    setCurationBusy(true); setCurationError(''); setDerivedVersion('')
    try { setCurationPreview(await previewCuration(selected!.version, recipe())) }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) expired(); else setCurationError(failure instanceof Error ? failure.message : '清洗预览失败') }
    finally { setCurationBusy(false) }
  }
  async function deriveCurationAction() {
    setCurationBusy(true); setCurationError('')
    try {
      const result = await deriveCuration(selected!.version, recipe())
      setCurationPreview(result.preview); setDerivedVersion(result.version)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setCurationError(failure instanceof Error ? failure.message : '派生版本生成失败')
    } finally { setCurationBusy(false) }
  }
  async function compareAction() {
    setCompareError('')
    try { setComparison(await compareCuration(selected!.version, compareVersion)) }
    catch (failure) { setCompareError(failure instanceof Error ? failure.message : '版本对比失败') }
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
    <section className="admin-train-panel"><h2>清洗与派生</h2><ErrorNotice>{curationError}</ErrorNotice>
      <TextArea aria-label="清洗配方" value={recipeText} onChange={event => { setRecipeText(event.target.value); setCurationPreview(null); setDerivedVersion('') }}/>
      <div className="admin-train-form">
        <Button loading={curationBusy} onClick={() => void previewCurationAction()}>预览清洗</Button>
        <Button loading={curationBusy} onClick={() => void deriveCurationAction()}>生成派生版本</Button>
      </div>
      {curationPreview ? <pre className="admin-report-meta">{JSON.stringify(curationPreview.stats, null, 2)}</pre> : null}
      {derivedVersion ? <p className="admin-report-meta">已生成派生版本 {derivedVersion}；返回数据集列表可查看并训练该版本。</p> : null}
    </section>
    <section className="admin-train-panel"><h2>对比与导出</h2><ErrorNotice>{compareError}</ErrorNotice>
      <div className="admin-train-form">
        <Select ariaLabel="对比派生版本" value={compareVersion} onChange={setCompareVersion} options={versions.filter(item => item.version !== selected.version).map(item => ({ value: item.version, label: item.version }))}/>
        <Button disabled={!compareVersion} onClick={() => void compareAction()}>对比版本</Button>
        <Button onClick={() => void exportCuration(selected.version)}>导出当前版本</Button>
      </div>
      {comparison ? <pre className="admin-report-meta">{JSON.stringify(comparison, null, 2)}</pre> : null}
    </section>
    <section className="admin-train-panel"><h2>用此版本训练</h2><ErrorNotice>{error}</ErrorNotice><div className="admin-train-form">
      <Select ariaLabel="训练方法" value={selectedMethod} onChange={setMethod} options={methods.map(item => ({ value: valueLabel(item.method, ''), label: `${valueLabel(item.name)} · ${valueLabel(item.method)}` }))}/>
      <Select ariaLabel="指标集" value={metricSet} onChange={setMetricSet} options={[{ value: 'metric-set-v2', label: 'metric-set-v2' }, { value: 'metric-set-v1', label: 'metric-set-v1' }]}/>
      <Select ariaLabel="训练分区类别策略" value={classPolicy} onChange={value => setClassPolicy(value as 'none' | 'weights' | 'sample')} options={[{ value: 'none', label: '不处理类别' }, { value: 'weights', label: '训练分区加权' }, { value: 'sample', label: '训练分区采样' }]}/>
      <Button variant="primary" loading={busy} disabled={!selectedMethod || !version} onClick={() => void train()}>创建训练任务</Button>
    </div></section>
  </section>
}
