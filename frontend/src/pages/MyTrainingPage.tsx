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

  if (error && !experiment && !list) return <section className="grid gap-4"><p className="text-xs text-rose" role="alert">{error}</p></section>
  if (!experimentId) return <section className="grid gap-4">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-soft pb-3"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">我的训练</h1><span className="text-xs text-foreground-3">单 worker · 同时最多一个活动实验</span></header>
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    {list === null ? <p className="py-6 text-center text-xs text-foreground-3">正在读取训练记录…</p> : list.length === 0
      ? <div className="grid justify-items-start gap-2 rounded-sm border border-border-soft p-4"><p className="text-sm text-foreground-3">还没有训练记录。先到「我的数据」选择一个版本发起训练。</p><Button variant="primary" onClick={() => navigate({ name: 'my-data' })}>选择数据</Button></div>
      : <div className="grid gap-2">{list.map(item => <button key={item.experimentId} className="grid gap-0.5 rounded-sm border border-border-soft bg-card p-2.5 text-left text-xs hover:bg-hover" onClick={() => navigate({ name: 'my-training', experimentId: item.experimentId })}>
        <strong className="truncate text-sm font-medium text-foreground">{item.datasetVersion}</strong><span className="text-foreground-3">{valueLabel(item.status)} · {item.tasks.length} 个方法 · {item.splitPreset}</span><code className="break-all font-mono text-[11px] text-foreground-4">{item.experimentId}</code>
      </button>)}</div>}
  </section>
  if (!experiment) return <section className="grid gap-4"><p className="py-6 text-center text-xs text-foreground-3">正在读取实验…</p></section>

  const historyTasks = experiment.tasks.filter(task => task.trainingHistory)
  return <section className="grid gap-4">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft pb-3"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">训练实验</h1><nav className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-training' })}>返回训练列表</Button><Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-data' })}>我的数据</Button></nav></header>
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
      <div><dt>数据版本</dt><dd><code>{experiment.datasetVersion}</code></dd></div>
      <div><dt>切分</dt><dd>{experiment.splitPreset}</dd></div>
      <div><dt>状态</dt><dd>{valueLabel(experiment.status)}</dd></div>
      <div><dt>创建</dt><dd>{formatDate(experiment.createdAt)}</dd></div>
    </dl>
    <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">子任务</h2>
      {experiment.tasks.map(task => <div key={task.taskId} className="grid gap-1.5 border-t border-border-soft pt-2 first:border-t-0 first:pt-0">
        <div className="flex flex-wrap items-baseline gap-2"><strong className="text-sm font-medium text-foreground">{task.method}</strong><span className="text-xs text-foreground-3">{valueLabel(task.status)}</span><code className="break-all font-mono text-[11px] text-foreground-4">{paramsText(task.parameters)}</code></div>
        {task.error ? <p className="text-xs text-rose">{task.error.code} · {task.error.message}</p> : null}
        {task.metrics ? <p className="text-xs tabular-nums text-foreground-3">PR-AUC {metric(task.metrics, 'averagePrecision')} · ROC-AUC {metric(task.metrics, 'rocAuc')} · F1 {metric(task.metrics, 'f1')} · P/R {metric(task.metrics, 'precision')}/{metric(task.metrics, 'recall')}</p> : null}
        {task.trainingHistory ? null : task.status === 'succeeded' ? <p className="text-xs text-foreground-4">该方法是单次拟合，无逐 epoch 曲线。</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {ACTIVE.has(task.status) ? <Button size="sm" variant="danger" loading={busy === task.taskId} onClick={() => void act(task, 'cancel')}>取消</Button> : null}
          {['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button size="sm" loading={busy === task.taskId} onClick={() => void act(task, 'retry')}>重试</Button> : null}
          {task.modelId ? <span className="rounded-sm bg-teal-soft px-1.5 py-0.5 text-[11px] text-teal-deep">已登记模型</span> : task.status === 'succeeded' ? <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">待登记</span> : null}
        </div>
      </div>)}
      <Button variant="primary" loading={busy === 'register'} disabled={!experiment.tasks.some(task => task.status === 'succeeded' && !task.modelId)} onClick={() => void register()}>登记本次模型</Button>
    </section>
    {historyTasks.length ? <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">训练曲线</h2>{historyTasks.map(task => <div key={task.taskId} className="grid gap-1"><p className="text-xs text-foreground-3">{task.method}</p><LossChart task={task}/></div>)}</section> : null}
    <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">比较</h2>
      {comparison?.notes.map(note => <p key={note} className="text-xs text-foreground-3">{note}</p>)}
      {comparison ? <div className="overflow-x-auto"><table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1.5"><thead><tr><th>方法</th><th>参数</th><th>PR-AUC</th><th>ROC-AUC</th><th>F1</th><th>耗时</th><th>状态</th></tr></thead><tbody>
        {comparison.methods.map(row => <tr key={row.taskId}><td>{row.methodName}</td><td>{paramsText(row.parameters)}</td><td>{metric(row.metrics, 'averagePrecision')}</td><td>{metric(row.metrics, 'rocAuc')}</td><td>{metric(row.metrics, 'f1')}</td><td>{row.trainingSeconds == null ? '未记录' : `${row.trainingSeconds.toFixed(2)}s`}</td><td>{row.error ? row.error.code : valueLabel(row.status)}</td></tr>)}
      </tbody></table></div> : null}
      <div className="flex flex-wrap items-center gap-2"><Button onClick={exportComparison} disabled={!comparison}>导出比较</Button></div>
    </section>
    <Disclosure summary="训练与模型口径">
      <p className="text-xs leading-body text-foreground-3">三档指标来自各自运行的冻结分区；训练成功不自动登记模型，登记后只对本人可见并可在本人项目中选用。分数未经当前仓库概率校准，不是缺陷概率。</p>
    </Disclosure>
  </section>
}
