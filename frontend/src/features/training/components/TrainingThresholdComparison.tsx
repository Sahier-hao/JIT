import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { chartTooltip, EChartCanvas, useChartColors, type ChartOption } from '@/components/shared/EChartCanvas'
import {
  CLASSIFICATION_METRICS, type ClassificationMetric, type ThresholdEvaluation, type ThresholdRequest,
  type ThresholdSelection, type ThresholdCandidate, type ThresholdPreview,
} from '../trainingComparison'

type Evaluate = (request: ThresholdRequest, signal: AbortSignal) => Promise<ThresholdEvaluation>

function point(preview: ThresholdPreview, tick: number) {
  const tp = preview.truePositives[tick]
  const fp = preview.falsePositives[tick]
  const fn = preview.positives - tp
  return {
    tp, fp, fn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: preview.positives ? tp / preview.positives : null,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
  }
}

const numberText = (value: number | null) => value === null ? '未定义' : value.toFixed(3)
const countText = (value: number) => value.toLocaleString('zh-CN')
const CONFUSION = [['tp', '命中'], ['fp', '误报'], ['fn', '漏报'], ['tn', '正确排除']] as const

function ValidationCurve({ rows, metric, tick }: {
  rows: [ThresholdCandidate, ThresholdCandidate]
  metric: ClassificationMetric
  tick: number
}) {
  const colors = useChartColors()
  const label = CLASSIFICATION_METRICS.find(([key]) => key === metric)?.[1] ?? 'F1'
  const option: ChartOption = {
    animation: false,
    tooltip: chartTooltip(colors),
    grid: { left: 40, right: 21, top: 14, bottom: 42 },
    xAxis: {
      type: 'value', min: 0, max: 1, interval: .25, name: '风险分数阈值', nameLocation: 'center', nameGap: 27,
      axisLabel: { color: colors.text, formatter: (value: number) => value.toFixed(2) },
      nameTextStyle: { color: colors.text },
      splitLine: { show: false },
    },
    yAxis: { type: 'value', min: 0, max: 1, interval: .25,
      axisLabel: { color: colors.text }, splitLine: { lineStyle: { color: colors.grid, type: 'dashed' } } },
    series: rows.map(({ method, preview }, index) => ({
      type: 'line', name: method.methodName, showSymbol: false,
      lineStyle: { color: colors.categorical[index], width: 2.5, type: index ? 'dashed' : 'solid' },
      itemStyle: { color: colors.categorical[index] },
      data: preview.truePositives.map((_, tick) => [tick / 100, point(preview, tick)[metric]]),
      markArea: index === 0 ? {
        silent: true, itemStyle: { color: colors.grid, opacity: .65 },
        data: [[{ xAxis: Math.max(0, (tick - .65) / 100) }, { xAxis: Math.min(1, (tick + .65) / 100) }]],
      } : undefined,
    })),
  }
  return <div className="grid min-w-0 grid-cols-1 gap-1">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-2">
      {rows.map(({ method }, index) => <span key={method.taskId} className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="w-5 border-t-2" style={{ borderColor: colors.categorical[index], borderTopStyle: index ? 'dashed' : 'solid' }}/>
        {method.methodName}
      </span>)}
    </div>
    <EChartCanvas option={option} label={`验证集${label}随阈值变化`} height={252} className="ui-chart min-w-0 overflow-hidden"/>
  </div>
}

function TestResults({ result, rows }: { result: ThresholdEvaluation; rows: [ThresholdCandidate, ThresholdCandidate] }) {
  const colors = useChartColors()
  const region = useRef<HTMLElement>(null)
  useEffect(() => {
    region.current?.focus({ preventScroll: true })
    region.current?.scrollIntoView?.({ block: 'nearest' })
  }, [result])
  return <section ref={region} tabIndex={-1} aria-label="测试集阈值结果" aria-live="polite"
    className="grid min-w-0 gap-3 border-t border-border-soft p-4 outline-none sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h4 className="text-base font-semibold">测试集阈值结果</h4>
      <span className="text-xs text-foreground-3">基准阈值 {result.methods[0]?.defaultThreshold.toFixed(2)}</span>
    </div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      {result.methods.map((entry, index) => <article key={entry.taskId} className="min-w-0 overflow-hidden rounded-lg border border-border-soft bg-card">
        <div className="flex flex-wrap items-start justify-between gap-2 border-l-[3px] px-3 py-3.5 sm:px-4" style={{ borderLeftColor: colors.categorical[index] }}>
          <div className="min-w-0">
            <h5 className="text-sm font-semibold">{rows[index].method.methodName}</h5>
            <p className="mt-1 text-xs leading-snug text-foreground-3">验证集召回率 {numberText(entry.validation.recall.value)} · F1 {numberText(entry.validation.f1.value)}</p>
          </div>
          <span className="shrink-0 rounded-md bg-accent-soft px-2 py-1 text-xs text-accent">
            选定阈值 <strong className="ml-1 tabular-nums">{entry.threshold.toFixed(2)}</strong>
          </span>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-border-soft border-y border-border-soft bg-sunken/55">
          {CLASSIFICATION_METRICS.map(([key, label]) => <div key={key} className="min-w-0 px-3 py-3 sm:px-4">
            <dt className="text-xs text-foreground-3">{label}</dt>
            <dd title={entry.test[key].reason ?? undefined} className="mt-0.5 font-mono text-lg font-semibold tracking-tight tabular-nums sm:text-xl">
              {numberText(entry.test[key].value)}
            </dd>
            <dd title={entry.defaultTest[key].reason ?? undefined} className="mt-0.5 text-xs tabular-nums text-foreground-3">
              默认 {numberText(entry.defaultTest[key].value)}
            </dd>
          </div>)}
        </dl>
        <details className="group px-3 sm:px-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2.5 text-xs font-medium text-foreground-2 [&::-webkit-details-marker]:hidden">
            测试计数 <ChevronDown aria-hidden="true" className="size-3.5 group-open:rotate-180"/>
          </summary>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border-soft py-2.5 text-xs sm:grid-cols-4">
            {CONFUSION.map(([key, label]) => <div key={key} className="min-w-0">
              <dt className="text-foreground-3">{label}</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{countText(entry.test.confusion[key])}</dd>
              <dd className="text-foreground-3">默认 {countText(entry.defaultTest.confusion[key])}</dd>
            </div>)}
          </dl>
        </details>
      </article>)}
    </div>
  </section>
}

export function TrainingThresholdComparison({ candidates, onEvaluate, result, onResult }: {
  candidates: ThresholdCandidate[]
  onEvaluate: Evaluate
  result: ThresholdEvaluation | null
  onResult: (result: ThresholdEvaluation | null) => void
}) {
  const [firstId, setFirst] = useState(candidates[0].method.taskId)
  const [secondId, setSecond] = useState(candidates[1].method.taskId)
  const [metric, setMetric] = useState<ClassificationMetric>('f1')
  const [tick, setTick] = useState(50)
  const [strategy, setStrategy] = useState<ThresholdSelection['strategy']>('fixed')
  const [target, setTarget] = useState('80')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])
  const first = candidates.find(row => row.method.taskId === firstId) ?? candidates[0]
  const second = candidates.find(row => row.method.taskId === secondId) ?? candidates[1]
  const rows: [ThresholdCandidate, ThresholdCandidate] = [first, second]
  const fingerprint = first.method.splitMemberSha256
  const comparable = Boolean(fingerprint && fingerprint === second.method.splitMemberSha256
    && first.method.manifestSha256 === second.method.manifestSha256)
  const targetRecall = Number(target) / 100
  const targetInvalid = strategy === 'target-recall' && !(targetRecall > 0 && targetRecall <= 1)

  function reset() {
    running.current?.abort()
    running.current = null
    setBusy(false)
    setError('')
    onResult(null)
  }

  async function evaluate() {
    if (!comparable || targetInvalid || running.current) return
    const taskIds: [string, string] = [first.method.taskId, second.method.taskId]
    const selection: ThresholdSelection = strategy === 'fixed' ? { strategy, threshold: tick / 100 }
      : strategy === 'target-recall' ? { strategy, targetRecall } : { strategy }
    const controller = new AbortController()
    running.current = controller
    setBusy(true)
    setError('')
    onResult(null)
    try {
      const evaluated = await onEvaluate({ ...selection, taskIds }, controller.signal)
      if (!controller.signal.aborted) onResult(evaluated)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '测试复核失败')
    } finally {
      if (running.current === controller) {
        running.current = null
        setBusy(false)
      }
    }
  }

  return <section aria-label="验证集阈值对比" className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft p-4 sm:px-5">
      <div>
        <h3 className="text-base font-semibold">验证集阈值对比</h3>
        {comparable ? <p className="mt-1 text-xs tabular-nums text-foreground-3">
          {countText(first.preview.positives + first.preview.negatives)} 条样本 · {countText(first.preview.positives)} 条正例
        </p> : null}
      </div>
      {comparable ? <ToggleGroup aria-label="曲线指标" size="sm" type="single" value={metric} variant="outline"
        onValueChange={value => { if (value) setMetric(value as ClassificationMetric) }}>
        {CLASSIFICATION_METRICS.map(([key, label]) => <ToggleGroupItem key={key} value={key}>{label}</ToggleGroupItem>)}
      </ToggleGroup> : null}
    </header>
    {candidates.length > 2 ? <div className="grid gap-2 border-b border-border-soft px-4 py-3 sm:grid-cols-2 sm:px-5">
      {([[first.method.taskId, second.method.taskId, setFirst], [second.method.taskId, first.method.taskId, setSecond]] as const)
        .map(([selected, other, setMethod], index) => <label key={index} className="grid gap-1 text-xs text-foreground-3">
          {index === 0 ? '模型一' : '模型二'}
          <NativeSelect size="sm" value={selected} onChange={event => { reset(); setMethod(event.currentTarget.value) }}>
            {candidates.map(({ method }) => <option key={method.taskId} value={method.taskId} disabled={method.taskId === other}>{method.methodName}</option>)}
          </NativeSelect>
        </label>)}
    </div> : null}
    {comparable ? <>
      <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-3 p-4 sm:p-5">
          <ValidationCurve rows={rows} metric={metric} tick={tick}/>
          <label className="grid gap-2 text-xs text-foreground-3">
            <span className="flex items-center justify-between gap-2">预览阈值
              <strong className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-sm tabular-nums text-accent">{(tick / 100).toFixed(2)}</strong>
            </span>
            <input type="range" aria-valuetext={(tick / 100).toFixed(2)} className="w-full accent-accent"
              min={0} max={100} value={tick} onChange={event => { if (strategy === 'fixed') reset(); setTick(event.currentTarget.valueAsNumber) }}/>
          </label>
        </div>
        <div className="grid content-start gap-3 border-t border-border-soft bg-sunken/65 p-4 sm:p-5 xl:border-t-0 xl:border-l" aria-busy={busy}>
          <h4 className="text-sm font-semibold">测试复核</h4>
          <label className="grid gap-1 text-xs text-foreground-3">阈值选择方式
            <NativeSelect size="sm" className="bg-card" value={strategy}
              onChange={event => { reset(); setStrategy(event.currentTarget.value as ThresholdSelection['strategy']) }}>
              <option value="fixed">使用当前预览阈值</option>
              <option value="max-f1">各自验证集 F1 最高</option>
              <option value="target-recall">按目标召回率</option>
            </NativeSelect>
          </label>
          {strategy === 'fixed' ? <p className="text-xs tabular-nums text-foreground-3">两个模型均使用阈值 <strong className="text-foreground">{(tick / 100).toFixed(2)}</strong></p> : null}
          {strategy === 'target-recall' ? <label className="grid gap-1 text-xs text-foreground-3">目标召回率 (%)
            <input className="h-8 w-24 rounded-md border border-input bg-card px-2 tabular-nums text-foreground"
              type="number" min={1} max={100} value={target} onChange={event => { reset(); setTarget(event.currentTarget.value) }}/>
          </label> : null}
          <Button type="button" size="sm" className="mt-1 justify-self-start xl:w-full" disabled={busy || targetInvalid} onClick={() => void evaluate()}>
            {busy ? <LoaderCircle aria-hidden="true" className="animate-spin"/> : <ArrowRight aria-hidden="true"/>}
            {busy ? '正在评估测试集…' : '用选定阈值评估测试集'}
          </Button>
          {error ? <p className="text-sm text-rose" role="alert">{error}</p> : null}
          <div className="mt-1 min-w-0 border-t border-border-soft pt-3" aria-label="当前阈值的验证集指标">
            <h4 className="mb-2 text-xs font-semibold text-foreground-2">验证集预览</h4>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {rows.map(({ method, preview }) => {
                const current = point(preview, tick)
                return <div key={method.taskId} className="min-w-0 rounded-lg border border-border-soft bg-card px-2.5 py-2">
                  <h5 className="text-xs font-semibold">{method.methodName}</h5>
                  <dl className="mt-1.5 grid grid-cols-3 gap-1 text-xs tabular-nums">
                    {CLASSIFICATION_METRICS.map(([key, label]) => <div key={key}>
                      <dt className="text-foreground-3">{label}</dt>
                      <dd className="mt-0.5 font-mono font-medium">{numberText(current[key])}</dd>
                    </div>)}
                  </dl>
                  <p className="mt-1.5 text-xs tabular-nums text-foreground-3">
                    命中 {countText(current.tp)} · 误报 {countText(current.fp)} · 漏报 {countText(current.fn)}
                  </p>
                </div>
              })}
            </div>
          </div>
        </div>
      </div>
      {result ? <TestResults result={result} rows={rows}/> : null}
    </> : <p className="p-4 text-sm text-foreground-3 sm:px-5">所选模型的验证集或测试集成员无法确认一致。</p>}
  </section>
}
