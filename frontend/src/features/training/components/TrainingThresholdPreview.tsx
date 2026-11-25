import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { parseTrainingThresholdPreview } from '../trainingComparison'

function ratio(count: number, total: number) {
  return total ? count / total * 100 : 0
}

export function TrainingThresholdPreview({ data }: { data: unknown }) {
  const preview = parseTrainingThresholdPreview(data)
  const [choice, setChoice] = useState<number>()
  if (!preview) return <section className="rounded-xl border border-border-soft bg-card px-4 py-3 text-sm text-foreground-3 sm:px-5">
    此次训练未保存验证集阈值试算数据。
  </section>
  const tick = choice ?? preview.defaultTick
  const hit = preview.truePositives[tick]
  const falseAlarm = preview.falsePositives[tick]
  const missed = preview.positives - hit
  const flagged = hit + falseAlarm
  const total = preview.positives + preview.negatives
  const threshold = (tick / 100).toFixed(2)
  return <section className="grid min-w-0 gap-4 rounded-xl border border-border-soft bg-card p-4 sm:p-5" aria-labelledby="training-threshold-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="training-threshold-title" className="text-sm font-semibold">验证集阈值试算</h2>
      <span className="text-xs text-foreground-3">{total.toLocaleString()} 条验证样本</span>
    </div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">风险分数阈值 <strong className="ml-1 tabular-nums">{threshold}</strong></span>
          <Button type="button" variant="ghost" size="xs" disabled={tick === preview.defaultTick} onClick={() => setChoice(undefined)}>恢复默认</Button>
        </div>
        <Slider label="风险分数阈值" value={[tick]} onValueChange={values => setChoice(values[0])}/>
        <p className="text-xs text-foreground-3">分数达到阈值的提交会被列入告警。</p>
      </div>
      <div className="grid gap-3 text-xs text-foreground-3">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-sm font-medium text-foreground">告警 {flagged.toLocaleString()} 条</strong>
            <span>命中 {hit.toLocaleString()} · 误报 {falseAlarm.toLocaleString()}</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            <div className="bg-accent" style={{ width: `${ratio(hit, total)}%` }}/>
            <div className="bg-amber" style={{ width: `${ratio(falseAlarm, total)}%` }}/>
          </div>
        </div>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-sm font-medium text-foreground">漏报 {missed.toLocaleString()} 条</strong>
            <span>占 {preview.positives.toLocaleString()} 条缺陷引入样本</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            <div className="h-full bg-rose" style={{ width: `${ratio(missed, preview.positives)}%` }}/>
          </div>
        </div>
      </div>
    </div>
    <p className="text-xs text-foreground-3">误报和漏报按验证集已有标签计算。滑动条仅用于试算。</p>
  </section>
}
