import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingNotice } from '@/components/shared/Feedback'
import { ApiError } from '@/lib/apiContract'
import { datasetVersionLabel } from '@/lib/datasetLabel'
import { cn } from '@/lib/utils'
import {
  Activity, ChevronLeft, ChevronRight, Download, LoaderCircle,
  RefreshCw, Search, ShieldAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Route } from '@/app/navigation'
import { userDatasets, type UserDataset } from '@/features/account/userClient'
import { formatDate } from '@/features/admin/adminContracts'
import { useRepositories } from '@/features/projects/repositoryWorkspace'
import { fetchRepositorySyncsPage } from '@/features/projects/projectClient'
import { fetchRepositorySyncCommits } from '@/lib/apiClient'
import type { SyncCommit, SyncView } from '@/features/projects/repositoryContract'
import {
  createPredictionBatch, createSinglePrediction, createUnlabeledPrediction,
  predictionBatch, predictionBatches, predictionModels, predictionSamples,
  predictionSplits,
  type PredictionBatch, type PredictionBatchDetail, type PredictionModel,
  type PredictionPartition, type PredictionRecord, type PredictionSample,
  type PredictionSplitOptions,
} from '@/features/predictions/predictionClient'
import { featureLabel } from '@/features/predictions/featureLabels'
import { thresholdMetrics } from '@/features/predictions/thresholdMetrics'

const PAGE_SIZE = 50
const SAMPLE_PAGE_SIZE = 10
const LABEL_STATUS: Record<string, string> = {
  positive: '已确认正例',
  immature: '观察未满',
  unobserved: '观察期内未见修复',
  unknown: '标签状态未知',
  unavailable: '无标签',
}
const PARTITION_LABEL: Record<PredictionPartition, string> = {
  train: '训练集', validation: '验证集', test: '测试集',
}

function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

function scoreText(value: number): string {
  return value.toFixed(4)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function MyPredictionsPage({ batchId, initialDatasetVersion, navigate, onLoginRequired }: {
  batchId?: string
  initialDatasetVersion?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [batches, setBatches] = useState<PredictionBatch[] | null>(null)
  const [tab, setTab] = useState<'single' | 'batch'>('batch')
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setHistoryError('')
    predictionBatches(controller.signal).then((items) => {
      if (!controller.signal.aborted) setBatches(items)
    }).catch((failure) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setHistoryError(errorMessage(failure, '预测记录读取失败'))
    })
    return () => controller.abort()
  }, [onLoginRequired, revision])

  useEffect(() => {
    if (batchId) return
    const controller = new AbortController()
    setError('')
    userDatasets('usable', controller.signal).then(({ datasets: items }) => {
      if (!controller.signal.aborted) setDatasets(items)
    }).catch((failure) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(errorMessage(failure, '预测数据读取失败'))
    })
    return () => controller.abort()
  }, [batchId, onLoginRequired, revision])

  function created(batch: PredictionBatch) {
    navigate({ name: 'my-predictions', batchId: batch.batchId })
    setRevision(value => value + 1)
  }

  return <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
    <div className="grid min-w-0 content-start gap-4">
      <WorkspacePageHeader
        title="缺陷预测"
        meta="使用已登记模型为提交打分。分数是模型估计，不是已确认缺陷。"
        actions={batchId
          ? <Button variant="outline" size="sm" type="button" onClick={() => navigate({ name: 'my-predictions' })}>新建预测</Button>
          : undefined}
      />
      {error ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
        <span>{error}</span>
        <Button size="sm" variant="outline" type="button" onClick={() => setRevision(value => value + 1)}>重试</Button>
      </div> : null}
      {batchId ? <PredictionDetail batchId={batchId} navigate={navigate} onLoginRequired={onLoginRequired} />
        : <Tabs value={tab} onValueChange={value => setTab(value as 'single' | 'batch')}>
          <TabsList variant="line" aria-label="预测方式">
            <TabsTrigger value="batch">批量预测</TabsTrigger>
            <TabsTrigger value="single">单条预测</TabsTrigger>
          </TabsList>
          <TabsContent value="batch">
            <BatchPredictionSetup
              datasets={datasets}
              initialDatasetVersion={initialDatasetVersion ?? ''}
              navigate={navigate}
              onLoginRequired={onLoginRequired}
              onCreated={created}
            />
          </TabsContent>
          <TabsContent value="single">
            <SinglePredictionSetup
              datasets={datasets}
              initialDatasetVersion={initialDatasetVersion ?? ''}
              navigate={navigate}
              onLoginRequired={onLoginRequired}
              onCreated={created}
            />
          </TabsContent>
        </Tabs>}
    </div>
    <PredictionHistory
      batches={batches}
      activeBatchId={batchId}
      loading={batches === null && !historyError}
      error={historyError}
      onRefresh={() => setRevision(value => value + 1)}
      onOpen={id => navigate({ name: 'my-predictions', batchId: id })}
    />
  </section>
}

function ModelSelect({ models, value, onChange, label = '模型' }: {
  models: PredictionModel[] | null
  value: string
  onChange: (value: string) => void
  label?: string
}) {
  return <label className="grid gap-1.5">
    <span className="text-xs font-medium text-foreground-2">{label}</span>
    <Select value={value} onValueChange={onChange} disabled={!models?.length}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={models ? '没有兼容的已启用模型' : '正在读取模型'} />
      </SelectTrigger>
      <SelectContent>{(models ?? []).map(item => <SelectItem key={item.modelId} value={item.modelId}>
        {item.name}{item.isDefault ? ' · 默认' : ''}{item.mine ? ' · 我的' : item.shared ? ' · 共享' : ''}
      </SelectItem>)}</SelectContent>
    </Select>
  </label>
}

function SelectedModel({ model }: { model: PredictionModel | null }) {
  if (!model) return null
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-soft px-3 py-2 text-xs text-foreground-3">
    <span>方法 {model.method ?? '未提供'}</span>
    <span>schema {model.featureSchemaVersion}</span>
    <span>运行 <code className="font-mono text-[11px]">{model.runId?.slice(0, 12) ?? '未提供'}</code></span>
  </div>
}

function NoCompatibleModels({ datasetVersion, navigate }: {
  datasetVersion: string
  navigate: (route: Route) => void
}) {
  return <div className="grid gap-2 rounded-lg border border-amber/25 bg-amber-soft px-3 py-2 text-xs text-amber-deep" role="status">
    <div className="flex gap-2">
      <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0" size={14}/>
      <span>没有本人可见、已启用、ready 且 schema 兼容的已登记模型。</span>
    </div>
    <div className="flex flex-wrap gap-2 pl-5">
      <Button size="sm" type="button" onClick={() => navigate({ name: 'my-training', datasetVersion })}>去训练</Button>
      <Button size="sm" type="button" variant="outline" onClick={() => navigate({ name: 'my-models' })}>查看模型</Button>
    </div>
  </div>
}

function BatchPredictionSetup({ datasets, initialDatasetVersion, navigate, onLoginRequired, onCreated }: {
  datasets: UserDataset[] | null
  initialDatasetVersion: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
  onCreated: (batch: PredictionBatch) => void
}) {
  const [sourceMode, setSourceMode] = useState<'dataset' | 'csv'>('dataset')
  const [datasetVersion, setDatasetVersion] = useState(initialDatasetVersion)
  const [models, setModels] = useState<PredictionModel[] | null>(null)
  const [modelId, setModelId] = useState('')
  const [threshold, setThreshold] = useState(0.5)
  const [scope, setScope] = useState<'full' | 'frozen'>('full')
  const [splits, setSplits] = useState<PredictionSplitOptions | null>(null)
  const [splitError, setSplitError] = useState('')
  const [splitSource, setSplitSource] = useState<'model' | 'preset'>('model')
  const [splitPreset, setSplitPreset] = useState('')
  const [partition, setPartition] = useState<PredictionPartition>('test')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!datasetVersion && datasets?.length) setDatasetVersion(datasets[0].version)
  }, [datasetVersion, datasets])

  useEffect(() => {
    if (sourceMode === 'dataset' && !datasetVersion) {
      setModels(null)
      setModelId('')
      return
    }
    const controller = new AbortController()
    setModels(null)
    predictionModels(sourceMode === 'dataset' ? { datasetVersion } : null, controller.signal)
      .then(({ models: items }) => {
        if (controller.signal.aborted) return
        setModels(items)
        setModelId(current => items.some(item => item.modelId === current)
          ? current : items[0]?.modelId ?? '')
      })
      .catch((failure) => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(errorMessage(failure, '兼容模型读取失败'))
      })
    return () => controller.abort()
  }, [datasetVersion, onLoginRequired, sourceMode])

  useEffect(() => {
    if (sourceMode !== 'dataset' || scope !== 'frozen' || !datasetVersion || !modelId) {
      setSplits(null)
      setSplitError('')
      return
    }
    const controller = new AbortController()
    setSplits(null)
    setSplitError('')
    predictionSplits(datasetVersion, modelId, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setSplits(value)
      const source = value.modelSplit ? 'model' : 'preset'
      setSplitSource(source)
      const preset = value.presets.find(item => item.available && item.id === (value.modelSplit?.splitPreset ?? ''))
        ?? value.presets.find(item => item.available)
      setSplitPreset(source === 'model'
        ? value.modelSplit?.splitPreset ?? '' : preset?.id ?? '')
      setPartition('test')
    }).catch((failure) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setSplitError(errorMessage(failure, '分区读取失败'))
    })
    return () => controller.abort()
  }, [datasetVersion, modelId, onLoginRequired, scope, sourceMode])

  const selectedDataset = datasets?.find(item => item.version === datasetVersion) ?? null
  const selectedModel = models?.find(item => item.modelId === modelId) ?? null
  const presetOptions = splits?.presets.filter(item => item.available) ?? []
  const selectedPreset = splits?.presets.find(item => item.id === splitPreset) ?? null
  const selectedSplit = splitSource === 'model' && splits?.modelSplit
    ? { preset: splits.modelSplit.splitPreset, sha: splits.modelSplit.memberSha256, partition: splits.modelSplit.partitions[partition] }
    : selectedPreset?.partitions
      ? { preset: selectedPreset.id, sha: selectedPreset.memberSha256 ?? '', partition: selectedPreset.partitions[partition] }
      : null

  async function submit() {
    if (!modelId || busy) return
    setBusy(true)
    setError('')
    try {
      if (sourceMode === 'csv') {
        if (!file) {
          setError('请选择无标签 CSV 文件。')
          return
        }
        onCreated(await createUnlabeledPrediction(file, { modelId, threshold }))
        return
      }
      if (!datasetVersion) return
      onCreated(await createPredictionBatch({
        datasetVersion, modelId, threshold,
        ...(scope === 'frozen'
          ? { partition, splitSource, splitPreset: splitSource === 'preset' ? splitPreset : undefined }
          : {}),
      }))
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(errorMessage(failure, '批量预测失败'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="mt-3 grid gap-5 rounded-xl border border-border-soft bg-card p-5 shadow-sm">
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground-2">批量来源</span>
      <NativeSelect aria-label="批量来源" value={sourceMode}
        onChange={event => { setSourceMode(event.target.value as 'dataset' | 'csv'); setError('') }}>
        <option value="dataset">数据版本</option>
        <option value="csv">无标签 CSV</option>
      </NativeSelect>
    </div>
    {sourceMode === 'dataset' ? <>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-2">数据版本</span>
          <Select value={datasetVersion} onValueChange={value => { setDatasetVersion(value); setSplits(null) }}>
            <SelectTrigger aria-label="预测数据版本">
              <SelectValue placeholder={datasets ? '选择数据' : '正在读取数据'}/>
            </SelectTrigger>
            <SelectContent>{(datasets ?? []).map(item => <SelectItem key={item.version} value={item.version}>
              {datasetVersionLabel(item.version).name} · {item.mine ? '我的数据' : '共享数据'}
            </SelectItem>)}</SelectContent>
          </Select>
        </label>
        <ModelSelect models={models} value={modelId} onChange={value => { setModelId(value); setSplits(null) }} />
      </div>
      {selectedDataset ? <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-xs text-foreground-3">
        <span>schema <code className="font-mono">{selectedDataset.schema}</code></span>
        <span>{countText(Number(selectedDataset.quality.includedRows))} 条</span>
        <span>正例 {countText(Number(selectedDataset.quality.positiveLabels))}</span>
      </div> : null}
      <SelectedModel model={selectedModel}/>
      {models && models.length === 0 ? <NoCompatibleModels datasetVersion={datasetVersion} navigate={navigate}/> : null}
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">评分范围</span>
        <NativeSelect aria-label="评分范围" value={scope}
          onChange={event => setScope(event.target.value as 'full' | 'frozen')} disabled={!modelId}>
          <option value="full">完整数据版本</option>
          <option value="frozen">固定分区</option>
        </NativeSelect>
      </label>
      {scope === 'frozen' ? <div className="grid gap-3 rounded-lg border border-border-soft p-3">
        {splitError ? <p className="text-xs text-rose-deep" role="alert">{splitError}</p> : null}
        {!splits && !splitError ? <LoadingNotice label="正在读取固定分区" prefix={false}/> : null}
        {splits ? <>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">分区来源</span>
            <NativeSelect aria-label="分区来源" value={splitSource}
              onChange={event => {
                const next = event.target.value as 'model' | 'preset'
                setSplitSource(next)
                const preset = presetOptions.find(item => item.id === (splits.modelSplit?.splitPreset ?? ''))
                  ?? presetOptions[0]
                setSplitPreset(next === 'model' ? splits.modelSplit?.splitPreset ?? '' : preset?.id ?? '')
              }}>
              <option value="model" disabled={!splits.modelSplit}>模型冻结分区</option>
              <option value="preset">时间切分预设</option>
            </NativeSelect>
          </label>
          {splitSource === 'preset' ? <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">切分预设</span>
            <NativeSelect aria-label="切分预设" value={splitPreset} onChange={event => setSplitPreset(event.target.value)}>
              {presetOptions.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
            </NativeSelect>
          </label> : null}
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">分区</span>
            <NativeSelect aria-label="预测分区" value={partition} onChange={event => setPartition(event.target.value as PredictionPartition)}>
              {(['train', 'validation', 'test'] as const).map(item => <option key={item} value={item}>{PARTITION_LABEL[item]}</option>)}
            </NativeSelect>
          </label>
          {selectedSplit && selectedSplit.partition ? <div className="grid gap-1 text-[11px] text-foreground-3">
            <span>{PARTITION_LABEL[partition]} {countText(selectedSplit.partition.count)} 条，正例 {countText(selectedSplit.partition.positives)}</span>
            <span>预设 {selectedSplit.preset ?? '未提供'} · 成员 {selectedSplit.sha.slice(0, 16)}</span>
          </div> : null}
        </> : null}
      </div> : null}
    </> : <>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">无标签 CSV</span>
        <Input aria-label="无标签 CSV" type="file" accept=".csv,text/csv"
          onChange={event => setFile(event.target.files?.[0] ?? null)} />
        <span className="text-[11px] text-foreground-4">表头必须包含所选模型的全部入模字段；不接受标签列。</span>
      </label>
      <ModelSelect models={models} value={modelId} onChange={setModelId} />
      <SelectedModel model={selectedModel}/>
    </>}
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground-2">初始分类阈值</span>
        <strong className="text-sm tabular-nums text-foreground">{threshold.toFixed(2)}</strong>
      </div>
      <Slider label="初始分类阈值" value={[Math.round(threshold * 100)]} onValueChange={values => setThreshold(values[0] / 100)}/>
    </div>
    {error ? <p className="rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">{error}</p> : null}
    <div className="flex justify-end">
      <Button type="button" disabled={!modelId || busy
        || (sourceMode === 'dataset'
          ? (!datasetVersion || (scope === 'frozen' && !selectedSplit))
          : !file)}
      onClick={() => void submit()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <Activity aria-hidden="true"/>}
        {busy ? '正在预测…' : '开始批量预测'}
      </Button>
    </div>
  </section>
}

type ProjectSelection = {
  repositoryId: string
  syncId: string
  commitId: string
  featureSchemaVersion: string | null
}

function SinglePredictionSetup({ datasets, initialDatasetVersion, navigate, onLoginRequired, onCreated }: {
  datasets: UserDataset[] | null
  initialDatasetVersion: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
  onCreated: (batch: PredictionBatch) => void
}) {
  const [sourceType, setSourceType] = useState<'dataset' | 'project' | 'manual'>('dataset')
  const [datasetVersion, setDatasetVersion] = useState(initialDatasetVersion)
  const [sample, setSample] = useState<PredictionSample | null>(null)
  const [projectSelection, setProjectSelection] = useState<ProjectSelection | null>(null)
  const [models, setModels] = useState<PredictionModel[] | null>(null)
  const [modelId, setModelId] = useState('')
  const [threshold, setThreshold] = useState(0.5)
  const [manualRecordId, setManualRecordId] = useState('')
  const [manualFeatures, setManualFeatures] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!datasetVersion && datasets?.length) setDatasetVersion(datasets[0].version)
  }, [datasetVersion, datasets])

  useEffect(() => {
    if ((sourceType === 'dataset' && !datasetVersion) || (sourceType === 'project' && !projectSelection?.featureSchemaVersion)) {
      setModels(sourceType === 'project' ? [] : null)
      setModelId('')
      return
    }
    const controller = new AbortController()
    setModels(null)
    const selector = sourceType === 'dataset'
      ? { datasetVersion }
      : sourceType === 'project'
        ? { schema: projectSelection?.featureSchemaVersion ?? '' }
        : null
    predictionModels(selector, controller.signal).then(({ models: items }) => {
      if (controller.signal.aborted) return
      setModels(items)
      setModelId(current => items.some(item => item.modelId === current)
        ? current : items[0]?.modelId ?? '')
    }).catch((failure) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(errorMessage(failure, '兼容模型读取失败'))
    })
    return () => controller.abort()
  }, [datasetVersion, onLoginRequired, projectSelection, sourceType])

  const selectedModel = models?.find(item => item.modelId === modelId) ?? null

  useEffect(() => {
    if (!selectedModel) return
    setManualFeatures(previous => Object.fromEntries(selectedModel.featureNames.map(name => [name, previous[name] ?? ''])))
  }, [selectedModel])

  async function submit() {
    if (!modelId || busy) return
    setBusy(true)
    setError('')
    try {
      if (sourceType === 'dataset') {
        if (!datasetVersion || !sample) {
          setError('请选择一个数据行。')
          return
        }
        onCreated(await createSinglePrediction({
          modelId, threshold,
          source: { kind: 'dataset', datasetVersion, recordId: sample.recordId },
        }))
      } else if (sourceType === 'project') {
        if (!projectSelection?.commitId) {
          setError('请选择项目分析中的提交。')
          return
        }
        onCreated(await createSinglePrediction({
          modelId, threshold,
          source: { kind: 'project', ...projectSelection },
        }))
      } else {
        if (!selectedModel) return
        const features: Record<string, number> = {}
        for (const name of selectedModel.featureNames) {
          const raw = (manualFeatures[name] ?? '').trim()
          const value = Number(raw)
          if (raw === '' || !Number.isFinite(value)) {
            setError(`字段 ${featureLabel(name)} 需要填写有限数值。`)
            return
          }
          features[name] = value
        }
        onCreated(await createSinglePrediction({
          modelId, threshold,
          source: { kind: 'manual', features, ...(manualRecordId.trim() ? { recordId: manualRecordId.trim() } : {}) },
        }))
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(errorMessage(failure, '单条预测失败'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="mt-3 grid gap-5 rounded-xl border border-border-soft bg-card p-5 shadow-sm">
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground-2">单条来源</span>
      <NativeSelect aria-label="单条来源" value={sourceType}
        onChange={event => {
          setSourceType(event.target.value as 'dataset' | 'project' | 'manual')
          setSample(null); setProjectSelection(null); setError('')
        }}>
        <option value="dataset">数据版本中的一行</option>
        <option value="project">项目分析中的提交</option>
        <option value="manual">手工填写特征</option>
      </NativeSelect>
    </label>
    {sourceType === 'dataset' ? <>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">数据版本</span>
        <Select value={datasetVersion} onValueChange={value => { setDatasetVersion(value); setSample(null) }}>
          <SelectTrigger aria-label="单条预测数据版本"><SelectValue placeholder={datasets ? '选择数据' : '正在读取数据'}/></SelectTrigger>
          <SelectContent>{(datasets ?? []).map(item => <SelectItem key={item.version} value={item.version}>
            {datasetVersionLabel(item.version).name} · {item.mine ? '我的数据' : '共享数据'}
          </SelectItem>)}</SelectContent>
        </Select>
      </label>
      {datasetVersion ? <DatasetSampleBrowser
        datasetVersion={datasetVersion}
        selectedRecordId={sample?.recordId ?? ''}
        onSelect={setSample}
      /> : null}
      <ModelSelect models={models} value={modelId} onChange={setModelId} />
      {models && models.length === 0 ? <NoCompatibleModels datasetVersion={datasetVersion} navigate={navigate}/> : null}
    </> : null}
    {sourceType === 'project' ? <>
      <ProjectCommitPicker selection={projectSelection} onSelect={setProjectSelection} />
      <ModelSelect models={models} value={modelId} onChange={setModelId} />
      {models && models.length === 0 ? <p className="rounded-lg border border-amber/25 bg-amber-soft px-3 py-2 text-xs text-amber-deep" role="status">
        该项目分析没有可用的兼容模型；请选择其他分析或登记兼容模型。
      </p> : null}
    </> : null}
    {sourceType === 'manual' ? <>
      <ModelSelect models={models} value={modelId} onChange={setModelId} />
      {models && models.length === 0 ? <p className="rounded-lg border border-amber/25 bg-amber-soft px-3 py-2 text-xs text-amber-deep" role="status">
        没有本人可见、已启用、ready 的可用模型。
      </p> : null}
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">记录标识（可选）</span>
        <Input aria-label="手工记录标识" value={manualRecordId} placeholder="例如 commit SHA 或自定义标识"
          onChange={event => setManualRecordId(event.target.value)}/>
      </label>
      {selectedModel ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {selectedModel.featureNames.map(name => <label key={name} className="grid gap-1.5">
          <span className="text-xs text-foreground-3">{featureLabel(name)} <code className="font-mono text-[10px]">{name}</code></span>
          <Input aria-label={`手工特征 ${name}`} inputMode="decimal" value={manualFeatures[name] ?? ''}
            onChange={event => setManualFeatures(previous => ({ ...previous, [name]: event.target.value }))}/>
        </label>)}
      </div> : null}
    </> : null}
    <SelectedModel model={selectedModel}/>
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground-2">初始分类阈值</span>
        <strong className="text-sm tabular-nums text-foreground">{threshold.toFixed(2)}</strong>
      </div>
      <Slider label="初始分类阈值" value={[Math.round(threshold * 100)]} onValueChange={values => setThreshold(values[0] / 100)}/>
    </div>
    {error ? <p className="rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">{error}</p> : null}
    <div className="flex justify-end">
      <Button type="button" disabled={!modelId || busy
        || (sourceType === 'dataset' && !sample)
        || (sourceType === 'project' && !projectSelection?.commitId)}
      onClick={() => void submit()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <Activity aria-hidden="true"/>}
        {busy ? '正在预测…' : '开始单条预测'}
      </Button>
    </div>
  </section>
}

function DatasetSampleBrowser({ datasetVersion, selectedRecordId, onSelect }: {
  datasetVersion: string
  selectedRecordId: string
  onSelect: (sample: PredictionSample) => void
}) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Awaited<ReturnType<typeof predictionSamples>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    predictionSamples(datasetVersion, { limit: SAMPLE_PAGE_SIZE, offset, search }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure, '数据行读取失败')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [datasetVersion, offset, search])

  useEffect(() => { setOffset(0); setSearch(''); setSearchInput('') }, [datasetVersion])

  return <div className="grid gap-2 rounded-lg border border-border-soft p-3">
    <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setOffset(0); setSearch(searchInput.trim()) }}>
      <Input aria-label="搜索数据行" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="搜索提交标识"/>
      <Button size="sm" variant="outline" type="submit"><Search aria-hidden="true"/>搜索</Button>
      <span className="ml-auto text-[11px] text-foreground-4">选择一行作为单条预测来源</span>
    </form>
    {error ? <p className="text-xs text-rose-deep" role="alert">{error}</p> : null}
    {loading && !page ? <LoadingNotice label="正在读取数据行" prefix={false}/> : null}
    {page && page.samples.length === 0 ? <p className="py-4 text-center text-xs text-foreground-4">没有匹配的数据行。</p> : null}
    {page && page.samples.length > 0 ? <Table>
      <TableHeader><TableRow>
        <TableHead>提交</TableHead><TableHead>时间</TableHead><TableHead>标签</TableHead><TableHead className="text-right">操作</TableHead>
      </TableRow></TableHeader>
      <TableBody>{page.samples.map(item => <TableRow key={item.recordId} data-state={item.recordId === selectedRecordId ? 'selected' : undefined}>
        <TableCell className="font-mono text-xs">{item.recordId.slice(0, 14)}</TableCell>
        <TableCell className="text-xs text-foreground-3">{item.authorTime ? formatDate(item.authorTime) : '—'}</TableCell>
        <TableCell className="text-xs">{item.label === null
          ? <span className="text-foreground-4">无标签 · {LABEL_STATUS[item.labelStatus] ?? item.labelStatus}</span>
          : <span>{item.label === 1 ? '1' : '0'} · {LABEL_STATUS[item.labelStatus] ?? item.labelStatus}</span>}</TableCell>
        <TableCell className="text-right"><Button size="sm" variant={item.recordId === selectedRecordId ? 'default' : 'outline'} type="button"
          aria-pressed={item.recordId === selectedRecordId} onClick={() => onSelect(item)}>
          {item.recordId === selectedRecordId ? '已选用' : '选用'}
        </Button></TableCell>
      </TableRow>)}</TableBody>
    </Table> : null}
    {page && page.total > SAMPLE_PAGE_SIZE ? <div className="flex items-center justify-between gap-2 text-xs text-foreground-3">
      <span>{offset + 1}–{Math.min(offset + page.samples.length, page.total)} / {countText(page.total)}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - SAMPLE_PAGE_SIZE))}><ChevronLeft aria-hidden="true"/></Button>
        <Button size="sm" variant="outline" type="button" disabled={offset + SAMPLE_PAGE_SIZE >= page.total} onClick={() => setOffset(offset + SAMPLE_PAGE_SIZE)}><ChevronRight aria-hidden="true"/></Button>
      </div>
    </div> : null}
  </div>
}

function ProjectCommitPicker({ selection, onSelect }: {
  selection: ProjectSelection | null
  onSelect: (selection: ProjectSelection) => void
}) {
  const repositories = useRepositories(true)
  const [repositoryId, setRepositoryId] = useState(selection?.repositoryId ?? '')
  const [syncs, setSyncs] = useState<SyncView[] | null>(null)
  const [syncId, setSyncId] = useState(selection?.syncId ?? '')
  const [commits, setCommits] = useState<SyncCommit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!repositoryId) { setSyncs([]); return }
    const controller = new AbortController()
    setSyncs(null); setSyncId(''); setCommits(null); setError('')
    fetchRepositorySyncsPage(repositoryId, 50, 0, controller.signal).then(page => {
      if (!controller.signal.aborted) setSyncs(page.syncs.filter(item => item.status === 'completed'))
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure, '项目分析读取失败')) })
    return () => controller.abort()
  }, [repositoryId])

  useEffect(() => {
    if (!syncId) { setCommits([]); setTotal(0); return }
    const controller = new AbortController()
    setCommits(null); setError('')
    fetchRepositorySyncCommits(syncId, 100, 0, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setCommits(page.commits)
      setTotal(page.total)
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure, '分析提交读取失败')) })
    return () => controller.abort()
  }, [syncId])

  const selectedSync = syncs?.find(item => item.syncId === syncId) ?? null
  return <div className="grid gap-3 rounded-lg border border-border-soft p-3">
    {error ? <p className="text-xs text-rose-deep" role="alert">{error}</p> : null}
    <div className="grid gap-3 md:grid-cols-2">
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">项目</span>
        <Select value={repositoryId} onValueChange={value => { setRepositoryId(value); onSelect({ repositoryId: value, syncId: '', commitId: '', featureSchemaVersion: null }) }}>
          <SelectTrigger aria-label="项目"><SelectValue placeholder={repositories.state === 'loading' ? '正在读取项目' : '选择项目'}/></SelectTrigger>
          <SelectContent>{repositories.items.map(item => <SelectItem key={item.repositoryId} value={item.repositoryId}>{item.displayName}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">已完成分析</span>
        <Select value={syncId} onValueChange={value => {
          setSyncId(value)
          onSelect({ repositoryId, syncId: value, commitId: '', featureSchemaVersion: syncs?.find(item => item.syncId === value)?.featureSchemaVersion ?? null })
        }} disabled={!syncs?.length}>
          <SelectTrigger aria-label="项目分析"><SelectValue placeholder={syncs === null ? '正在读取分析' : '选择分析'}/></SelectTrigger>
          <SelectContent>{(syncs ?? []).map(item => <SelectItem key={item.syncId} value={item.syncId}>
            {item.branch} · {item.updatedAt ? formatDate(item.updatedAt) : item.syncId.slice(0, 8)}
          </SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>
    {selectedSync ? <p className="text-[11px] text-foreground-3">schema <code className="font-mono">{selectedSync.featureSchemaVersion ?? '未记录'}</code> · 模型 <code className="font-mono">{selectedSync.modelId?.slice(0, 8) ?? '未记录'}</code></p> : null}
    {commits === null && syncId ? <LoadingNotice label="正在读取提交" prefix={false}/> : null}
    {commits && commits.length === 0 && syncId ? <p className="text-xs text-foreground-4">该分析没有可读取的提交。</p> : null}
    {commits && commits.length > 0 ? <div className="max-h-64 overflow-y-auto rounded-md border border-border-soft">
      <Table><TableHeader><TableRow><TableHead>提交</TableHead><TableHead>提交级预测分数</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>{commits.map(commit => <TableRow key={commit.commitId} data-state={selection?.commitId === commit.commitId ? 'selected' : undefined}>
          <TableCell><code className="font-mono text-xs">{commit.commitId.slice(0, 12)}</code><span className="ml-2 text-xs text-foreground-3">{commit.subject ?? ''}</span></TableCell>
          <TableCell className="tabular-nums text-xs">{scoreText(commit.risk)}</TableCell>
          <TableCell className="text-right"><Button size="sm" variant={selection?.commitId === commit.commitId ? 'default' : 'outline'} type="button"
            onClick={() => onSelect({
              repositoryId, syncId, commitId: commit.commitId,
              featureSchemaVersion: selectedSync?.featureSchemaVersion ?? null,
            })}>{selection?.commitId === commit.commitId ? '已选用' : '选用'}</Button></TableCell>
        </TableRow>)}</TableBody></Table>
    </div> : null}
    {commits && total > commits.length ? <p className="text-[11px] text-foreground-4">仅显示前 {commits.length} 条，共 {countText(total)} 条。</p> : null}
  </div>
}

function PredictionHistory({ batches, activeBatchId, loading, error, onRefresh, onOpen }: {
  batches: PredictionBatch[] | null
  activeBatchId?: string
  loading: boolean
  error: string
  onRefresh: () => void
  onOpen: (batchId: string) => void
}) {
  return <aside className="min-w-0 rounded-xl border border-border-soft bg-card shadow-sm">
    <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">预测记录</h2>
      <Button size="icon" variant="ghost" type="button" onClick={onRefresh} aria-label="刷新预测记录">
        <RefreshCw aria-hidden="true" size={15}/>
      </Button>
    </div>
    <div className="max-h-[68vh] overflow-y-auto p-2">
      {error ? <p className="px-2 py-2 text-xs text-rose-deep" role="alert">{error}</p> : null}
      {loading ? <LoadingNotice label="正在读取预测记录" prefix={false}/>
        : batches && batches.length === 0 ? <p className="px-2 py-8 text-center text-xs text-foreground-3">还没有预测记录。</p>
          : <div className="grid gap-1">{batches?.map(item => <Button key={item.batchId} variant="ghost" type="button"
            aria-current={item.batchId === activeBatchId ? 'page' : undefined}
            className={cn('flex h-auto w-full min-w-0 flex-col items-stretch gap-0 rounded-lg border px-3 py-2.5 text-left transition-colors',
              item.batchId === activeBatchId ? 'border-accent/35 bg-accent-soft' : 'border-transparent hover:bg-sunken')}
            onClick={() => onOpen(item.batchId)}>
            <span className="flex items-center justify-between gap-2">
              <strong className="truncate text-xs text-foreground">{item.dataset}</strong>
              <span className="shrink-0 text-[10px] tabular-nums text-foreground-4">{formatDate(item.createdAt)}</span>
            </span>
            <span className="mt-1 flex items-center gap-2 text-[10px] text-foreground-4">
              <Badge variant="outline">{item.mode === 'single' ? '单条' : '批量'}</Badge>
              <span className="truncate">{item.source.label}</span>
            </span>
            <span className="mt-1 block truncate text-[11px] text-foreground-3">{item.model.name}</span>
            <span className="mt-1 flex items-center gap-2 text-[10px] text-foreground-4">
              <span>{countText(item.counts.records)} 条</span>
              <span>阈值 {item.threshold.toFixed(2)}</span>
            </span>
          </Button>)}</div>}
    </div>
  </aside>
}

function PredictionDetail({ batchId, navigate, onLoginRequired }: {
  batchId: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [detail, setDetail] = useState<PredictionBatchDetail | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tick, setTick] = useState(50)
  const [tickBatchId, setTickBatchId] = useState('')
  const [sort, setSort] = useState<'risk' | 'time'>('risk')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [activeExplanation, setActiveExplanation] = useState<PredictionRecord | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null); setError('')
    predictionBatch(batchId, { limit: PAGE_SIZE, offset, sort, search }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        setDetail(value)
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(errorMessage(failure, '预测结果读取失败'))
      })
    return () => controller.abort()
  }, [attempt, batchId, offset, onLoginRequired, search, sort])

  useEffect(() => { setOffset(0); setSearch(''); setSearchInput(''); setActiveExplanation(null) }, [batchId])

  useEffect(() => {
    if (detail && detail.batchId !== tickBatchId) {
      setTick(Math.round(detail.threshold * 100))
      setTickBatchId(detail.batchId)
    }
  }, [detail, tickBatchId])

  if (error) return <div className="rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
    {error} <Button size="sm" variant="outline" type="button" onClick={() => setAttempt(value => value + 1)}>重试读取</Button>
  </div>
  if (detail === null) return <LoadingNotice label="正在读取预测结果"/>

  const metrics = thresholdMetrics(detail.thresholdPreview, tick)
  const total = detail.counts.records
  const evaluationRoute: Route | null = detail.evaluationEligible ? {
    name: 'my-evaluation',
    batchId: detail.batchId,
    modelId: detail.model.modelId,
    ...(detail.datasetVersion ? { datasetVersion: detail.datasetVersion } : {}),
    ...(detail.partition ? { partition: detail.partition } : {}),
    ...(detail.splitPreset ? { splitPreset: detail.splitPreset } : {}),
  } : null
  return <>
    <section className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{detail.mode === 'single' ? '单条预测' : '批量预测'}</Badge>
              <span className="text-xs text-foreground-3">{detail.source.label}</span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{detail.dataset}</h2>
            {detail.datasetVersion ? <code className="mt-1 block break-all font-mono text-[11px] text-foreground-4">{detail.datasetVersion}</code> : null}
          </div>
          <div className="text-right text-xs text-foreground-3">
            <strong className="block text-sm text-foreground">{detail.model.name}</strong>
            <span>{detail.model.method ?? '方法未提供'}</span>
            <span className="mt-1 block">{formatDate(detail.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground-4">
          <span>schema <code className="font-mono">{detail.model.featureSchemaVersion}</code></span>
          <span>运行 <code className="font-mono">{detail.model.runId?.slice(0, 12) ?? '未提供'}</code></span>
          {detail.partition ? <span>分区 {PARTITION_LABEL[detail.partition]}</span> : null}
          {detail.splitPreset ? <span>预设 {detail.splitPreset}</span> : null}
          {detail.memberSha256 ? <span>成员 {detail.memberSha256.slice(0, 16)}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/v1/user/prediction-batches/${encodeURIComponent(detail.batchId)}/export`} download>
              <Download aria-hidden="true"/>导出 CSV
            </a>
          </Button>
          {evaluationRoute ? <Button size="sm" type="button" onClick={() => navigate(evaluationRoute)}>去评估</Button> : null}
        </div>
        {!detail.evaluationEligible ? <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-foreground-3">{detail.evaluationReason}；可直接查看或导出。</p> : null}
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border-soft border-t border-border-soft sm:grid-cols-4 sm:divide-y-0">
        <MetricCell label="预测记录" value={countText(detail.counts.records)}/>
        <MetricCell label="可用真实标签" value={countText(detail.counts.labeledAvailable)}/>
        <MetricCell label="当前阈值告警" value={countText(metrics.flagged)}/>
        <MetricCell label="无标签记录" value={countText(detail.counts.unavailable)}/>
      </dl>
    </section>

    <section className="grid gap-3 rounded-xl border border-border-soft bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">结果表</h2>
          <p className="mt-0.5 text-[11px] text-foreground-4">分类按当前阈值实时重算，不重新调用模型。</p>
        </div>
        <output className="rounded-lg bg-sunken px-3 py-1.5 text-sm font-semibold tabular-nums">阈值 {(tick / 100).toFixed(2)}</output>
      </div>
      <Slider label="分类阈值" value={[tick]} onValueChange={values => setTick(values[0])}/>
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); setOffset(0); setSearch(searchInput.trim()) }}>
          <Input aria-label="搜索预测记录" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="搜索样本或提交标识"/>
          <Button size="sm" variant="outline" type="submit"><Search aria-hidden="true"/>搜索</Button>
        </form>
        <label className="ml-auto flex items-center gap-2 text-xs text-foreground-3">
          排序
          <NativeSelect aria-label="预测结果排序" size="sm" value={sort}
            onChange={event => { setSort(event.target.value as 'risk' | 'time'); setOffset(0) }}>
            <option value="risk">提交级预测分数</option>
            <option value="time">时间</option>
          </NativeSelect>
        </label>
      </div>
      {detail.records.length === 0 ? <p className="py-8 text-center text-xs text-foreground-4">没有匹配的记录。</p>
        : <Table>
          <TableHeader><TableRow>
            <TableHead>样本 / 提交</TableHead>
            <TableHead>提交级预测分数</TableHead>
            <TableHead>当前阈值分类</TableHead>
            <TableHead>真实标签</TableHead>
            <TableHead>时间 / 来源</TableHead>
            <TableHead className="text-right">特征归因</TableHead>
          </TableRow></TableHeader>
          <TableBody>{detail.records.map(record => {
            const flagged = record.risk >= tick / 100
            return <TableRow key={record.predictionId}>
              <TableCell><code className="font-mono text-xs">{record.recordId}</code></TableCell>
              <TableCell className="font-semibold tabular-nums">{scoreText(record.risk)}</TableCell>
              <TableCell><span className={cn('rounded-full px-2 py-0.5 text-xs', flagged ? 'bg-rose-soft text-rose-deep' : 'bg-sunken text-foreground-3')}>
                {flagged ? '达到阈值' : '未达到阈值'}
              </span></TableCell>
              <TableCell className="text-xs">{record.label === null
                ? <span className="text-foreground-4">无标签 · {LABEL_STATUS[record.labelStatus] ?? record.labelStatus}</span>
                : <span>{record.label} · {LABEL_STATUS[record.labelStatus] ?? record.labelStatus}</span>}</TableCell>
              <TableCell className="text-xs text-foreground-3">{record.authorTime ? formatDate(record.authorTime) : '时间未提供'}<span className="mt-0.5 block text-foreground-4">{detail.source.label}</span></TableCell>
              <TableCell className="text-right">{record.explanation
                ? <Button size="sm" variant="ghost" type="button" onClick={() => setActiveExplanation(record)}>查看归因</Button>
                : <span className="text-[11px] text-foreground-4">无归因</span>}</TableCell>
            </TableRow>
          })}</TableBody>
        </Table>}
      {total > PAGE_SIZE ? <div className="flex items-center justify-between gap-2 text-xs text-foreground-3">
        <span>{offset + 1}–{Math.min(offset + detail.records.length, total)} / {countText(total)}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft aria-hidden="true"/></Button>
          <Button size="sm" variant="outline" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}><ChevronRight aria-hidden="true"/></Button>
        </div>
      </div> : null}
    </section>

    <section className="rounded-xl border border-amber/20 bg-amber-soft p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-deep"><ShieldAlert aria-hidden="true" size={15}/>结果边界</div>
      <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-amber-deep/90">
        {detail.limitations.map(item => <li key={item} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-amber"/><span>{item}</span></li>)}
      </ul>
    </section>

    <Dialog open={Boolean(activeExplanation)} onOpenChange={next => { if (!next) setActiveExplanation(null) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>特征归因</DialogTitle>
          <DialogDescription>
            {activeExplanation ? `${activeExplanation.recordId} · 提交级预测分数 ${scoreText(activeExplanation.risk)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {activeExplanation?.explanation ? <>
          <p className="text-sm leading-6 text-foreground-2">{activeExplanation.explanation.summary}</p>
          <Table>
            <TableHeader><TableRow><TableHead>特征</TableHead><TableHead>本次值</TableHead><TableHead>基线</TableHead><TableHead>贡献</TableHead></TableRow></TableHeader>
            <TableBody>{activeExplanation.explanation.items.map(item => <TableRow key={item.feature}>
              <TableCell>{featureLabel(item.feature)} <code className="font-mono text-[10px] text-foreground-4">{item.feature}</code></TableCell>
              <TableCell className="tabular-nums">{item.value.toFixed(4)}</TableCell>
              <TableCell className="tabular-nums">{item.baseline.toFixed(4)}</TableCell>
              <TableCell className={cn('tabular-nums', item.delta > 0 ? 'text-rose-deep' : 'text-teal-deep')}>
                {item.delta > 0 ? '+' : ''}{item.delta.toFixed(6)}
              </TableCell>
            </TableRow>)}</TableBody>
          </Table>
          <p className="text-xs text-foreground-4">特征归因说明模型对输入的敏感度，不是缺陷原因。</p>
        </> : <p className="text-sm text-foreground-3">该记录没有保存特征归因。</p>}
      </DialogContent>
    </Dialog>
  </>
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return <div className="px-4 py-3"><dt className="text-[10px] text-foreground-4">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</dd></div>
}
