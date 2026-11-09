import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../apiContract'
import {
  cancelTrainingTask, fetchTrainingExperiment, fetchTrainingExperimentComparison,
  formatDate, retryTrainingTask, valueLabel,
  type Row, type TrainingExperiment, type TrainingExperimentComparison, type TrainingTask,
} from '../../adminContracts'
import { Button, Select } from '../../ui/controls'
import { Disclosure } from '../../ui/controls'
import { EChartCanvas, useChartColors } from '../../ui/chart'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

const ACTIVE = new Set(['queued', 'running'])

function metric(metrics: Row | null, key: string): string {
  const item = metrics?.[key]
  if (item == null) return '未定义'
  if (typeof item === 'number') return item.toFixed(3)
  if (typeof item !== 'object') return valueLabel(item)
  const value = (item as Row).value
  if (typeof value === 'number') return value.toFixed(3)
  return typeof (item as Row).reason === 'string' ? String((item as Row).reason) : '未定义'
}

function paramsText(parameters: Row | null): string {
  if (!parameters) return '默认参数'
  return Object.entries(parameters)
    .filter(([key]) => !['threads', 'seed', 'solver', 'tol', 'regularization', 'class_weight'].includes(key))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(',')}]` : value}`)
    .join(' · ')
}

function LossChart({ task }: { task: TrainingTask }) {
  const colors = useChartColors()
  const history = task.trainingHistory
  const option = useMemo(() => ({
    grid: { left: 46, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis' as const, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.textStrong } },
    xAxis: { type: 'category' as const, data: history?.entries.map(item => String(item.epoch)) ?? [], axisLabel: { color: colors.text }, axisLine: { lineStyle: { color: colors.axis } }, name: 'epoch', nameTextStyle: { color: colors.text } },
    yAxis: { type: 'value' as const, scale: true, axisLabel: { color: colors.text }, splitLine: { lineStyle: { color: colors.grid } }, name: 'train loss', nameTextStyle: { color: colors.text } },
    series: [{ type: 'line' as const, smooth: false, showSymbol: true, symbolSize: 4, data: history?.entries.map(item => item.trainLoss), lineStyle: { color: colors.series }, itemStyle: { color: colors.series } }],
  }), [colors, history])
  if (!history) return null
  return <EChartCanvas option={option} height={200} label={`${task.method} 逐 epoch 训练损失`}/>
}

export function AdminTrainingExperimentPage({ experimentId, navigate, expired }: {
  experimentId: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [experiment, setExperiment] = useState<TrainingExperiment | null>(null)
  const [comparison, setComparison] = useState<TrainingExperimentComparison | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [historyMethod, setHistoryMethod] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    async function load() {
      try {
        const [next, compared] = await Promise.all([
          fetchTrainingExperiment(experimentId, controller.signal),
          fetchTrainingExperimentComparison(experimentId, controller.signal),
        ])
        if (controller.signal.aborted) return
        setExperiment(next); setComparison(compared); setError('')
        if (next.tasks.some(task => ACTIVE.has(task.status))) {
          timer = setTimeout(load, 3000)
        }
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '实验读取失败')
      }
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [experimentId, revision, expired])

  async function cancel(task: TrainingTask) {
    setBusy(task.taskId); setError('')
    try { await cancelTrainingTask(task.taskId); setRevision(value => value + 1) }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '取消失败')
    } finally { setBusy('') }
  }
  async function retry(task: TrainingTask) {
    setBusy(task.taskId); setError('')
    try { await retryTrainingTask(task.taskId); setRevision(value => value + 1) }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '重试失败')
    } finally { setBusy('') }
  }
  function exportComparison() {
    if (!comparison) return
    const blob = new Blob([JSON.stringify(comparison, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `training-experiment-${comparison.experimentId}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!experiment) return <section>
    <AdminPageHeader title="训练实验"/>
    <ErrorNotice>{error}</ErrorNotice>
    {!error ? <p className="admin-report-meta">正在读取实验…</p> : null}
  </section>

  const historyTasks = experiment.tasks.filter(task => task.trainingHistory)
  const selectedHistory = historyTasks.find(task => task.taskId === historyMethod) ?? historyTasks[0]
  const counts = experiment.statusCounts
  return <section>
    <AdminPageHeader title="训练实验" meta={experiment.datasetVersion}/>
    <div className="admin-detail-actions">
      <Button onClick={() => navigate({ name: 'admin', view: 'datasets' })}>返回数据集</Button>
      <Button onClick={() => navigate({ name: 'admin', view: 'experiment-runs' })}>登记实验运行</Button>
      <Button onClick={exportComparison} disabled={!comparison}>导出比较</Button>
    </div>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="admin-detail-grid">
      <section><h2>实验身份</h2><dl className="admin-facts">
        <div><dt>数据版本</dt><dd>{experiment.datasetVersion}</dd></div>
        <div><dt>manifest SHA-256</dt><dd><code>{experiment.manifestSha256}</code></dd></div>
        <div><dt>切分预设</dt><dd>{experiment.splitPreset}</dd></div>
        <div><dt>指标集</dt><dd>{experiment.metricSet}</dd></div>
        <div><dt>类别策略</dt><dd>{experiment.classPolicy ? valueLabel(experiment.classPolicy.kind) : '不处理'}</dd></div>
        <div><dt>种子</dt><dd>{experiment.seed}</dd></div>
        <div><dt>创建</dt><dd>{formatDate(experiment.createdAt)}</dd></div>
        <div><dt>训练用户</dt><dd>{experiment.ownerUserId ?? '管理员'}</dd></div>
      </dl></section>
      <section><h2>子任务</h2><dl className="admin-facts">
        <div><dt>状态</dt><dd>{valueLabel(experiment.status)}</dd></div>
        {['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].map(key =>
          <div key={key}><dt>{valueLabel(key)}</dt><dd>{counts[key] ?? 0}</dd></div>)}
      </dl></section>
    </div>
    <section className="admin-train-panel"><h2>子任务与真实训练过程</h2>
      {experiment.tasks.map(task => <div key={task.taskId} className="admin-experiment-task">
        <div className="admin-experiment-task-head">
          <strong>{task.method}</strong>
          <span>{valueLabel(task.status)}{task.queuePosition ? ` · 队列第 ${task.queuePosition} 位` : ''}</span>
          <span className="admin-report-meta">{paramsText(task.parameters)}</span>
        </div>
        {task.error ? <p className="admin-inline-error">{task.error.code} · {task.error.message}</p> : null}
        {task.metrics ? <p className="admin-report-meta">
          PR-AUC {metric(task.metrics, 'averagePrecision')} · ROC-AUC {metric(task.metrics, 'rocAuc')} ·
          F1 {metric(task.metrics, 'f1')} · P {metric(task.metrics, 'precision')} / R {metric(task.metrics, 'recall')} ·
          耗时 {task.trainingPerformance?.durationSeconds == null ? '未记录' : `${Number(task.trainingPerformance.durationSeconds).toFixed(2)}s`}
        </p> : null}
        {task.trainingHistory ? null : task.status === 'succeeded'
          ? <p className="admin-report-meta">该方法是单次拟合，无逐 epoch 曲线。</p> : null}
        <div className="admin-train-form">
          <Button size="sm" onClick={() => navigate({ name: 'admin', view: 'training', resourceId: task.taskId })}>任务详情</Button>
          {ACTIVE.has(task.status) ? <Button size="sm" variant="danger" loading={busy === task.taskId} onClick={() => void cancel(task)}>取消</Button> : null}
          {['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button size="sm" loading={busy === task.taskId} onClick={() => void retry(task)}>重试</Button> : null}
        </div>
      </div>)}
    </section>
    {historyTasks.length ? <section className="admin-train-panel"><h2>训练曲线</h2>
      <div className="admin-train-form">
        <Select ariaLabel="训练曲线方法" value={selectedHistory?.taskId ?? ''} onChange={setHistoryMethod}
          options={historyTasks.map(task => ({ value: task.taskId, label: task.method }))}/>
      </div>
      {selectedHistory ? <LossChart task={selectedHistory}/> : null}
    </section> : null}
    <section className="admin-train-panel"><h2>同一口径比较</h2>
      {comparison ? <>
        {comparison.notes.map(note => <p key={note} className="admin-report-meta">{note}</p>)}
        <table className="admin-compare-table">
          <thead><tr><th>方法</th><th>参数</th><th>PR-AUC</th><th>ROC-AUC</th><th>F1</th><th>P / R</th><th>Recall@20%LOC</th><th>MCC</th><th>耗时</th><th>状态</th></tr></thead>
          <tbody>{comparison.methods.map(row => <tr key={row.taskId}>
            <td>{row.methodName}</td>
            <td>{paramsText(row.parameters)}</td>
            <td>{metric(row.metrics, 'averagePrecision')}</td>
            <td>{metric(row.metrics, 'rocAuc')}</td>
            <td>{metric(row.metrics, 'f1')}</td>
            <td>{metric(row.metrics, 'precision')} / {metric(row.metrics, 'recall')}</td>
            <td>{metric(row.metrics, 'recall20Loc')}</td>
            <td>未定义</td>
            <td>{row.trainingSeconds == null ? '未记录' : `${row.trainingSeconds.toFixed(2)}s`}</td>
            <td>{row.error ? `${row.error.code} · ${row.error.message}` : valueLabel(row.status)}</td>
          </tr>)}</tbody>
        </table>
        <p className="admin-report-meta">
          口径：{comparison.datasetVersion} · {comparison.splitPreset} · {comparison.metricSet} ·
          manifest {comparison.manifestSha256.slice(0, 12)}…
          {comparison.comparable ? '；各方法使用相同数据与切分成员。' : '；口径不一致，不可直接比较。'}
          MCC 未纳入当前指标集。
        </p>
      </> : <p className="admin-report-meta">正在读取比较结果…</p>}
    </section>
    <Disclosure summary="比较口径与限制">
      <p className="admin-report-meta">
        三档指标来自各自运行的冻结分区；训练档只用于拟合诊断，验证档是模型选择背景，测试档承担冻结泛化评价。
        单次实验不按测试指标选择参数或方法，训练成功仍需在「登记实验运行」中显式登记，项目分析也只使用显式选择的已登记模型。
        分数未经当前仓库概率校准，不能视为缺陷概率。
      </p>
    </Disclosure>
  </section>
}
