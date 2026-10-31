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

import { type Dataset } from './domain'
import { EmptyState, LoadingNotice } from './Feedback'
import { Button } from './ui/controls'
import { Icon } from './Icon'
import { parseSummaryTrend, type TrendAggregate } from './trendContract'
import { TrendChart, PartitionList, TrendTable, monthOf, signedPoints, drillSearch } from './components/report/TrendPanels'
import { DEFAULT_INSIGHTS, INSIGHT_DISCLAIMER, type TrendInsight } from './trendInsights'
import { historicalLoader, useDataset } from './useDataset'
import './trend.css'

function InsightPanel({ insights, trend }: { insights: readonly TrendInsight[]; trend: TrendAggregate }) {
  return (
    <section className="list-panel trend-insight-panel" aria-label="趋势洞察">
      <h2 className="trend-insight-title">趋势洞察</h2>
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
                {result.approximate ? (
                  <p className="trend-insight-meta"><span className="trend-insight-approx">近似</span> 按中位风险折算。</p>
                ) : null}
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
  return (
    <>
      <section className="list-panel trend-panel" aria-label="历史趋势图">
        <TrendChart data={trend} split={split} />
        <ul className="trend-legend">
          <li>
            <span className="trend-swatch trend-swatch-bar" aria-hidden="true" />
            提交数
          </li>
          <li>
            <span className="trend-swatch trend-swatch-observed" aria-hidden="true" />
            观测正标签比例
          </li>
          <li>
            <span className="trend-swatch trend-swatch-estimated" aria-hidden="true" />
            模型风险中位数
          </li>
        </ul>
        <PartitionList split={split} />
        <p className="trend-note">
          样本不足的桶不绘制数据点；模型风险是估计值，未经概率校准。
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
            风险为模型估计，未经概率校准；观测比例来自历史标签聚合。
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
    </>
  )
}
