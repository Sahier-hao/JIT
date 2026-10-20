import { displayTime } from '../../domain'
import type { RepositoryDetail } from '../../repositoryWorkspace'

/** 固定的成功分析头部：名称、完成时间、分支、提交数与风险分布条。 */
export function RepositoryHead({ repository, total }: { repository: RepositoryDetail; total: number }) {
  const { high, medium, low, unknown } = repository.distribution
  const segments = [
    { key: 'high', value: high, label: '高' },
    { key: 'medium', value: medium, label: '中' },
    { key: 'low', value: low, label: '低' },
  ].filter(segment => segment.value > 0)
  return (
    <header className="review-head">
      <div className="review-head-main">
        <h1>{repository.displayName}</h1>
        <p className="t-meta">
          {repository.viewContext?.completedAt ? `分析完成 ${displayTime(repository.viewContext.completedAt)}` : '旧分析未记录完成时间'}
          <span className="meta-sep" aria-hidden="true">·</span>
          {repository.viewContext?.branch ?? '未提供'} 分支
          <span className="meta-sep" aria-hidden="true">·</span>
          {total.toLocaleString()} 个已分析提交
        </p>
      </div>
      <div className="dist-wrap">
        <div
          className="dist"
          role="img"
          aria-label={`风险分布：高 ${high}，中 ${medium}，低 ${low}${unknown ? `，未知 ${unknown}` : ''}`}
        >
          {segments.length === 0
            ? <i className="dist-empty" />
            : segments.map(segment => (
              <i key={segment.key} className={`dist-${segment.key}`} style={{ flex: segment.value }} />
            ))}
        </div>
        <p className="dist-legend">
          <span className="dist-high-fg">高 {high}</span>
          <span className="dist-medium-fg">中 {medium}</span>
          <span className="dist-low-fg">低 {low}</span>
        </p>
      </div>
    </header>
  )
}
