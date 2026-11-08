import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import {
  ACTIVE_TASK_STATUSES, cancelTrainingTask, fetchTrainingTask, fetchTrainingTasks,
  retryTrainingTask, formatDate, valueLabel, type Row, type TrainingTask,
} from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice, MetricGrid } from './AdminShared'

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '训练中', succeeded: '成功', failed: '失败',
  cancelled: '已取消', interrupted: '已中断',
}
const PAGE_SIZE = 20

export function AdminTrainingPage({ taskId, navigate, expired }: {
  taskId?: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [tasks, setTasks] = useState<TrainingTask[]>([])
  const [task, setTask] = useState<TrainingTask | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)

  const handleFailure = useCallback((failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) expired()
    else setError(failure instanceof Error ? failure.message : fallback)
  }, [expired])
  const retryLoad = useCallback(() => {
    setError(''); setLoading(true); setRevision(value => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    setLoading(true)
    const load = async () => {
      try {
        if (taskId) {
          const current = await fetchTrainingTask(taskId, controller.signal)
          if (controller.signal.aborted) return
          setTask(current)
          if (ACTIVE_TASK_STATUSES.includes(current.status)) timer = window.setTimeout(load, 3000)
        } else {
          const result = await fetchTrainingTasks(PAGE_SIZE, page * PAGE_SIZE, controller.signal)
          if (controller.signal.aborted) return
          setTasks(result.tasks)
          setTotal(result.total)
          if (page > 0 && result.tasks.length === 0 && result.total > 0) {
            setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1))
            return
          }
          if (result.tasks.some(item => ACTIVE_TASK_STATUSES.includes(item.status))) timer = window.setTimeout(load, 3000)
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
  }, [taskId, page, handleFailure, revision])

  useEffect(() => { if (!taskId) setTask(null) }, [taskId])

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
  if (error && !taskId && !tasks.length) return <EmptyState title="训练任务不可用" description={error}><Button onClick={retryLoad}>重试</Button></EmptyState>
  if (error && taskId && task?.taskId !== taskId) return <EmptyState title="训练任务不可用" description={error}><Button onClick={retryLoad}>重试</Button><Button onClick={() => navigate({ name: 'admin', view: 'training' })}>返回任务列表</Button></EmptyState>
  if (taskId && task?.taskId === taskId) return <TrainingTaskDetail task={task} error={error} busy={busy} act={act} retry={retryLoad} back={() => navigate({ name: 'admin', view: 'training' })} openRuns={() => navigate({ name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', artifactState: 'complete' })} openModel={modelId => navigate({ name: 'admin', view: 'models', resourceId: modelId })} openExperiment={id => navigate({ name: 'admin', view: 'training-experiment', resourceId: id })}/>
  return <section>
    <AdminPageHeader title="训练任务" onRefresh={retryLoad}/>
    <ErrorNotice>{error}</ErrorNotice>
    {error ? <div className="admin-detail-actions"><Button size="sm" onClick={retryLoad}>重新读取</Button></div> : null}
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
    {total > PAGE_SIZE ? <div className="admin-detail-actions">
      <Button size="sm" disabled={page <= 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>第 {page + 1} 页 · 共 {total} 条</span>
      <Button size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(value => value + 1)}>下一页</Button>
    </div> : null}
  </section>
}

function TrainingTaskDetail({ task, error, busy, act, retry, back, openRuns, openModel, openExperiment }: {
  task: TrainingTask
  error: string
  busy: string
  act: (id: string, action: 'cancel' | 'retry') => Promise<void>
  retry: () => void
  back: () => void
  openRuns: () => void
  openModel: (modelId: string) => void
  openExperiment: (experimentId: string) => void
}) {
  const active = ACTIVE_TASK_STATUSES.includes(task.status)
  const retryable = ['failed', 'cancelled', 'interrupted'].includes(task.status)
  return <section>
    <AdminPageHeader title="训练任务详情" meta={`${task.datasetVersion} · ${task.method}`}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="admin-detail-actions"><Button onClick={back}>返回任务列表</Button>{error ? <Button onClick={retry}>重新读取</Button> : null}{task.status === 'succeeded' ? <><Button onClick={openRuns}>查看实验登记</Button>{task.modelId ? <Button onClick={() => openModel(task.modelId!)}>查看模型</Button> : null}</> : null}{active ? <Button danger disabled={!!busy || !!task.cancelRequestedAt} onClick={() => void act(task.taskId, 'cancel')}>{task.cancelRequestedAt ? '正在取消…' : '取消任务'}</Button> : retryable ? <Button disabled={!!busy} onClick={() => void act(task.taskId, 'retry')}>重试</Button> : null}</div>
    <div className="admin-status-line"><span className="source-chip">{STATUS_LABELS[task.status]}</span><span>{task.stage}</span>{task.queuePosition ? <span>队列位置 {task.queuePosition}</span> : null}</div>
    {task.error ? <div className="admin-error-box" role="alert"><strong>{task.error.code}</strong><p>{task.error.message}</p></div> : null}
    {task.status === 'succeeded' ? <><MetricGrid metrics={task.metrics}/><dl className="admin-facts">
      <div><dt>数据版本</dt><dd><code>{task.datasetVersion}</code></dd></div>
      <div><dt>业务运行</dt><dd><code>{valueLabel(task.runId)}</code></dd></div>
      <div><dt>原产物运行</dt><dd><code>{valueLabel(task.artifactRunId)}</code></dd></div>
      <div><dt>模型</dt><dd><code>{valueLabel(task.modelId)}</code></dd></div>
      <div><dt>特征 schema</dt><dd>{valueLabel(task.featureSchemaVersion)}</dd></div>
      <div><dt>时间切分预设</dt><dd><code>{task.splitPreset}</code></dd></div>
      <div><dt>实际参数</dt><dd><code>{task.parameters ? JSON.stringify(task.parameters) : '默认参数（未记录覆盖）'}</code></dd></div>
      {task.experimentId ? <div><dt>所属实验</dt><dd><Button size="sm" onClick={() => openExperiment(task.experimentId!)}>查看实验</Button></dd></div> : null}
      <div><dt>产物位置</dt><dd><code>{valueLabel(task.artifactKey)}</code></dd></div>
      {task.splitRule ? <div><dt>切分规则</dt><dd>{task.splitRule}</dd></div> : null}
      {task.dataScale ? <div><dt>数据规模</dt><dd>{valueLabel(task.dataScale.records)} 条 · {valueLabel(task.dataScale.featureWidth)} 维</dd></div> : null}
      {task.trainingPerformance ? <div><dt>训练性能</dt><dd>{typeof task.trainingPerformance.durationSeconds === 'number' ? `${task.trainingPerformance.durationSeconds.toFixed(2)} 秒` : '耗时未记录'} · {typeof task.trainingPerformance.recordsPerSecond === 'number' ? `${task.trainingPerformance.recordsPerSecond.toFixed(1)} 条/秒` : '吞吐未记录'}</dd></div> : null}
      {task.classPolicy ? <div><dt>训练分区策略</dt><dd><code>{JSON.stringify(task.classPolicy)}</code></dd></div> : null}
      {task.classPolicySummary ? <div><dt>策略前后数量</dt><dd><code>{JSON.stringify(task.classPolicySummary)}</code></dd></div> : null}
    </dl>
    {task.metricsByPartition ? <TrainingPartitions metrics={task.metricsByPartition}/> : null}
    {task.trainingHistory ? <section className="admin-training-partitions"><h2>训练过程</h2>
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>epoch</th><th>训练损失</th><th>耗时</th></tr></thead>
        <tbody>{task.trainingHistory.entries.map(entry => <tr key={entry.epoch}>
          <td>{entry.epoch}</td>
          <td>{entry.trainLoss == null ? '未记录' : entry.trainLoss.toFixed(4)}</td>
          <td>{entry.seconds.toFixed(2)} 秒</td>
        </tr>)}</tbody>
      </table></div>
      <p className="admin-report-meta">固定 {task.trainingHistory.epochs} 个 epoch，不早停；测试分区不参与逐 epoch 监控。</p>
    </section> : task.status === 'succeeded' ? <p className="admin-report-meta">未记录逐 epoch 训练历史：该方法可能是非迭代方法，或产物产生于历史版本。</p> : null}
    {task.classPolicy ? <p className="admin-report-meta">测试指标不因训练分区策略而可直接比较。</p> : null}</> : null}
    <dl className="admin-facts">
      <div><dt>父任务</dt><dd><code>{task.parentTaskId ?? '无'}</code></dd></div>
      <div><dt>创建人</dt><dd>{task.createdBy}</dd></div>
      <div><dt>创建时间</dt><dd>{formatDate(task.createdAt)}</dd></div>
      <div><dt>开始时间</dt><dd>{formatDate(task.startedAt)}</dd></div>
      <div><dt>完成时间</dt><dd>{formatDate(task.completedAt)}</dd></div>
    </dl>
  </section>
}

function TrainingPartitions({ metrics }: { metrics: Row }) {
  const partitions = [
    ['train', '拟合诊断'],
    ['validation', '模型选择背景'],
    ['test', '冻结泛化评价'],
  ] as const
  return <section className="admin-training-partitions"><h2>分区指标</h2><div className="admin-detail-grid">
    {partitions.map(([name, label]) => {
      const part = metrics[name]
      return <section key={name}><h2>{label}</h2>{part && typeof part === 'object' ? <MetricGrid metrics={part as Row}/> : <p className="quiet-empty">未记录</p>}</section>
    })}
  </div></section>
}
