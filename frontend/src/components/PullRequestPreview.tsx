import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronDown, Search } from 'lucide-react'
import { Segmented } from '../ui/segmented'
import { Button, Input } from '../ui/controls'
import { Dropdown } from '../ui/dropdown'
import { CodeDiff } from '../ui/CodeDiff'
import { PRModelClues } from './PRModelClues'
import { Markdown } from './Markdown'
import { RepositoryExplanation } from './RepositoryExplanation'
import { useSnapshotAnalyses } from '../useSnapshotAnalyses'
import { displayTime } from '../domain'
import type { PRSnapshot } from '../prReviewClient'
import type { Route } from '../navigation'

const stateLabels: Record<string, string> = { open: '开放中', closed: '已关闭', merged: '已合并' }

/** 只读 PR 详情：先看提交，点开某条提交才显示它触及的文件与代码；不写入个人草稿。 */
export function PullRequestPreview({ source, remoteState, repositoryId, navigate, onStart, startLabel = '创建审查工作单', back }: { source: PRSnapshot; remoteState?: PRSnapshot['remoteState'] | null; repositoryId?: string; navigate: (route: Route) => void; onStart: () => void; startLabel?: string; back?: { label: string; onClick: () => void } }) {
  const state = remoteState ?? source.remoteState
  const [filter, setFilter] = useState('')
  const [commitFilter, setCommitFilter] = useState('')
  const [path, setPath] = useState(source.files[0]?.path ?? '')
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const [fileOrder, setFileOrder] = useState<'risk' | 'path'>('risk')
  const [selectedCommit, setSelectedCommit] = useState('')
  const [filesOpen, setFilesOpen] = useState(false)
  const [explanationOpen, setExplanationOpen] = useState(false)
  const [commitOrder, setCommitOrder] = useState<'risk' | 'order'>('risk')
  const analysis = useSnapshotAnalyses(source.snapshotId, source.totalCommits)
  const { fileRisks, commitRisks } = analysis
  useEffect(() => { setSelectedCommit(''); setFilesOpen(false); setExplanationOpen(false); setCommitFilter('') }, [source.snapshotId])
  const needle = filter.trim().toLowerCase()
  const commitNeedle = commitFilter.trim().toLowerCase()
  const matchedCommits = commitNeedle
    ? source.commits.filter(commit => commit.message.toLowerCase().includes(commitNeedle) || commit.sha.toLowerCase().includes(commitNeedle))
    : source.commits
  const commitRows = commitOrder === 'order' ? matchedCommits : [...matchedCommits].sort((a, b) => {
    const left = commitRisks[a.sha]?.risk, right = commitRisks[b.sha]?.risk
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    return right - left
  })
  const scoredCommitCount = source.commits.filter(commit => commitRisks[commit.sha] != null).length
  const explanationRepository = analysis.primary?.sync.repositoryId ?? repositoryId ?? null
  const explanationRisk = selectedCommit ? commitRisks[selectedCommit]?.risk : undefined
  function openCommit(sha: string) {
    setSelectedCommit(sha)
    setFilesOpen(true)
    setExplanationOpen(false)
    const touched = commitRisks[sha]?.files ?? []
    if (touched.length && !touched.includes(path)) setPath(touched[0])
  }
  function backToCommits() { setFilesOpen(false); setSelectedCommit(''); setExplanationOpen(false) }
  const selectedFiles = selectedCommit ? commitRisks[selectedCommit]?.files ?? [] : null
  const scopedFiles = selectedFiles && selectedFiles.length ? source.files.filter(file => selectedFiles.includes(file.path)) : source.files
  const visibleFiles = needle ? scopedFiles.filter(file => file.path.toLowerCase().includes(needle)) : scopedFiles
  const files = fileOrder === 'path' ? visibleFiles : [...visibleFiles].sort((a, b) => (fileRisks[b.path] ?? -1) - (fileRisks[a.path] ?? -1))
  const file = source.files.find(item => item.path === path)
  return <section className="pr-preview" aria-label="PR 只读详情">
    <div className="pr-preview-top">
      <Button variant="ghost" size="sm" onClick={back ? back.onClick : () => navigate(repositoryId ? { name: 'repository', repositoryId, tab: 'prs' } : { name: 'my-reviews' })}>{back ? back.label : `返回${repositoryId ? '项目 PR 审查' : '我的审查'}`}</Button>
      <div className="pr-preview-actions">
        <Button variant="primary" onClick={onStart} title="创建工作单后可标记阅读进度、记录问题并导出意见">{startLabel}</Button>
        <a href={source.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>
      </div>
    </div>
    <header className="pr-preview-head">
      <div>
        <p className="pr-preview-crumb">{source.owner}/{source.name} <span>·</span> #{source.number} <span className={`pr-preview-state is-${state}`}>{stateLabels[state] ?? state}</span> <span className="pr-preview-mode">只读预览</span></p>
        <h1>{source.title}</h1>
        <p className="pr-preview-meta">{source.author} <span>·</span> {source.baseBranch} → {source.headBranch} <span>·</span> 文件 {source.files.length}/{source.totalFiles} <span>·</span> 提交 {source.commits.length}/{source.totalCommits} <span>·</span> 读取于 {displayTime(source.capturedAt)}</p>
      </div>
    </header>
    <PRModelClues analysis={analysis}/>
    {!filesOpen ? <>
      <section className="wb-commit-table is-preview" aria-label="PR 提交风险排序">
        <div className="pr-commit-toolbar">
          <div className="pr-commit-heading">
            <h2>提交风险排序</h2>
            <span className="pr-commit-count">{scoredCommitCount}/{source.commits.length} 有分数</span>
          </div>
          <div className="pr-commit-controls">
            <Input className="pr-commit-search" size="sm" placeholder="搜索提交标题或 SHA" aria-label="搜索 PR 提交" prefix={<Search size={14}/>} allowClear value={commitFilter} onChange={event => setCommitFilter(event.target.value)}/>
            <Dropdown items={[{ key: 'risk', label: '按风险' }, { key: 'order', label: '按提交顺序' }]} onClick={key => setCommitOrder(key as 'risk' | 'order')}>
              <Button variant="ghost" size="sm" className="pr-commit-sort" aria-haspopup="menu" aria-label={`提交排序方式：${commitOrder === 'risk' ? '按风险' : '按提交顺序'}`} trailing={<ChevronDown size={13} aria-hidden/>}>排序：{commitOrder === 'risk' ? '按风险' : '按提交顺序'}</Button>
            </Dropdown>
          </div>
        </div>
        {scoredCommitCount === 0 ? <p className="pr-preview-hint">此版本尚未分析，暂无模型分数。</p> : null}
        {commitRows.length === 0
          ? <p className="pr-preview-hint">没有匹配的提交。可换一个标题片段或提交 SHA。</p>
          : <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">提交 / 改动</th><th scope="col">模型分数</th><th scope="col">变更行</th><th scope="col">文件</th></tr></thead>
              <tbody>
                {commitRows.map(commit => {
                  const info = commitRisks[commit.sha]
                  const lines = info ? (info.addedLines ?? 0) + (info.deletedLines ?? 0) : null
                  return <tr key={commit.sha} tabIndex={0} onClick={() => openCommit(commit.sha)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCommit(commit.sha) } }}>
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
          </div>}
        {commitRows.length ? <p className="pr-commit-hint">选择一条提交，查看它触及的文件与代码。</p> : null}
      </section>
    </> : <>
      <div className="pr-preview-files-bar">
        <Button size="sm" icon={<ArrowLeft size={14}/>} onClick={backToCommits}>提交列表</Button>
        {selectedCommit ? <><code>{selectedCommit.slice(0, 12)}</code>{commitRisks[selectedCommit]?.files.length
          ? <Button size="sm" variant="ghost" title="退出这次提交的范围，看整个 PR" onClick={() => setSelectedCommit('')}>全部 {source.files.length} 个文件</Button>
          : <span className="pr-preview-scope" title="这条提交没有文件映射，文件栏展示整个 PR">全部 {source.files.length} 个文件</span>}</> : <span className="pr-preview-scope">全部 {source.files.length} 个文件</span>}
        {selectedCommit && explanationRisk != null && explanationRepository ? <Button size="sm" variant="ghost" onClick={() => setExplanationOpen(value => !value)}>{explanationOpen ? '收起模型解释' : '模型解释'}</Button> : null}
      </div>
      {explanationOpen && selectedCommit && explanationRepository && explanationRisk != null && analysis.primary ? <div className="pr-preview-explanation">
        <RepositoryExplanation context={{
          repositoryId: explanationRepository,
          viewSyncId: analysis.primary.sync.syncId,
          commitId: selectedCommit,
          risk: explanationRisk,
          modelId: analysis.primary.sync.modelId,
          runId: analysis.primary.sync.runId,
          datasetVersion: analysis.primary.sync.datasetVersion,
        }}/>
      </div> : null}
      <div className="pr-preview-grid">
        <aside className="pr-preview-files" aria-label="PR 文件">
          <div className="pr-preview-pane-head"><h2>文件</h2><span>{source.files.length}/{source.totalFiles}</span></div>
          <Segmented size="sm" aria-label="文件排序" value={fileOrder} onChange={value => setFileOrder(value as 'risk' | 'path')} options={[{ label: '按风险', value: 'risk' }, { label: '按路径', value: 'path' }]}/>
          {selectedCommit && !(commitRisks[selectedCommit]?.files.length) ? <p className="pr-preview-warning">{scoredCommitCount === 0 ? '此版本尚未分析，无法按提交筛选文件；显示全部文件。' : '这条提交没有文件映射（旧分析），显示全部文件。'}</p> : null}
          <Input placeholder="筛选路径" aria-label="筛选 PR 文件路径" value={filter} onChange={event => setFilter(event.target.value)}/>
          <div className="pr-preview-file-list" role="listbox" aria-label="PR 文件列表">
            {files.map((item, index) => <button key={item.path} type="button" role="option" aria-selected={path === item.path} className={`pr-preview-file${path === item.path ? ' is-active' : ''}`} onClick={() => setPath(item.path)}>
              <span className="pr-preview-file-path" title={item.path}><span className="pr-preview-file-name">{item.path.slice(item.path.lastIndexOf('/') + 1)}</span><span className="pr-preview-file-dir">{files[index - 1]?.path.slice(0, files[index - 1].path.lastIndexOf('/')) === item.path.slice(0, item.path.lastIndexOf('/')) ? '' : item.path.slice(0, item.path.lastIndexOf('/'))}</span></span>
              <span className="pr-preview-file-meta"><em className="pr-file-add">+{item.additions}</em>{item.deletions ? <em className="pr-file-del">−{item.deletions}</em> : null}{fileRisks[item.path] != null ? <em className="pr-file-risk" title="该文件涉及提交的最高模型分数；排序参考">{fileRisks[item.path].toFixed(3)}</em> : null}</span>
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
            {file.patch ? <CodeDiff file={file} view={diffView} onAnchor={() => {}}/> : <p className="pr-preview-empty">没有可展示的完整 Diff，不能视作空文件。创建工作单后可读取固定上下文。</p>}
          </> : <p className="pr-preview-empty">这个 PR 没有可展示的文件。</p>}
        </main>
      </div>
    </>}
    <div className="pr-preview-details">
      <details><summary>作者说明</summary>{source.body ? <div className="pr-preview-body"><Markdown>{source.body}</Markdown></div> : <p className="pr-preview-no-body">作者没有填写说明</p>}</details>
    </div>
  </section>
}
