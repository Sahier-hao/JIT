import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import {
  ACTIVE_TASK_STATUSES, cancelTrainingTask, fetchTrainingTask, fetchTrainingTasks,
  retryTrainingTask, formatDate, valueLabel, type TrainingTask,
} from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice, MetricGrid } from './AdminShared'

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '训练中', succeeded: '成功', failed: '失败',
  cancelled: '已取消', interrupted: '已中断',
}

export function AdminTrainingPage({ taskId, navigate, expired }: {
  taskId?: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [tasks, setTasks] = useState<TrainingTask[]>([])
  const [task, setTask] = useState<TrainingTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)

  const handleFailure = useCallback((failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) expired()
    else setError(failure instanceof Error ? failure.message : fallback)
  }, [expired])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        if (taskId) {
          const current = await fetchTrainingTask(taskId, controller.signal)
          if (controller.signal.aborted) return
          setTask(current)
          if (ACTIVE_TASK_STATUSES.includes(current.status)) timer = window.setTimeout(load, 3000)
        } else {
          const page = await fetchTrainingTasks(20, 0, controller.signal)
          if (controller.signal.aborted) return
          setTasks(page.tasks)
          if (page.tasks.some(item => ACTIVE_TASK_STATUSES.includes(item.status))) timer = window.setTimeout(load, 3000)
        }
        setError('')
      } catch (failure) {
        if (!controller.signal.aborted) handleFailure(failure, '训练任务读取失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [taskId, handleFailure, revision])

  async function act(id: string, action: 'cancel' | 'retry') {
    setBusy(id); setError('')
    try {
      const result = action === 'cancel' ? await cancelTrainingTask(id) : await retryTrainingTask(id)
      if (action === 'retry') navigate({ name: 'admin', view: 'training', resourceId: result.taskId })
      else setTask(result)
    } catch (failure) { handleFailure(failure, action === 'cancel' ? '取消失败' : '重试失败') }
    finally { setBusy('') }
  }

  if (loading) return <LoadingNotice label="正在读取训练任务"/>
  if (error && !tasks.length && !task) return <EmptyState title="训练任务不可用" description={error}><Button onClick={() => navigate({ name: 'admin', view: 'training' })}>重试</Button></EmptyState>
  if (task) return <TrainingTaskDetail task={task} error={error} busy={busy} act={act} back={() => navigate({ name: 'admin', view: 'training' })}/>
  return <section>
    <AdminPageHeader title="训练任务" intro="从已登记数据集训练指定方法，并核对指标、运行与模型谱系。" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    {!tasks.length ? <p className="quiet-empty">尚无训练任务。请从数据集详情创建。</p> : <div className="admin-table-wrap"><table className="admin-table admin-task-table">
      <thead><tr><th>数据集</th><th>方法</th><th>状态</th><th>时间</th><th><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{tasks.map(item => <tr key={item.taskId}>
        <td><strong>{item.datasetVersion}</strong><small>{item.metricSet}</small></td>
        <td>{item.method}</td>
        <td><span className="source-chip">{STATUS_LABELS[item.status]}</span>{item.queuePosition ? <small>队列 {item.queuePosition}</small> : item.status === 'running' ? <small>{item.stage}</small> : item.error ? <small>{item.error.message}</small> : null}</td>
        <td>{formatDate(item.createdAt)}</td>
        <td><Button size="sm" onClick={() => navigate({ name: 'admin', view: 'training', resourceId: item.taskId })}>查看</Button></td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}

function TrainingTaskDetail({ task, error, busy, act, back }: {
  task: TrainingTask
  error: string
  busy: string
  act: (id: string, action: 'cancel' | 'retry') => Promise<void>
  back: () => void
}) {
  const active = ACTIVE_TASK_STATUSES.includes(task.status)
  const retryable = ['failed', 'cancelled', 'interrupted'].includes(task.status)
  return <section>
    <AdminPageHeader title="训练任务详情" intro={`${task.datasetVersion} · ${task.method}`}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="admin-detail-actions"><Button onClick={back}>返回任务列表</Button>{active ? <Button danger disabled={!!busy || !!task.cancelRequestedAt} onClick={() => void act(task.taskId, 'cancel')}>{task.cancelRequestedAt ? '正在取消…' : '取消任务'}</Button> : retryable ? <Button disabled={!!busy} onClick={() => void act(task.taskId, 'retry')}>重试</Button> : null}</div>
    <div className="admin-status-line"><span className="source-chip">{STATUS_LABELS[task.status]}</span><span>{task.stage}</span>{task.queuePosition ? <span>队列位置 {task.queuePosition}</span> : null}</div>
    {task.error ? <div className="admin-error-box" role="alert"><strong>{task.error.code}</strong><p>{task.error.message}</p></div> : null}
    {task.status === 'succeeded' ? <><MetricGrid metrics={task.metrics}/><dl className="admin-facts">
      <div><dt>数据版本</dt><dd><code>{task.datasetVersion}</code></dd></div>
      <div><dt>业务运行</dt><dd><code>{valueLabel(task.runId)}</code></dd></div>
      <div><dt>原产物运行</dt><dd><code>{valueLabel(task.artifactRunId)}</code></dd></div>
      <div><dt>模型</dt><dd><code>{valueLabel(task.modelId)}</code></dd></div>
      <div><dt>特征 schema</dt><dd>{valueLabel(task.featureSchemaVersion)}</dd></div>
      <div><dt>产物位置</dt><dd><code>{valueLabel(task.artifactKey)}</code></dd></div>
    </dl></> : null}
    <dl className="admin-facts">
      <div><dt>父任务</dt><dd><code>{task.parentTaskId ?? '无'}</code></dd></div>
      <div><dt>创建人</dt><dd>{task.createdBy}</dd></div>
      <div><dt>创建时间</dt><dd>{formatDate(task.createdAt)}</dd></div>
      <div><dt>开始时间</dt><dd>{formatDate(task.startedAt)}</dd></div>
      <div><dt>完成时间</dt><dd>{formatDate(task.completedAt)}</dd></div>
    </dl>
  </section>
}
