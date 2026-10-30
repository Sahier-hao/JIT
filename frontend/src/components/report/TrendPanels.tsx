import { shanghaiDate, type BaselineSummary } from '../../domain'
import { type TrendAggregate, type TrendBucket, type TrendMeasure } from '../../trendContract'
import { Button } from '../../ui/controls'

type Split = BaselineSummary['split']

const CHART = { width: 760, height: 280, left: 58, right: 52, top: 20, bottom: 40 }

const PARTITION_LABELS: Record<string, string> = { train: '训练', validation: '验证', test: '测试' }

function partitionLabel(key: string): string {
  return PARTITION_LABELS[key] ?? key
}

/** 时区在契约里固定为 UTC+08:00，因此 ISO 串的前 7 位就是该桶所在月份。 */
export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function signedPoints(value: number): string {
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

export function drillSearch(bucket: TrendBucket): string {
  const range = drillRange(bucket)
  return `/?mode=historical&start=${range.start}&end=${range.end}#/validation`
}

export function TrendChart({ data, split }: { data: TrendAggregate; split: Split | undefined }) {
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
export function PartitionList({ split }: { split: Split | undefined }) {
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

export function TrendTable({ data, onDrill }: { data: TrendAggregate; onDrill: (bucket: TrendBucket) => void }) {
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
