import { Folder, ChevronRight, TrendingUp, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type Dataset } from './domain'
import { EmptyState, LoadingNotice } from './Feedback'


import { parseSummaryTrend, type TrendAggregate } from './trendContract'
import { TrendChart, PartitionList, TrendTable, monthOf, signedPoints, drillSearch } from './components/report/TrendPanels'
import { DEFAULT_INSIGHTS, INSIGHT_DISCLAIMER, type TrendInsight } from './trendInsights'
import { historicalLoader, useDataset } from './useDataset'

function InsightPanel({ insights, trend }: { insights: readonly TrendInsight[]; trend: TrendAggregate }) {
  return (
    <section className="grid gap-3 rounded-md border border-border-soft bg-card p-card" aria-label="趋势洞察">
      <h2 className="text-base font-semibold text-foreground">趋势洞察</h2>
      <p className="text-xs leading-body text-foreground-3">{INSIGHT_DISCLAIMER}</p>
      {insights.map((insight) => {
        const result = insight.compute(trend)
        return (
          <div key={insight.id} className="grid gap-1.5" data-insight={insight.kind}>
            <h3 className="text-sm font-semibold text-foreground">{insight.label}</h3>
            {result.unavailable ? (
              <p className="text-xs text-foreground-3">{result.reason}</p>
            ) : (
              <>
                <p className="text-sm text-foreground-2">{result.headline}</p>
                {result.approximate ? (
                  <p className="text-xs text-foreground-3"><span className="rounded-sm bg-amber-soft px-1 py-0.5 text-[11px] text-amber-deep">近似</span> 按中位风险折算。</p>
                ) : null}
                <ol className="grid gap-1">
                  {result.ranking.map((entry) => (
                    <li key={entry.bucket.start} className="grid gap-x-3 gap-y-0.5 border-t border-border-soft py-1.5 text-xs sm:grid-cols-[80px_1fr_1fr_1fr]" data-bucket={entry.bucket.start}>
                      <strong className="font-mono text-foreground">{monthOf(entry.bucket.start)}</strong>
                      <span className="tabular-nums text-foreground-2">观测正例（测试）{entry.observed}</span>
                      <span className="tabular-nums text-foreground-2">估计正例（测试）{entry.estimated.toFixed(1)}</span>
                      <span className="tabular-nums text-foreground-2">率差 {signedPoints(entry.gap)} pp</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}

function TrendBody({
  data,
  trend,
  insights,
  navigate,
}: {
  data: Dataset
  trend: TrendAggregate
  insights: readonly TrendInsight[]
  navigate: (search: string) => void
}) {
  const split = data.summary?.split
  return (
    <>
      <section className="grid gap-3 rounded-md border border-border-soft bg-card p-card" aria-label="历史趋势图">
        <TrendChart data={trend} split={split} />
        <ul className="trend-legend flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-3">
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--chart-bar)]" aria-hidden="true" />提交数</li>
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--chart-obs)]" aria-hidden="true" />观测正标签比例</li>
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--chart-est)]" aria-hidden="true" />模型风险中位数</li>
        </ul>
        <PartitionList split={split} />
        <p className="text-xs leading-body text-foreground-3">样本不足的桶不绘制数据点；模型风险是估计值，未经概率校准。</p>
      </section>
      <InsightPanel insights={insights} trend={trend} />
      <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card" aria-label="历史趋势文本视图">
        <h2 className="text-base font-semibold text-foreground">同数据的文本视图</h2>
        <TrendTable data={trend} onDrill={(bucket) => navigate(drillSearch(bucket))} />
      </section>
      <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card" aria-label="趋势来源与限制">
        <h2 className="text-base font-semibold text-foreground">来源与限制</h2>
        <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[140px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
          <div><dt>项目与数据版本</dt><dd>{data.project} · <code className="font-mono text-xs">{data.version}</code></dd></div>
          {data.runId === undefined ? null : <div><dt>运行标识</dt><dd><code className="font-mono text-xs">{data.runId}</code></dd></div>}
          {data.model === undefined ? null : <div><dt>模型</dt><dd>{data.model.name} · <code className="font-mono text-xs">{data.model.id}</code></dd></div>}
          <div><dt>聚合口径</dt><dd>按月分桶（{trend.timezone}），桶内提交数低于 {trend.minSample} 时比例与风险分布为空值并附原因</dd></div>
          <div><dt>下钻口径</dt><dd>以该桶自身起止派生日期范围（结束端取次日零点减一秒），按界面时区 {trend.timezone} 解释且包含两端</dd></div>
        </dl>
        {data.summary?.limitations === undefined || data.summary.limitations.length === 0 ? null : (
          <ul className="list-disc pl-5 text-xs leading-body text-foreground-3">
            {data.summary.limitations.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </section>
    </>
  )
}

export function TrendPage({
  insights = DEFAULT_INSIGHTS,
  navigate,
  expectedRunId,
  embedded = false,
}: {
  insights?: readonly TrendInsight[]
  navigate?: (search: string) => void
  expectedRunId?: string
  embedded?: boolean
} = {}) {
  const { resource, retry } = useDataset(historicalLoader, 'historical')

  if (resource.state !== 'ready') {
    return (
      <>
        {!embedded ? <header className="border-b border-border bg-card px-4 py-2 text-sm font-medium text-foreground">JIT · 提交评审 · 历史趋势</header> : null}
        {resource.state === 'loading' ? (
          <LoadingNotice label="正在读取真实历史运行的摘要与趋势聚合。" />
        ) : (
          <EmptyState tone="alert" title="数据不可用" description={resource.error}>
            <Button variant='default' onClick={retry} type="button">重新加载</Button>
          </EmptyState>
        )}
      </>
    )
  }

  const trend = parseSummaryTrend(resource.data.summary)
  if (expectedRunId && resource.data.runId !== expectedRunId) return <EmptyState title="该历史运行未供给" description="服务已切换运行；请返回验证报告核对来源。"/>
  const go = navigate ?? ((search: string) => window.location.assign(search))

  return (
    <div className="grid gap-4">
      {!embedded ? <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-sunken text-foreground-3"><Folder aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/></span>
          <strong className="truncate text-foreground">{resource.data.project}</strong>
          <ChevronRight aria-hidden="true" focusable="false" strokeWidth={1.5} size={14} className="text-foreground-4"/>
          <span className="text-foreground-3">历史趋势</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-border-soft px-2 py-0.5"><span className="size-1.5 rounded-full bg-teal"/><span className="text-foreground-2">真实历史回放</span></span>
          <code className="font-mono text-xs" title={resource.data.version}>{resource.data.version}</code>
        </div>
      </header>
      {resource.data.runId === undefined ? null : (
        <div className="flex flex-wrap gap-3 px-1 text-xs text-foreground-3">
          <span>{resource.data.model?.name}</span>
          <span>运行 <code className="font-mono" title={resource.data.runId}>{resource.data.runId}</code></span>
        </div>
      )}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border-soft pb-3">
        <div className="grid gap-1">
          <h1 className="font-sans text-xl font-semibold leading-title text-foreground">历史趋势</h1>
          <p className="max-w-3xl text-sm leading-body text-foreground-3">按时间观察发布者历史观测与模型对冻结测试批次的估计。两者语义不同、范围不同，分别标注。 <a className="text-accent underline-offset-2 hover:underline" href="#/validation">返回验证数据列表</a></p>
        </div>
        {trend.state === 'ready' ? (
          <div className="flex items-center gap-2 text-foreground-3">
            <TrendingUp aria-hidden="true" focusable="false" strokeWidth={1.5} size={20}/>
            <div className="grid leading-tight"><strong className="text-lg font-semibold tabular-nums text-foreground">{trend.data.buckets.length}</strong><span className="text-xs">个时间桶</span></div>
          </div>
        ) : null}
      </header>
      </> : null}
      <div className="flex gap-2 rounded-sm border border-blue/30 bg-blue-soft p-3 text-xs text-blue-deep">
        <Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={16} className="mt-0.5 shrink-0"/>
        <div className="grid gap-0.5"><strong className="text-sm">历史观测 · 模型估计</strong><span>风险为模型估计，未经概率校准；观测比例来自历史标签聚合。</span></div>
      </div>
      {trend.state === 'absent' ? (
        <div className="grid gap-1 rounded-sm border border-border-soft bg-card p-3 text-xs text-foreground-2" role="status">
          <div className="flex gap-2"><Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={16} className="mt-0.5 shrink-0"/><strong className="text-sm text-foreground">该运行未提供趋势聚合</strong></div>
          <span>当前供给的运行产物里没有趋势聚合键，因此没有可核对的时间桶数据。其余视图（提交工作台、详情、优先审查清单与基线摘要）不受影响。</span>
          <a className="text-accent underline-offset-2 hover:underline" href="#/validation">前往验证数据列表</a>
        </div>
      ) : null}
      {trend.state === 'invalid' ? (
        <div className="grid gap-1 rounded-sm border border-rose/30 bg-rose-soft p-3 text-xs text-rose-deep" role="alert">
          <div className="flex gap-2"><Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={16} className="mt-0.5 shrink-0"/><strong className="text-sm">趋势聚合不可用</strong></div>
          <span>该运行提供了趋势聚合，但与约定不符：{trend.reason}。这里不展示可疑数值、不沿用上一次结果；工作台、详情、清单与基线摘要不受影响。</span>
        </div>
      ) : null}
      {trend.state === 'ready' ? <TrendBody data={resource.data} trend={trend.data} insights={insights} navigate={go} /> : null}
    </div>
  )
}
