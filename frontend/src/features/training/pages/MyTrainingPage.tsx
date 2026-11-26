import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ChevronDown, LoaderCircle, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { publishTrainingExperiment } from '@/features/account/activeJobs'
import { queryKeys } from '@/lib/queryKeys'
import { ApiError } from '@/lib/apiContract'
import { formatDate, type TrainingExperiment, type TrainingExperimentComparison, type TrainingTask } from '@/features/admin/adminContracts'
import {
  cancelUserTask, registerUserExperiment, retryUserTask, userComparison, userExperiment,
  userExperiments, useUserRevision,
} from '@/features/account/userClient'


import type { Route } from '@/app/navigation'
import { TrainingCreateDialog } from '@/features/training/components/TrainingCreateDialog'
import { TrainingExperimentList } from '@/features/training/components/TrainingExperimentList'
import { TrainingExperimentMonitor } from '@/features/training/components/TrainingExperimentMonitor'
import { CardListSkeleton } from '@/components/shared/Skeletons'
import { EmptyState } from '@/components/shared/Feedback'
import { cn } from '@/lib/utils'
import { datasetVersionLabel, splitPresetLabel } from '@/lib/datasetLabel'
import { isActiveTraining, trainingStatus } from '@/features/training/trainingPresentation'
import { TrainingComparisonResults } from '@/features/training/components/TrainingComparisonResults'
import { comparisonExportText, fetchThresholdEvaluation, type ThresholdEvaluation, type ThresholdRequest } from '@/features/training/trainingComparison'

export function MyTrainingPage({ account = null, experimentId, initialDatasetVersion, initialMethod, initialSchema, historyDatasetVersion, navigate, onLoginRequired }: {
  account?: string | null
  experimentId?: string
  initialDatasetVersion?: string
  initialMethod?: string
  initialSchema?: string
  historyDatasetVersion?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const client = useQueryClient()
  const [experiment, setExperiment] = useState<TrainingExperiment | null>(() => experimentId
    ? client.getQueryData<TrainingExperiment>(queryKeys.userTrainingExperiment(account, experimentId)) ?? null
    : null)
  const [comparison, setComparison] = useState<TrainingExperimentComparison | null>(null)
  const [comparisonError, setComparisonError] = useState('')
  const [comparisonRevision, setComparisonRevision] = useState(0)
  const [list, setList] = useState<TrainingExperiment[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(Boolean(initialDatasetVersion || initialMethod || initialSchema))
  const userRevision = useUserRevision()
  const returnToList = () => navigate({ name: 'my-training', ...(historyDatasetVersion ? { historyDatasetVersion } : {}) })

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let active = false
    let activeExperimentId: string | undefined
    async function load() {
      try {
        const requestedId = experimentId ?? activeExperimentId
        if (requestedId) {
          const next = await userExperiment(requestedId, controller.signal)
          if (controller.signal.aborted) return
          if (experimentId) {
            setExperiment(next)
            client.setQueryData(queryKeys.userTrainingExperiment(account, experimentId), next)
          } else {
            setList(previous => previous?.map(item => item.experimentId === requestedId ? next : item) ?? null)
          }
          active = next.tasks.some(task => isActiveTraining(task.status))
        } else {
          const value = await userExperiments(controller.signal)
          if (controller.signal.aborted) return
          setList(value)
          activeExperimentId = value.find(item => isActiveTraining(item.status))?.experimentId
          active = activeExperimentId !== undefined
        }
        setError('')
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '训练记录读取失败')
      } finally {
        if (active && !controller.signal.aborted) timer = setTimeout(load, 3000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [account, client, experimentId, revision, userRevision, onLoginRequired])

  const comparisonKey = experiment?.experimentId === experimentId && experiment
    && experiment.tasks.filter(task => task.status === 'succeeded').length >= 2
    ? JSON.stringify(experiment.tasks.map(task => [task.taskId, task.status, task.modelId])) : null
  useEffect(() => {
    if (!experimentId || comparisonKey === null) return
    const controller = new AbortController()
    setComparison(null)
    setComparisonError('')
    userComparison(experimentId, controller.signal).then(result => {
      if (!controller.signal.aborted) setComparison(result)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setComparisonError(failure instanceof Error ? failure.message : '读取比较结果失败')
    })
    return () => controller.abort()
  }, [experimentId, comparisonKey, comparisonRevision, onLoginRequired])

  async function act(task: TrainingTask, action: 'cancel' | 'retry') {
    setBusy(task.taskId); setError('')
    try {
      if (action === 'cancel') {
        await cancelUserTask(task.taskId)
      } else {
        const attempt = await retryUserTask(task.taskId)
        if (experiment && attempt.experimentId === experiment.experimentId) {
          const tasks = experiment.tasks.map(item => item.taskId === task.taskId ? attempt : item)
          const status = tasks.some(item => item.status === 'running') ? 'running'
            : tasks.some(item => item.status === 'queued') ? 'queued' : experiment.status
          const next = { ...experiment, tasks, status }
          setExperiment(next)
          publishTrainingExperiment(client, account, next)
        }
      }
      setRevision(value => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '操作失败')
    } finally { setBusy('') }
  }
  async function register() {
    if (!experiment) return
    setBusy('register'); setError('')
    try { await registerUserExperiment(experiment.experimentId); setRevision(value => value + 1) }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '登记失败')
    } finally { setBusy('') }
  }
  async function evaluateThresholds(request: ThresholdRequest, signal: AbortSignal) {
    if (!comparison || comparison.experimentId !== experimentId) throw new Error('训练实验已切换，请重新选择')
    try {
      return await fetchThresholdEvaluation(comparison, 'user', request, signal)
    } catch (failure) {
      if (!signal.aborted && failure instanceof ApiError && failure.status === 401) onLoginRequired()
      throw failure
    }
  }

  function exportComparison(evaluation?: ThresholdEvaluation) {
    if (!comparison) return
    const blob = new Blob([comparisonExportText(comparison, evaluation)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `my-experiment-${comparison.experimentId}.json`; anchor.click()
    URL.revokeObjectURL(url)
  }

  if (error && (experimentId ? experiment?.experimentId !== experimentId : !list)) return <EmptyState title="训练记录读取失败" description={error} tone="alert">
    <Button onClick={() => { setError(''); setRevision(value => value + 1) }} variant="outline" type="button">重新读取</Button>
    {experimentId ? <Button onClick={returnToList} variant="ghost" type="button">返回训练列表</Button> : null}
  </EmptyState>
  if (!experimentId) {
    const records = historyDatasetVersion ? list?.filter(item => item.datasetVersion === historyDatasetVersion) : list
    return <section className="mx-auto grid w-full max-w-[68rem] min-w-0 grid-cols-1 gap-4">
      <WorkspacePageHeader title="我的训练"
        meta={historyDatasetVersion ? <span className="font-mono text-xs [overflow-wrap:anywhere]">{historyDatasetVersion}</span> : undefined}
        actions={<>
          {historyDatasetVersion ? <Button variant="ghost" onClick={() => navigate({ name: 'my-training' })} type="button">查看全部训练</Button> : null}
          <Button onClick={() => setCreateOpen(true)} type="button"><Plus aria-hidden="true"/>开始训练</Button>
        </>}/>
      {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      {!records ? <CardListSkeleton label="正在读取训练记录" rows={3}/> : records.length === 0
        ? <EmptyState title={historyDatasetVersion ? '这个数据版本还没有训练记录' : '还没有训练记录'}><Button variant="outline" onClick={() => navigate({ name: 'my-data', ...(historyDatasetVersion ? { datasetVersion: historyDatasetVersion } : {}) })} type="button">{historyDatasetVersion ? '打开数据版本' : '管理我的数据'}</Button></EmptyState>
        : <TrainingExperimentList records={records} navigate={navigate} historyDatasetVersion={historyDatasetVersion}/>}
      <TrainingCreateDialog open={createOpen} onOpenChange={setCreateOpen} initialDatasetVersion={initialDatasetVersion ?? historyDatasetVersion} initialMethod={initialMethod} preferredSchema={initialSchema}
        onOpenData={() => { setCreateOpen(false); navigate({ name: 'my-data' }) }}
        onCreated={created => {
          publishTrainingExperiment(client, account, created)
          navigate({ name: 'my-training', experimentId: created.experimentId, ...(historyDatasetVersion ? { historyDatasetVersion } : {}) })
        }} onLoginRequired={onLoginRequired}/>
    </section>
  }
  if (!experiment || experiment.experimentId !== experimentId) return <section className="grid gap-4"><CardListSkeleton label="正在读取训练实验" rows={2}/></section>

  const pendingRegistration = experiment.tasks.some(task => task.status === 'succeeded' && !task.modelId)
  const registeredCount = experiment.tasks.filter(task => task.modelId).length
  const methodCount = new Set(experiment.tasks.map(task => task.method)).size
  const succeededCount = experiment.tasks.filter(task => task.status === 'succeeded').length
  const dataset = datasetVersionLabel(experiment.datasetVersion)
  const status = trainingStatus[experiment.status]
  const compared = comparisonKey !== null && comparison?.experimentId === experimentId ? comparison : null
  const showComparisonFirst = experiment.status === 'succeeded' && compared !== null
  const registration = pendingRegistration ? <Button className="justify-self-start" size="sm" disabled={!!busy} onClick={() => void register()} type="button">
    {busy === 'register' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : null}登记为可用模型
  </Button> : null
  const comparisonPanel = compared
    ? <TrainingComparisonResults key={`comparison-${experimentId}`} comparison={compared}
      onExport={exportComparison} onEvaluateThresholds={evaluateThresholds}/>
    : comparisonKey !== null && !comparisonError
      ? <p key="loading-comparison" role="status" className="text-xs text-foreground-3">正在读取比较结果…</p> : null
  const monitor = <TrainingExperimentMonitor key={experimentId} experiment={experiment} busy={busy}
    onOpenDataset={() => navigate({ name: 'my-data', datasetVersion: experiment.datasetVersion })}
    onOpenAlgorithm={method => navigate({ name: 'algorithms', method })}
    onAction={(task, action) => void act(task, action)} registration={showComparisonFirst ? null : registration}/>

  const overview = <section aria-label="实验概览" className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card">
    <dl className="grid grid-cols-1 gap-px bg-border-soft sm:grid-cols-2 xl:grid-cols-4 [&>div]:min-w-0 [&>div]:bg-card [&>div]:px-4 [&>div]:py-3">
      <div>
        <dt className="text-xs text-foreground-3">数据</dt>
        <dd className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]" title={experiment.datasetVersion}>{dataset.name}</dd>
        {dataset.range ? <dd className="mt-0.5 text-xs text-foreground-3">{dataset.range}</dd> : null}
      </div>
      <div>
        <dt className="text-xs text-foreground-3">时间切分</dt>
        <dd className="mt-0.5 text-sm tabular-nums">{splitPresetLabel(experiment.splitPreset)}</dd>
      </div>
      <div>
        <dt className="text-xs text-foreground-3">模型</dt>
        <dd className="mt-0.5 text-sm">{methodCount} 个，已完成 {succeededCount} 个</dd>
      </div>
      <div>
        <dt className="text-xs text-foreground-3">登记</dt>
        <dd className="mt-0.5 text-sm">{registeredCount ? `已登记 ${registeredCount} 个` : '尚未登记'}</dd>
      </div>
    </dl>
  </section>

  return <section className="grid min-w-0 grid-cols-1 gap-5">
    <WorkspacePageHeader title="训练实验" meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={cn('inline-flex items-center gap-1.5 font-medium', status.color)}>
        <span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden="true"/>
        {status.label}
      </span>
      <span>创建于 {formatDate(experiment.createdAt)}</span>
    </span>} actions={<>
      <Button variant="ghost" size="sm" onClick={returnToList} type="button"><ArrowLeft aria-hidden="true"/>返回训练列表</Button>
      {registeredCount ? <Button variant="outline" size="sm" onClick={() => navigate({ name: 'my-models' })} type="button">查看我的模型</Button> : null}
      {showComparisonFirst ? registration : null}
    </>}/>
    {overview}
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    {comparisonError ? <div className="flex flex-wrap items-center gap-2 text-xs text-rose"><p role="alert">{comparisonError}</p><Button size="sm" onClick={() => setComparisonRevision(value => value + 1)} variant="outline" type="button">重试比较</Button></div> : null}
    {showComparisonFirst ? [comparisonPanel, <details key="training-monitor" className="group min-w-0 rounded-xl border border-border-soft bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
        训练过程与单模型结果 <ChevronDown aria-hidden="true" className="size-4 text-foreground-3 group-open:rotate-180"/>
      </summary>
      <div className="min-w-0 border-t border-border-soft p-3 sm:p-4">{monitor}</div>
    </details>] : [monitor, comparisonPanel]}
  </section>
}
