import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { LoaderCircle, X, ArrowLeft, Eye, RefreshCw, FileText, ExternalLink, Search, Plus, Save } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/native-select'

import { useEffect, useRef, useState } from 'react'






import { repositoryRoute, type Route } from '../navigation'
import { CodeDiff } from '@/components/shared/CodeDiff'
import { LoadingNotice } from '../Feedback'
import { ContractError } from '../apiContract'
import { PRModelClues } from '../components/PRModelClues'
import { Markdown } from '../components/Markdown'
import { useSnapshotAnalyses } from '../useSnapshotAnalyses'
import { ProgressBar } from '../components/JobProgress'
import { PullRequestPreview } from '../components/PullRequestPreview'
import { DeliveryForm, FeedbackCases, QuestionEditor, WorkBackup } from '../components/pr/WorkPanels'
import { displayTime } from '../domain'
import { analyzePRCandidates, getPRContext, getPRSnapshot, refreshPR, type PRCandidate, type PRContext, samePRSource, type PRSnapshot } from '../prReviewClient'
import { reviewStatusLabels, adoptVersion, backupText, candidateQuestion, clearRecovery, conclusionLabels, createWork, downloadText, exportReview, question, readRecovery, readStatusLabels as fileLabel, readWorks, remoteStateLabels as remoteLabel, saveRecovery, saveWork, setFileState, workKey, type Conclusion, type Evidence, type FileState, type PRWork, type ReviewQuestion } from '../prReview'
import { canWriteReview, requireAccount, useReviewAccount } from '../reviewAccount'
import { cn } from '../lib/utils'


type Navigate = (route: Route) => void
const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
const changeLabels: Record<string, string> = { added: '新增', removed: '删除', modified: '修改', renamed: '重命名', copied: '复制', changed: '内容变化', unchanged: '未变化' }
const FILE_FLAG: Record<string, string> = { added: 'bg-teal', removed: 'bg-rose', modified: 'bg-amber', renamed: 'bg-blue', copied: 'bg-blue', changed: 'bg-amber', unchanged: 'bg-foreground-4' }
/** 文件行把路径拆成"目录 + 文件名"：目录可以被省略号吃掉，文件名必须始终完整。 */
function splitPath(path: string) {
  const index = path.lastIndexOf('/')
  return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
}
function backup(work: PRWork, account: string | null) { downloadText(`review-${work.owner}-${work.name}-${work.number}.json`, backupText(work, account), 'application/json') }

function validateProjectSource(source: PRSnapshot, owner: string, name: string, number: number, repositoryId?: string) {
  if (source.owner.toLowerCase() !== owner.toLowerCase() || source.name.toLowerCase() !== name.toLowerCase() || source.number !== number || repositoryId && source.repositoryId !== repositoryId) throw new ContractError('PR 固定来源与项目上下文不一致，未修改个人草稿')
}

/** 提醒只读打开固定快照，进入工作必须由用户明确执行。 */
export function FixedPRSnapshot({ owner, repositoryName, number, repositoryId, snapshotId, navigate }: { owner: string; repositoryName: string; number: number; repositoryId?: string; snapshotId: string; navigate: Navigate }) {
  const reviewAccount = useReviewAccount()
  const account = reviewAccount.account
  const [source, setSource] = useState<PRSnapshot | null>(null), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0), [fileIndex, setFileIndex] = useState(0)
  const analysis = useSnapshotAnalyses(snapshotId)
  const [personal] = useState(() => { try { return { works: account ? readWorks(account) : [], error: '' } } catch (failure) { return { works: [], error: message(failure) } } })
  const existing = personal.works.find(w => w.key === workKey(owner, repositoryName, number))
  useEffect(() => {
    const controller = new AbortController()
    setSource(null); setError(null)
    getPRSnapshot(snapshotId, controller.signal).then(value => { if (controller.signal.aborted) return; validateProjectSource(value, owner, repositoryName, number, repositoryId); setSource(value) }).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [snapshotId, owner, repositoryName, number, repositoryId, attempt])
  function enter() {
    if (!source) return
    try {
      const account = requireAccount(reviewAccount)
      const current = readWorks(account).find(w => w.key === workKey(owner, repositoryName, number))
      let next = current ?? createWork(source)
      if (current && !current.rounds[source.snapshotId]) {
        if (Date.parse(source.capturedAt) >= Date.parse(current.rounds[current.latestSnapshotId].source.capturedAt)) next = adoptVersion(current, source)
        else next = { ...current, rounds: { ...current.rounds, [source.snapshotId]: createWork(source).rounds[source.snapshotId] } }
      }
      saveWork(account, { ...next, viewedSnapshotId: source.snapshotId })
      navigate({ name: 'pr-work', repositoryId: repositoryId ?? source.repositoryId, owner, repositoryName, number })
    } catch (failure) { setError(failure) }
  }
  const file = source?.files[fileIndex]
  return <section className="grid gap-4 pr-fixed-preview" data-testid="pr-fixed-preview">
    <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => navigate(repositoryId ? repositoryRoute(repositoryId, 'prs') : { name: 'notifications' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} />}返回{repositoryId ? '项目 PR' : '站内提醒'}</Button>
    <header className="grid gap-1 border-b border-border-soft pb-3">
      <h1 className="font-sans text-xl font-semibold leading-title text-foreground">固定快照 · PR #{number}</h1>
      <p className="text-xs text-foreground-3">{owner}/{repositoryName} · 版本 {snapshotId}</p>
    </header>
    <div className="grid gap-1 rounded-sm border border-amber/30 bg-amber-soft p-3 text-xs text-amber-deep">
      <strong className="text-sm">固定来源只读预览</strong>
      <p>不承诺是远端最新版本；不会新建个人工作单，也不会改变正在阅读的轮次。</p>
      {existing ? <p>本浏览器原阅读轮次 {existing.viewedSnapshotId.slice(0, 12)}；最近已知轮次 {existing.latestSnapshotId.slice(0, 12)}。</p> : null}
    </div>
    {personal.error ? <p className="text-xs text-rose" role="alert">{personal.error}；现有存储未清空。</p> : null}
    {error ? <Alert variant="destructive"><AlertTitle>{message(error)}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<Button size="sm" onClick={() => setAttempt(v => v + 1)} variant="outline" type="button">重新读取</Button>}</div></Alert> : null}
    {!source && !error ? <LoadingNotice label="读取提醒绑定的固定快照"/> : null}
    {source ? <>
      <h2 className="text-base font-semibold text-foreground">{source.title}</h2>
      <p className="text-xs text-foreground-3">{source.author} · 保存于 {displayTime(source.capturedAt)} · 基准 {source.baseSha.slice(0, 12)} / 目标 {source.headSha.slice(0, 12)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant='default' disabled={Boolean(personal.error)} onClick={enter} type="button">{existing ? existing.rounds[snapshotId] ? '明确进入此保存轮次' : Date.parse(source.capturedAt) < Date.parse(existing.rounds[existing.latestSnapshotId].source.capturedAt) ? '明确进入历史复盘轮次' : '明确开始此版本新一轮' : '开始审查此固定版本'}</Button>
        {existing ? <Button onClick={() => navigate({ name: 'pr-work', repositoryId, owner, repositoryName, number })} variant="outline" type="button">返回原阅读轮次</Button> : null}
        <a className="text-xs text-accent underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">核对远端 PR</a>
      </div>
      <PRModelClues analysis={analysis}/>
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">预览文件</span><NativeSelect aria-label="固定快照预览文件" value={fileIndex} onChange={e => setFileIndex(Number(e.target.value))}>{source.files.map((f, i) => <option key={f.path} value={i}>{f.path}</option>)}</NativeSelect></label>
      {file?.patch ? <div className="overflow-auto rounded-sm border border-border-soft"><CodeDiff file={file} view="unified" onAnchor={() => {}}/></div> : <p className="text-xs text-foreground-3">没有可展示的完整 Diff，未视作空文件。可以进入此轮次后读取固定上下文。</p>}
      {!source.filesComplete ? <p className="text-xs text-amber-deep">文件范围未完整加载，已获取 {source.files.length}/{source.totalFiles}；未覆盖不等于没有问题。</p> : null}
    </> : null}
  </section>
}

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
  const [contexts, setContexts] = useState<Record<string, PRContext>>({})
  const [contextError, setContextError] = useState('')
  const [contextBusy, setContextBusy] = useState(false)
  const [evidenceError, setEvidenceError] = useState('')
  const evidenceJump = useRef(false)
  const [delivery, setDelivery] = useState<{ kind: Conclusion; note: string; preview: string; checked: boolean; oldConfirmed: boolean } | null>(null)
  const [drawer, setDrawer] = useState<'source' | 'delivery' | 'backup' | null>(null)
  const [filter, setFilter] = useState('')
  const [fileOrder, setFileOrder] = useState<'risk' | 'path'>('risk')
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [reviewView, setReviewView] = useState<'commits' | 'files'>('commits')
  const [commitOrder, setCommitOrder] = useState<'risk' | 'order'>('risk')
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const [candidates, setCandidates] = useState<PRCandidate[]>([])
  const [candidateBusy, setCandidateBusy] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const version = work?.viewedSnapshotId ?? ''
  const analysis = useSnapshotAnalyses(version)
  const { fileRisks, commitRisks } = analysis
  useEffect(() => {
    setSelectedCommit(null); setCandidates([]); setCandidateError('')
    if (evidenceJump.current) { evidenceJump.current = false; setReviewView('files') }
    else setReviewView('commits')
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
  const savedLocation = work?.rounds[version]?.location
  const savedPath = work?.rounds[version]?.currentFile
  const savedSide = savedLocation?.side, savedLine = savedLocation?.line
  useEffect(() => {
    if (!savedSide || !savedLine || !savedPath) return
    const node = document.querySelector<HTMLElement>(`.pr-code [data-code-line="${savedSide}:${savedLine}"], .pr-code #line-${savedSide}-${savedLine}`)
    if (node) { node.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); return }
    if (!source || source.snapshotId !== version) return
    const key = `${version}:${savedPath}:`
    if (contexts[key + 'base'] && contexts[key + 'head']) { Promise.resolve().then(() => setContextError('原位置不在可读取的代码范围内，保留原位置与版本；未冒用其他版本的代码。')); return }
    let active = true
    Promise.all(['base', 'head'].map(side => getPRContext(source, savedPath, side as 'base' | 'head')))
      .then(values => { if (active) setContexts(previous => ({ ...previous, ...Object.fromEntries(values.map(v => [`${v.snapshotId}:${v.path}:${v.side}`, v])) })) })
      .catch(error => { if (active) setContextError('原位置暂时不可读取：' + message(error)) })
    return () => { active = false }
  }, [version, savedLine, savedSide, savedPath, source, contexts])
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
      return <PullRequestPreview source={source} remoteState={remoteState} repositoryId={repositoryId} navigate={navigate} onStart={work ? toWork : begin} startLabel={work ? '进入工作单' : undefined} back={work ? { label: '返回工作单', onClick: toWork } : undefined}/>
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
  const cacheKey = `${version}:${path}:`
  const baseContext = contexts[cacheKey + 'base'], headContext = contexts[cacheKey + 'head']
  const readable = Boolean(file?.patchComplete || baseContext?.complete && headContext?.complete)
  const selected = round.questions.find(q => q.id === selectedId) ?? round.questions.find(q => q.id === round.selectedQuestionId) ?? round.questions[0]
  const readCount = Object.values(round.progress).filter(p => p.state === 'read').length
  const recheckCount = Object.values(round.progress).filter(p => p.state === 'recheck').length
  const pendingCount = round.questions.filter(q => q.status === 'open' || q.requiresRecheck).length
  function changeRound(update: (value: typeof round) => typeof round) {
    const active = current.current!
    commit({ ...active, rounds: { ...active.rounds, [version]: update(active.rounds[version]) } })
  }
  function updateQuestion(value: ReviewQuestion) { changeRound(r => ({ ...r, questions: r.questions.map(q => q.id === value.id ? value : q) })) }
  function chooseFile(value: string) { changeRound(r => ({ ...r, currentFile: value, location: undefined })); setContextError('') }
  function selectCommit(sha: string | null) {
    setSelectedCommit(sha)
    setReviewView('files')
    const files = sha ? commitRisks[sha]?.files ?? [] : []
    if (sha && files.length && !files.includes(path)) chooseFile(files[0])
  }
  function showCommitList() { setReviewView('commits'); setSelectedCommit(null) }
  function switchVersion(value: string, targetPath?: string, location?: { side: 'base' | 'head'; line: number }, options?: { evidence?: boolean }) {
    const active = current.current!
    const evidence = Boolean(options?.evidence && targetPath)
    if (evidence) {
      const readable = active.rounds[value]?.source.files.some(item => item.path === targetPath)
      setEvidenceError(readable ? '' : '证据文件不在该版本的文件列表中；原版本与位置已保留。')
    } else {
      setEvidenceError('')
    }
    if (evidence && value === version) setReviewView('files')
    evidenceJump.current = evidence && value !== version
    commit({ ...active, viewedSnapshotId: value, rounds: targetPath ? { ...active.rounds, [value]: { ...active.rounds[value], currentFile: targetPath, location } } : active.rounds })
    if (value !== version) setSource(null)
    setReadError(null); setContextError(''); setDelivery(null)
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
  async function loadContext() {
    if (contextBusy || !file) return
    setContextBusy(true); setContextError('')
    try {
      const values = await Promise.all(['base', 'head'].map(side => getPRContext(live, path, side as 'base' | 'head')))
      setContexts(previous => ({ ...previous, ...Object.fromEntries(values.map(value => [`${value.snapshotId}:${value.path}:${value.side}`, value])) }))
    } catch (error) { setContextError(message(error)) }
    finally { setContextBusy(false) }
  }
  function anchor(side: 'base' | 'head', line: number) {
    if (!file) return
    const q = selected ?? question(live)
    const value: Evidence = { snapshotId: version, path, side, line, blobSha: file.blobSha, note: '' }
    if (q.evidence.some(e => e.snapshotId === version && e.path === path && e.side === side && e.line === line)) return
    const next = { ...q, relatedFiles: [...new Set([...q.relatedFiles, path])], evidence: [...q.evidence, value] }
    if (selected) updateQuestion(next); else changeRound(r => ({ ...r, questions: [...r.questions, next] }))
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
  const commitRows = commitOrder === 'order' ? live.commits : [...live.commits].sort((a, b) => {
    const left = commitRisks[a.sha]?.risk, right = commitRisks[b.sha]?.risk
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    return right - left
  })
  const scoredCommits = live.commits.filter(commit => commitRisks[commit.sha] != null).length
  const selectedFiles = selectedCommit ? commitRisks[selectedCommit]?.files ?? [] : null
  const scopedFiles = selectedFiles && selectedFiles.length ? live.files.filter(file => selectedFiles.includes(file.path)) : live.files
  const filteredFiles = needle ? scopedFiles.filter(f => f.path.toLowerCase().includes(needle)) : scopedFiles
  const visibleFiles = fileOrder === 'path' ? filteredFiles : [...filteredFiles].sort((a, b) => (fileRisks[b.path] ?? -1) - (fileRisks[a.path] ?? -1))
  const stale = work.latestSnapshotId !== version
  const paneHead = 'flex items-center justify-between gap-2 border-b border-border-soft px-3 py-2'
  return <section className="grid gap-3">
    <header className="grid gap-2 border-b border-border-soft pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-3">
            <Button aria-label={repositoryId ? '返回项目 PR 审查' : '我的审查'} variant="ghost" size="sm" onClick={() => navigate(repositoryId ? repositoryRoute(repositoryId, 'prs') : { name: 'my-reviews' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} />}{repositoryId ? '返回项目 PR 审查' : '我的审查'}</Button>
            <span aria-hidden="true">/</span>
            <span>{owner}/{repositoryName}</span>
            <span aria-hidden="true">·</span>
            <span>#{number}</span>
            <Badge variant="secondary">{remoteLabel[work.remoteState]}</Badge>
            <Badge variant="secondary">个人工作单</Badge>
          </div>
          <h1 className="font-sans text-xl font-semibold leading-title text-foreground" title={round.source.title}>{round.source.title}</h1>
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
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => navigate({ name: 'pr-work', repositoryId, owner, repositoryName, number, mode: 'preview' })} aria-label="查看只读版本" variant="outline" type="button">{<Eye aria-hidden="true" focusable="false" strokeWidth={1.5} />}查看只读版本</Button>
          <Button onClick={() => void check()} aria-label="检查 PR 更新" variant="outline" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <RefreshCw aria-hidden="true" focusable="false" strokeWidth={1.5} />}检查 PR 更新</Button>
          <Select value={work.interest == null ? '' : String(work.interest)} onValueChange={nextValue => (value => commit({ ...current.current!, interest: value as PRWork['interest'] }))(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="个人关注状态" className="w-28"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([{ value: 'active', label: '关注中' }, { value: 'paused', label: '已暂停' }, { value: 'ended', label: '已结束' }]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setDrawer('source')} aria-label="版本与说明" variant="outline" type="button">{<FileText aria-hidden="true" focusable="false" strokeWidth={1.5} />}版本与说明</Button>
          <Button variant='default' onClick={() => setDrawer('delivery')} aria-label="输出意见" type="button">{<ExternalLink aria-hidden="true" focusable="false" strokeWidth={1.5} />}输出意见</Button>
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

    {reviewView === 'commits' ? <section className="grid gap-2" aria-label="PR 提交风险排序">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">提交风险排序</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">
          <span>{scoredCommits}/{live.commits.length} 有分数</span>
          <ToggleGroup type="single" value={String(commitOrder)} onValueChange={nextValue => { if (nextValue) (value => setCommitOrder(value as 'risk' | 'order'))(nextValue as typeof commitOrder); }} aria-label="提交排序">{([{ label: '按风险', value: 'risk' }, { label: '按提交顺序', value: 'order' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
        </div>
      </div>
      <Table><TableHeader><TableRow><TableHead>提交 / 改动</TableHead><TableHead>模型分数</TableHead><TableHead className="text-right tabular-nums">变更行</TableHead><TableHead className="text-right tabular-nums">文件</TableHead></TableRow></TableHeader><TableBody>{commitRows.map(commit => {
            const info = commitRisks[commit.sha]
            const lines = info ? (info.addedLines ?? 0) + (info.deletedLines ?? 0) : null
            return <TableRow key={commit.sha} tabIndex={0} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => selectCommit(commit.sha)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCommit(commit.sha) } }}><TableCell><div className="flex min-w-0 flex-wrap items-baseline gap-2"><span className="truncate text-sm font-medium text-foreground">{commit.message.split('\n')[0]}</span><code className="font-mono text-xs text-foreground-3">{commit.sha.slice(0, 12)}</code></div></TableCell><TableCell><span className={cn('tabular-nums', info ? 'text-foreground' : 'text-foreground-4')}>{info ? info.risk.toFixed(2) : '未评分'}</span></TableCell><TableCell className="text-right tabular-nums">{lines == null ? '—' : lines.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{info?.fileCount ?? '—'}</TableCell></TableRow>
          })}</TableBody></Table>
      {!live.commitsComplete ? <p className="text-xs text-foreground-3">仅显示已加载的 {live.commits.length}/{live.totalCommits} 条提交。</p> : null}
    </section> : null}

    {reviewView === 'files' && evidenceError ? <Alert variant="destructive"><AlertTitle>{evidenceError}</AlertTitle></Alert> : null}
    {reviewView === 'files' ? <div className="grid overflow-hidden rounded-lg border border-border-strong bg-card lg:h-[calc(100vh-260px)] lg:min-h-[560px] lg:grid-cols-[260px_minmax(0,1fr)_320px]">
      <aside className="flex min-h-0 flex-col border-b border-border-soft lg:border-b-0 lg:border-r" aria-label="提交与文件">
        <div className={paneHead}><h2 className="text-sm font-semibold text-foreground">文件</h2><span className="text-xs text-foreground-3">{selectedCommit ? `${scopedFiles.length} 个文件` : `${live.files.length}/${live.totalFiles}`}</span></div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
          <Button size="sm" onClick={showCommitList} variant="outline" type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} />}提交列表</Button>
          {selectedCommit ? <><code className="font-mono text-foreground-3">{selectedCommit.slice(0, 12)}</code><Button variant="link" size="sm" onClick={() => selectCommit(null)} type="button">全部文件</Button></> : <span className="text-foreground-3">全部文件</span>}
        </div>
        {selectedCommit && !(commitRisks[selectedCommit]?.files.length) ? <p className="px-3 pb-2 text-xs text-amber-deep">{scoredCommits === 0 ? '此版本尚未分析，无法按提交筛选文件；下方显示全部文件。' : '这条提交没有文件映射（旧分析），下方仍显示全部文件。'}</p> : null}
        <div className="grid gap-2 px-3 pb-2">
          <div className="relative"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{<Search aria-hidden="true" focusable="false" strokeWidth={1.5} />}</span><Input placeholder="筛选路径" value={filter} onChange={e => setFilter(e.target.value)} aria-label="筛选文件路径" className={["h-8", "pl-9 pr-9"].filter(Boolean).join(' ')}/>{filter ? <Button type="button" variant="ghost" size="icon-xs" aria-label="清除" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setFilter('')}><X aria-hidden="true"/></Button> : null}</div>
          <ToggleGroup type="single" value={String(fileOrder)} onValueChange={nextValue => { if (nextValue) (value => setFileOrder(value as 'risk' | 'path'))(nextValue as typeof fileOrder); }} aria-label="文件排序">{([{ label: '按风险', value: 'risk' }, { label: '按路径', value: 'path' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2" role="listbox" aria-label="改动文件">
          {visibleFiles.map(f => {
            const state = round.progress[f.path]?.state ?? 'unread'
            const { dir, name } = splitPath(f.path)
            return <Button variant="ghost" key={f.path} role="option" aria-selected={path === f.path} className={cn('flex w-full items-start gap-1.5 rounded-sm border-0 bg-transparent px-1.5 py-1.5 text-left text-xs transition-colors', path === f.path ? 'bg-accent-soft text-foreground' : 'text-foreground-2 hover:bg-hover')} onClick={() => chooseFile(f.path)}>
              <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', FILE_FLAG[f.status] ?? 'bg-foreground-4')} aria-hidden="true"/>
              <span className="min-w-0 flex-1" title={f.path}><span className="block truncate font-medium">{name}</span><span className="block truncate text-[11px] text-foreground-4">{dir}</span></span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums">
                <span className="flex gap-1">{f.additions ? <em className="not-italic text-teal-deep">+{f.additions}</em> : null}{f.deletions ? <em className="not-italic text-rose-deep">−{f.deletions}</em> : null}{fileRisks[f.path] != null ? <em className="not-italic text-foreground-3" title="该文件涉及提交的最高模型分数；排序参考">{fileRisks[f.path].toFixed(3)}</em> : null}</span>
                <span className={cn(state === 'read' ? 'text-teal-deep' : state === 'recheck' ? 'text-amber-deep' : 'text-foreground-4')}>{fileLabel[state]}</span>
              </span>
            </Button>
          })}
          {!visibleFiles.length ? <p className="py-4 text-center text-xs text-foreground-3">没有匹配的文件。</p> : null}
        </div>
        {!live.filesComplete ? <p className="border-t border-border-soft px-3 py-2 text-xs text-amber-deep">还有 {live.totalFiles - live.files.length} 个文件未覆盖，请在 GitHub 核对超出接口上限的范围。</p> : null}
      </aside>

      <section className="pr-code flex min-h-0 min-w-0 flex-col border-b border-border-soft lg:border-b-0 lg:border-r" aria-label="PR 代码阅读">
        {file ? <>
          <div className="grid gap-2 border-b border-border-soft px-3 py-2">
            <div className="min-w-0">
              <code className="block truncate font-mono text-xs text-foreground-2">{file.path}</code>
              <span className="text-[11px] text-foreground-3">{changeLabels[file.status] ?? file.status} · <em className="not-italic text-teal-deep">+{file.additions}</em> <em className="not-italic text-rose-deep">−{file.deletions}</em>{file.previousPath ? ` · 重命名自 ${file.previousPath}` : ''}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup type="single" value={String(diffView)} onValueChange={nextValue => { if (nextValue) (value => setDiffView(value as 'unified' | 'split'))(nextValue as typeof diffView); }} aria-label="视图">{([{ label: '统一', value: 'unified' }, { label: '并排', value: 'split' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
              <Tooltip><TooltipTrigger asChild><Button size="sm" onClick={() => void loadContext()} variant="outline" disabled={Boolean(contextBusy)} type="button">{contextBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}完整上下文</Button></TooltipTrigger><TooltipContent>{"读取基准与目标的完整文件内容"}</TooltipContent></Tooltip>
              <Button size="sm" onClick={() => { if (!file) return; setCandidateBusy(true); setCandidateError(''); void analyzePRCandidates(live.snapshotId, [file.path], 'head').then(result => setCandidates(result.candidates)).catch(error => setCandidateError(message(error))).finally(() => setCandidateBusy(false)) }} variant="outline" disabled={Boolean(candidateBusy)} type="button">{candidateBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}分析代码候选</Button>
              <Button size="sm" variant={round.progress[path]?.state === 'read' ? 'outline' : 'default'} disabled={!readable} onClick={() => commit(setFileState(current.current!, version, path, 'read', readable))} type="button">标记已阅读</Button>
              <Select value={round.progress[path]?.state ?? 'unread' == null ? '' : String(round.progress[path]?.state ?? 'unread')} onValueChange={nextValue => (value => commit(setFileState(current.current!, version, path, value as FileState, readable)))(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="文件阅读状态" className="w-28" size="sm"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([{ value: 'unread', label: '未阅读' }, { value: 'read', label: '已阅读' }, { value: 'recheck', label: '需要复查' }, { value: 'uncovered', label: '暂未覆盖' }]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          {file.patchComplete ? null : <p className="border-b border-border-soft px-3 py-2 text-xs text-amber-deep">Diff 未完整提供（二进制或过大文件）；读取完整上下文后才能标记已阅读。</p>}
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeDiff file={file} view={diffView} onAnchor={anchor} location={round.location}/>
          </div>
          {candidateError ? <div className="border-t border-border-soft p-2"><Alert variant="destructive"><AlertTitle>{candidateError}</AlertTitle></Alert></div> : null}
          {candidates.length ? <section className="grid max-h-72 gap-2 overflow-auto border-t border-border-soft p-3" aria-label="代码候选">
            <h3 className="text-sm font-semibold text-foreground">代码候选</h3>
            <p className="text-xs text-foreground-3">候选只作线索，不是缺陷概率或行级缺陷结论。</p>
            {candidates.filter(item => item.path === file.path).map((item, index) => {
              const key = `${item.side}:${item.path}:${item.line}:${item.ruleId}:${item.ruleVersion}`
              const decision = round.candidateDecisions?.[key]
              const set = (status: 'confirmed' | 'rejected' | 'deferred') => {
                const reason = decision?.reason ?? ''
                if (status !== 'confirmed' && !reason.trim()) { setCandidateError('先填写候选处理理由'); return }
                setCandidateError('')
                changeRound(r => ({ ...r, candidateDecisions: { ...(r.candidateDecisions ?? {}), [key]: { status, reason } } }))
              }
              return <div key={`${key}:${index}`} className="grid gap-1 rounded-sm border border-border-soft p-2 text-xs">
                <code className="font-mono text-foreground-2">{item.path}:{item.line}</code> · {item.ruleId} · {item.message}
                {item.evidence ? <pre className="overflow-auto rounded-sm bg-dark p-2 font-mono text-[11px] text-on-dark">{item.evidence}</pre> : null}
                {item.suggestion ? <div className="grid gap-1 rounded-sm bg-soft p-2">
                  <strong className="text-foreground">{item.suggestion.title}</strong>
                  <p className="text-foreground-3">{item.suggestion.rationale}</p>
                  {item.suggestion.manualChecks.length ? <ul className="list-disc pl-4 text-foreground-3">{item.suggestion.manualChecks.map(check => <li key={check}>{check}</li>)}</ul> : null}
                  {item.suggestion.example ? <pre className="overflow-auto rounded-sm bg-dark p-2 font-mono text-[11px] text-on-dark">{`${item.suggestion.example.before}\n→\n${item.suggestion.example.after}`}</pre> : null}
                </div> : null}
                <div className="flex items-center flex-wrap gap-2" style={{gap: 8}}>{(['confirmed', 'rejected', 'deferred'] as const).map(status => <Button key={status} size="sm" variant={decision?.status === status ? 'default' : 'outline'} onClick={() => set(status)} type="button">{status === 'confirmed' ? '确认' : status === 'rejected' ? '驳回' : '暂缓'}</Button>)}<Input className="h-8 flex-1 rounded-sm border border-input bg-card px-2 text-xs text-foreground" aria-label="候选处理理由" value={decision?.reason ?? ''} onChange={event => changeRound(r => ({ ...r, candidateDecisions: { ...(r.candidateDecisions ?? {}), [key]: { status: decision?.status ?? 'deferred', reason: event.target.value } } }))} placeholder="处理理由"/><Button size="sm" onClick={() => {
                    const exists = round.questions.some(item2 => item2.kind === 'suggestion' && item2.relatedFiles[0] === item.path && item2.body.includes(`${item.ruleId}@${item.ruleVersion}`) && item2.body.includes(`${item.path}:${item.line}`))
                    if (exists) { setCandidateError('该候选建议已在问题草稿中'); return }
                    const created = candidateQuestion(live, item)
                    changeRound(r => ({ ...r, questions: [...r.questions, created], selectedQuestionId: created.id }))
                    setSelectedId(created.id); setCandidateError('')
                  }} variant="outline" type="button">加入问题草稿</Button></div>
              </div>
            })}
          </section> : null}
          <details className="border-t border-border-soft">
            <summary className="cursor-pointer px-3 py-2 text-xs text-foreground-2">作者原始说明</summary>
            <pre className="max-h-48 overflow-auto border-t border-border-soft p-3 font-mono text-[11px] leading-body text-foreground-2">{live.body || '作者没有填写说明'}</pre>
          </details>
          {contextError ? <div className="border-t border-border-soft p-2"><Alert variant="destructive"><AlertTitle>{contextError}</AlertTitle></Alert></div> : null}
          {[baseContext, headContext].filter((c): c is PRContext => Boolean(c)).map(c => <details key={c.side} className="border-t border-border-soft" open>
            <summary className="cursor-pointer px-3 py-2 text-xs text-foreground-2">{c.side === 'base' ? '基准' : '目标'}上下文 · {c.absent ? '该侧不存在此文件' : c.complete ? `${c.totalLines} 行完整文本` : `仅前 10000/${c.totalLines} 行，未完整覆盖`}</summary>
            <div className="max-h-64 overflow-auto border-t border-border-soft font-mono text-[11px]">{c.content.split('\n').map((line, i) => <Button variant="ghost" key={i} type="button" data-code-line={`${c.side}:${i + 1}`} data-focused={round.location?.side === c.side && round.location.line === i + 1 ? 'true' : undefined} onClick={() => anchor(c.side, i + 1)} aria-label={`关联 ${file.path}:${c.side}:${i + 1}`} className="flex w-full gap-2 border-0 bg-transparent px-2 py-0.5 text-left text-foreground-2 hover:bg-hover data-[focused=true]:bg-accent-soft"><span className="w-9 shrink-0 text-right tabular-nums text-foreground-4">{i + 1}</span><code className="truncate font-mono">{line || ' '}</code></Button>)}</div>
          </details>)}
        </> : <div className="grid place-items-center p-8 text-center"><p className="text-xs text-foreground-3">这个版本没有可展示的文件，请核对 GitHub 来源。</p></div>}
      </section>

      <aside className="flex min-h-0 flex-col" aria-label="问题与人工记录">
        <div className={paneHead}><h2 className="text-sm font-semibold text-foreground">问题</h2><Button aria-label="新建" size="sm" variant="ghost" onClick={() => { const next = question(live); changeRound(r => ({ ...r, questions: [...r.questions, next], selectedQuestionId: next.id })); setSelectedId(next.id) }} type="button">{<Plus aria-hidden="true" focusable="false" strokeWidth={1.5} />}新建</Button></div>
        <div className="max-h-40 shrink-0 overflow-auto border-b border-border-soft p-1.5">
          {round.questions.map(q => <Button variant="ghost" key={q.id} className={cn('block w-full rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-xs', selected?.id === q.id ? 'bg-accent-soft text-foreground' : 'text-foreground-2 hover:bg-hover')} aria-pressed={selected?.id === q.id} onClick={() => { setSelectedId(q.id); changeRound(r => ({ ...r, selectedQuestionId: q.id })) }}>
            <span className="block truncate font-medium">{q.body.slice(0, 60) || '未填写的问题'}</span>
            <span className="block text-[11px] text-foreground-4">{reviewStatusLabels[q.status]}{q.requiresRecheck ? ' · 代码变化待复核' : ''}{q.evidence.length ? ` · ${q.evidence.length} 条证据` : ''}</span>
          </Button>)}
          {!round.questions.length ? <p className="py-3 text-center text-xs text-foreground-3">还没有问题记录。新建一条，或点击代码行把位置关联进来。</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {selected ? <QuestionEditor key={selected.id + version} value={selected} source={live} onChange={updateQuestion} onJump={anchor => { if (!work.rounds[anchor.snapshotId]) { setContextError('原版本无法读取，原位置已保留'); return } switchVersion(anchor.snapshotId, anchor.path, anchor.line ? { side: anchor.side, line: anchor.line } : undefined, { evidence: true }) }} work={work}/> : null}
        </div>
        <label className="grid shrink-0 gap-1 border-t border-border-soft p-2">
          <span className="text-xs text-foreground-2">个人笔记{round.scratchOriginSnapshotId ? <small className="ml-1 text-foreground-4">沿用原版本 {round.scratchOriginSnapshotId.slice(0, 12)} 的笔记，请结合当前代码核对。</small> : null}</span>
          <Textarea className="min-h-16 w-full rounded-sm border border-input bg-card p-2 text-xs text-foreground placeholder:text-foreground-4" aria-label="个人笔记" value={round.scratch} onChange={e => changeRound(r => ({ ...r, scratch: e.target.value, scratchOriginSnapshotId: undefined }))} placeholder="读到哪里、还待核对什么；不会附到对外意见里。"/>
        </label>
      </aside>
    </div> : null}

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
