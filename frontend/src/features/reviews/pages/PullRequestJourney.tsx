import { NativeSelect } from '@/components/ui/native-select'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { LoaderCircle, X, ArrowLeft, Eye, RefreshCw, FileText, ExternalLink, Search, Plus, Save } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { useEffect, useId, useRef, useState } from 'react'






import { repositoryRoute } from '@/app/navigation'
import { ReviewCode } from '@/features/reviews/components/ReviewCode'
import { PRModelClues } from '@/features/reviews/components/PRModelClues'
import { Markdown } from '@/components/shared/Markdown'
import { useSnapshotAnalyses } from '@/features/projects/useSnapshotAnalyses'
import { ProgressBar } from '@/features/projects/components/JobProgress'
import { PullRequestPreview } from '@/features/reviews/components/PullRequestPreview'
import { ReviewCommitTable } from '@/features/reviews/components/ReviewCommitTable'
import { DeliveryForm, FeedbackCases, QuestionEditor, WorkBackup } from '@/features/reviews/components/WorkPanels'
import { displayTime } from '@/lib/domain'
import { getPRSnapshot, refreshPR, type PRCandidate, samePRSource, type PRSnapshot } from '@/features/reviews/prReviewClient'
import { reviewStatusLabels, adoptVersion, addCandidateToRound, clearRecovery, conclusionLabels, createWork, downloadText, exportReview, question, readRecovery, readStatusLabels as fileLabel, readWorks, remoteStateLabels as remoteLabel, saveRecovery, saveWork, setFileState, workKey, type Conclusion, type Evidence, type FileState, type PRWork, type ReviewQuestion } from '@/features/reviews/prReview'
import { canWriteReview, useReviewAccount } from '@/features/reviews/reviewAccount'
import { usePRCandidateChecks } from '@/features/reviews/usePRCandidateChecks'
import { cn } from '@/lib/utils'
import { backup, FILE_FLAG, message, splitPath, validateProjectSource, type Navigate } from '@/features/reviews/pages/reviewShared'

export { FixedPRSnapshot } from '@/features/reviews/pages/FixedPRSnapshot'

export function PullRequestWork({ owner, repositoryName, number, repositoryId, preview = false, navigate }: { owner: string; repositoryName: string; number: number; repositoryId?: string; preview?: boolean; navigate: Navigate }) {
  const reviewAccount = useReviewAccount()
  const account = reviewAccount.account
  const [initial] = useState(() => {
    const key = workKey(owner, repositoryName, number)
    try {
      const work = account ? readWorks(account).find(w => w.key === key) ?? null : null
      if (work) validateProjectSource(work.rounds[work.viewedSnapshotId].source, owner, repositoryName, number, repositoryId)
      return { work, error: '', recovery: account ? readRecovery(account, key) : null }
    } catch (error) { return { work: null, error: message(error), recovery: null } }
  })
  const [work, setWork] = useState<PRWork | null>(initial.work)
  const [recovery, setRecovery] = useState<PRWork | null>(initial.recovery)
  const accountRef = useRef(account)
  const reviewAccountRef = useRef(reviewAccount)
  const saveErrorRef = useRef(Boolean(initial.error))
  accountRef.current = account
  reviewAccountRef.current = reviewAccount
  saveErrorRef.current = Boolean(initial.error)
  const current = useRef(work)
  const [saveError, setSaveError] = useState(initial.error)
  const [source, setSource] = useState<PRSnapshot | null>(null)
  const [remoteState, setRemoteState] = useState<PRSnapshot['remoteState'] | null>(null)
  const [remoteCheckedAt, setRemoteCheckedAt] = useState<string | null>(null)
  const [readError, setReadError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [locationRequest, setLocationRequest] = useState(0)
  const [evidenceError, setEvidenceError] = useState('')
  const evidenceJump = useRef(false)
  const [delivery, setDelivery] = useState<{ kind: Conclusion; note: string; preview: string; checked: boolean; oldConfirmed: boolean } | null>(null)
  const [drawer, setDrawer] = useState<'source' | 'delivery' | 'backup' | null>(null)
  const [filter, setFilter] = useState('')
  const [fileStateFilter, setFileStateFilter] = useState('all')
  const [filesOpen, setFilesOpen] = useState(false)
  const filesPanelId = useId()
  const [fileOrder, setFileOrder] = useState<'risk' | 'path'>('risk')
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [reviewView, setReviewView] = useState<'commits' | 'files'>('commits')
  const [commitOrder, setCommitOrder] = useState<'risk' | 'order'>('risk')
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const version = work?.viewedSnapshotId ?? ''
  const checks = usePRCandidateChecks(reviewView === 'files' && !preview ? version : '')
  const analysis = useSnapshotAnalyses(version)
  const { fileRisks, commitRisks } = analysis
  useEffect(() => {
    setSelectedCommit(null)
    const round = current.current?.rounds[version]
    setReviewView(evidenceJump.current ? 'files' : round?.reviewView ?? (round?.location ? 'files' : 'commits'))
    evidenceJump.current = false
  }, [version])
  function commit(next: PRWork) {
    const ownerAccount = accountRef.current
    let saved = next, failed = false
    try {
      if (!ownerAccount) throw new Error('登录身份尚未确认，个人工作单不写入')
      if (!canWriteReview(reviewAccountRef.current)) {
        saveRecovery(ownerAccount, next)
        failed = true
        setSaveError(`登录身份正在核验，草稿保留在账户 ${ownerAccount} 的恢复副本中；核验完成后请重试保存。`)
      } else {
        saved = saveWork(ownerAccount, next)
        setSaveError('')
        setRecovery(null)
      }
    } catch (error) {
      if (ownerAccount) saveRecovery(ownerAccount, next)
      failed = true
      setSaveError(`尚未保存：${message(error)}。正在编辑的文本仍在本页，可重试或导出完整草稿。`)
    }
    saveErrorRef.current = failed
    current.current = saved; setWork(saved)
    return saved
  }
  useEffect(() => () => {
    if (accountRef.current && saveErrorRef.current && current.current) {
      saveRecovery(accountRef.current, current.current)
    }
  }, [])
  function restoreRecovery() {
    if (!recovery || !account) return
    try {
      const saved = saveWork(account, { ...recovery, revision: work?.revision ?? 0 })
      saveErrorRef.current = false
      current.current = saved; setWork(saved); setRecovery(null); setSaveError('')
    } catch (error) {
      setSaveError(`恢复未保存内容失败：${message(error)}。恢复副本仍保留在账户 ${account}。`)
    }
  }
  function dismissRecovery() {
    if (account) clearRecovery(account, work?.key ?? workKey(owner, repositoryName, number))
    setRecovery(null)
  }
  useEffect(() => {
    const controller = new AbortController()
    const cached = current.current
    if (!cached) {
      refreshPR(owner, repositoryName, number, repositoryId).then(result => { if (!controller.signal.aborted) { setSource(result.snapshot); setRemoteState(result.remoteState); setRemoteCheckedAt(result.checkedAt); setReadError(null) } }).catch(error => { if (!controller.signal.aborted) setReadError(error) })
    } else {
      getPRSnapshot(cached.viewedSnapshotId, controller.signal).then(result => { if (!controller.signal.aborted) { if (!samePRSource(cached.rounds[cached.viewedSnapshotId].source, result)) throw new Error('返回代码与草稿固定版本不一致'); setSource(result); setReadError(null) } }).catch(error => { if (!controller.signal.aborted) { setReadError(error); setSource(null) } })
    }
    return () => controller.abort()
  }, [owner, repositoryName, number, repositoryId, version, attempt])
  function begin() {
    if (!source) return
    commit({ ...createWork(source), remoteState: remoteState ?? source.remoteState, checkedAt: remoteCheckedAt ?? source.capturedAt })
    setReadError(null)
  }
  if (!work && recovery) {
    return <section className="grid gap-3" aria-label="恢复未保存内容">
      <Alert variant="default"><AlertTitle>{`账户 ${account} 有本 PR 的未保存恢复副本`}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<div className="flex items-center flex-nowrap gap-2" style={{gap: 4}}><Button size="sm" variant='default' onClick={restoreRecovery} type="button">恢复未保存内容</Button><Button size="sm" onClick={dismissRecovery} variant="outline" type="button">忽略</Button></div>}</div></Alert>
    </section>
  }
  if (preview || !work) {
    const failed = Boolean(readError || initial.error)
    if (!failed && source) {
      const toWork = () => navigate({ name: 'pr-work', repositoryId, owner, repositoryName, number })
      return <PullRequestPreview source={source} remoteState={remoteState} repositoryId={repositoryId} navigate={navigate} onStart={work ? toWork : begin}
        onDraft={next => { commit(next); setReviewView('files'); if (preview) toWork() }}
        startLabel={work ? '进入工作单' : undefined} back={work ? { label: '返回工作单', onClick: toWork } : undefined}/>
    }
    const detail = failed ? message(readError ?? new Error(initial.error)) : '正在拉取 PR 文件与固定代码版本。'
    const back = () => navigate(repositoryId ? repositoryRoute(repositoryId, 'prs') : { name: 'my-reviews' })
    return <Dialog open onOpenChange={next => { if (!next) back() }}><DialogContent className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${480}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{<span className="inline-flex items-center gap-2"><span className={cn('size-2 rounded-full', failed ? 'bg-rose' : 'bg-blue')} aria-hidden="true"/>{failed ? '这个 PR 暂时读不出来' : '正在读取 PR'}</span>}</DialogTitle><DialogDescription>{<span role={failed ? 'alert' : 'status'}>{detail}</span>}</DialogDescription></DialogHeader>{failed ? null : <ProgressBar value={null} state="queued" label="正在读取 PR"/>}<DialogFooter>{<>
        {failed ? <Button variant='default' onClick={() => { setReadError(null); setAttempt(v => v + 1) }} type="button">重试读取</Button> : null}
        <Button variant={failed ? undefined : 'default'} onClick={back} type="button">返回{repositoryId ? '项目 PR 审查' : '我的审查'}</Button>
      </>}</DialogFooter></DialogContent></Dialog>
  }
  const round = work.rounds[version], live = source?.snapshotId === version ? source : round.source
  const path = round.currentFile, file = live.files.find(f => f.path === path)
  const selected = round.questions.find(q => q.id === selectedId) ?? round.questions.find(q => q.id === round.selectedQuestionId) ?? round.questions[0]
  const readCount = Object.values(round.progress).filter(p => p.state === 'read').length
  const recheckCount = Object.values(round.progress).filter(p => p.state === 'recheck').length
  const pendingCount = round.questions.filter(q => q.status === 'open' || q.requiresRecheck).length
  function changeRound(update: (value: typeof round) => typeof round) {
    const active = current.current!
    commit({ ...active, rounds: { ...active.rounds, [version]: update(active.rounds[version]) } })
  }
  function updateQuestion(value: ReviewQuestion) { changeRound(r => ({ ...r, questions: r.questions.map(q => q.id === value.id ? value : q) })) }
  function chooseFile(value: string) {
    changeRound(r => ({ ...r, reviewView: 'files', currentFile: value, location: r.currentFile === value ? r.location : undefined }))
    setFilesOpen(false)
    setEvidenceError('')
  }
  function addCandidate(item: PRCandidate) {
    const next = addCandidateToRound(current.current!.rounds[version], item)
    changeRound(() => next)
    setSelectedId(next.selectedQuestionId ?? '')
  }
  function selectCommit(sha: string | null) {
    setSelectedCommit(sha)
    setReviewView('files')
    const files = sha ? commitRisks[sha]?.files ?? [] : []
    if (sha && files.length && !files.includes(path)) chooseFile(files[0])
    else if (round.reviewView !== 'files') changeRound(r => ({ ...r, reviewView: 'files' }))
  }
  function showCommitList() {
    setReviewView('commits')
    setSelectedCommit(null)
    if (round.reviewView !== 'commits') changeRound(r => ({ ...r, reviewView: 'commits' }))
  }
  function switchVersion(value: string, targetPath?: string, location?: { side: 'base' | 'head'; line: number }, options?: { evidence?: boolean }) {
    const active = current.current!
    const evidence = Boolean(options?.evidence && targetPath)
    if (evidence) {
      const readable = active.rounds[value]?.source.files.some(item => item.path === targetPath)
      setEvidenceError(readable ? '' : '证据文件不在该版本的文件列表中；原版本与位置已保留。')
      setLocationRequest(request => request + 1)
      setSelectedCommit(null)
      setFilter('')
      setFileStateFilter('all')
    } else {
      setEvidenceError('')
    }
    if (evidence && value === version) setReviewView('files')
    evidenceJump.current = evidence && value !== version
    commit({ ...active, viewedSnapshotId: value, rounds: targetPath ? { ...active.rounds, [value]: { ...active.rounds[value], currentFile: targetPath, location, reviewView: 'files' } } : active.rounds })
    if (value !== version) setSource(null)
    setReadError(null); setDelivery(null)
    if (!evidence) evidenceJump.current = false
  }
  async function check(): Promise<PRWork | null> {
    if (lock.current) return null
    lock.current = true; setBusy(true); setReadError(null)
    try {
      const result = await refreshPR(owner, repositoryName, number, repositoryId)
      const updated = commit({ ...adoptVersion(current.current!, result.snapshot), remoteState: result.remoteState, checkedAt: result.checkedAt, checkError: '' })
      if (updated.viewedSnapshotId === result.snapshot.snapshotId) setSource(result.snapshot)
      return updated
    } catch (error) { commit({ ...current.current!, checkError: message(error) }); setReadError(error); return null }
    finally { lock.current = false; setBusy(false) }
  }
  function anchor(side: 'base' | 'head', line: number) {
    if (!file) return
    const q = selected ?? question(live)
    const value: Evidence = { snapshotId: version, path, side, line, blobSha: file.blobSha, note: '' }
    const exists = q.evidence.some(e => e.snapshotId === version && e.path === path && e.side === side && e.line === line)
    const next = exists ? q : { ...q, relatedFiles: [...new Set([...q.relatedFiles, path])], evidence: [...q.evidence, value] }
    changeRound(r => ({ ...r, location: { side, line }, selectedQuestionId: q.id,
      questions: selected ? r.questions.map(entry => entry.id === q.id ? next : entry) : [...r.questions, next] }))
    setSelectedId(q.id)
  }
  async function prepareDelivery(kind: Conclusion, note: string) {
    const checked = await check()
    const active = checked ?? current.current!
    setDelivery({ kind, note, preview: exportReview(active, version, kind, note), checked: Boolean(checked), oldConfirmed: false })
  }
  async function confirmDelivery() {
    if (!delivery) return
    const checked = await check()
    const active = checked ?? current.current!
    if ((!checked || active.latestSnapshotId !== version) && !delivery.oldConfirmed) { setDelivery({ ...delivery, checked: Boolean(checked), preview: exportReview(active, version, delivery.kind, delivery.note) }); return }
    changeRound(r => ({ ...r, conclusion: { kind: delivery.kind, note: delivery.note, markdown: exportReview(active, version, delivery.kind, delivery.note), createdAt: new Date().toISOString() } }))
    setDelivery(null)
  }
  const readPercent = live.totalFiles ? Math.round((readCount / live.totalFiles) * 100) : 0
  const needle = filter.trim().toLowerCase()
  const scoredCommits = live.commits.filter(commit => commitRisks[commit.sha] != null).length
  const selectedFiles = selectedCommit ? commitRisks[selectedCommit]?.files ?? [] : null
  const scopedFiles = selectedFiles && selectedFiles.length ? live.files.filter(file => selectedFiles.includes(file.path)) : live.files
  const filesWithDrafts = new Set(round.questions.filter(q => q.status === 'open' || q.requiresRecheck)
    .flatMap(q => [...q.relatedFiles, ...q.evidence.filter(e => e.snapshotId === version).map(e => e.path)]))
  const filteredFiles = scopedFiles.filter(file => file.path.toLowerCase().includes(needle)
    && (fileStateFilter === 'all' || (fileStateFilter === 'draft' ? filesWithDrafts.has(file.path)
      : (round.progress[file.path]?.state ?? 'unread') === fileStateFilter)))
  const visibleFiles = fileOrder === 'path' ? filteredFiles : [...filteredFiles].sort((a, b) => (fileRisks[b.path] ?? -1) - (fileRisks[a.path] ?? -1))
  const stale = work.latestSnapshotId !== version
  const paneHead = 'flex items-center justify-between gap-2 border-b border-border-soft px-3 py-2'
  const drafts = <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="问题与人工记录">
    <div className={paneHead}><h2 className="text-sm font-semibold text-foreground">问题</h2><Button aria-label="新建" size="sm" variant="ghost" onClick={() => { const next = question(live); changeRound(r => ({ ...r, questions: [...r.questions, next], selectedQuestionId: next.id })); setSelectedId(next.id) }} type="button">{<Plus aria-hidden="true" focusable="false" strokeWidth={1.5} />}新建</Button></div>
    <div className="max-h-32 shrink-0 overflow-auto border-b border-border-soft p-1.5">
      {round.questions.map(q => <Button variant="ghost" key={q.id} className={cn('h-auto min-w-0 block w-full whitespace-normal rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-xs', selected?.id === q.id ? 'bg-accent-soft text-foreground' : 'text-foreground-2 hover:bg-hover')} aria-pressed={selected?.id === q.id} onClick={() => { setSelectedId(q.id); changeRound(r => ({ ...r, selectedQuestionId: q.id })) }}>
        <span className="block truncate font-medium">{q.body.slice(0, 60) || '未填写的问题'}</span>
        <span className="block text-[11px] text-foreground-4">{reviewStatusLabels[q.status]}{q.requiresRecheck ? ' · 代码变化待复核' : ''}{q.evidence.length ? ` · ${q.evidence.length} 条证据` : ''}</span>
      </Button>)}
      {!round.questions.length ? <p className="py-3 text-center text-xs text-foreground-3">还没有问题记录。新建一条，或点击代码行把位置关联进来。</p> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {selected ? <QuestionEditor key={selected.id + version} value={selected} source={live} onChange={updateQuestion} onJump={anchor => { if (!work.rounds[anchor.snapshotId]) { setEvidenceError('原版本无法读取，原位置已保留'); return } switchVersion(anchor.snapshotId, anchor.path, anchor.line ? { side: anchor.side, line: anchor.line } : undefined, { evidence: true }) }} work={work}/> : null}
    </div>
    <label className="grid shrink-0 gap-1 border-t border-border-soft p-3">
      <span className="text-xs text-foreground-2">个人笔记{round.scratchOriginSnapshotId ? <small className="ml-1 text-foreground-4">沿用原版本 {round.scratchOriginSnapshotId.slice(0, 12)} 的笔记，请结合当前代码核对。</small> : null}</span>
      <Textarea className="min-h-16 w-full rounded-sm border border-input bg-card p-2 text-xs text-foreground placeholder:text-foreground-4" aria-label="个人笔记" value={round.scratch} onChange={e => changeRound(r => ({ ...r, scratch: e.target.value, scratchOriginSnapshotId: undefined }))} placeholder="读到哪里、还待核对什么；不会附到对外意见里。"/>
    </label>
  </section>
  return <section className="grid gap-3">
    <header className="grid min-w-0 gap-3 border-b border-border-soft pb-4">
      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-1.5 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-3">
            <Button aria-label={repositoryId ? '返回项目 PR 审查' : '我的审查'} variant="ghost" size="sm" onClick={() => navigate(repositoryId ? repositoryRoute(repositoryId, 'prs') : { name: 'my-reviews' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} />}{repositoryId ? '返回项目 PR 审查' : '我的审查'}</Button>
            <span aria-hidden="true">/</span>
            <span>{owner}/{repositoryName}</span>
            <span aria-hidden="true">·</span>
            <span>#{number}</span>
            <Badge variant="secondary">{remoteLabel[work.remoteState]}</Badge>
          </div>
          <h1 className="font-sans text-xl font-semibold leading-title tracking-tight text-foreground sm:text-2xl" title={round.source.title}>{round.source.title}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-3">
            <span>{round.source.author}</span>
            <span aria-hidden="true">·</span>
            <span>已读 <b className="text-foreground">{readCount}</b>/{live.totalFiles}</span>
            <span aria-hidden="true">·</span>
            <span>待复核 <b className="text-foreground">{recheckCount}</b></span>
            <span aria-hidden="true">·</span>
            <span>待处理问题 <b className="text-foreground">{pendingCount}</b></span>
            <span aria-hidden="true">·</span>
            <span className={saveError ? 'text-rose' : 'text-foreground-4'}>{saveError ? '草稿尚未保存' : work.savedAt ? `草稿已保存 ${displayTime(work.savedAt)}` : '草稿尚未保存'}</span>
          </div>
        </div>
        <div role="group" aria-label="审查操作" className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg bg-sunken p-1.5">
          <Button size="sm" onClick={() => navigate({ name: 'pr-work', repositoryId, owner, repositoryName, number, mode: 'preview' })} aria-label="查看只读版本" variant="ghost" type="button">{<Eye aria-hidden="true" focusable="false" strokeWidth={1.5} />}查看只读版本</Button>
          <Button size="sm" onClick={() => void check()} aria-label="检查 PR 更新" variant="ghost" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <RefreshCw aria-hidden="true" focusable="false" strokeWidth={1.5} />}检查 PR 更新</Button>
          <Select value={work.interest == null ? '' : String(work.interest)} onValueChange={nextValue => (value => commit({ ...current.current!, interest: value as PRWork['interest'] }))(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="个人关注状态" size="sm" className="w-28"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([{ value: 'active', label: '关注中' }, { value: 'paused', label: '已暂停' }, { value: 'ended', label: '已结束' }]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
          <Button size="sm" onClick={() => setDrawer('source')} aria-label="版本与说明" variant="ghost" type="button">{<FileText aria-hidden="true" focusable="false" strokeWidth={1.5} />}版本与说明</Button>
          <Button size="sm" onClick={() => setDrawer('delivery')} aria-label="输出意见" className="sm:ml-auto" type="button">{<ExternalLink aria-hidden="true" focusable="false" strokeWidth={1.5} />}输出意见</Button>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-strong" aria-hidden="true"><span className="block h-full rounded-full bg-accent" style={{ width: `${readPercent}%` }}/></div>
    </header>

    {(saveError || readError || recovery || work.checkError || work.remoteState !== 'open' || stale) ? <div className="grid gap-2">
      {recovery ? <Alert variant="default"><AlertTitle>{`账户 ${account} 有未保存的恢复副本`}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<div className="flex items-center flex-nowrap gap-2" style={{gap: 4}}><Button size="sm" onClick={restoreRecovery} variant="outline" type="button">恢复</Button><Button size="sm" onClick={dismissRecovery} variant="outline" type="button">忽略</Button></div>}</div></Alert> : null}
      {saveError ? <Alert variant="default"><AlertTitle>{saveError}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<div className="flex items-center flex-nowrap gap-2" style={{gap: 4}}><Button size="sm" onClick={() => commit(current.current!)} variant="outline" type="button">重试保存</Button><Button size="sm" onClick={() => backup(work, account)} variant="outline" type="button">导出草稿</Button></div>}</div></Alert> : null}
      {readError ? <Alert variant="destructive"><AlertTitle>{message(readError)}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<Button size="sm" onClick={() => setAttempt(v => v + 1)} variant="outline" type="button">重新读取</Button>}</div></Alert> : null}
      {work.checkError ? <Alert variant="default"><AlertTitle>{`上次检查失败：${work.checkError}。仍保留此前版本，最近成功检查 ${displayTime(work.checkedAt)}。`}</AlertTitle></Alert> : null}
      {work.remoteState !== 'open' ? <Alert variant="default"><AlertTitle>{`远端 PR ${remoteLabel[work.remoteState]}，当前为历史审查；个人草稿和原结论保留。`}</AlertTitle></Alert> : null}
      {stale ? <Alert variant="default"><AlertTitle>{"代码基准或目标版本已有变化，当前仍阅读原版本；旧意见不会自动解决。"}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<Button size="sm" variant='default' onClick={() => switchVersion(work.latestSnapshotId)} type="button">开始复核新版本</Button>}</div></Alert> : null}
      {round.historyNotice ? <Alert variant="default"><AlertTitle>{round.historyNotice}</AlertTitle></Alert> : null}
    </div> : null}

    <PRModelClues key={`model:${version}`} analysis={analysis}/>

    {reviewView === 'commits' ? <ReviewCommitTable commits={live.commits} commitRisks={commitRisks} order={commitOrder} onOrder={setCommitOrder} onSelect={selectCommit} commitsComplete={live.commitsComplete} totalCommits={live.totalCommits}/> : null}

    {reviewView === 'files' && evidenceError ? <Alert variant="destructive"><AlertTitle>{evidenceError}</AlertTitle></Alert> : null}
    {reviewView === 'files' ? <section aria-label="文件审查工作区" className="grid min-w-0 overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(156px,18%)_minmax(0,1fr)] xl:h-[clamp(436px,calc(100dvh-280px),790px)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border-soft px-3 py-2 lg:hidden">
        <Button type="button" size="sm" variant="outline" aria-expanded={filesOpen} aria-controls={filesPanelId} onClick={() => setFilesOpen(open => !open)}>
          {filesOpen ? '收起文件列表' : '文件列表'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={showCommitList}>返回提交列表</Button>
      </div>
      <aside id={filesPanelId} className={cn('min-h-0 flex-col border-b border-border-soft lg:flex lg:border-r lg:border-b-0', filesOpen ? 'flex' : 'hidden')} aria-label="提交与文件">
        <div className={paneHead}><h2 className="text-sm font-semibold text-foreground">文件</h2><span className="text-xs text-foreground-3">{selectedCommit ? `${scopedFiles.length} 个文件` : `${live.files.length}/${live.totalFiles}`}</span></div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
          <Button size="sm" onClick={showCommitList} variant="ghost" type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} />}提交列表</Button>
          {selectedCommit ? <><code className="font-mono text-foreground-3">{selectedCommit.slice(0, 12)}</code><Button variant="link" size="sm" onClick={() => selectCommit(null)} type="button">全部文件</Button></> : <span className="text-foreground-3">全部文件</span>}
        </div>
        {selectedCommit && !(commitRisks[selectedCommit]?.files.length) ? <p className="px-3 pb-2 text-xs text-amber-deep">{scoredCommits === 0 ? '此版本尚未分析，无法按提交筛选文件；下方显示全部文件。' : '这条提交没有文件映射（旧分析），下方仍显示全部文件。'}</p> : null}
        <div className="grid gap-2 px-3 pb-2">
          <div className="relative"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{<Search aria-hidden="true" focusable="false" strokeWidth={1.5} />}</span><Input placeholder="筛选路径" value={filter} onChange={e => setFilter(e.target.value)} aria-label="筛选文件路径" className={["h-8", "pl-9 pr-9"].filter(Boolean).join(' ')}/>{filter ? <Button type="button" variant="ghost" size="icon-xs" aria-label="清除" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setFilter('')}><X aria-hidden="true"/></Button> : null}</div>
          <NativeSelect aria-label="文件阅读筛选" size="sm" value={fileStateFilter} onChange={event => setFileStateFilter(event.currentTarget.value)}>
            <option value="all">全部阅读状态</option>
            <option value="unread">未阅读</option>
            <option value="read">已阅读</option>
            <option value="recheck">待复核</option>
            <option value="draft">有草稿</option>
          </NativeSelect>
          <ToggleGroup type="single" value={String(fileOrder)} onValueChange={nextValue => { if (nextValue) (value => setFileOrder(value as 'risk' | 'path'))(nextValue as typeof fileOrder); }} aria-label="文件排序">{([{ label: '按风险', value: 'risk' }, { label: '按路径', value: 'path' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
        </div>
        <div className="max-h-44 min-h-0 flex-1 overflow-auto px-2 pb-2 lg:max-h-none" role="listbox" aria-label="改动文件">
          {visibleFiles.map(f => {
            const state = round.progress[f.path]?.state ?? 'unread'
            const { dir, name } = splitPath(f.path)
            return <Button variant="ghost" key={f.path} role="option" aria-selected={path === f.path} className={cn('h-auto min-w-0 flex w-full items-start gap-1.5 whitespace-normal rounded-sm border-0 bg-transparent px-1.5 py-1.5 text-left text-xs transition-colors', path === f.path ? 'bg-accent-soft text-foreground' : 'text-foreground-2 hover:bg-hover')} onClick={() => chooseFile(f.path)}>
              <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', FILE_FLAG[f.status] ?? 'bg-foreground-4')} aria-hidden="true"/>
              <span className="min-w-0 flex-1" title={f.path}><span className="block truncate font-medium">{name}</span><span className="block truncate text-[11px] text-foreground-4">{dir}</span></span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums">
                <span className="flex gap-1">{f.additions ? <em className="not-italic text-teal-deep">+{f.additions}</em> : null}{f.deletions ? <em className="not-italic text-rose-deep">−{f.deletions}</em> : null}{fileRisks[f.path] != null ? <em className="not-italic text-foreground-3" title="该文件涉及提交的最高模型分数；排序参考">{fileRisks[f.path].toFixed(3)}</em> : null}</span>
                <span className={cn(state === 'read' ? 'text-teal-deep' : state === 'recheck' ? 'text-amber-deep' : 'text-foreground-4')}>{fileLabel[state]}</span>
                {filesWithDrafts.has(f.path) ? <span className="font-medium text-accent">有草稿</span> : null}
                {checks.fileResult(f.path).label ? <span className="text-amber-deep">{checks.fileResult(f.path).label}</span> : null}
              </span>
            </Button>
          })}
          {!visibleFiles.length ? <p className="py-4 text-center text-xs text-foreground-3">没有匹配的文件。</p> : null}
        </div>
        {!live.filesComplete ? <p className="border-t border-border-soft px-3 py-2 text-xs text-amber-deep">还有 {live.totalFiles - live.files.length} 个文件未覆盖，请在 GitHub 核对超出接口上限的范围。</p> : null}
      </aside>

      <section className="pr-code flex min-h-0 min-w-0 flex-col" aria-label="PR 代码阅读">
        {file ? <ReviewCode key={JSON.stringify([version, file.path])} source={live} file={file} checks={checks}
          view={diffView} onViewChange={setDiffView} drafts={drafts} compactInspector
          location={round.location} locationRequest={locationRequest} onAnchor={anchor} onAdd={addCandidate}
          decisions={round.candidateDecisions}
          onDecision={(key, decision) => changeRound(r => ({ ...r, candidateDecisions: { ...r.candidateDecisions, [key]: decision } }))}
          actions={readable => <>
            <Button size="sm" variant="ghost" disabled={!readable}
              onClick={() => commit(setFileState(current.current!, version, path, 'read', readable))} type="button">标记已阅读</Button>
            <Select value={round.progress[path]?.state ?? 'unread'}
              onValueChange={value => commit(setFileState(current.current!, version, path, value as FileState, readable))}>
              <SelectTrigger aria-label="文件阅读状态" className="w-28" size="sm"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="unread">未阅读</SelectItem>
                <SelectItem value="read" disabled={!readable}>已阅读</SelectItem>
                <SelectItem value="recheck">需要复查</SelectItem>
                <SelectItem value="uncovered">暂未覆盖</SelectItem>
              </SelectContent>
            </Select>
          </>}/> : <><p className="p-4 text-sm text-foreground-3">这个版本没有可展示的文件。</p>{drafts}</>}
      </section>
    </section> : null}

    <Sheet open={drawer === 'source'} onOpenChange={next => {  if (!next) (() => setDrawer(null))(); }}><SheetContent side="right" aria-describedby={undefined} className="max-h-[90vh] overflow-auto h-full max-h-none" style={{width: `min(100vw, ${600}px)`, maxWidth: 'none'}}><SheetHeader><SheetTitle>{"代码版本与作者说明"}</SheetTitle></SheetHeader><div className="grid gap-3">
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">正在阅读的版本</span>
          <Select value={version == null ? '' : String(version)} onValueChange={nextValue => (value => switchVersion(value))(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="审查代码版本"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{(Object.values(work.rounds).map(r => ({ value: r.source.snapshotId, label: `${r.source.headSha.slice(0, 12)} · ${displayTime(r.source.capturedAt)}` }))).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
        </label>
        <dl className="grid gap-1 text-sm">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-1.5"><dt className="text-xs text-foreground-3">基准</dt><dd className="m-0 break-words">{live.baseBranch} · {live.baseSha.slice(0, 12)}</dd></div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-1.5"><dt className="text-xs text-foreground-3">目标</dt><dd className="m-0 break-words">{live.headBranch} · {live.headSha.slice(0, 12)}</dd></div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-1.5"><dt className="text-xs text-foreground-3">代码读取于</dt><dd className="m-0 break-words">{displayTime(live.capturedAt)}</dd></div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-1.5"><dt className="text-xs text-foreground-3">最近检查</dt><dd className="m-0 break-words">{displayTime(work.checkedAt)}</dd></div>
        </dl>
        <details className="rounded-sm border border-border-soft" open>
          <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">涉及提交（已加载 {live.commits.length}/{live.totalCommits}）</summary>
          <ul className="grid gap-1 border-t border-border-soft p-2.5 text-xs">{live.commits.map(c => <li key={c.sha} className="flex gap-2"><a className="shrink-0 font-mono text-accent underline-offset-2 hover:underline" href={`https://github.com/${live.baseRepository}/commit/${c.sha}`} target="_blank" rel="noreferrer">{c.sha.slice(0, 12)}</a> <span className="min-w-0 truncate text-foreground-3">{c.message.split('\n')[0]}</span></li>)}</ul>
          {!live.commitsComplete ? <p className="border-t border-border-soft p-2.5 text-xs text-amber-deep">提交列表未完整加载，请在 GitHub 核对其余提交；文件阅读不依赖模型。</p> : null}
        </details>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild><a href={live.url} target="_blank" aria-label="在 GitHub 核对 PR">{<ExternalLink aria-hidden="true" focusable="false" strokeWidth={1.5} />}在 GitHub 核对 PR</a></Button>
          <Button size="sm" onClick={() => navigate(repositoryRoute(live.repositoryId))} variant="outline" type="button">项目分析与模型线索</Button>
          <Button size="sm" onClick={() => setDrawer('backup')} aria-label="草稿备份与反馈" variant="outline" type="button">{<Save aria-hidden="true" focusable="false" strokeWidth={1.5} />}草稿备份与反馈</Button>
        </div>
      </div></SheetContent></Sheet>
    <Sheet open={drawer === 'delivery'} onOpenChange={next => {  if (!next) (() => setDrawer(null))(); }}><SheetContent side="right" aria-describedby={undefined} className="max-h-[90vh] overflow-auto h-full max-h-none" style={{width: `min(100vw, ${680}px)`, maxWidth: 'none'}}><SheetHeader><SheetTitle>{"输出本轮审查意见"}</SheetTitle></SheetHeader><div className="grid gap-3">
        <p className="text-xs leading-body text-foreground-3">尚需处理：{live.totalFiles - readCount} 个未完整阅读文件、{pendingCount} 个未关闭或待复核问题。可继续阅读，或在结论中明确保留。</p>
        <DeliveryForm busy={busy} draft={round.deliveryDraft} onDraft={deliveryDraft => changeRound(r => ({ ...r, deliveryDraft }))} onPrepare={prepareDelivery}/>
        {delivery ? <div className="grid gap-2 rounded-sm border border-border-soft p-3">
          <h3 className="text-sm font-semibold text-foreground">审查意见预览</h3>
          {!delivery.checked || work.latestSnapshotId !== version ? <label className="flex items-start gap-2 text-xs text-foreground-2"><Checkbox className="mt-0.5" checked={delivery.oldConfirmed} onCheckedChange={checked => setDelivery({ ...delivery, oldConfirmed: checked === true })}/>确认按当前旧版本交付，并保留版本和未覆盖事项说明</label> : null}
          <Textarea className="min-h-40 w-full rounded-sm border border-input bg-sunken p-2 font-mono text-[11px] text-foreground-2" readOnly aria-label="审查意见预览" value={delivery.preview}/>
          <div className="flex items-center flex-wrap gap-2" style={{gap: 8}}><Button variant='default' disabled={busy || ((!delivery.checked || work.latestSnapshotId !== version) && !delivery.oldConfirmed)} onClick={() => void confirmDelivery()} type="button">确认保存本轮结论</Button><Button onClick={() => setDelivery(null)} variant="outline" type="button">继续审查</Button></div>
        </div> : null}
        {round.conclusion ? <div className="grid gap-2 rounded-sm border border-border-soft p-3">
          <h3 className="text-sm font-semibold text-foreground">{conclusionLabels[round.conclusion.kind]} · {displayTime(round.conclusion.createdAt)}</h3>
          <p className="text-xs text-foreground-3">意见属于 {live.headSha.slice(0, 12)}，尚未发送到 GitHub。</p>
          <div className="flex items-center flex-wrap gap-2" style={{gap: 8}}><Button size="sm" onClick={() => downloadText(`review-${number}-${live.headSha.slice(0, 8)}.md`, round.conclusion!.markdown, 'text/markdown')} variant="outline" type="button">下载 Markdown 意见</Button><Button size="sm" onClick={() => navigator.clipboard.writeText(round.conclusion!.markdown).catch(error => setReadError(error))} variant="outline" type="button">复制审查意见</Button></div>
          <details className="rounded-sm border border-border-soft"><summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">查看已保存意见</summary><div className="border-t border-border-soft p-2.5"><Markdown>{round.conclusion.markdown}</Markdown></div></details>
        </div> : null}
      </div></SheetContent></Sheet>
    <Sheet open={drawer === 'backup'} onOpenChange={next => {  if (!next) (() => setDrawer(null))(); }}><SheetContent side="right" aria-describedby={undefined} className="max-h-[90vh] overflow-auto h-full max-h-none" style={{width: `min(100vw, ${620}px)`, maxWidth: 'none'}}><SheetHeader><SheetTitle>{"个人草稿备份"}</SheetTitle></SheetHeader><WorkBackup work={work} onMerge={commit} account={account}/><FeedbackCases key={`feedback:${version}`} work={work} version={version}/></SheetContent></Sheet>
  </section>
}
