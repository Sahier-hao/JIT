/**
 * 项目总览：只回答两个问题——有哪些项目、各自处在什么状态。
 *
 * 项目卡片整卡可点，进入项目页；分析设置与记录都在项目页，列表页不发起分析。
 */
import { EmptyState, LoadingNotice } from '../Feedback'
import { Icon } from '../Icon'
import type { Route } from '../navigation'
import { useRecentSyncs } from '../projectClient'
import { projectStatus } from '../projectStatus'
import { useRepositories } from '../repositoryWorkspace'
import { displayTime } from '../domain'
import { ACTIVE_STATUSES } from '../repositoryContract'

export function ProjectsPage({ navigate }: { navigate: (route: Route) => void }) {
  const repositories = useRepositories()
  const recent = useRecentSyncs(50)
  const items = repositories.state === 'ready' ? repositories.items : []
  const latestBySyncId = new Map(recent.syncs.map(job => [job.syncId, job]))
  const commits = items.reduce((sum, item) => sum + item.commitCount, 0)
  const high = items.reduce((sum, item) => sum + item.distribution.high, 0)
  const running = items.filter(item => {
    const job = item.latestSyncId ? latestBySyncId.get(item.latestSyncId) : undefined
    return job !== undefined && (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  }).length

  return <section className="projects-page">
    <header className="page-heading">
      <div>
        <h1>项目</h1>
        <p className="page-intro">接入一个仓库，从一次分析开始安排下一次审查。</p>
      </div>
      <button className="primary-button" onClick={() => navigate({ name: 'sources' })}><Icon name="plus"/>新建项目</button>
    </header>
    {repositories.state === 'loading' ? <LoadingNotice label="正在读取项目"/> : repositories.state === 'error' ? <EmptyState title="项目读取失败" description={repositories.error} tone="alert"><button onClick={repositories.retry}>重新加载</button></EmptyState> : items.length ? <>
      <div className="section-label"><span>全部项目</span><span>{items.length} 个项目 · {commits.toLocaleString()} 个已分析提交{high ? ` · ${high.toLocaleString()} 个高风险` : ''}{running ? ` · ${running} 个正在分析` : ''}</span></div>
      <div className="project-grid">{items.map(repo => {
        const job = repo.latestSyncId ? latestBySyncId.get(repo.latestSyncId) : undefined
        const status = projectStatus(repo, job)
        return <button className="project-card" key={repo.repositoryId} onClick={() => navigate({ name: 'repository', repositoryId: repo.repositoryId })}>
          <div className="project-card-top"><span className="project-card-icon"><Icon name="project" size={23}/></span><span className={`project-card-status tone-${status.tone}`}>{status.label}</span></div>
          <h2>{repo.displayName}</h2>
          <p>{repo.url}</p>
          <div className="project-card-metrics">
            <span><b>{repo.commitCount.toLocaleString()}</b> 个已分析提交</span>
            {repo.viewSyncId ? <span><b>{repo.distribution.high.toLocaleString()}</b> 个高风险</span> : null}
          </div>
          <div className="project-card-bottom"><span>{repo.viewSyncId ? '打开项目' : '开始分析'}</span><Icon name="arrow"/></div>
          <small>最近请求 · {repo.latestSyncAt ? displayTime(repo.latestSyncAt) : '尚未分析'}</small>
        </button>
      })}</div>
    </> : <div className="project-onboarding">
      <div className="onboarding-graphic" aria-hidden="true"><span/><Icon name="project" size={38}/><span/></div>
      <h2>从一个仓库开始</h2>
      <p>先建立项目，再在项目页决定分析范围；分析完成后，项目会一直保留结果与记录。</p>
      <button className="clear-button" onClick={() => navigate({ name: 'sources' })}>新建项目 <Icon name="arrow"/></button>
      <div className="onboarding-steps"><span><b>01</b> 建立项目</span><span><b>02</b> 发起分析</span><span><b>03</b> 安排审查</span></div>
    </div>}
  </section>
}
