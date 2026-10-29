import { useEffect, useState } from 'react'
import { Button } from '../ui/controls'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { getRepositoryOverview, type RepositoryOverview, type RepositoryOverviewActivity } from '../repositoryOverviewClient'
import type { RepositoryView } from '../repositoryWorkspace'

function compact(value: string | null) {
  return value ? displayTime(value) : '未提供'
}

function ActivityChart({ activity, coverage }: { activity: RepositoryOverviewActivity[]; coverage: string | null }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...activity.map(item => item.commits))
  return <div className="repo-chart">
    <div className="repo-activity" role="group" aria-label="最近 12 周提交量">
      {activity.map((item, index) => <button key={item.weekStart} type="button" className="repo-activity-bar" aria-label={`${item.weekStart} 起一周 ${item.commits} 个提交`} data-active={active === index ? 'true' : undefined} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onBlur={() => setActive(null)}>
        <span className="repo-activity-track"><span className="repo-activity-fill" style={{ height: item.commits ? `${Math.round(item.commits / max * 100)}%` : 0 }}/></span>
        <span className="repo-activity-label">{item.weekStart.slice(5)}</span>
      </button>)}
      {active !== null ? <p className="repo-chart-tip" role="status">{activity[active].weekStart} 起一周 · {activity[active].commits} 个提交</p> : null}
    </div>
    <p className="form-hint">按周统计最近 100 条公开提交{coverage === 'last-100-commits' ? '，不是完整仓库历史' : ''}；峰值 {max} 个提交/周。</p>
    <details className="repo-table-details"><summary>查看等价数据表</summary><table className="trend-data-table"><caption>最近 12 周提交量</caption><thead><tr><th scope="col">周起始</th><th scope="col">提交数</th></tr></thead><tbody>{activity.map(item => <tr key={item.weekStart}><th scope="row">{item.weekStart}</th><td>{item.commits}</td></tr>)}</tbody></table></details>
  </div>
}

export function RepositoryOverviewView({ repositoryId, repository, onStartAnalysis, onOpenAnalysis }: { repositoryId: string; repository: RepositoryView; onStartAnalysis: () => void; onOpenAnalysis: () => void }) {
  const [overview, setOverview] = useState<RepositoryOverview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    getRepositoryOverview(repositoryId, attempt > 0, controller.signal).then(value => { if (!controller.signal.aborted) setOverview(value) })
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
          <div className="section-label"><h2>仓库活跃度</h2><span>最近 12 周</span></div>
          <ActivityChart activity={overview.activity} coverage={overview.activityCoverage}/>
        </section>
        <section className="repo-chart-card" aria-label="语言构成">
          <div className="section-label"><h2>语言构成</h2><span>GitHub 字节统计</span></div>
          {overview.languages.length ? <div className="repo-languages">{overview.languages.map(item => <div className="repo-language" key={item.name}><div><span>{item.name}</span><span>{item.percent}%</span></div><div className="repo-language-track"><span style={{ width: `${item.percent}%` }}/></div><small>{item.bytes.toLocaleString()} 字节</small></div>)}</div> : <p className="quiet-empty">GitHub 没有返回语言统计。</p>}
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
