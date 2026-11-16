import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../apiContract'
import { formatDate, valueLabel, type Row, type TrainingExperiment, type TrainingExperimentComparison, type TrainingTask } from '../adminContracts'
import {
  cancelUserTask, registerUserExperiment, retryUserTask, userComparison, userExperiment,
  userExperiments, useUserRevision,
} from '../userClient'
import { Button } from '../ui/controls'
import { Disclosure } from '../ui/controls'
import { EChartCanvas, useChartColors } from '../ui/chart'
import type { Route } from '../navigation'
import '../styles/user-workspace.css'

const ACTIVE = new Set(['queued', 'running'])

function metric(metrics: Row | null, key: string): string {
  const item = metrics?.[key]
  if (item == null) return '未定义'
  if (typeof item === 'number') return item.toFixed(3)
  const value = (item as Row).value
  return typeof value === 'number' ? value.toFixed(3) : '未定义'
}
function paramsText(parameters: Row | null): string {
  if (!parameters) return '默认参数'
  return Object.entries(parameters).filter(([key]) => !['threads', 'seed', 'solver', 'tol', 'regularization', 'class_weight'].includes(key))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(',')}]` : value}`).join(' · ')
}
function LossChart({ task }: { task: TrainingTask }) {
  const colors = useChartColors()
  const history = task.trainingHistory
  const option = useMemo(() => ({
    grid: { left: 46, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis' as const, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.textStrong } },
    xAxis: { type: 'category' as const, data: history?.entries.map(item => String(item.epoch)) ?? [], axisLabel: { color: colors.text }, name: 'epoch', nameTextStyle: { color: colors.text } },
    yAxis: { type: 'value' as const, scale: true, axisLabel: { color: colors.text }, splitLine: { lineStyle: { color: colors.grid } }, name: 'train loss', nameTextStyle: { color: colors.text } },
    series: [{ type: 'line' as const, symbolSize: 4, data: history?.entries.map(item => item.trainLoss), lineStyle: { color: colors.series }, itemStyle: { color: colors.series } }],
  }), [colors, history])
  return history ? <EChartCanvas option={option} height={200} label={`${task.method} 逐 epoch 训练损失`}/> : null
}

export function MyTrainingPage({ experimentId, navigate, onLoginRequired }: {
  experimentId?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [experiment, setExperiment] = useState<TrainingExperiment | null>(null)
  const [comparison, setComparison] = useState<TrainingExperimentComparison | null>(null)
  const [list, setList] = useState<TrainingExperiment[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const userRevision = useUserRevision()

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    async function load() {
      try {
        if (experimentId) {
          const next = await userExperiment(experimentId, controller.signal)
          if (controller.signal.aborted) return
          setExperiment(next)
          const compared = await userComparison(experimentId, controller.signal)
          if (!controller.signal.aborted) setComparison(compared)
          if (next.tasks.some(task => ACTIVE.has(task.status))) timer = setTimeout(load, 3000)
        } else {
          const value = await userExperiments(controller.signal)
          if (!controller.signal.aborted) setList(value)
        }
        setError('')
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '训练记录读取失败')
      }
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [experimentId, revision, userRevision, onLoginRequired])

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

  if (error && !experiment && !list) return <section className="user-workspace"><p className="field-error" role="alert">{error}</p></section>
  if (!experimentId) return <section className="user-workspace">
    <header className="user-page-head"><h1>我的训练</h1><span>单 worker · 同时最多一个活动实验</span></header>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {list === null ? <p className="quiet-empty">正在读取训练记录…</p> : list.length === 0
      ? <div className="user-empty"><p>还没有训练记录。先到「我的数据」选择一个版本发起训练。</p><Button variant="primary" onClick={() => navigate({ name: 'my-data' })}>选择数据</Button></div>
      : <div className="user-experiment-list">{list.map(item => <button key={item.experimentId} className="user-experiment-card" onClick={() => navigate({ name: 'my-training', experimentId: item.experimentId })}>
        <strong>{item.datasetVersion}</strong><span>{valueLabel(item.status)} · {item.tasks.length} 个方法 · {item.splitPreset}</span><code>{item.experimentId}</code>
      </button>)}</div>}
  </section>
  if (!experiment) return <section className="user-workspace"><p className="quiet-empty">正在读取实验…</p></section>

  const historyTasks = experiment.tasks.filter(task => task.trainingHistory)
  return <section className="user-workspace">
    <header className="user-page-head"><h1>训练实验</h1><nav><Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-training' })}>返回训练列表</Button><Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-data' })}>我的数据</Button></nav></header>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <dl className="admin-facts">
      <div><dt>数据版本</dt><dd><code>{experiment.datasetVersion}</code></dd></div>
      <div><dt>切分</dt><dd>{experiment.splitPreset}</dd></div>
      <div><dt>状态</dt><dd>{valueLabel(experiment.status)}</dd></div>
      <div><dt>创建</dt><dd>{formatDate(experiment.createdAt)}</dd></div>
    </dl>
    <section className="user-panel"><h2>子任务</h2>
      {experiment.tasks.map(task => <div key={task.taskId} className="user-task">
        <div><strong>{task.method}</strong> <span>{valueLabel(task.status)}</span><code>{paramsText(task.parameters)}</code></div>
        {task.error ? <p className="field-error">{task.error.code} · {task.error.message}</p> : null}
        {task.metrics ? <p className="user-metrics">PR-AUC {metric(task.metrics, 'averagePrecision')} · ROC-AUC {metric(task.metrics, 'rocAuc')} · F1 {metric(task.metrics, 'f1')} · P/R {metric(task.metrics, 'precision')}/{metric(task.metrics, 'recall')}</p> : null}
        {task.trainingHistory ? null : task.status === 'succeeded' ? <p className="quiet-empty">该方法是单次拟合，无逐 epoch 曲线。</p> : null}
        <div className="user-inline">
          {ACTIVE.has(task.status) ? <Button size="sm" variant="danger" loading={busy === task.taskId} onClick={() => void act(task, 'cancel')}>取消</Button> : null}
          {['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button size="sm" loading={busy === task.taskId} onClick={() => void act(task, 'retry')}>重试</Button> : null}
          {task.modelId ? <span className="source-chip">已登记模型</span> : task.status === 'succeeded' ? <span className="source-chip">待登记</span> : null}
        </div>
      </div>)}
      <Button variant="primary" loading={busy === 'register'} disabled={!experiment.tasks.some(task => task.status === 'succeeded' && !task.modelId)} onClick={() => void register()}>登记本次模型</Button>
    </section>
    {historyTasks.length ? <section className="user-panel"><h2>训练曲线</h2>{historyTasks.map(task => <div key={task.taskId}><p className="quiet-empty">{task.method}</p><LossChart task={task}/></div>)}</section> : null}
    <section className="user-panel"><h2>比较</h2>
      {comparison?.notes.map(note => <p key={note} className="quiet-empty">{note}</p>)}
      {comparison ? <div className="user-table-scroll"><table className="user-table"><thead><tr><th>方法</th><th>参数</th><th>PR-AUC</th><th>ROC-AUC</th><th>F1</th><th>耗时</th><th>状态</th></tr></thead><tbody>
        {comparison.methods.map(row => <tr key={row.taskId}><td>{row.methodName}</td><td>{paramsText(row.parameters)}</td><td>{metric(row.metrics, 'averagePrecision')}</td><td>{metric(row.metrics, 'rocAuc')}</td><td>{metric(row.metrics, 'f1')}</td><td>{row.trainingSeconds == null ? '未记录' : `${row.trainingSeconds.toFixed(2)}s`}</td><td>{row.error ? row.error.code : valueLabel(row.status)}</td></tr>)}
      </tbody></table></div> : null}
      <div className="user-inline"><Button onClick={exportComparison} disabled={!comparison}>导出比较</Button></div>
    </section>
    <Disclosure summary="训练与模型口径">
      <p className="quiet-empty">三档指标来自各自运行的冻结分区；训练成功不自动登记模型，登记后只对本人可见并可在本人项目中选用。分数未经当前仓库概率校准，不是缺陷概率。</p>
    </Disclosure>
  </section>
}
