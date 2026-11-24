import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { X, Search, ChevronDown, ArrowLeft } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { useEffect, useState } from 'react'



import { ReviewCode } from '@/features/reviews/components/ReviewCode'


import { PRModelClues } from '@/features/reviews/components/PRModelClues'
import { Markdown } from '@/components/shared/Markdown'
import { RepositoryExplanation } from '@/features/projects/components/RepositoryExplanation'
import type { PRCandidate, PRSnapshot } from '@/features/reviews/prReviewClient'
import { addCandidateToRound, openReviewVersion, readWorks, saveWork, workKey, type PRWork } from '@/features/reviews/prReview'
import { requireAccount, useReviewAccount } from '@/features/reviews/reviewAccount'
import { usePRCandidateChecks } from '@/features/reviews/usePRCandidateChecks'
import { useSnapshotAnalyses } from '@/features/projects/useSnapshotAnalyses'
import { displayTime } from '@/lib/domain'

import { repositoryRoute, type Route } from '@/app/navigation'
import { cn } from '@/lib/utils'

const stateLabels: Record<string, string> = { open: '开放中', closed: '已关闭', merged: '已合并' }
const STATE_CLASS: Record<string, string> = { open: 'bg-teal-soft text-teal-deep', closed: 'bg-soft text-foreground-3', merged: 'bg-blue-soft text-blue-deep' }

/** 只读 PR 详情：先看提交，点开某条提交才显示它触及的文件与代码；不写入个人草稿。 */
export function PullRequestPreview({ source, remoteState, repositoryId, navigate, onStart, onDraft, startLabel = '创建审查工作单', back }: {
  source: PRSnapshot; remoteState?: PRSnapshot['remoteState'] | null; repositoryId?: string
  navigate: (route: Route) => void; onStart: () => void; onDraft?: (work: PRWork) => void
  startLabel?: string; back?: { label: string; onClick: () => void }
}) {
  const state = remoteState ?? source.remoteState
  const reviewAccount = useReviewAccount()
  const firstPath = source.files[0]?.path ?? ''
  const [filter, setFilter] = useState('')
  const [commitFilter, setCommitFilter] = useState('')
  const [path, setPath] = useState(firstPath)
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const [fileOrder, setFileOrder] = useState<'risk' | 'path'>('risk')
  const [selectedCommit, setSelectedCommit] = useState('')
  const [filesOpen, setFilesOpen] = useState(false)
  const [explanationOpen, setExplanationOpen] = useState(false)
  const [commitOrder, setCommitOrder] = useState<'risk' | 'order'>('risk')
  const [draftError, setDraftError] = useState('')
  const checks = usePRCandidateChecks(filesOpen ? source.snapshotId : '')
  const analysis = useSnapshotAnalyses(source.snapshotId, source.totalCommits)
  const { fileRisks, commitRisks } = analysis
  useEffect(() => { setSelectedCommit(''); setFilesOpen(false); setExplanationOpen(false); setCommitFilter(''); setPath(firstPath); setDraftError('') }, [source.snapshotId, firstPath])
  function addCandidateQuestion(item: PRCandidate) {
    try {
      const account = requireAccount(reviewAccount)
      const works = readWorks(account)
      const existing = works.find(value => value.key === workKey(source.owner, source.name, source.number))
      const work = openReviewVersion(existing, source)
      const next = { ...work,
        rounds: { ...work.rounds, [source.snapshotId]: addCandidateToRound(work.rounds[source.snapshotId], item) } }
      if (onDraft) onDraft(next)
      else {
        saveWork(account, next)
        navigate({ name: 'pr-work', repositoryId, owner: source.owner, repositoryName: source.name, number: source.number })
      }
    } catch (failure) {
      setDraftError(failure instanceof Error ? failure.message : '保存草稿失败')
    }
  }

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
  return <section className="grid gap-4" aria-label="PR 只读详情">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={back ? back.onClick : () => navigate(repositoryId ? repositoryRoute(repositoryId, 'prs') : { name: 'my-reviews' })} type="button">{back ? back.label : `返回${repositoryId ? '项目 PR 审查' : '我的审查'}`}</Button>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant='default' onClick={onStart} title="创建工作单后可标记阅读进度、记录问题并导出意见" type="button">{startLabel}</Button>
        <a className="text-xs text-accent underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>
      </div>
    </div>

    <header className="grid gap-1 border-b border-border-soft pb-4">
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-3">
        {source.owner}/{source.name} <span aria-hidden="true">·</span> #{source.number}
        <span className={cn('rounded-sm px-1 py-0.5 text-[11px]', STATE_CLASS[state] ?? 'bg-soft text-foreground-3')}>{stateLabels[state] ?? state}</span>
        <span className="rounded-sm bg-soft px-1 py-0.5 text-[11px] text-foreground-3">只读预览</span>
      </p>
      <h1 className="font-sans text-xl font-semibold leading-title text-foreground">{source.title}</h1>
      <p className="text-xs text-foreground-3">{source.author} <span aria-hidden="true">·</span> {source.baseBranch} → {source.headBranch} <span aria-hidden="true">·</span> 文件 {source.files.length}/{source.totalFiles} <span aria-hidden="true">·</span> 提交 {source.commits.length}/{source.totalCommits} <span aria-hidden="true">·</span> 读取于 {displayTime(source.capturedAt)}</p>
    </header>

    <PRModelClues analysis={analysis}/>

    {!filesOpen ? <>
      <section className="grid gap-3" aria-label="PR 提交风险排序">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold text-foreground">提交风险排序</h2>
            <span className="text-xs text-foreground-3">{scoredCommitCount}/{source.commits.length} 有分数</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{<Search aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}</span><Input className={[["w-56", "h-8"].filter(Boolean).join(' '), "pl-9 pr-9"].filter(Boolean).join(' ')} placeholder="搜索提交标题或 SHA" aria-label="搜索 PR 提交" value={commitFilter} onChange={event => setCommitFilter(event.target.value)}/>{commitFilter ? <Button type="button" variant="ghost" size="icon-xs" aria-label="清除" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setCommitFilter('')}><X aria-hidden="true"/></Button> : null}</div>
            <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-haspopup="menu" aria-label={`提交排序方式：${commitOrder === 'risk' ? '按风险' : '按提交顺序'}`} type="button">排序：{commitOrder === 'risk' ? '按风险' : '按提交顺序'}{<ChevronDown aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/>}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{([{ key: 'risk', label: '按风险' }, { key: 'order', label: '按提交顺序' }]).map(item => <DropdownMenuItem key={item.key} disabled={'disabled' in item && item.disabled === true} variant={'danger' in item && item.danger ? 'destructive' : 'default'} onSelect={() => (key => setCommitOrder(key as 'risk' | 'order'))(item.key)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
          </div>
        </div>
        {scoredCommitCount === 0 ? <p className="text-xs text-foreground-3">此版本尚未分析，暂无模型分数。</p> : null}
        {commitRows.length === 0
          ? <p className="text-xs text-foreground-3">没有匹配的提交。可换一个标题片段或提交 SHA。</p>
          : <div className="min-w-0 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>提交 / 改动</TableHead><TableHead>模型分数</TableHead><TableHead className="text-right tabular-nums">变更行</TableHead><TableHead className="text-right tabular-nums">文件</TableHead></TableRow></TableHeader><TableBody>{commitRows.map(commit => {
                const info = commitRisks[commit.sha]
                const lines = info ? (info.addedLines ?? 0) + (info.deletedLines ?? 0) : null
                return <TableRow key={commit.sha} tabIndex={0} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => openCommit(commit.sha)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCommit(commit.sha) } }}><TableCell><div className="flex min-w-0 flex-wrap items-baseline gap-2"><span className="truncate text-sm font-medium text-foreground">{commit.message.split('\n')[0]}</span><code className="font-mono text-xs text-foreground-3">{commit.sha.slice(0, 12)}</code></div></TableCell><TableCell><span className={cn('tabular-nums', info ? 'text-foreground' : 'text-foreground-4')}>{info ? info.risk.toFixed(2) : '未评分'}</span></TableCell><TableCell className="text-right tabular-nums">{lines == null ? '—' : lines.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{info?.fileCount ?? '—'}</TableCell></TableRow>
              })}</TableBody></Table></div>}
        {commitRows.length ? <p className="text-xs text-foreground-4">选择一条提交，查看它触及的文件与代码。</p> : null}
      </section>
    </> : <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={backToCommits} variant="outline" type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}提交列表</Button>
        {selectedCommit ? <><code className="font-mono text-xs text-foreground-3">{selectedCommit.slice(0, 12)}</code>{commitRisks[selectedCommit]?.files.length
          ? <Button size="sm" variant="ghost" title="退出这次提交的范围，看整个 PR" onClick={() => setSelectedCommit('')} type="button">全部 {source.files.length} 个文件</Button>
          : <span className="text-xs text-foreground-3" title="这条提交没有文件映射，文件栏展示整个 PR">全部 {source.files.length} 个文件</span>}</> : <span className="text-xs text-foreground-3">全部 {source.files.length} 个文件</span>}
        {selectedCommit && explanationRisk != null && explanationRepository ? <Button size="sm" variant="ghost" onClick={() => setExplanationOpen(true)} type="button">模型解释</Button> : null}
      </div>
      <Dialog open={explanationOpen && Boolean(selectedCommit && explanationRepository && explanationRisk != null && analysis.primary)} onOpenChange={setExplanationOpen}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${560}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"模型解释"}</DialogTitle></DialogHeader>{selectedCommit && explanationRepository && explanationRisk != null && analysis.primary ? <RepositoryExplanation heading={false} context={{
          repositoryId: explanationRepository,
          viewSyncId: analysis.primary.sync.syncId,
          commitId: selectedCommit,
          risk: explanationRisk,
          modelId: analysis.primary.sync.modelId,
          runId: analysis.primary.sync.runId,
          datasetVersion: analysis.primary.sync.datasetVersion,
        }}/> : null}</DialogContent></Dialog>
      <div className="grid min-w-0 overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(156px,18%)_minmax(0,1fr)] xl:h-[clamp(436px,calc(100dvh-280px),790px)]">
        <aside className="flex min-h-0 flex-col border-b border-border-soft lg:border-b-0 lg:border-r" aria-label="PR 文件">
          <div className="flex items-baseline justify-between gap-2 px-3 py-2">
            <h2 className="text-sm font-semibold text-foreground">文件</h2><span className="text-xs text-foreground-3">{source.files.length}/{source.totalFiles}</span>
          </div>
          <div className="px-3 pb-2"><ToggleGroup type="single" value={String(fileOrder)} onValueChange={nextValue => { if (nextValue) (value => setFileOrder(value as 'risk' | 'path'))(nextValue as typeof fileOrder); }} aria-label="文件排序">{([{ label: '按风险', value: 'risk' }, { label: '按路径', value: 'path' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup></div>
          {selectedCommit && !(commitRisks[selectedCommit]?.files.length) ? <p className="px-3 pb-2 text-xs text-amber-deep">{scoredCommitCount === 0 ? '此版本尚未分析，无法按提交筛选文件；显示全部文件。' : '这条提交没有文件映射（旧分析），显示全部文件。'}</p> : null}
          <div className="px-3 pb-2"><Input placeholder="筛选路径" aria-label="筛选 PR 文件路径" value={filter} onChange={event => setFilter(event.target.value)}/></div>
          <div className="max-h-44 min-h-0 flex-1 overflow-auto px-2 pb-2 lg:max-h-none" role="listbox" aria-label="PR 文件列表">
            {files.map((item, index) => <Button variant="ghost" key={item.path} type="button" role="option" aria-selected={path === item.path} className={cn('h-auto min-w-0 flex w-full items-start justify-between gap-2 whitespace-normal rounded-sm border-0 bg-transparent px-1.5 py-1.5 text-left text-xs transition-colors', path === item.path ? 'bg-accent-soft text-foreground' : 'text-foreground-2 hover:bg-hover')} onClick={() => setPath(item.path)}>
              <span className="min-w-0 flex-1" title={item.path}>
                <span className="block truncate font-medium">{item.path.slice(item.path.lastIndexOf('/') + 1)}</span>
                <span className="block truncate text-[11px] text-foreground-4">{files[index - 1]?.path.slice(0, files[index - 1].path.lastIndexOf('/')) === item.path.slice(0, item.path.lastIndexOf('/')) ? '' : item.path.slice(0, item.path.lastIndexOf('/'))}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums">
                <span className="flex gap-1">
                  <em className="not-italic text-teal-deep">+{item.additions}</em>
                  {item.deletions ? <em className="not-italic text-rose-deep">−{item.deletions}</em> : null}
                  {fileRisks[item.path] != null ? <em className="not-italic text-foreground-3" title="该文件涉及提交的最高模型分数；排序参考">{fileRisks[item.path].toFixed(3)}</em> : null}
                </span>
                <span className="text-amber-deep">{checks.fileResult(item.path).label}</span>
              </span>
            </Button>)}
            {!files.length ? <p className="py-4 text-center text-xs text-foreground-3">没有匹配的文件。</p> : null}
          </div>
          {!source.filesComplete ? <p className="border-t border-border-soft px-3 py-2 text-xs text-amber-deep">文件范围未完整加载，已获取 {source.files.length}/{source.totalFiles}；未覆盖不等于没有问题。</p> : null}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          {file ? <ReviewCode key={JSON.stringify([source.snapshotId, file.path])} source={source} file={file} checks={checks}
            view={diffView} onViewChange={setDiffView} onAdd={addCandidateQuestion}/>
            : <p className="p-4 text-xs text-foreground-3">这个 PR 没有可展示的文件。</p>}
          {draftError ? <p className="border-t border-border-soft px-3 py-2 text-xs text-rose-deep" role="alert">{draftError}</p> : null}
        </main>
      </div>
    </>}

    <details className="rounded-sm border border-border-soft">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground-2">作者说明</summary>
      <div className="border-t border-border-soft p-3">{source.body ? <Markdown>{source.body}</Markdown> : <p className="text-xs text-foreground-3">作者没有填写说明</p>}</div>
    </details>
  </section>
}
