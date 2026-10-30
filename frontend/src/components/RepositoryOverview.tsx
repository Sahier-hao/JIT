import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ECharts } from 'echarts/core'
import { Button } from '../ui/controls'
import { EChartCanvas, chartTooltip, escapeHtml, useChartColors, type ChartColors, type ChartOption } from '../ui/chart'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { getRepositoryOverview, type RepositoryOverview, type RepositoryOverviewActivity, type RepositoryOverviewLanguage } from '../repositoryOverviewClient'
import { cacheKey, readCache, writeCache } from '../lib/localCache'
import type { RepositoryView } from '../repositoryWorkspace'

function compact(value: string | null) {
  return value ? displayTime(value) : '未提供'
}

function isPartialWeek(weekStart: string, fetchedAt: string | null): boolean {
  const start = Date.parse(`${weekStart}T00:00:00Z`)
  const fetched = fetchedAt ? Date.parse(fetchedAt) : Number.NaN
  return Number.isFinite(start) && Number.isFinite(fetched) && start + 7 * 86_400_000 > fetched
}

function tooltipIndex(params: unknown): number {
  const list = Array.isArray(params) ? params : [params]
  const first = list[0] as { dataIndex?: unknown } | undefined
  return typeof first?.dataIndex === 'number' ? first.dataIndex : 0
}

function activityOption(activity: RepositoryOverviewActivity[], fetchedAt: string | null, colors: ChartColors): ChartOption {
  const counts = activity.map(item => item.commits)
  return {
    animationDuration: 360,
    grid: { left: 46, right: 16, top: 18, bottom: 30 },
    tooltip: {
      ...chartTooltip(colors),
      formatter: (params: unknown) => {
        const item = activity[tooltipIndex(params)]
        if (!item) return ''
        const note = isPartialWeek(item.weekStart, fetchedAt) ? '（本周进行中）' : ''
        return `<strong>${escapeHtml(item.weekStart)} 起一周</strong><br/>${item.commits.toLocaleString()} 个提交${note}`
      },
    },
    xAxis: {
      type: 'category', data: activity.map(item => item.weekStart), boundaryGap: false,
      axisLine: { lineStyle: { color: colors.axis } }, axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 11, hideOverlap: true, formatter: (value: string) => value.slice(5) },
    },
    yAxis: {
      type: 'value', minInterval: 1, splitNumber: 4,
      axisLabel: { color: colors.text, fontSize: 11 },
      splitLine: { lineStyle: { color: colors.grid, width: 1 } },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      name: '周提交', type: 'line', data: counts,
      showSymbol: activity.length <= 30, symbol: 'circle', symbolSize: 8,
      lineStyle: { width: 2, color: colors.series, cap: 'round', join: 'round' },
      itemStyle: { color: colors.series, borderColor: colors.surface, borderWidth: 2 },
      areaStyle: { color: colors.series, opacity: 0.1 },
      emphasis: { focus: 'series' },
    }],
  }
}

function ActivityChart({ activity, coverage, fetchedAt }: { activity: RepositoryOverviewActivity[]; coverage: string | null; fetchedAt: string | null }) {
  const colors = useChartColors()
  const chart = useRef<ECharts | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const option = useMemo(() => activityOption(activity, fetchedAt, colors), [activity, fetchedAt, colors])
  const total = activity.reduce((sum, item) => sum + item.commits, 0)
  const max = Math.max(0, ...activity.map(item => item.commits))
  const tableTitle = coverage === 'last-52-weeks' ? '最近 52 周' : '最近 12 周'
  const show = (index: number) => {
    setActive(index)
    chart.current?.dispatchAction({ type: 'downplay', seriesIndex: 0 })
    chart.current?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: index })
    chart.current?.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: index })
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (!activity.length) return
    const at = active ?? activity.length - 1
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(Math.max(0, at - 1)) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); show(Math.min(activity.length - 1, at + 1)) }
    else if (event.key === 'Home') { event.preventDefault(); show(0) }
    else if (event.key === 'End') { event.preventDefault(); show(activity.length - 1) }
    else if (event.key === 'Escape') { setActive(null); chart.current?.dispatchAction({ type: 'downplay', seriesIndex: 0 }); chart.current?.dispatchAction({ type: 'hideTip' }) }
  }
  const current = active == null ? null : activity[active]
  return <div className="repo-chart">
    <div className="repo-activity-facts">
      <span><b>{total.toLocaleString()}</b>个提交</span>
      <span><b>{max.toLocaleString()}</b>单周峰值</span>
      <span><b>{Math.round(total / Math.max(1, activity.length)).toLocaleString()}</b>周均</span>
    </div>
    {activity.length ? <div className="repo-activity-chart" tabIndex={0} role="group" aria-label={`最近 ${activity.length} 周每周提交量曲线；左右方向键逐周查看，等价数据表在本卡下方`} onKeyDown={keys} onFocus={() => { if (active === null) show(activity.length - 1) }} onBlur={() => { setActive(null); chart.current?.dispatchAction({ type: 'hideTip' }) }}>
      <EChartCanvas option={option} height={220} label={`最近 ${activity.length} 周每周提交量曲线`} onChart={instance => { chart.current = instance }}/>
    </div> : <p className="quiet-empty">GitHub 没有返回周提交统计。</p>}
    <p className="chart-readout" role="status" aria-live="polite">{current ? `${current.weekStart} 起一周 · ${current.commits.toLocaleString()} 个提交${isPartialWeek(current.weekStart, fetchedAt) ? '（本周进行中）' : ''}` : '悬停曲线或聚焦后用左右方向键查看每周数量；等价数据表提供全部数值。'}</p>
    <p className="form-hint">{coverage === 'last-52-weeks' ? 'GitHub 默认分支最近 52 周周提交统计，最后一周为读取时仍在进行的本周。' : '按周统计最近 100 条公开提交，不是完整仓库历史。'}</p>
    <details className="repo-table-details"><summary>查看等价数据表</summary><table className="trend-data-table"><caption>{tableTitle}提交量</caption><thead><tr><th scope="col">周起始</th><th scope="col">提交数</th></tr></thead><tbody>{activity.map(item => <tr key={item.weekStart}><th scope="row">{item.weekStart}</th><td>{item.commits}</td></tr>)}</tbody></table></details>
  </div>
}

interface LanguageSlice { name: string; bytes: number; percent: number; color: string }

function languagePercent(item: Pick<LanguageSlice, 'bytes' | 'percent'>): string {
  return item.bytes > 0 && item.percent < 0.1 ? '<0.1%' : `${item.percent.toFixed(1)}%`
}

function languageSlices(languages: RepositoryOverviewLanguage[], colors: ChartColors): LanguageSlice[] {
  const sorted = [...languages].sort((left, right) => right.bytes - left.bytes)
  const head = sorted.length > 6 ? sorted.slice(0, 5) : sorted
  const slices = head.map((item, index) => ({ ...item, color: colors.categorical[index] ?? colors.other }))
  const rest = sorted.slice(head.length)
  if (rest.length) {
    slices.push({
      name: '其他',
      bytes: rest.reduce((sum, item) => sum + item.bytes, 0),
      percent: Math.round(rest.reduce((sum, item) => sum + item.percent, 0) * 10) / 10,
      color: colors.other,
    })
  }
  return slices
}

function languageOption(slices: LanguageSlice[], colors: ChartColors): ChartOption {
  return {
    animationDuration: 360,
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: [8, 10],
      textStyle: { color: colors.textStrong, fontSize: 12, lineHeight: 19 },
      extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);',
      formatter: (params: unknown) => {
        const item = (params as { data?: { name?: string; percent?: number; bytes?: number } }).data
        if (!item) return ''
        return `<strong>${escapeHtml(String(item.name ?? ''))}</strong><br/>${languagePercent({ bytes: Number(item.bytes ?? 0), percent: Number(item.percent ?? 0) })} · ${Number(item.bytes ?? 0).toLocaleString()} 字节`
      },
    },
    series: [{
      type: 'pie', radius: ['54%', '78%'], center: ['50%', '50%'], avoidLabelOverlap: true,
      label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4 },
      data: slices.map(item => ({ name: item.name, value: item.bytes, percent: item.percent, bytes: item.bytes, itemStyle: { color: item.color } })),
      emphasis: { scale: true, scaleSize: 4 },
    }],
  }
}

function LanguageChart({ languages }: { languages: RepositoryOverviewLanguage[] }) {
  const colors = useChartColors()
  const slices = useMemo(() => languageSlices(languages, colors), [languages, colors])
  const option = useMemo(() => languageOption(slices, colors), [slices, colors])
  const total = languages.reduce((sum, item) => sum + item.bytes, 0)
  return <>
    <div className="repo-language-chart">
      <EChartCanvas option={option} height={216} label="语言构成环形图；各语言名称、占比与字节数见旁边图例和等价数据表" className="ui-chart repo-language-donut"/>
      <ul className="repo-language-legend">
        {slices.map(item => <li key={item.name}>
          <span className="repo-language-swatch" style={{ background: item.color }} aria-hidden="true"/>
          <span className="repo-language-name">{item.name}</span>
          <b>{languagePercent(item)}</b>
          <small>{item.bytes.toLocaleString()} 字节</small>
        </li>)}
      </ul>
    </div>
    <details className="repo-table-details"><summary>查看等价数据表</summary><table className="trend-data-table"><caption>语言构成（GitHub 字节统计，共 {total.toLocaleString()} 字节）</caption><thead><tr><th scope="col">语言</th><th scope="col">字节</th><th scope="col">占比</th></tr></thead><tbody>{slices.map(item => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.bytes.toLocaleString()}</td><td>{languagePercent(item)}</td></tr>)}</tbody></table></details>
  </>
}

export function RepositoryOverviewView({ repositoryId, repository, onStartAnalysis, onOpenAnalysis }: { repositoryId: string; repository: RepositoryView; onStartAnalysis: () => void; onOpenAnalysis: () => void }) {
  const cache = cacheKey('overview-v2', repositoryId)
  const [overview, setOverview] = useState<RepositoryOverview | null>(() => readCache<RepositoryOverview>(cache, 30 * 60_000))
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    getRepositoryOverview(repositoryId, attempt > 0, controller.signal).then(value => { if (!controller.signal.aborted) { setOverview(value); if (value.supported && !value.errorCode) writeCache(cache, value) } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [repositoryId, attempt])
  const metadata = overview?.metadata ?? null
  const hasAnalysis = Boolean(repository.viewSyncId)
  return <section className="repo-overview" aria-label="仓库概览">
    <div className="repo-overview-head">
      <div>
        <p className="page-intro">{metadata?.description || '公开仓库概览。这里只展示仓库事实，不是模型分数或缺陷率。'}</p>
        {metadata ? <p className="repo-overview-meta"><span>{metadata.fullName}</span><span>{metadata.defaultBranch ? `默认分支 ${metadata.defaultBranch}` : '默认分支未知'}</span><span>{metadata.private ? '私有' : '公开'}</span>{metadata.license ? <span>{metadata.license}</span> : null}<a href={metadata.htmlUrl} target="_blank" rel="noreferrer">在 GitHub 打开</a></p> : <p className="repo-overview-meta"><span>{repository.url}</span><a href={repository.url} target="_blank" rel="noreferrer">在 GitHub 打开</a></p>}
      </div>
      <Button variant={hasAnalysis ? 'secondary' : 'primary'} onClick={hasAnalysis ? onOpenAnalysis : onStartAnalysis}>{hasAnalysis ? '查看分析结果' : '发起第一次分析'}</Button>
    </div>
    {loading && !overview ? <LoadingNotice label="正在读取仓库概览"/> : null}
    {error ? <FailureNotice error={error} onRetry={() => setAttempt(value => value + 1)}/> : null}
    {overview && !overview.supported ? <div className="repo-empty"><h2>此项目不支持 GitHub 仓库概览</h2><p>分支分析和风险趋势仍可使用。仓库概览只读取公开 GitHub 元数据，不访问私有来源。</p></div> : null}
    {overview?.supported && !metadata ? <div className="repo-empty"><h2>仓库概览暂时不可用</h2><p>{overview.errorCode === 'PR_RATE_LIMITED' ? 'GitHub 匿名额度受限，稍后重试；不影响项目分析。' : '无法读取 GitHub 仓库信息，可以稍后重试；不影响项目分析。'}</p><Button onClick={() => setAttempt(value => value + 1)}>重新读取概览</Button></div> : null}
    {overview?.stale ? <p className="status-note">显示上次缓存的概览（读取于 {compact(overview.fetchedAt)}），GitHub 暂时不可用。</p> : null}
    {overview && metadata ? <>
      <div className="repo-stats">
        <div><b>{metadata.stars.toLocaleString()}</b><span>stars</span></div>
        <div><b>{metadata.forks.toLocaleString()}</b><span>forks</span></div>
        <div><b>{metadata.openIssues.toLocaleString()}</b><span>开放 issue/PR</span></div>
        <div><b>{metadata.watchers.toLocaleString()}</b><span>watchers</span></div>
        <div><b>{compact(metadata.pushedAt)}</b><span>最近推送</span></div>
      </div>
      <div className="repo-charts">
        <section className="repo-chart-card" aria-label="仓库活跃度">
          <div className="section-label"><h2>仓库活跃度</h2><span>{overview.activityCoverage === 'last-52-weeks' ? '近一年 · 按周' : '最近 12 周'}</span></div>
          <ActivityChart activity={overview.activity} coverage={overview.activityCoverage} fetchedAt={overview.fetchedAt}/>
        </section>
        <section className="repo-chart-card" aria-label="语言构成">
          <div className="section-label"><h2>语言构成</h2><span>GitHub 字节统计</span></div>
          {overview.languages.length ? <LanguageChart languages={overview.languages}/> : <p className="quiet-empty">GitHub 没有返回语言统计。</p>}
          <p className="form-hint">语言构成是 GitHub 按字节统计，不是代码质量。</p>
        </section>
      </div>
      <section className="repo-commits" aria-label="最近提交">
        <div className="section-label"><h2>最近提交</h2><span>最多 10 条</span></div>
        {overview.recentCommits.length ? <ul>{overview.recentCommits.map(commit => <li key={commit.sha}><a href={commit.url} target="_blank" rel="noreferrer"><code>{commit.sha.slice(0, 7)}</code> {commit.message}</a><span>{commit.author} · {compact(commit.date)}</span></li>)}</ul> : <p className="quiet-empty">GitHub 没有返回最近提交。</p>}
      </section>
      {metadata.topics.length ? <p className="repo-topics">{metadata.topics.map(topic => <span key={topic}>{topic}</span>)}</p> : null}
      <p className="form-hint">仓库概览读取于 {compact(overview.fetchedAt)}；GitHub 公开数据，不是模型分数或缺陷率。</p>
    </> : null}
    {!hasAnalysis ? <div className="repo-callout"><div><strong>还没有分析结果</strong><p>发起分析后，模型分数和提交阅读顺序在「分析」页；这页保持仓库基本信息不变。</p></div><Button variant="primary" onClick={onStartAnalysis}>发起分析</Button></div> : null}
  </section>
}
