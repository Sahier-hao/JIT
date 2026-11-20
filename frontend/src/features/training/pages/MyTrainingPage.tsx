import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ArrowLeft, LoaderCircle, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { formatDate, type TrainingExperiment, type TrainingExperimentComparison, type TrainingTask } from '@/features/admin/adminContracts'
import {
  cancelUserTask, registerUserExperiment, retryUserTask, userComparison, userExperiment,
  userExperiments, useUserRevision,
} from '@/features/account/userClient'


import { formatMethodParams } from '@/lib/methodParams'
import type { Route } from '@/app/navigation'
import { TrainingCreateDialog } from '@/features/training/components/TrainingCreateDialog'
import { TrainingExperimentList } from '@/features/training/components/TrainingExperimentList'
import { TrainingExperimentMonitor, trainingMetric } from '@/features/training/components/TrainingExperimentMonitor'
import { CardListSkeleton } from '@/components/shared/Skeletons'
import { EmptyState } from '@/components/shared/Feedback'
import { isActiveTraining, trainingStatus } from '@/features/training/trainingPresentation'

export function MyTrainingPage({ experimentId, initialDatasetVersion, navigate, onLoginRequired }: {
  experimentId?: string
  initialDatasetVersion?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [experiment, setExperiment] = useState<TrainingExperiment | null>(null)
  const [comparison, setComparison] = useState<TrainingExperimentComparison | null>(null)
  const [comparisonError, setComparisonError] = useState('')
  const [comparisonRevision, setComparisonRevision] = useState(0)
  const [list, setList] = useState<TrainingExperiment[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(Boolean(initialDatasetVersion))
  const userRevision = useUserRevision()

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
          if (experimentId) setExperiment(next)
          else setList(previous => previous?.map(item => item.experimentId === requestedId ? next : item) ?? null)
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
  }, [experimentId, revision, userRevision, onLoginRequired])

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
      await (action === 'cancel' ? cancelUserTask(task.taskId) : retryUserTask(task.taskId))
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
  function exportComparison() {
    if (!comparison) return
    const blob = new Blob([JSON.stringify(comparison, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `my-experiment-${comparison.experimentId}.json`; anchor.click()
    URL.revokeObjectURL(url)
  }

  if (error && (experimentId ? experiment?.experimentId !== experimentId : !list)) return <EmptyState title="训练记录读取失败" description={error} tone="alert">
    <Button onClick={() => { setError(''); setRevision(value => value + 1) }} variant="outline" type="button">重新读取</Button>
    {experimentId ? <Button onClick={() => navigate({ name: 'my-training' })} variant="ghost" type="button">返回训练列表</Button> : null}
  </EmptyState>
  if (!experimentId) return <section className="grid min-w-0 grid-cols-1 gap-4">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft pb-3">
      <h1 className="text-xl font-semibold leading-title text-foreground">我的训练</h1>
      <Button size="sm" onClick={() => setCreateOpen(true)} type="button"><Plus aria-hidden="true"/>开始训练</Button>
    </header>
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    {list === null ? <CardListSkeleton label="正在读取训练记录" rows={3}/> : list.length === 0
      ? <EmptyState title="还没有训练记录"><Button variant="outline" onClick={() => navigate({ name: 'my-data' })} type="button">管理我的数据</Button></EmptyState>
      : <TrainingExperimentList records={list} navigate={navigate}/>}
    <TrainingCreateDialog open={createOpen} onOpenChange={setCreateOpen} initialDatasetVersion={initialDatasetVersion} onCreated={experimentId => navigate({ name: 'my-training', experimentId })} onLoginRequired={onLoginRequired}/>
  </section>
  if (!experiment || experiment.experimentId !== experimentId) return <section className="grid gap-4"><CardListSkeleton label="正在读取训练实验" rows={2}/></section>

  const pendingRegistration = experiment.tasks.some(task => task.status === 'succeeded' && !task.modelId)
  return <section className="grid min-w-0 grid-cols-1 gap-5">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border-soft pb-3">
      <div><h1 className="text-xl font-semibold leading-title text-foreground">训练实验</h1>
        <p className="mt-1 text-xs text-foreground-3">创建于 {formatDate(experiment.createdAt)}</p></div>
      <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-training' })} type="button"><ArrowLeft aria-hidden="true"/>返回训练列表</Button>
    </header>
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    <TrainingExperimentMonitor key={experimentId} experiment={experiment} busy={busy} onAction={(task, action) => void act(task, action)}
      registration={pendingRegistration ? <Button className="justify-self-start" size="sm" disabled={!!busy} onClick={() => void register()} type="button">
        {busy === 'register' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : null}登记本次模型
      </Button> : null}/>
    {comparisonKey !== null ? <section className="grid min-w-0 gap-3 rounded-xl border border-border-soft bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">测试集结果比较</h2>
        {comparison ? <Button onClick={exportComparison} variant="outline" size="sm" type="button">导出比较</Button> : null}
      </div>
      {comparisonError ? <div className="flex flex-wrap items-center gap-2 text-xs text-rose"><p role="alert">{comparisonError}</p><Button size="sm" onClick={() => setComparisonRevision(value => value + 1)} variant="outline" type="button">重试比较</Button></div> : null}
      {!comparison && !comparisonError ? <p role="status" className="text-xs text-foreground-3">正在读取比较结果…</p> : null}
      {comparison?.notes.map(note => <p key={note} className="text-xs text-foreground-3">{note}</p>)}
      {comparison ? <div className="overflow-x-auto"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1.5"><TableHeader><TableRow><TableHead>方法</TableHead><TableHead>参数</TableHead><TableHead>PR-AUC</TableHead><TableHead>ROC-AUC</TableHead><TableHead>F1</TableHead><TableHead>耗时</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>
        {comparison.methods.filter(row => row.status === 'succeeded').map(row => <TableRow key={row.taskId}><TableCell>{row.methodName}</TableCell><TableCell>{formatMethodParams(row.parameters)}</TableCell><TableCell>{trainingMetric(row.metrics, 'averagePrecision')}</TableCell><TableCell>{trainingMetric(row.metrics, 'rocAuc')}</TableCell><TableCell>{trainingMetric(row.metrics, 'f1')}</TableCell><TableCell>{row.trainingSeconds == null ? '—' : `${row.trainingSeconds.toFixed(2)}s`}</TableCell><TableCell>{trainingStatus[row.status].label}</TableCell></TableRow>)}
      </TableBody></Table></div> : null}
    </section> : null}
  </section>
}
