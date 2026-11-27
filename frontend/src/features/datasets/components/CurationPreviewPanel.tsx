import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chartTooltip, EChartCanvas, useChartColors, type ChartOption } from '@/components/shared/EChartCanvas'
import {
  CURATION_RULE_LABELS,
  type CurationFeatureComparison,
  type CurationPreview,
  type CurationStep,
} from '@/features/datasets/curationContract'
import { EXCLUSION_LABELS, numberText } from '@/features/datasets/mydata/format'
import { useMemo, useState } from 'react'

function ruleLabel(step: CurationStep): string {
  return CURATION_RULE_LABELS[step.rule.id] ?? step.rule.id
}

function ruleDetail(step: CurationStep): string {
  const rule = step.rule
  if (rule.fields?.length) return rule.fields.join('、')
  if (rule.id === 'keep-date') return [rule.start, rule.end].filter(Boolean).join(' 至 ')
  if (rule.id === 'quantile-range' && rule.lower != null && rule.upper != null) {
    return `${numberText(rule.lower * 100)}%–${numberText(rule.upper * 100)}%`
  }
  if (rule.field) {
    if (rule.id === 'keep-range') {
      return `${rule.field} ${rule.min == null ? '不限' : `≥ ${numberText(rule.min)}`} ${rule.max == null ? '' : `≤ ${numberText(rule.max)}`}`.trim()
    }
    if (rule.value != null) return `${rule.field} ${rule.id.startsWith('max') ? '≤' : '≥'} ${numberText(rule.value)}`
    return rule.field
  }
  return ''
}

function comparisonFor(step: CurationStep, field: string): CurationFeatureComparison | null {
  return step.featureComparison.find(item => item.field === field) ?? null
}

function changeText(before: number | null, after: number | null, digits = 0): string {
  const format = (value: number | null) => value == null
    ? '—'
    : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
  return `${format(before)} → ${format(after)}`
}

export function CurationPreviewPanel({ preview }: { preview: CurationPreview }) {
  const colors = useChartColors()
  const [selectedStep, setSelectedStep] = useState(preview.steps.at(-1)?.index ?? 0)
  const [selectedFeature, setSelectedFeature] = useState(
    preview.featureComparison[0]?.field ?? preview.steps[0]?.featureComparison[0]?.field ?? '',
  )

  const featureFields = useMemo(() => {
    const fields = preview.featureComparison.map(item => item.field)
    if (!fields.length) {
      for (const step of preview.steps) {
        for (const item of step.featureComparison) {
          if (!fields.includes(item.field)) fields.push(item.field)
        }
      }
    }
    return fields
  }, [preview.featureComparison, preview.steps])
  const currentStep = preview.steps.find(step => step.index === selectedStep) ?? preview.steps.at(-1) ?? null
  const comparison = currentStep && selectedFeature ? comparisonFor(currentStep, selectedFeature) : null
  const excluded = Object.entries(preview.stats.excluded).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && entry[1] > 0)
  const beforeRows = preview.beforeStats?.includedRows ?? preview.beforeStats?.rawRows ?? preview.stats.rawRows
  const beforePositive = preview.beforeStats?.positiveLabels ?? 0
  const afterRows = preview.stats.includedRows
  const afterPositive = preview.stats.positiveLabels
  const samples = (currentStep?.afterStats.sampleExcluded ?? []).slice(0, 8)

  const datasetOption: ChartOption = {
    animation: false,
    tooltip: chartTooltip(colors),
    grid: { left: 46, right: 12, top: 18, bottom: 50 },
    xAxis: {
      type: 'category',
      data: preview.steps.map(step => `${step.index} ${ruleLabel(step)}`),
      axisLine: { lineStyle: { color: colors.axis } },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 10, interval: 0, rotate: preview.steps.length > 3 ? 28 : 0 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.grid } },
    },
    series: [
      {
        type: 'bar',
        name: '步骤前',
        data: preview.steps.map(step => step.beforeStats.includedRows),
        itemStyle: { color: colors.categorical[0] },
        barMaxWidth: 18,
      },
      {
        type: 'bar',
        name: '步骤后',
        data: preview.steps.map(step => step.afterStats.includedRows),
        itemStyle: { color: colors.categorical[1] },
        barMaxWidth: 18,
      },
    ],
  }

  const comparisonMax = comparison
    ? Math.max(1, ...comparison.before.bucketCounts, ...comparison.after.bucketCounts)
    : 1
  const featureOption: ChartOption = {
    animation: false,
    tooltip: chartTooltip(colors),
    grid: { left: 46, right: 12, top: 18, bottom: 54 },
    xAxis: {
      type: 'category',
      data: comparison?.bins.map((bin, index) => `${index === 0 ? '≤' : ''}${numberText(bin.end)}`) ?? [],
      axisLine: { lineStyle: { color: colors.axis } },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 10, interval: 0, rotate: 28 },
    },
    yAxis: {
      type: 'value',
      max: comparisonMax,
      minInterval: 1,
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.grid } },
    },
    series: [
      {
        type: 'bar',
        name: '步骤前',
        data: comparison?.before.bucketCounts ?? [],
        itemStyle: { color: colors.categorical[0] },
        barMaxWidth: 18,
      },
      {
        type: 'bar',
        name: '步骤后',
        data: comparison?.after.bucketCounts ?? [],
        itemStyle: { color: colors.categorical[1] },
        barMaxWidth: 18,
      },
    ],
  }

  return <div className="grid gap-4">
    <section className="grid gap-3 border-t border-border-soft pt-3" aria-labelledby="curation-result-summary">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="curation-result-summary" className="text-sm font-semibold text-foreground">清洗预览</h3>
          <p className="mt-0.5 text-xs text-foreground-3">
            {numberText(preview.beforeStats?.includedRows ?? preview.stats.rawRows)} → {numberText(preview.stats.includedRows)} 行
            <span className="mx-1.5 text-foreground-4">·</span>
            正例 {numberText(preview.beforeStats?.positiveLabels ?? null)} → {numberText(preview.stats.positiveLabels)}
          </p>
        </div>
        <code className="max-w-full truncate text-[10px] text-foreground-4" title={preview.recipeSha256}>{preview.recipeSha256.slice(0, 12)}</code>
      </div>
      {excluded.length ? <div className="flex flex-wrap gap-1.5">
        {excluded.map(([reason, count]) => <span key={reason} className="rounded-md bg-sunken px-2 py-1 text-[11px] text-foreground-2">
          {EXCLUSION_LABELS[reason] ?? reason} {numberText(count)}
        </span>)}
      </div> : null}
      <p className="text-[11px] text-foreground-3">
        标签分布：正例 {numberText(beforePositive)} → {numberText(afterPositive)}，负例 {numberText(beforeRows - beforePositive)} → {numberText(afterRows - afterPositive)}
      </p>
    </section>

    <section className="grid gap-2" aria-labelledby="curation-step-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="curation-step-chart" className="text-xs font-medium text-foreground-2">数据集变化</h3>
        <div className="flex flex-wrap gap-3 text-[11px] text-foreground-3">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: colors.categorical[0] }}/>步骤前</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: colors.categorical[1] }}/>步骤后</span>
        </div>
      </div>
      <EChartCanvas option={datasetOption} height={190} label="每一步清洗前后的记录数"/>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
          <thead className="text-foreground-3"><tr className="border-y border-border-soft">
            <th className="py-1.5 pr-3 font-normal">步骤</th><th className="py-1.5 pr-3 font-normal">操作</th>
            <th className="py-1.5 pr-3 text-right font-normal">前</th><th className="py-1.5 pr-3 text-right font-normal">后</th>
            <th className="py-1.5 text-right font-normal">排除</th>
          </tr></thead>
          <tbody>{preview.steps.map(step => <tr key={step.index} className="border-b border-border-soft text-foreground-2">
            <td className="py-1.5 pr-3 tabular-nums">{step.index}</td>
            <td className="py-1.5 pr-3">{ruleLabel(step)} {ruleDetail(step) ? <span className="text-foreground-4">· {ruleDetail(step)}</span> : null}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{numberText(step.beforeStats.includedRows)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{numberText(step.afterStats.includedRows)}</td>
            <td className="py-1.5 text-right tabular-nums">{numberText(step.afterStats.excludedRows)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-2 border-t border-border-soft pt-3" aria-labelledby="curation-samples">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="curation-samples" className="text-xs font-medium text-foreground-2">代表性记录</h3>
        <span className="text-[11px] text-foreground-4">步骤 {currentStep?.index ?? '—'} 排除的记录，最多 8 条</span>
      </div>
      {samples.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left text-[11px]">
          <thead className="text-foreground-3"><tr className="border-y border-border-soft">
            <th className="py-1.5 pr-3 font-normal">记录</th><th className="py-1.5 pr-3 font-normal">时间</th>
            <th className="py-1.5 pr-3 font-normal">标签</th><th className="py-1.5 font-normal">处理原因</th>
          </tr></thead>
          <tbody>{samples.map((sample, index) => {
            const id = typeof sample.id === 'string' ? sample.id : '—'
            const time = typeof sample.time === 'string' ? sample.time.slice(0, 10) : '—'
            const label = sample.label === 1 ? '正例' : sample.label === 0 ? '负例' : '未知'
            const reason = typeof sample.reason === 'string' ? EXCLUSION_LABELS[sample.reason] ?? sample.reason : '—'
            return <tr key={`${id}:${index}`} className="border-b border-border-soft text-foreground-2">
              <td className="py-1.5 pr-3 font-mono">{id.slice(0, 12)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{time}</td>
              <td className="py-1.5 pr-3">{label}</td>
              <td className="py-1.5">{reason}</td>
            </tr>
          })}</tbody>
        </table>
      </div> : <p className="text-xs text-foreground-3">这一步没有保留可展示的排除记录。</p>}
    </section>

    <section className="grid gap-2 border-t border-border-soft pt-3" aria-labelledby="curation-feature-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="curation-feature-chart" className="text-xs font-medium text-foreground-2">指定特征变化</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedStep ? String(selectedStep) : ''} onValueChange={value => setSelectedStep(Number(value))}>
            <SelectTrigger aria-label="特征对比步骤" className="h-8 w-[130px] text-[11px]"><SelectValue/></SelectTrigger>
            <SelectContent>{preview.steps.map(step => <SelectItem key={step.index} value={String(step.index)}>步骤 {step.index}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectedFeature} onValueChange={setSelectedFeature}>
            <SelectTrigger aria-label="对比特征" className="h-8 w-[130px] font-mono text-[11px]"><SelectValue/></SelectTrigger>
            <SelectContent>{featureFields.map(field => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {comparison ? <>
        <div className="flex flex-wrap gap-3 text-[11px] text-foreground-3">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: colors.categorical[0] }}/>步骤前</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: colors.categorical[1] }}/>步骤后</span>
          <span>记录 {changeText(comparison.before.records, comparison.after.records)}</span>
          <span>缺失 {changeText(comparison.before.missing, comparison.after.missing)}</span>
          <span>均值 {changeText(comparison.before.mean, comparison.after.mean, 3)}</span>
          <span>最大 {changeText(comparison.before.max, comparison.after.max, 3)}</span>
        </div>
        <EChartCanvas option={featureOption} height={210} label={`${selectedFeature} 在步骤 ${selectedStep} 前后的分布`}/>
        <details className="text-[11px] text-foreground-3">
          <summary className="cursor-pointer">各步骤统计</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead><tr className="border-y border-border-soft">
                <th className="py-1.5 pr-3 font-normal">步骤</th><th className="py-1.5 pr-3 font-normal">记录</th>
                <th className="py-1.5 pr-3 font-normal">缺失</th><th className="py-1.5 pr-3 font-normal">均值</th>
                <th className="py-1.5 font-normal">范围</th>
              </tr></thead>
              <tbody>{preview.steps.map(step => {
                const item = comparisonFor(step, selectedFeature)
                return <tr key={step.index} className="border-b border-border-soft">
                  <td className="py-1.5 pr-3 tabular-nums">{step.index}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{item ? changeText(item.before.records, item.after.records) : '—'}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{item ? changeText(item.before.missing, item.after.missing) : '—'}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{item ? changeText(item.before.mean, item.after.mean, 3) : '—'}</td>
                  <td className="py-1.5 tabular-nums">{item ? `${changeText(item.before.min, item.before.max, 3)} / ${changeText(item.after.min, item.after.max, 3)}` : '—'}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
        </details>
      </> : <p className="text-xs text-foreground-3">该步骤没有 {selectedFeature || '所选特征'} 的可比较数值。</p>}
    </section>
  </div>
}
