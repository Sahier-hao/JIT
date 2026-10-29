import { useEffect, useState } from 'react'
import { Segmented } from '../ui/segmented'
import { Button, Input } from '../ui/controls'
import { CodeDiff } from '../ui/CodeDiff'
import { PRModelClues } from './PRModelClues'
import { displayTime } from '../domain'
import type { PRSnapshot } from '../prReviewClient'
import type { Route } from '../navigation'

const stateLabels: Record<string, string> = { open: '开放中', closed: '已关闭', merged: '已合并' }

/** 只读 PR 详情：不写入个人草稿，只有用户点「开始审查」才进入工作单。 */
export function PullRequestPreview({ source, remoteState, repositoryId, navigate, onStart }: { source: PRSnapshot; remoteState?: PRSnapshot['remoteState'] | null; repositoryId?: string; navigate: (route: Route) => void; onStart: () => void }) {
  const state = remoteState ?? source.remoteState
  const [filter, setFilter] = useState('')
  const [path, setPath] = useState(source.files[0]?.path ?? '')
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const [fileRisks, setFileRisks] = useState<Record<string, number>>({})
  const [fileOrder, setFileOrder] = useState<'risk' | 'path'>('risk')
  const [commitRisks, setCommitRisks] = useState<Record<string, { risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }>>({})
  const [selectedCommit, setSelectedCommit] = useState('')
  useEffect(() => { setSelectedCommit(''); setFileRisks({}); setCommitRisks({}) }, [source.snapshotId])
  const needle = filter.trim().toLowerCase()
  const commitRows = [...source.commits].sort((a, b) => {
    const left = commitRisks[a.sha]?.risk, right = commitRisks[b.sha]?.risk
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    return right - left
  })
  const scoredCommitCount = commitRows.filter(commit => commitRisks[commit.sha] != null).length
  function chooseCommit(sha: string) {
    setSelectedCommit(sha)
    const touched = commitRisks[sha]?.files ?? []
    if (touched.length && !touched.includes(path)) setPath(touched[0])
  }
  const selectedFiles = selectedCommit ? commitRisks[selectedCommit]?.files ?? [] : null
  const scopedFiles = selectedFiles && selectedFiles.length ? source.files.filter(file => selectedFiles.includes(file.path)) : source.files
  const visibleFiles = needle ? scopedFiles.filter(file => file.path.toLowerCase().includes(needle)) : scopedFiles
  const files = fileOrder === 'path' ? visibleFiles : [...visibleFiles].sort((a, b) => (fileRisks[b.path] ?? -1) - (fileRisks[a.path] ?? -1))
  const file = source.files.find(item => item.path === path)
  return <section className="pr-preview" aria-label="PR 只读详情">
    <div className="pr-preview-top">
      <Button variant="ghost" size="sm" onClick={() => navigate(repositoryId ? { name: 'repository', repositoryId, tab: 'prs' } : { name: 'my-reviews' })}>返回{repositoryId ? '项目 PR 审查' : '我的审查'}</Button>
      <div className="pr-preview-actions">
        <Button variant="primary" onClick={onStart}>开始审查</Button>
        <a href={source.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>
      </div>
    </div>
    <header className="pr-preview-head">
      <div>
        <p className="pr-preview-crumb">{source.owner}/{source.name} <span>·</span> #{source.number} <span className={`pr-preview-state is-${state}`}>{stateLabels[state] ?? state}</span></p>
        <h1>{source.title}</h1>
        <p className="pr-preview-meta">{source.author} <span>·</span> {source.baseBranch} → {source.headBranch} <span>·</span> 文件 {source.files.length}/{source.totalFiles} <span>·</span> 提交 {source.commits.length}/{source.totalCommits} <span>·</span> 读取于 {displayTime(source.capturedAt)}</p>
      </div>
    </header>
    <p className="pr-preview-note">只读预览。先看提交风险排序，再读文件；点「开始审查」创建工作单。</p>
    <PRModelClues readOnly source={source} navigate={navigate} onModelId={() => {}} onFileRisks={setFileRisks} onCommitRisks={setCommitRisks}/>
    <section className="wb-commit-table is-preview" aria-label="PR 提交风险排序">
      <div className="wb-commit-table-head">
        <h2>提交风险排序</h2>
        <span>{scoredCommitCount}/{source.commits.length} 有分数</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">提交 / 改动</th><th scope="col">模型分数</th><th scope="col">变更行</th><th scope="col">文件</th></tr></thead>
          <tbody>
            {commitRows.map(commit => {
              const info = commitRisks[commit.sha]
              const lines = info ? (info.addedLines ?? 0) + (info.deletedLines ?? 0) : null
              return <tr key={commit.sha} tabIndex={0} onClick={() => chooseCommit(commit.sha)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseCommit(commit.sha) } }}>
                <td>
                  <div className="wb-commit-title"><span>{commit.message.split('\n')[0]}</span><code className="wb-commit-sha">{commit.sha.slice(0, 12)}</code></div>
                </td>
                <td><span className={`wb-commit-risk${info ? '' : ' is-unknown'}`}>{info ? info.risk.toFixed(2) : '未评分'}</span></td>
                <td className="numeric">{lines == null ? '—' : lines.toLocaleString()}</td>
                <td className="numeric">{info?.fileCount ?? '—'}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </section>
    <div className="pr-preview-grid">
      <aside className="pr-preview-files" aria-label="PR 文件">
        <div className="pr-preview-pane-head"><h2>文件</h2><span>{source.files.length}/{source.totalFiles}</span>{selectedCommit ? <Button size="sm" variant="ghost" onClick={() => setSelectedCommit('')}>全部文件</Button> : null}</div>
        <Segmented size="sm" aria-label="文件排序" value={fileOrder} onChange={value => setFileOrder(value as 'risk' | 'path')} options={[{ label: '按风险', value: 'risk' }, { label: '按路径', value: 'path' }]}/>
        {selectedCommit && !(commitRisks[selectedCommit]?.files.length) ? <p className="pr-preview-warning">这条提交没有文件映射（旧分析），显示全部文件。</p> : null}
        <Input placeholder="筛选路径" aria-label="筛选 PR 文件路径" value={filter} onChange={event => setFilter(event.target.value)}/>
        <div className="pr-preview-file-list" role="listbox" aria-label="PR 文件列表">
          {files.map(item => <button key={item.path} type="button" role="option" aria-selected={path === item.path} className={`pr-preview-file${path === item.path ? ' is-active' : ''}`} onClick={() => setPath(item.path)}>
            <span className="pr-preview-file-path" title={item.path}>{item.path}</span>
            <span className="pr-preview-file-meta"><em className="pr-file-add">+{item.additions}</em><em className="pr-file-del">−{item.deletions}</em>{fileRisks[item.path] != null ? <em className="pr-file-risk" title="该文件涉及提交的最高模型分数；排序参考">{fileRisks[item.path].toFixed(3)}</em> : null}</span>
          </button>)}
          {!files.length ? <p className="quiet-empty">没有匹配的文件。</p> : null}
        </div>
        {!source.filesComplete ? <p className="pr-preview-warning">文件范围未完整加载，已获取 {source.files.length}/{source.totalFiles}；未覆盖不等于没有问题。</p> : null}
      </aside>
      <main className="pr-preview-code">
        {file ? <>
          <div className="pr-preview-code-head">
            <div><code>{file.path}</code><span>{file.previousPath ? `重命名自 ${file.previousPath}` : ''}</span></div>
            <Segmented size="sm" value={diffView} onChange={value => setDiffView(value as 'unified' | 'split')} options={[{ label: '统一', value: 'unified' }, { label: '并排', value: 'split' }]}/>
          </div>
          {file.patch ? <CodeDiff file={file} view={diffView} onAnchor={() => {}}/> : <p className="pr-preview-empty">没有可展示的完整 Diff，不能视作空文件。开始审查后可读取固定上下文。</p>}
        </> : <p className="pr-preview-empty">这个 PR 没有可展示的文件。</p>}
      </main>
    </div>
    <div className="pr-preview-details">
      <details open><summary>作者说明</summary><pre className="pr-preview-body">{source.body || '作者没有填写说明'}</pre></details>
    </div>
  </section>
}
