import type { Route } from '../navigation'
import { displayTime } from '../domain'
import { Icon } from '../Icon'
import { EmptyState, LoadingNotice } from '../Feedback'
import type { RepositoryListLoad } from '../repositoryWorkspace'

interface ProjectsPageProps {
  repositories: RepositoryListLoad
  navigate: (route: Route) => void
}

/** 项目列表：加载、失败、列表、空态四种状态只取决于 `useRepositories` 的结果。 */
export function ProjectsPage({ repositories, navigate }: ProjectsPageProps) {
  return (
    <section className="projects-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>项目</h1>
          <p className="page-intro">从一次分析开始，把审查精力放在值得关注的改动上。</p>
        </div>
        <button className="primary-button" onClick={() => navigate({ name: 'sources' })}><Icon name="plus"/>新建分析</button>
      </header>
      {repositories.state === 'loading'
        ? <LoadingNotice label="正在读取项目"/>
        : repositories.state === 'error'
          ? <EmptyState title="项目读取失败" description={repositories.error} tone="alert"><button onClick={repositories.retry}>重新加载</button></EmptyState>
          : repositories.items.length
            ? <>
                <div className="section-label"><span>全部项目</span><span>{repositories.total} 个项目</span></div>
                <div className="project-grid">
                  {repositories.items.map(repo => (
                    <button className="project-card" key={repo.repositoryId} onClick={() => navigate({ name: 'repository', repositoryId: repo.repositoryId })}>
                      <div className="project-card-top">
                        <span className="project-card-icon"><Icon name="project" size={23}/></span>
                        <span className="project-card-status">{repo.viewSyncId ? '已有分析' : '等待分析'}</span>
                      </div>
                      <h2>{repo.displayName}</h2>
                      <p>{repo.url}</p>
                      <div className="project-card-bottom"><span><b>{repo.commitCount.toLocaleString()}</b> 个已分析提交</span><Icon name="arrow"/></div>
                      <small>最近请求 · {repo.latestSyncAt ? displayTime(repo.latestSyncAt) : '尚未发起'}</small>
                    </button>
                  ))}
                </div>
              </>
            : <div className="project-onboarding">
                <div className="onboarding-graphic" aria-hidden="true"><span/><Icon name="project" size={38}/><span/></div>
                <p className="eyebrow">A CLEARER CODE REVIEW</p>
                <h2>从一个仓库开始</h2>
                <p>接入项目，分析提交，再决定下一次审查的重点。</p>
                <button className="clear-button" onClick={() => navigate({ name: 'sources' })}>接入仓库 <Icon name="arrow"/></button>
                <div className="onboarding-steps"><span><b>01</b> 接入项目</span><span><b>02</b> 分析提交</span><span><b>03</b> 安排审查</span></div>
              </div>}
    </section>
  )
}
