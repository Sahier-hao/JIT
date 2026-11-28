import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { publishTrainingExperiment } from '@/features/account/activeJobs'
import { queryKeys } from '@/lib/queryKeys'
import { ApiError } from '@/lib/apiContract'
import { formatDate, type TrainingExperiment, type TrainingTask } from '@/features/admin/adminContracts'
import {
  cancelUserTask, registerUserExperimentTask, retryUserTask, userExperiment,
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
  async function register(task: TrainingTask) {
    if (!experiment) return
    setBusy(task.taskId); setError('')
    try {
      await registerUserExperimentTask(experiment.experimentId, task.taskId)
      setRevision(value => value + 1)
    }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '登记失败')
    } finally { setBusy('') }
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

  const registeredCount = experiment.tasks.filter(task => task.modelId).length
  const methodCount = new Set(experiment.tasks.map(task => task.method)).size
  const succeededCount = experiment.tasks.filter(task => task.status === 'succeeded').length
  const dataset = datasetVersionLabel(experiment.datasetVersion)
  const status = trainingStatus[experiment.status]
  const monitor = <TrainingExperimentMonitor key={experimentId} experiment={experiment} busy={busy}
    onOpenDataset={() => navigate({ name: 'my-data', datasetVersion: experiment.datasetVersion })}
    onOpenAlgorithm={method => navigate({ name: 'algorithms', method })}
    onAction={(task, action) => void act(task, action)}
    onRegister={task => void register(task)}
    onEvaluate={task => navigate({
      name: 'model-evaluation',
      source: 'training',
      experimentId: experiment.experimentId,
      taskId: task.taskId,
      modelId: task.modelId ?? undefined,
    })}/>

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
        <dt className="text-xs text-foreground-3">模型库</dt>
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
      {registeredCount ? <Button variant="outline" size="sm" onClick={() => navigate({ name: 'my-models' })} type="button">查看模型库</Button> : null}
    </>}/>
    {overview}
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    {monitor}
  </section>
}
