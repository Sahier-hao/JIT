import { useEffect, useRef, useState } from 'react'
import { Alert, Space, Tag, Tooltip } from '../ui/feedback'
import { Button, Input, Select } from '../ui/controls'
import { Drawer } from '../ui/drawer'
import { Dialog } from '../ui/dialog'
import { Segmented } from '../ui/segmented'
import * as ui from '../ui/controls'
import { ArrowLeft, ExternalLink, FileText, Plus, RefreshCw, Save, Search } from 'lucide-react'
import type { Route } from '../navigation'
import { CodeDiff } from '../ui/CodeDiff'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { ContractError } from '../apiContract'
import { PRModelClues } from '../components/PRModelClues'
import { PullRequestPreview } from '../components/PullRequestPreview'
import { DeliveryForm, FeedbackCases, QuestionEditor, WorkBackup } from '../components/pr/WorkPanels'
import { displayTime } from '../domain'
import { getPRContext, getPRSnapshot, refreshPR, type PRContext, samePRSource, type PRSnapshot } from '../prReviewClient'
import { reviewStatusLabels, adoptVersion, conclusionLabels, createWork, downloadText, exportReview, question, readWorks, saveWork, setFileState, workKey, type Conclusion, type Evidence, type FileState, type PRWork, type ReviewQuestion } from '../prReview'


type Navigate = (route: Route) => void
const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
const remoteLabel = { open: '开放中', closed: '已关闭', merged: '已合并' }
const changeLabels: Record<string, string> = { added: '新增', removed: '删除', modified: '修改', renamed: '重命名', copied: '复制', changed: '内容变化', unchanged: '未变化' }
const fileLabel: Record<FileState, string> = { unread: '未阅读', read: '已阅读', recheck: '需要复核', uncovered: '暂未覆盖' }
/** 侧栏窄，只留尾部两段路径：文件名和它所在的目录比仓库顶层目录更有用。 */
function shortPath(path: string) {
  const parts = path.split('/')
  if (path.length <= 34 || parts.length < 3) return path
  const tail = parts.slice(-2).join('/')
  const head = parts[0]
  return head.length + tail.length + 3 <= 34 ? `${head}/…/${tail}` : `…/${tail}`
}
function backup(work: PRWork) { downloadText(`review-${work.owner}-${work.name}-${work.number}.json`, JSON.stringify({ format: 'jit-pr-review-v1', work }, null, 2), 'application/json') }

function validateProjectSource(source: PRSnapshot, owner: string, name: string, number: number, repositoryId?: string) {
  if (source.owner.toLowerCase() !== owner.toLowerCase() || source.name.toLowerCase() !== name.toLowerCase() || source.number !== number || repositoryId && source.repositoryId !== repositoryId) throw new ContractError('PR 固定来源与项目上下文不一致，未修改个人草稿')
}

/** 提醒只读打开固定快照，进入工作必须由用户明确执行。 */
export function FixedPRSnapshot({ owner, repositoryName, number, repositoryId, snapshotId, navigate }: { owner: string; repositoryName: string; number: number; repositoryId?: string; snapshotId: string; navigate: Navigate }) {
  const [source, setSource] = useState<PRSnapshot | null>(null), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0), [fileIndex, setFileIndex] = useState(0)
  const [personal] = useState(() => { try { return { works: readWorks(), error: '' } } catch (failure) { return { works: [], error: message(failure) } } })
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
      const current = readWorks().find(w => w.key === workKey(owner, repositoryName, number))
      let next = current ?? createWork(source)
      if (current && !current.rounds[source.snapshotId]) {
        if (Date.parse(source.capturedAt) >= Date.parse(current.rounds[current.latestSnapshotId].source.capturedAt)) next = adoptVersion(current, source)
        else next = { ...current, rounds: { ...current.rounds, [source.snapshotId]: createWork(source).rounds[source.snapshotId] } }
      }
      saveWork({ ...next, viewedSnapshotId: source.snapshotId })
      navigate({ name: 'pr-work', repositoryId: repositoryId ?? source.repositoryId, owner, repositoryName, number })
    } catch (failure) { setError(failure) }
  }
  const file = source?.files[fileIndex]
  return <section className="pr-fixed-preview">
    <ui.Button variant="ghost" size="sm" icon={<ArrowLeft/>} onClick={() => navigate(repositoryId ? { name: 'repository', repositoryId, tab: 'prs' } : { name: 'notifications' })}>返回{repositoryId ? '项目 PR' : '站内提醒'}</ui.Button>
    <header className="page-heading"><div><h1>固定快照 · PR #{number}</h1><p>{owner}/{repositoryName} · 版本 {snapshotId}</p></div></header>
    <div className="pr-update-note"><strong>历史 / 固定来源只读预览</strong><p>此提醒绑定保存时的快照，不承诺是远端最新版本。不会新建个人工作单，也不会改变正在阅读的轮次、笔记或模型选择。</p>{existing ? <p>本浏览器原阅读轮次 {existing.viewedSnapshotId.slice(0, 12)}；最近已知轮次 {existing.latestSnapshotId.slice(0, 12)}。</p> : null}</div>
    {personal.error ? <p className="field-error" role="alert">{personal.error}；现有存储未清空。</p> : null}
    {error ? <FailureNotice error={error} onRetry={() => setAttempt(v => v + 1)}/> : null}
    {!source && !error ? <LoadingNotice label="读取提醒绑定的固定快照"/> : null}
    {source ? <>
      <h2>{source.title}</h2>
      <p>{source.author} · 保存于 {displayTime(source.capturedAt)} · 基准 {source.baseSha.slice(0, 12)} / 目标 {source.headSha.slice(0, 12)}</p>
      <div className="panel-actions">
        <ui.Button variant="primary" disabled={Boolean(personal.error)} onClick={enter}>{existing ? existing.rounds[snapshotId] ? '明确进入此保存轮次' : Date.parse(source.capturedAt) < Date.parse(existing.rounds[existing.latestSnapshotId].source.capturedAt) ? '明确进入历史复盘轮次' : '明确开始此版本新一轮' : '开始审查此固定版本'}</ui.Button>
        {existing ? <ui.Button onClick={() => navigate({ name: 'pr-work', repositoryId, owner, repositoryName, number })}>返回原阅读轮次</ui.Button> : null}
        <a href={source.url} target="_blank" rel="noreferrer">核对远端 PR</a>
      </div>
      <PRModelClues source={source} navigate={navigate}/>
      <label>预览文件<select aria-label="固定快照预览文件" value={fileIndex} onChange={e => setFileIndex(Number(e.target.value))}>{source.files.map((f, i) => <option key={f.path} value={i}>{f.path}</option>)}</select></label>
      {file?.patch ? <CodeDiff file={file} view="unified" onAnchor={() => {}}/> : <p>没有可展示的完整 Diff，未视作空文件。可以进入此轮次后读取固定上下文。</p>}
      {!source.filesComplete ? <p className="field-error">文件范围未完整加载，已获取 {source.files.length}/{source.totalFiles}；未覆盖不等于没有问题。</p> : null}
    </> : null}
  </section>
}

export function PullRequestWork({ owner, repositoryName, number, repositoryId, navigate }: { owner: string; repositoryName: string; number: number; repositoryId?: string; navigate: Navigate }) {
  const [initial] = useState(() => { try { const work = readWorks().find(w => w.key === workKey(owner, repositoryName, number)) ?? null; if (work) validateProjectSource(work.rounds[work.viewedSnapshotId].source, owner, repositoryName, number, repositoryId); return { work, error: '' } } catch (error) { return { work: null, error: message(error) } } })
  const [work, setWork] = useState<PRWork | null>(initial.work)
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
  const [fileRisks, setFileRisks] = useState<Record<string, number>>({})
  const [fileOrder, setFileOrder] = useState<'risk' | 'path'>('risk')
  const [commitRisks, setCommitRisks] = useState<Record<string, { risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }>>({})
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [reviewView, setReviewView] = useState<'commits' | 'files'>('commits')
  const [commitOrder, setCommitOrder] = useState<'risk' | 'order'>('risk')
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const version = work?.viewedSnapshotId ?? ''
  useEffect(() => {
    setSelectedCommit(null); setCommitRisks({}); setFileRisks({})
    if (evidenceJump.current) { evidenceJump.current = false; setReviewView('files') }
    else setReviewView('commits')
  }, [version])
  function commit(next: PRWork) {
    let saved = next
    try { saved = saveWork(next); setSaveError('') } catch (error) { setSaveError(`尚未保存：${message(error)}。正在编辑的文本仍在本页，可重试或导出完整草稿。`) }
    current.current = saved; setWork(saved)
    return saved
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
  if (!work) {
    const failed = Boolean(readError || initial.error)
    if (!failed && source) return <PullRequestPreview source={source} remoteState={remoteState} repositoryId={repositoryId} navigate={navigate} onStart={begin}/>
    const detail = failed ? message(readError ?? new Error(initial.error)) : '正在拉取 PR 的文件与固定代码版本。首次接入要逐个取文件，通常需要 20 到 30 秒。'
    const back = () => navigate(repositoryId ? { name: 'repository', repositoryId, tab: 'prs' } : { name: 'my-reviews' })
    return <Dialog
      open
      onOpenChange={next => { if (!next) back() }}
      title={<span className="wb-read-head"><span className={failed ? 'wb-read-dot is-failed' : 'wb-read-dot'} aria-hidden="true"/>{failed ? '这个 PR 暂时读不出来' : '正在读取 PR'}</span>}
      description={<span role={failed ? 'alert' : 'status'}>{detail}</span>}
      width={480}
      footer={<>
        {failed ? <Button variant="primary" onClick={() => { setReadError(null); setAttempt(v => v + 1) }}>重试读取</Button> : null}
        <Button variant={failed ? undefined : 'primary'} onClick={back}>返回{repositoryId ? '项目 PR 审查' : '我的审查'}</Button>
      </>}
    >{null}</Dialog>
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
  return <section className="wb">
    <header className="wb-head">
      <div className="wb-head-main">
        <div className="wb-head-text">
          <div className="wb-crumb">
            <Button aria-label={repositoryId ? '返回项目 PR 审查' : '我的审查'} variant="ghost" size="sm" className="wb-back" icon={<ArrowLeft/>} onClick={() => navigate(repositoryId ? { name: 'repository', repositoryId, tab: 'prs' } : { name: 'my-reviews' })}>{repositoryId ? '返回项目 PR 审查' : '我的审查'}</Button>
            <span className="wb-sep">/</span>
            <span>{owner}/{repositoryName}</span>
            <span className="wb-sep">·</span>
            <span>#{number}</span>
            <Tag className="wb-state">{remoteLabel[work.remoteState]}</Tag>
          </div>
          <h1 className="wb-title" title={round.source.title}>{round.source.title}</h1>
          <div className="wb-facts">
            <span>{round.source.author}</span>
            <span className="wb-sep">·</span>
            <span>已读 <b>{readCount}</b>/{live.totalFiles}</span>
            <span className="wb-sep">·</span>
            <span>待复核 <b>{recheckCount}</b></span>
            <span className="wb-sep">·</span>
            <span>待处理问题 <b>{pendingCount}</b></span>
            <span className="wb-sep">·</span>
            <span className={saveError ? 'wb-save is-error' : 'wb-save'}>{saveError ? '草稿尚未保存' : work.savedAt ? `草稿已保存 ${displayTime(work.savedAt)}` : '草稿尚未保存'}</span>
          </div>
        </div>
        <div className="wb-head-actions">
          <Button icon={<RefreshCw/>} loading={busy} onClick={() => void check()} aria-label="检查 PR 更新">检查 PR 更新</Button>
          <Select
            className="wb-interest"
            aria-label="个人关注状态"
            value={work.interest}
            onChange={value => commit({ ...current.current!, interest: value as PRWork['interest'] })}
            options={[{ value: 'active', label: '关注中' }, { value: 'paused', label: '已暂停' }, { value: 'ended', label: '已结束' }]}
          />
          <Button icon={<FileText/>} onClick={() => setDrawer('source')} aria-label="版本与说明">版本与说明</Button>
          <Button variant="primary" icon={<ExternalLink/>} onClick={() => setDrawer('delivery')} aria-label="输出意见">输出意见</Button>
        </div>
      </div>
      <div className="wb-meter" aria-hidden="true"><span style={{ width: `${readPercent}%` }}/></div>
    </header>
    {(saveError || readError || work.checkError || work.remoteState !== 'open' || stale) ? <div className="wb-alerts">
      {saveError ? <Alert type="warning" showIcon title={saveError} action={<Space size={4}><Button size="sm" onClick={() => commit(current.current!)}>重试保存</Button><Button size="sm" onClick={() => backup(work)}>导出草稿</Button></Space>}/> : null}
      {readError ? <Alert type="error" showIcon title={message(readError)} action={<Button size="sm" onClick={() => setAttempt(v => v + 1)}>重新读取</Button>}/> : null}
      {work.checkError ? <Alert type="warning" showIcon title={`上次检查失败：${work.checkError}。仍保留此前版本，最近成功检查 ${displayTime(work.checkedAt)}。`}/> : null}
      {work.remoteState !== 'open' ? <Alert type="info" showIcon title={`远端 PR ${remoteLabel[work.remoteState]}，当前为历史审查；个人草稿和原结论保留。`}/> : null}
      {stale ? <Alert type="warning" showIcon title="代码基准或目标版本已有变化，当前仍阅读原版本；旧意见不会自动解决。" action={<Button size="sm" variant="primary" onClick={() => switchVersion(work.latestSnapshotId)}>开始复核新版本</Button>}/> : null}
      {round.historyNotice ? <Alert type="info" showIcon title={round.historyNotice}/> : null}
    </div> : null}
    <div className="wb-clues">
      <PRModelClues key={`model:${version}`} source={live} navigate={navigate} onFileRisks={setFileRisks} onCommitRisks={setCommitRisks}/>
    </div>
    {reviewView === 'commits' ? <section className="wb-commit-table" aria-label="PR 提交风险排序">
      <div className="wb-commit-table-head">
        <h2>提交风险排序</h2>
        <div className="wb-commit-head-actions">
          <span>{scoredCommits}/{live.commits.length} 有分数</span>
          <Segmented size="sm" aria-label="提交排序" value={commitOrder} onChange={value => setCommitOrder(value as 'risk' | 'order')} options={[{ label: '按风险', value: 'risk' }, { label: '按提交顺序', value: 'order' }]}/>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">提交 / 改动</th><th scope="col">模型分数</th><th scope="col">变更行</th><th scope="col">文件</th></tr></thead>
          <tbody>
            {commitRows.map(commit => {
              const info = commitRisks[commit.sha]
              const lines = info ? (info.addedLines ?? 0) + (info.deletedLines ?? 0) : null
              return <tr key={commit.sha} tabIndex={0} onClick={() => selectCommit(commit.sha)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCommit(commit.sha) } }}>
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
      {!live.commitsComplete ? <p className="wb-pane-note">仅显示已加载的 {live.commits.length}/{live.totalCommits} 条提交。</p> : null}
    </section> : null}
    {reviewView === 'files' && evidenceError ? <Alert type="error" showIcon title={evidenceError}/> : null}
    {reviewView === 'files' ? <div className="wb-body">
      <aside className="wb-files" aria-label="提交与文件">
        <div className="wb-pane-head"><h2>文件</h2><span className="wb-count">{selectedCommit ? `${scopedFiles.length} 个文件` : `${live.files.length}/${live.totalFiles}`}</span></div>
        <div className="wb-file-scope">
          <Button size="sm" icon={<ArrowLeft/>} onClick={showCommitList}>提交列表</Button>
          {selectedCommit ? <><code>{selectedCommit.slice(0, 12)}</code><Button variant="link" size="sm" onClick={() => selectCommit(null)}>全部文件</Button></> : <span>全部文件</span>}
        </div>
        {selectedCommit && !(commitRisks[selectedCommit]?.files.length) ? <p className="wb-pane-note">{scoredCommits === 0 ? '此版本尚未分析，无法按提交筛选文件；下方显示全部文件。' : '这条提交没有文件映射（旧分析），下方仍显示全部文件。'}</p> : null}
        <Input size="sm" allowClear prefix={<Search/>} placeholder="筛选路径" value={filter} onChange={e => setFilter(e.target.value)} aria-label="筛选文件路径"/>
        <Segmented size="sm" aria-label="文件排序" value={fileOrder} onChange={value => setFileOrder(value as 'risk' | 'path')} options={[{ label: '按风险', value: 'risk' }, { label: '按路径', value: 'path' }]}/>
        <div className="wb-file-list" role="listbox" aria-label="改动文件">
          {visibleFiles.map(f => {
            const state = round.progress[f.path]?.state ?? 'unread'
            return <button key={f.path} role="option" aria-selected={path === f.path} className={`wb-file${path === f.path ? ' is-active' : ''}`} onClick={() => chooseFile(f.path)}>
              <span className={`wb-file-flag is-${f.status}`} aria-hidden="true"/>
              <span className="wb-file-path" title={f.path}>{shortPath(f.path)}</span>
              <span className="wb-file-meta"><em className="wb-add">+{f.additions}</em><em className="wb-del">−{f.deletions}</em>{fileRisks[f.path] != null ? <em className="wb-file-risk" title="该文件涉及提交的最高模型分数；排序参考">{fileRisks[f.path].toFixed(3)}</em> : null}<span className={`wb-file-state is-${state}`}>{fileLabel[state]}</span></span>
            </button>
          })}
          {!visibleFiles.length ? <p className="wb-pane-empty">没有匹配的文件。</p> : null}
        </div>
        {!live.filesComplete ? <p className="wb-pane-note">还有 {live.totalFiles - live.files.length} 个文件未覆盖，请在 GitHub 核对超出接口上限的范围。</p> : null}
      </aside>
      <section className="wb-code pr-code" aria-label="PR 代码阅读">
        {file ? <>
          <div className="wb-code-head">
            <div className="wb-code-title">
              <code>{file.path}</code>
              <span className="wb-code-meta">{changeLabels[file.status] ?? file.status} · <em className="wb-add">+{file.additions}</em> <em className="wb-del">−{file.deletions}</em>{file.previousPath ? ` · 重命名自 ${file.previousPath}` : ''}</span>
            </div>
            <div className="wb-code-actions">
              <Segmented size="sm" value={diffView} onChange={value => setDiffView(value as 'unified' | 'split')} options={[{ label: '统一', value: 'unified' }, { label: '并排', value: 'split' }]}/>
              <Tooltip title="读取基准与目标的完整文件内容"><Button size="sm" loading={contextBusy} onClick={() => void loadContext()}>完整上下文</Button></Tooltip>
              <Button size="sm" variant={round.progress[path]?.state === 'read' ? 'secondary' : 'primary'} disabled={!readable} onClick={() => commit(setFileState(current.current!, version, path, 'read', readable))}>标记已阅读</Button>
              <Select size="sm" className="wb-mark" value={round.progress[path]?.state ?? 'unread'} onChange={value => commit(setFileState(current.current!, version, path, value as FileState, readable))} options={[{ value: 'unread', label: '未阅读' }, { value: 'read', label: '已阅读' }, { value: 'recheck', label: '需要复查' }, { value: 'uncovered', label: '暂未覆盖' }]} aria-label="文件阅读状态"/>
            </div>
          </div>
          <p className="wb-code-hint">{file.patchComplete ? '真实 GitHub Diff，已核对增删行数。点击行号把该位置关联到右侧当前问题。' : 'Diff 未完整提供（二进制或过大文件）；读取完整上下文后才能标记已阅读。'}</p>
          <CodeDiff file={file} view={diffView} onAnchor={anchor} location={round.location}/>
          <details className="wb-author">
            <summary>作者原始说明</summary>
            <div className="wb-author-inner">
              <h3>作者原始说明</h3>
              <pre className="wb-author-body">{live.body || '作者没有填写说明'}</pre>
            </div>
          </details>
          {contextError ? <Alert type="error" showIcon title={contextError}/> : null}
          {[baseContext, headContext].filter((c): c is PRContext => Boolean(c)).map(c => <details key={c.side} className="wb-context" open>
            <summary>{c.side === 'base' ? '基准' : '目标'}上下文 · {c.absent ? '该侧不存在此文件' : c.complete ? `${c.totalLines} 行完整文本` : `仅前 10000/${c.totalLines} 行，未完整覆盖`}</summary>
            <div className="wb-context-lines">{c.content.split('\n').map((line, i) => <button key={i} data-code-line={`${c.side}:${i + 1}`} data-focused={round.location?.side === c.side && round.location.line === i + 1 ? 'true' : undefined} onClick={() => anchor(c.side, i + 1)} aria-label={`关联 ${file.path}:${c.side}:${i + 1}`}><span>{i + 1}</span><code>{line || ' '}</code></button>)}</div>
          </details>)}
        </> : <div className="wb-code-empty"><p>这个版本没有可展示的文件，请核对 GitHub 来源。</p></div>}
      </section>
      <aside className="wb-notes" aria-label="问题与人工记录">
        <div className="wb-pane-head"><h2>问题</h2><Button aria-label="新建" size="sm" variant="ghost" icon={<Plus/>} onClick={() => { const next = question(live); changeRound(r => ({ ...r, questions: [...r.questions, next], selectedQuestionId: next.id })); setSelectedId(next.id) }}>新建</Button></div>
        <div className="wb-question-list">
          {round.questions.map(q => <button key={q.id} className={`wb-question${selected?.id === q.id ? ' is-active' : ''}`} aria-pressed={selected?.id === q.id} onClick={() => { setSelectedId(q.id); changeRound(r => ({ ...r, selectedQuestionId: q.id })) }}>
            <span className="wb-question-body">{q.body.slice(0, 60) || '未填写的问题'}</span>
            <span className="wb-question-meta">{reviewStatusLabels[q.status]}{q.requiresRecheck ? ' · 代码变化待复核' : ''}{q.evidence.length ? ` · ${q.evidence.length} 条证据` : ''}</span>
          </button>)}
          {!round.questions.length ? <p className="wb-pane-empty">还没有问题记录。新建一条，或点击代码行把位置关联进来。</p> : null}
        </div>
        <div className="wb-question-detail">
          {selected ? <QuestionEditor key={selected.id + version} value={selected} source={live} onChange={updateQuestion} onJump={anchor => { if (!work.rounds[anchor.snapshotId]) { setContextError('原版本无法读取，原位置已保留'); return } switchVersion(anchor.snapshotId, anchor.path, anchor.line ? { side: anchor.side, line: anchor.line } : undefined, { evidence: true }) }} work={work}/> : null}
        </div>
        <label className="wb-note">
          <span>个人笔记{round.scratchOriginSnapshotId ? <small>沿用原版本 {round.scratchOriginSnapshotId.slice(0, 12)} 的笔记，请结合当前代码核对。</small> : null}</span>
          <textarea aria-label="个人笔记" value={round.scratch} onChange={e => changeRound(r => ({ ...r, scratch: e.target.value, scratchOriginSnapshotId: undefined }))} placeholder="读到哪里、还待核对什么；不会附到对外意见里。"/>
        </label>
      </aside>
    </div> : null}
    <Drawer open={drawer === 'source'} onClose={() => setDrawer(null)} width={600} title="代码版本与作者说明">
      <div className="wb-drawer">
        <label className="wb-field">正在阅读的版本
          <Select value={version} onChange={value => switchVersion(value)} options={Object.values(work.rounds).map(r => ({ value: r.source.snapshotId, label: `${r.source.headSha.slice(0, 12)} · ${displayTime(r.source.capturedAt)}` }))} aria-label="审查代码版本"/>
        </label>
        <dl className="wb-defs">
          <div><dt>基准</dt><dd>{live.baseBranch} · {live.baseSha.slice(0, 12)}</dd></div>
          <div><dt>目标</dt><dd>{live.headBranch} · {live.headSha.slice(0, 12)}</dd></div>
          <div><dt>代码读取于</dt><dd>{displayTime(live.capturedAt)}</dd></div>
          <div><dt>最近检查</dt><dd>{displayTime(work.checkedAt)}</dd></div>
        </dl>
        <details className="wb-commits" open>
          <summary>涉及提交（已加载 {live.commits.length}/{live.totalCommits}）</summary>
          <ul>{live.commits.map(c => <li key={c.sha}><a href={`https://github.com/${live.baseRepository}/commit/${c.sha}`} target="_blank" rel="noreferrer">{c.sha.slice(0, 12)}</a> <span>{c.message.split('\n')[0]}</span></li>)}</ul>
          {!live.commitsComplete ? <p>提交列表未完整加载，请在 GitHub 核对其余提交；文件阅读不依赖模型。</p> : null}
        </details>
        <div className="wb-drawer-links">
          <Button size="sm" icon={<ExternalLink/>} href={live.url} target="_blank" aria-label="在 GitHub 核对 PR">在 GitHub 核对 PR</Button>
          <Button size="sm" onClick={() => navigate({ name: 'repository', repositoryId: live.repositoryId })}>项目分析与模型线索</Button>
          <Button size="sm" icon={<Save/>} onClick={() => setDrawer('backup')} aria-label="草稿备份与反馈">草稿备份与反馈</Button>
        </div>
      </div>
    </Drawer>
    <Drawer open={drawer === 'delivery'} onClose={() => setDrawer(null)} width={680} title="输出本轮审查意见">
      <div className="wb-drawer">
        <p className="wb-drawer-note">尚需处理：{live.totalFiles - readCount} 个未完整阅读文件、{pendingCount} 个未关闭或待复核问题。可继续阅读，或在结论中明确保留。</p>
        <DeliveryForm busy={busy} draft={round.deliveryDraft} onDraft={deliveryDraft => changeRound(r => ({ ...r, deliveryDraft }))} onPrepare={prepareDelivery}/>
        {delivery ? <div className="wb-delivery-preview">
          <h3>审查意见预览</h3>
          {!delivery.checked || work.latestSnapshotId !== version ? <label className="wb-check"><input type="checkbox" checked={delivery.oldConfirmed} onChange={e => setDelivery({ ...delivery, oldConfirmed: e.target.checked })}/>确认按当前旧版本交付，并保留版本和未覆盖事项说明</label> : null}
          <textarea readOnly aria-label="审查意见预览" value={delivery.preview}/>
          <Space>
            <Button variant="primary" disabled={busy || ((!delivery.checked || work.latestSnapshotId !== version) && !delivery.oldConfirmed)} onClick={() => void confirmDelivery()}>确认保存本轮结论</Button>
            <Button onClick={() => setDelivery(null)}>继续审查</Button>
          </Space>
        </div> : null}
        {round.conclusion ? <div className="wb-receipt">
          <h3>{conclusionLabels[round.conclusion.kind]} · {displayTime(round.conclusion.createdAt)}</h3>
          <p>意见属于 {live.headSha.slice(0, 12)}，尚未发送到 GitHub。</p>
          <Space>
            <Button size="sm" onClick={() => downloadText(`review-${number}-${live.headSha.slice(0, 8)}.md`, round.conclusion!.markdown, 'text/markdown')}>下载 Markdown 意见</Button>
            <Button size="sm" onClick={() => navigator.clipboard.writeText(round.conclusion!.markdown).catch(error => setReadError(error))}>复制审查意见</Button>
          </Space>
          <details><summary>查看已保存意见</summary><pre>{round.conclusion.markdown}</pre></details>
        </div> : null}
      </div>
    </Drawer>
    <Drawer open={drawer === 'backup'} onClose={() => setDrawer(null)} width={620} title="个人草稿备份">
      <WorkBackup work={work} onMerge={commit}/>
      <FeedbackCases key={`feedback:${version}`} work={work} version={version}/>
    </Drawer>
  </section>
}
