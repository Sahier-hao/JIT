/**
 * 历史趋势视图（DTD-01～DTD-09、change make-trend-actionable 的 design D2～D7）。
 *
 * 数据取自与工作台同一次运行摘要响应（`/api/review-batch`），可以独立读取，也不要求先
 * 打开工作台。聚合的解析走独立路径 `trendContract.ts`：缺少该键即"未提供"，不合法即"不可用"，
 * 两种情况都不影响工作台、详情、清单与基线摘要。
 *
 * 本轮新增三件事：
 * - 分区带：按运行摘要声明的分区集合在图上标出范围与边界，并按时间桶的域裁剪（DTD-08）。
 * - 洞察：页面只渲染传入的洞察列表，不含任何具体算法；本轮注册"估计与观测的差异"（DTD-09、design D6）。
 * - 下钻：文本视图每行一个按钮，把该桶范围作为工作台的初始日期筛选（DTD-07、design D2/D5）。
 *
 * 时间轴按真实时间比例投影（不是按桶序号等距）：分区边界只有落在时间比例轴上才可能与摘要一致。
 */

import { shanghaiDate, type BaselineSummary, type Dataset } from './domain'
import { EmptyState, LoadingNotice } from './Feedback'
import { Button } from './ui/controls'
import { Icon } from './Icon'
import { parseSummaryTrend, type TrendAggregate, type TrendBucket, type TrendMeasure } from './trendContract'
import { DEFAULT_INSIGHTS, INSIGHT_DISCLAIMER, type TrendInsight } from './trendInsights'
import { historicalLoader, useDataset } from './useDataset'
import './trend.css'

const CHART = { width: 760, height: 280, left: 58, right: 52, top: 20, bottom: 40 }

type Split = BaselineSummary['split']

/** 分区中文名只用于**显示**；未命中时回退运行摘要里的原始键名（不写死顺序与名称）。 */
const PARTITION_LABELS: Record<string, string> = { train: '训练', validation: '验证', test: '测试' }

function partitionLabel(key: string): string {
  return PARTITION_LABELS[key] ?? key
}

/** 时区在契约里固定为 UTC+08:00，因此 ISO 串的前 7 位就是该桶所在月份。 */
function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function signedPoints(value: number): string {
  const points = (value * 100).toFixed(1)
  return value >= 0 ? `+${points}` : points
}

function measureText(measure: TrendMeasure, emptyLabel: string): string {
  return measure.value === null ? `${emptyLabel}：${measure.reason ?? '原因未记录'}` : percent(measure.value)
}

function riskText(bucket: TrendBucket): string {
  if (bucket.risk === null) return '—'
  if (bucket.risk.median === null) return `样本不足：${bucket.risk.reason ?? '原因未记录'}`
  return `${bucket.risk.median.toFixed(2)}（测试记录 ${bucket.risk.count} 条）`
}

/** 该桶记录覆盖哪些分区：用于说明观测比例覆盖全部记录、风险只覆盖其中的测试记录。 */
function partitionText(bucket: TrendBucket): string {
  const parts = Object.entries(bucket.byPartition).filter(([, count]) => count.commits > 0)
  if (parts.length === 0) return '无记录'
  // 单分区桶只显示名称（与"提交数"列重复）；跨分区桶保留各自条数，
  // 用来解释"D宽测比例覆盖全部记录、风险只覆盖其中的测试记录"（DTD-03）。
  if (parts.length === 1) return partitionLabel(parts[0][0])
  return parts.map(([name, count]) => `${partitionLabel(name)} ${count.commits}`).join(' · ')
}

/** 比例轴上限：至少 20%，取到 5% 的整数倍，最多 100%。 */
function rateAxisMax(values: number[]): number {
  const max = Math.max(0.2, ...values)
  return Math.min(1, Math.ceil(max * 20) / 20)
}

interface PartitionBand {
  key: string
  label: string
  start: string
  end: string
  count: number
  positiveCount: number
  x: number
  width: number
  showStartEdge: boolean
  labelVisible: boolean
}

/** 分区带：按桶域裁剪，全落在域外的分区不画带（文字区仍然列出）。 */
function partitionBands(split: Split | undefined, domainStart: number, domainEnd: number, xTime: (time: number) => number): PartitionBand[] {
  if (split === undefined) return []
  return Object.entries(split)
    .map(([key, stat]) => {
      const start = Date.parse(stat.start)
      const end = Date.parse(stat.end)
      const clampedStart = Math.max(domainStart, Math.min(domainEnd, start))
      const clampedEnd = Math.max(domainStart, Math.min(domainEnd, end))
      const x = xTime(clampedStart)
      const width = Math.max(0, xTime(clampedEnd) - x)
      return {
        key,
        label: partitionLabel(key),
        start: stat.start,
        end: stat.end,
        count: stat.count,
        positiveCount: stat.positiveCount,
        x,
        width,
        showStartEdge: clampedStart > domainStart && width > 0,
        labelVisible: width >= 36,
      }
    })
    .filter((band) => band.width > 0)
    // 按起始时间排序，**不**跟随摘要里 JSON 的键序：后端写文件时键是按字母序的
    // （test、train、validation），照搬会把分区带与清单排成"测试、训练、验证"。
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start))
}

/** 下钻范围：由该桶自己的端点派生，结束端取"次日零点减一秒"的界面日期（不假设粒度）。 */
function drillRange(bucket: TrendBucket): { start: string; end: string } {
  const start = shanghaiDate(bucket.start)
  const lastMoment = new Date(Date.parse(bucket.end) - 1000).toISOString()
  return { start, end: shanghaiDate(lastMoment) }
}

function drillSearch(bucket: TrendBucket): string {
  const range = drillRange(bucket)
  return `/?mode=historical&start=${range.start}&end=${range.end}#/validation`
}

function TrendChart({ data, split }: { data: TrendAggregate; split: Split | undefined }) {
  const buckets = data.buckets
  const count = buckets.length
  const plotWidth = CHART.width - CHART.left - CHART.right
  const plotHeight = CHART.height - CHART.top - CHART.bottom

  const domainStart = Math.min(...buckets.map((bucket) => Date.parse(bucket.start)))
  const domainEnd = Math.max(...buckets.map((bucket) => Date.parse(bucket.end)))
  const span = Math.max(1, domainEnd - domainStart)
  const xTime = (time: number) => CHART.left + (plotWidth * (time - domainStart)) / span
  const midOf = (bucket: TrendBucket) => (xTime(Date.parse(bucket.start)) + xTime(Date.parse(bucket.end))) / 2

  const commitsMax = Math.max(1, ...buckets.map((bucket) => bucket.commits))
  const rateMax = rateAxisMax([
    ...buckets.map((bucket) => bucket.observedRate.value ?? 0),
    ...buckets.map((bucket) => bucket.risk?.median ?? 0),
  ])
  // 双序列分离（design D14）：上半区放提交数（有自己的纵轴），下半区放比例与风险，
  // 两区共享 x 轴。这样柱状序列不再借用百分比刻度，读数不再悬空。
  const commitsTop = CHART.top
  const commitsBottom = CHART.top + plotHeight * 0.42
  const rateTop = CHART.top + plotHeight * 0.56
  const rateBottom = CHART.top + plotHeight
  const yRate = (value: number) => rateBottom - (rateBottom - rateTop) * (value / rateMax)
  const yCommits = (value: number) => commitsBottom - (commitsBottom - commitsTop) * (value / commitsMax)
  const labelStep = Math.max(1, Math.ceil(count / 8))
  const bands = partitionBands(split, domainStart, domainEnd, xTime)

  /** 逐序列取点：空值处断开；相邻桶在时间上不连续时也断开，避免跨缺口拉一条直线。 */
  const segments = (pick: (bucket: TrendBucket) => number | null) => {
    const result: { x: number; y: number }[][] = []
    let current: { x: number; y: number }[] = []
    const flush = () => {
      if (current.length > 0) result.push(current)
      current = []
    }
    buckets.forEach((bucket, index) => {
      const value = pick(bucket)
      const previous = index > 0 ? buckets[index - 1] : null
      if (previous !== null && Date.parse(previous.end) !== Date.parse(bucket.start)) flush()
      if (value === null) {
        flush()
        return
      }
      current.push({ x: midOf(bucket), y: yRate(value) })
    })
    flush()
    return result
  }

  const observed = segments((bucket) => bucket.observedRate.value)
  const estimated = segments((bucket) => bucket.risk?.median ?? null)
  const gaps = buckets.map((bucket, index) => (bucket.observedRate.value === null ? index : -1)).filter((index) => index >= 0)

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={`历史趋势图：${count} 个时间桶的提交数、观测正标签比例与模型风险中位数，并按运行摘要标出 ${bands.length} 个分区的范围；完整数值见同数据的文本视图`}
    >
      <defs>
        <pattern id="trend-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--chart-hatch)" strokeWidth="1" />
        </pattern>
      </defs>
      {bands.map((band) => (
        <g key={`band-${band.key}`} data-partition={band.key}>
          <rect
            className={band.key === 'test' ? 'trend-band trend-band-test' : 'trend-band trend-band-hatch'}
            x={band.x}
            y={CHART.top}
            width={band.width}
            height={plotHeight}
          />
          {band.showStartEdge ? (
            <line className="trend-band-edge" x1={band.x} x2={band.x} y1={CHART.top} y2={CHART.top + plotHeight} />
          ) : null}
          {band.labelVisible ? (
            <text className="trend-band-label" x={band.x + band.width / 2} y={CHART.top + 12} textAnchor="middle">
              {band.label}
            </text>
          ) : null}
        </g>
      ))}
      {[0, rateMax / 2, rateMax].map((tick) => (
        <g key={`rate-${tick}`}>
          <line className="trend-grid" x1={CHART.left} x2={CHART.left + plotWidth} y1={yRate(tick)} y2={yRate(tick)} />
          <line className="trend-tick" x1={CHART.left - 4} x2={CHART.left} y1={yRate(tick)} y2={yRate(tick)} />
          <text className="trend-axis-text" x={CHART.left - 8} y={yRate(tick) + 3.5} textAnchor="end">
            {percent(tick)}
          </text>
          <text className="trend-axis-text" x={CHART.left + plotWidth + 8} y={yRate(tick) + 3.5} textAnchor="start">{tick.toFixed(2)}</text>
        </g>
      ))}
      {[0, Math.round(commitsMax / 2), commitsMax].map((tick) => (
        <g key={`commits-${tick}`}>
          <line className="trend-grid" x1={CHART.left} x2={CHART.left + plotWidth} y1={yCommits(tick)} y2={yCommits(tick)} />
          <line className="trend-tick" x1={CHART.left - 4} x2={CHART.left} y1={yCommits(tick)} y2={yCommits(tick)} />
          <text className="trend-axis-text" x={CHART.left - 8} y={yCommits(tick) + 3.5} textAnchor="end">
            {tick}
          </text>
        </g>
      ))}
      {buckets.map((bucket) => {
        const bucketWidth = Math.max(0, xTime(Date.parse(bucket.end)) - xTime(Date.parse(bucket.start)))
        const barWidth = Math.max(3, Math.min(bucketWidth * 0.42, 26))
        return (
          <rect
            key={`bar-${bucket.start}`}
            className="trend-bar"
            x={midOf(bucket) - barWidth / 2}
            y={yCommits(bucket.commits)}
            width={barWidth}
            height={commitsBottom - yCommits(bucket.commits)}
          />
        )
      })}
      {gaps.map((index) => (
        <line
          key={`gap-${buckets[index].start}`}
          className="trend-gap"
          x1={midOf(buckets[index])}
          x2={midOf(buckets[index])}
          y1={CHART.top}
          y2={rateBottom}
        />
      ))}
      {observed.map((points) => (
        <g key={`observed-${points[0].x}`}>
          {points.length > 1 ? (
            <polyline className="trend-line trend-line-observed" points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
          ) : null}
          {points.map((point) => (
            <rect key={point.x} className="trend-dot trend-dot-observed" x={point.x - 2.5} y={point.y - 2.5} width={5} height={5} />
          ))}
        </g>
      ))}
      {estimated.map((points) => (
        <g key={`estimated-${points[0].x}`}>
          {points.length > 1 ? (
            <polyline className="trend-line trend-line-estimated" points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
          ) : null}
          {points.map((point) => (
            <rect key={point.x} className="trend-dot trend-dot-estimated" x={point.x - 2.5} y={point.y - 2.5} width={5} height={5} />
          ))}
        </g>
      ))}
      <line className="trend-axis trend-axis-split" x1={CHART.left} x2={CHART.left + plotWidth} y1={rateTop - 6} y2={rateTop - 6} />
      <text className="trend-axis-unit" x={CHART.left} y={rateTop - 10}>观测比例</text>
      <text className="trend-axis-unit" x={CHART.left + plotWidth} y={rateTop - 10} textAnchor="end">模型分数</text>
      <line className="trend-axis" x1={CHART.left} x2={CHART.left + plotWidth} y1={rateBottom} y2={rateBottom} />
      {buckets.map((bucket, index) =>
        index % labelStep === 0 ? (
          <text
            key={`label-${bucket.start}`}
            className="trend-axis-text"
            x={midOf(bucket)}
            y={CHART.top + plotHeight + 20}
            textAnchor="middle"
          >
            {monthOf(bucket.start)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

/** 分区范围的文字版：全部来自运行摘要，即使某个分区整段落在桶域之外也照样列出。 */
function PartitionList({ split }: { split: Split | undefined }) {
  if (split === undefined) return null
  return (
    <ul className="trend-partitions" aria-label="分区范围">
      {Object.entries(split)
        .sort(([, left], [, right]) => Date.parse(left.start) - Date.parse(right.start))
        .map(([key, stat]) => (
        <li key={key}>
          <span>{partitionLabel(key)}：</span>
          <time dateTime={stat.start}>{stat.start}</time>
          <span>—</span>
          <time dateTime={stat.end}>{stat.end}</time>
          <code>
            {stat.count} 条 / 正 {stat.positiveCount}
          </code>
        </li>
      ))}
    </ul>
  )
}

function TrendTable({ data, onDrill }: { data: TrendAggregate; onDrill: (bucket: TrendBucket) => void }) {
  return (
    <div className="table-wrap trend-table-wrap" role="region" aria-label="历史趋势文本视图" tabIndex={0}>
      <table className="trend-table">
        <caption>
          历史趋势文本视图：每个时间桶的提交数、记录分区、观测正标签比例与模型风险中位数（时区 {data.timezone}，最小样本{' '}
          {data.minSample}）
        </caption>
        <thead>
          <tr>
            <th>时间桶（{data.timezone}）</th>
            <th className="numeric">提交数</th>
            <th>记录分区</th>
            <th>观测正标签比例</th>
            <th>模型风险中位数</th>
            <th className="trend-drill-head">下钻</th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.map((bucket) => {
            const range = drillRange(bucket)
            return (
              <tr key={bucket.start}>
                <td className="time-cell">
                  <time dateTime={bucket.start}>{monthOf(bucket.start)}</time>
                  <span>
                    {bucket.start.slice(0, 10)} — {bucket.end.slice(0, 10)}
                  </span>
                </td>
                <td className="numeric">{bucket.commits}</td>
                <td>{partitionText(bucket)}</td>
                <td>{measureText(bucket.observedRate, '样本不足')}</td>
                <td>{riskText(bucket)}</td>
                <td className="trend-drill-cell">
                  <Button
                    variant="link"
                    size="sm"
                    className="trend-drill"
                    aria-label={`查看该桶提交：${range.start} 至 ${range.end}`}
                    onClick={() => onDrill(bucket)}
                  >查看提交</Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="trend-table-note">「—」表示该桶没有测试分区记录，因此不提供模型风险中位数；样本不足的桶在单元格内给出原因。</p>
    </div>
  )
}

/** 洞察面板：只按传入的注册项渲染，不含任何具体洞察算法（design D6）。 */
function InsightPanel({ insights, trend }: { insights: readonly TrendInsight[]; trend: TrendAggregate }) {
  return (
    <section className="list-panel trend-insight-panel" aria-label="趋势洞察">
      <h2 className="trend-insight-title">
        趋势洞察
        <span>由当前运行的摘要计算，可注册扩展</span>
      </h2>
      <p className="trend-insight-meta">{INSIGHT_DISCLAIMER}</p>
      {insights.map((insight) => {
        const result = insight.compute(trend)
        return (
          <div key={insight.id} data-insight={insight.kind}>
            <h3 className="trend-insight-title">{insight.label}</h3>
            {result.unavailable ? (
              <p className="trend-insight-meta">{result.reason}</p>
            ) : (
              <>
                <p className="trend-insight-headline">{result.headline}</p>
                <p className="trend-insight-meta">
                  {result.approximate ? (
                    <>
                      <span className="trend-insight-approx">近似</span> 运行只提供中位风险，估计正例数按中位风险折算，不代表期望值。
                    </>
                  ) : (
                    '估计正例数按运行提供的平均风险计算。'
                  )}
                </p>
                <ol className="trend-insight-list">
                  {result.ranking.map((entry) => (
                    <li key={entry.bucket.start} className="trend-insight-row" data-bucket={entry.bucket.start}>
                      <strong>{monthOf(entry.bucket.start)}</strong>
                      <span className="numeric">观测正例（测试）{entry.observed}</span>
                      <span className="numeric">估计正例（测试）{entry.estimated.toFixed(1)}</span>
                      <span className="numeric">率差 {signedPoints(entry.gap)} pp</span>
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
  const sparse = trend.buckets.filter((bucket) => bucket.observedRate.value === null).length
  const withRisk = trend.buckets.filter((bucket) => bucket.risk !== null && bucket.risk.median !== null).length
  return (
    <>
      <div className="section-caption">
        <span>
          历史趋势<b>{trend.buckets.length}</b>
        </span>
        <span>
          粒度：按月 · 时区：{trend.timezone} · 最小样本：{trend.minSample}
        </span>
      </div>
      <section className="list-panel trend-panel" aria-label="历史趋势图">
        <TrendChart data={trend} split={split} />
        <ul className="trend-legend">
          <li>
            <span className="trend-swatch trend-swatch-bar" aria-hidden="true" />
            提交数 · 历史观测
          </li>
          <li>
            <span className="trend-swatch trend-swatch-observed" aria-hidden="true" />
            观测正标签比例 · 历史观测 · 覆盖全部纳入记录
          </li>
          <li>
            <span className="trend-swatch trend-swatch-estimated" aria-hidden="true" />
            模型风险中位数 · 模型估计 · 仅测试区间
          </li>
        </ul>
        <PartitionList split={split} />
        <p className="trend-note">
          背景带按运行摘要的分区范围绘制（越过时间桶范围的按域裁剪）。样本不足的桶不绘制数据点（图中以虚线标出），也不画成 0；
          共 {sparse} 个桶样本不足，{withRisk} 个桶含测试记录的风险分布。观测比例来自发布者历史标签聚合，不是模型效果；风险是模型估计，
          未经概率校准，不等于已确认缺陷。
        </p>
      </section>
      <InsightPanel insights={insights} trend={trend} />
      <section className="list-panel trend-table-panel" aria-label="历史趋势文本视图">
        <h2 className="trend-table-title">同数据的文本视图</h2>
        <TrendTable data={trend} onDrill={(bucket) => navigate(drillSearch(bucket))} />
      </section>
      <section className="list-panel trend-source-panel" aria-label="趋势来源与限制">
        <h2 className="trend-table-title">来源与限制</h2>
        <dl className="identity-list">
          <div>
            <dt>项目与数据版本</dt>
            <dd>
              {data.project} · <code>{data.version}</code>
            </dd>
          </div>
          {data.runId === undefined ? null : (
            <div>
              <dt>运行标识</dt>
              <dd>
                <code>{data.runId}</code>
              </dd>
            </div>
          )}
          {data.model === undefined ? null : (
            <div>
              <dt>模型</dt>
              <dd>
                {data.model.name} · <code>{data.model.id}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>聚合口径</dt>
            <dd>
              按月分桶（{trend.timezone}），桶内提交数低于 {trend.minSample} 时比例与风险分布为空值并附原因
            </dd>
          </div>
          <div>
            <dt>下钻口径</dt>
            <dd>
              以该桶自身起止派生日期范围（结束端取次日零点减一秒），按界面时区 {trend.timezone} 解释且包含两端
            </dd>
          </div>
        </dl>
        {data.summary?.limitations === undefined || data.summary.limitations.length === 0 ? null : (
          <ul className="trend-limits">
            {data.summary.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
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
        {!embedded ? <header className="topbar">JIT · 提交评审 · 历史趋势</header> : null}
        {resource.state === 'loading' ? (
          <LoadingNotice label="正在读取真实历史运行的摘要与趋势聚合。" />
        ) : (
          // useDataset 的失败是纯文本原因；FailureNotice 按错误类型分类会把它换成通用文案，
          // 因此这里沿用工作台的"数据不可用 + 原因 + 重新加载"呈现。
          <EmptyState tone="alert" title="数据不可用" description={resource.error}>
            <Button variant="primary" onClick={retry}>重新加载</Button>
          </EmptyState>
        )}
      </>
    )
  }

  const trend = parseSummaryTrend(resource.data.summary)
  if (expectedRunId && resource.data.runId !== expectedRunId) return <EmptyState title="该历史运行未供给" description="服务已切换运行；请返回验证报告核对来源。"/>
  const go = navigate ?? ((search: string) => window.location.assign(search))

  return (
    <>
      {!embedded ? <>
      <header className="topbar">
        <div>
          <span className="project-symbol">
            <Icon name="project" />
          </span>
          <strong>{resource.data.project}</strong>
          <Icon name="chevron" size={14} />
          <span>历史趋势</span>
        </div>
        <div className="source-meta">
          <span className="demo-badge historical-badge">
            <span />
            真实历史回放
          </span>
          <code title={resource.data.version}>{resource.data.version}</code>
        </div>
      </header>
      {resource.data.runId === undefined ? null : (
        <div className="run-context">
          <span>{resource.data.model?.name}</span>
          <span>
            运行 <code title={resource.data.runId}>{resource.data.runId}</code>
          </span>
        </div>
      )}
      <div className="page-heading">
        <div>
          <h1>历史趋势</h1>
          <p className="page-intro">
            按时间观察发布者历史观测与模型对冻结测试批次的估计。两者语义不同、范围不同，分别标注。{' '}
            <a href="#/validation">返回验证数据列表</a>
          </p>
        </div>
        {trend.state === 'ready' ? (
          <div className="record-count">
            <Icon name="trend" size={20} />
            <div>
              <strong>{trend.data.buckets.length}</strong>
              <span>个时间桶</span>
            </div>
          </div>
        ) : null}
      </div>
      </> : null}
      <div className="demo-notice historical-notice">
        <Icon name="info" size={17} />
        <div>
          <strong>历史观测 · 模型估计</strong>
          <span>
            观测比例来自发布者历史标签聚合，覆盖全部纳入记录；风险是模型对冻结测试批次的估计，未经概率校准，不等于已确认缺陷。整体为回顾性评价。
          </span>
        </div>
      </div>
      {trend.state === 'absent' ? (
        <div className="notice notice-info" role="status">
          <Icon name="info" size={17} />
          <div>
            <strong>该运行未提供趋势聚合</strong>
            <span>
              当前供给的运行产物里没有趋势聚合键，因此没有可核对的时间桶数据。其余视图（提交工作台、详情、优先审查清单与基线摘要）不受影响。
            </span>
            <div className="notice-actions">
              <a href="#/validation">前往验证数据列表</a>
            </div>
          </div>
        </div>
      ) : null}
      {trend.state === 'invalid' ? (
        <div className="notice notice-failure" role="alert">
          <Icon name="info" size={17} />
          <div>
            <strong>趋势聚合不可用</strong>
            <span>
              该运行提供了趋势聚合，但与约定不符：{trend.reason}。这里不展示可疑数值、不沿用上一次结果；工作台、详情、清单与基线摘要不受影响。
            </span>
          </div>
        </div>
      ) : null}
      {trend.state === 'ready' ? (
        <TrendBody data={resource.data} trend={trend.data} insights={insights} navigate={go} />
      ) : null}
      <footer className="page-foot">
        <span>JIT Review</span>
        <span>历史趋势 · 公开数据基线 · 个人审查选择</span>
      </footer>
    </>
  )
}
