import { displayTime, riskTone, safeRisk, scoreText, type Commit } from '../../domain'
import { Icon } from '../../Icon'

interface ReviewTableProps {
  commits: Commit[]
  shortlist: string[]
  onOpen: (id: string, trigger: HTMLButtonElement) => void
  onAdd: (id: string) => void
  onRemove?: (id: string) => void
}

/** 提交表：清单视图和计划视图共用；`onRemove` 存在时表示当前在计划里。 */
export function ReviewTable({ commits, shortlist, onOpen, onAdd, onRemove }: ReviewTableProps) {
  return (
    <div className="review-table-wrap">
      <div className="table-scroll"><table className="review-table">
        <caption className="sr-only">仓库提交风险列表，按模型分数从高到低</caption>
        <thead>
          <tr>
            <th>提交 / 改动</th>
            <th className="th-risk">模型分数</th>
            <th className="numeric">变更行</th>
            <th className="numeric">文件</th>
            <th className="action-head"><span className="sr-only">审查选择</span></th>
          </tr>
        </thead>
        <tbody>
          {commits.map(commit => {
            return (
              <tr key={commit.id} data-tone={riskTone(safeRisk(commit.risk))}>
                <td className="commit-cell">
                  <i className="row-mark" aria-hidden="true" />
                  <button
                    className="commit-link"
                    title={commit.id}
                    aria-label={`查看 ${commit.id}`}
                    onClick={event => onOpen(commit.id, event.currentTarget)}
                  >
                    <span className="commit-title">{commit.title || '未提供标题'}</span><code>{commit.id.slice(0, 8)}</code>
                  </button>
                  <span className="commit-meta">
                    <span>{commit.authorName || '作者未提供'} · </span>
                    <time dateTime={commit.time}>{displayTime(commit.time).slice(0, 16)}</time>
                  </span>
                </td>
                <td className="risk-cell">
                  <b className="risk-value">{scoreText(safeRisk(commit.risk))}</b>
                  <span className="risk-track" aria-hidden="true">
                    <i style={{ width: `${Math.round((safeRisk(commit.risk) ?? 0) * 100)}%` }} className="risk-fill" />
                  </span>
                </td>
                <td className="numeric">{commit.lines === undefined ? '—' : commit.lines.toLocaleString()}</td>
                <td className="numeric">{commit.files === undefined ? '—' : commit.files.toLocaleString()}</td>
                <td className="action-cell">
                  <button
                    className="row-action"
                    aria-label={onRemove ? `从计划移除 ${commit.id}` : shortlist.includes(commit.id) ? `${commit.id} 已在清单` : `加入 ${commit.id} 到清单`}
                    disabled={!onRemove && shortlist.includes(commit.id)}
                    onClick={() => onRemove ? onRemove(commit.id) : onAdd(commit.id)}
                  >
                    <Icon name={onRemove ? 'close' : shortlist.includes(commit.id) ? 'check' : 'plus'} size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
    </div>
  )
}
