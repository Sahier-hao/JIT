import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Route } from '../navigation'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { PRModelClues } from '../components/PRModelClues'
import { displayTime } from '../domain'
import { getPRContext, getPRSnapshot, intakePR, refreshPR, type PRContext, type PRFile, samePRSource, verifyBackupSources, type PRList, type PRSnapshot } from '../prReviewClient'
import { reviewStatusLabels, parsePatchLines, adoptVersion, conclusionLabels, createWork, downloadText, evidenceURL, exportReview, mergeBackup, parseBackup, question, readWorks, saveWork, setFileState, workKey, type Conclusion, type Evidence, type FileState, type PRWork, type ReviewQuestion } from '../prReview'

type Navigate = (route: Route) => void
const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
const routeFor = (work: PRWork): Route => ({ name: 'pr-work', owner: work.owner, repositoryName: work.name, number: work.number })
const remoteLabel = { open: '开放中', closed: '已关闭', merged: '已合并' }
const changeLabels: Record<string, string> = { added: '新增', removed: '删除', modified: '修改', renamed: '重命名', copied: '复制', changed: '内容变化', unchanged: '未变化' }
const fileLabel: Record<FileState, string> = { unread: '未阅读', read: '已阅读', recheck: '需要复核', uncovered: '暂未覆盖' }
function loadPersonal() { try { return { works: readWorks(), error: '' } } catch (error) { return { works: [], error: message(error) } } }
function backup(work: PRWork) { downloadText(`review-${work.owner}-${work.name}-${work.number}.json`, JSON.stringify({ format: 'jit-pr-review-v1', work }, null, 2), 'application/json') }

export function MyReviews({ navigate, repositoryUrl }: { navigate: Navigate; repositoryUrl?: string }) {
  const [personal, setPersonal] = useState(loadPersonal)
  const [url, setUrl] = useState(repositoryUrl ?? '')
  const [list, setList] = useState<PRList | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  const refreshPersonal = () => setPersonal(loadPersonal())
  useEffect(() => { window.addEventListener('jit:pr-work-changed', refreshPersonal); window.addEventListener('storage', refreshPersonal); return () => { window.removeEventListener('jit:pr-work-changed', refreshPersonal); window.removeEventListener('storage', refreshPersonal) } }, [])
  async function connect(event?: FormEvent, value = url, state = 'open', page = 1) {
    event?.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const result = await intakePR(value, state, page)
      if ('snapshot' in result) {
        const existing = readWorks().find(w => w.key === workKey(result.snapshot.owner, result.snapshot.name, result.snapshot.number))
        const next = existing ? adoptVersion(existing, result.snapshot) : createWork(result.snapshot)
        const saved = saveWork({ ...next, interest: 'active', remoteState: result.remoteState, checkedAt: result.checkedAt, checkError: '' })
        navigate(routeFor(saved))
      } else setList(result)
    } catch (failure) { setError(failure) }
    finally { lock.current = false; setBusy(false) }
  }
  async function checkAll() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      for (const item of readWorks().filter(w => w.interest === 'active')) {
        try {
          const result = await refreshPR(item.owner, item.name, item.number)
          const latest = readWorks().find(w => w.key === item.key) ?? item
          saveWork({ ...adoptVersion(latest, result.snapshot), checkedAt: result.checkedAt, remoteState: result.remoteState, checkError: '' })
        } catch (failure) {
          const latest = readWorks().find(w => w.key === item.key) ?? item
          saveWork({ ...latest, checkError: message(failure) })
        }
      }
      refreshPersonal()
    } catch (failure) { setError(failure) }
    finally { lock.current = false; setBusy(false) }
  }
  useEffect(() => {
    let active = true
    if (loadPersonal().works.some(w => w.interest === 'active' && w.remoteState === 'open' && Date.now() - Date.parse(w.checkedAt) > 300000)) Promise.resolve().then(() => { if (active) void checkAll() })
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void checkAll() }, 300000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  function status(work: PRWork) {
    const round = work.rounds[work.latestSnapshotId]
    if (work.interest !== 'active' || work.remoteState !== 'open') return '历史与暂停'
    if (work.latestSnapshotId !== work.viewedSnapshotId || Object.values(round.progress).some(p => p.state === 'recheck') || round.questions.some(q => q.requiresRecheck)) return '作者更新待复核'
    if (round.conclusion) return '等待作者处理'
    return Object.values(round.progress).some(p => p.state === 'read') || round.scratch || round.questions.some(q => q.judgment || q.evidence.length) ? '继续审查' : '新关注的工作'
  }
  return <section className="pr-home">
    <header className="page-heading"><div><p className="pr-eyebrow">PERSONAL REVIEW</p><h1>我的审查</h1><p className="page-intro">从一个真实 PR 开始，把问题、证据和下一轮复核放在同一张工作单里。</p></div><button className="clear-button" disabled={busy} onClick={() => void checkAll()}>{busy ? '正在读取远端…' : '检查关注工作更新'}</button></header>
    <form className="pr-intake" onSubmit={event => void connect(event)}><label>仓库或 PR 地址<input aria-label="仓库或 PR 地址" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/owner/repo/pull/42"/></label><button className="primary-button" disabled={busy}>接入审查</button><p>支持公开 GitHub 来源。个人关注不代表正式评审人分配；草稿、问题和反馈只保存在当前浏览器。页面停留期间每 5 分钟检查关注工作。</p></form>
    {error ? <FailureNotice error={error}/> : null}
    {personal.error ? <p role="alert" className="field-error">{personal.error}。现有存储未被清空。</p> : null}
    {list ? <section className="pr-discovery"><div className="section-label"><h2>{list.owner}/{list.name} · {list.state === 'open' ? '开放的 PR' : '历史 PR'}</h2><span>检查于 {displayTime(list.checkedAt)}</span></div>
      {!list.pullRequests.length ? <p>没有{list.state === 'open' ? '开放的' : '本页'} PR。可以选择历史 PR 复盘。</p> : list.pullRequests.map(pr => <article key={pr.number} className="pr-task"><div><b>#{pr.number} {pr.title}</b><p>{pr.author} · {remoteLabel[pr.remoteState]} · 更新于 {displayTime(pr.updatedAt)}</p></div><button className="clear-button" disabled={busy} onClick={() => void connect(undefined, pr.url)}>开始{pr.remoteState === 'open' ? '审查' : '历史复盘'}</button></article>)}
      <div className="panel-actions"><button className="text-button" disabled={busy} onClick={() => void connect(undefined, list.repositoryUrl, list.state === 'open' ? 'closed' : 'open')}>{list.state === 'open' ? '查看历史 PR' : '查看开放 PR'}</button><button className="text-button" disabled={busy || list.page <= 1} onClick={() => void connect(undefined, list.repositoryUrl, list.state, list.page - 1)}>上一页</button><span>第 {list.page} 页</span><button className="text-button" disabled={busy || !list.hasMore} onClick={() => void connect(undefined, list.repositoryUrl, list.state, list.page + 1)}>下一页</button></div>
    </section> : null}
    {['作者更新待复核', '继续审查', '新关注的工作', '等待作者处理', '历史与暂停'].map(group => {
      const items = personal.works.filter(work => status(work) === group)
      if (!items.length) return null
      return <section key={group} className="pr-queue"><h2>{group}<span>{items.length}</span></h2>{items.map(work => {
        const round = work.rounds[work.latestSnapshotId]
        return <article key={work.key} className="pr-task"><div><small>{work.owner}/{work.name} · {remoteLabel[work.remoteState]} · {work.interest === 'paused' ? '已暂停关注' : work.interest === 'ended' ? '已结束关注' : '个人关注'}</small><h3>#{work.number} {round.source.title}</h3><p>{round.source.author} · 已读 {Object.values(round.progress).filter(p => p.state === 'read').length}/{round.source.totalFiles} · 最近检查 {displayTime(work.checkedAt)}</p>{work.checkError ? <p role="alert" className="field-error">检查失败：{work.checkError}；保留此前版本。</p> : null}</div><button className="primary-button" onClick={() => navigate(routeFor(work))}>{group === '作者更新待复核' ? '核对更新' : group === '新关注的工作' ? '开始审查' : '继续工作'}</button></article>
      })}</section>
    })}
    {!personal.works.length && !personal.error ? <div className="quiet-empty"><h2>接手一项真实改动</h2><p>粘贴 PR 地址直接开始，或从仓库挑选一项工作。模型暂时不可用时，也能阅读代码并留下判断。</p></div> : null}
    <details className="pr-backup-start"><summary>从完整草稿备份恢复工作</summary><input type="file" accept=".json,application/json" aria-label="恢复工作单备份" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 1024 * 1024) throw new Error('备份超过1 MiB'); const incoming = parseBackup(await file.text()); await verifyBackupSources(incoming); const old = readWorks().find(w => w.key === incoming.key); if (old) { navigate(routeFor(old)); throw new Error('此 PR 已有工作单，请在工作单内预览并合并备份，不覆盖原记录') } const restored = saveWork({ ...incoming, revision: 0 }); navigate(routeFor(restored)) } catch (failure) { setError(failure) } }}/></details>
  </section>
}

export function PullRequestWork({ owner, repositoryName, number, navigate }: { owner: string; repositoryName: string; number: number; navigate: Navigate }) {
  const [initial] = useState(() => { try { return { work: readWorks().find(w => w.key === workKey(owner, repositoryName, number)) ?? null, error: '' } } catch (error) { return { work: null, error: message(error) } } })
  const [work, setWork] = useState<PRWork | null>(initial.work)
  const current = useRef(work)
  const [saveError, setSaveError] = useState(initial.error)
  const [source, setSource] = useState<PRSnapshot | null>(null)
  const [readError, setReadError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [contexts, setContexts] = useState<Record<string, PRContext>>({})
  const [contextError, setContextError] = useState('')
  const [contextBusy, setContextBusy] = useState(false)
  const [delivery, setDelivery] = useState<{ kind: Conclusion; note: string; preview: string; checked: boolean; oldConfirmed: boolean } | null>(null)
  const version = work?.viewedSnapshotId ?? ''
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
      refreshPR(owner, repositoryName, number).then(result => { if (!controller.signal.aborted) { commit({ ...createWork(result.snapshot), remoteState: result.remoteState, checkedAt: result.checkedAt }); setSource(result.snapshot) } }).catch(error => { if (!controller.signal.aborted) setReadError(error) })
    } else {
      getPRSnapshot(cached.viewedSnapshotId, controller.signal).then(result => { if (!controller.signal.aborted) { if (!samePRSource(cached.rounds[cached.viewedSnapshotId].source, result)) throw new Error('返回代码与草稿固定版本不一致'); setSource(result); setReadError(null) } }).catch(error => { if (!controller.signal.aborted) { setReadError(error); setSource(null) } })
    }
    return () => controller.abort()
  }, [owner, repositoryName, number, version, attempt])
  const savedLocation = work?.rounds[version]?.location
  const savedPath = work?.rounds[version]?.currentFile
  const savedSide = savedLocation?.side, savedLine = savedLocation?.line
  useEffect(() => {
    if (!savedSide || !savedLine || !savedPath) return
    const node = document.querySelector<HTMLElement>(`.pr-code [data-code-line="${savedSide}:${savedLine}"]`)
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
  if (!work) return <section><button className="back-link" onClick={() => navigate({ name: 'my-reviews' })}>我的审查</button>{readError || initial.error ? <><FailureNotice error={readError ?? new Error(initial.error)}/><button onClick={() => { setReadError(null); setAttempt(v => v + 1) }}>重试读取 PR</button></> : <LoadingNotice label="正在读取 PR、文件和固定代码版本"/>}</section>
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
  function switchVersion(value: string, targetPath?: string, location?: { side: 'base' | 'head'; line: number }) {
    const active = current.current!
    commit({ ...active, viewedSnapshotId: value, rounds: targetPath ? { ...active.rounds, [value]: { ...active.rounds[value], currentFile: targetPath, location } } : active.rounds })
    if (value !== version) setSource(null)
    setReadError(null); setContextError(''); setDelivery(null)
  }
  async function check(): Promise<PRWork | null> {
    if (lock.current) return null
    lock.current = true; setBusy(true); setReadError(null)
    try {
      const result = await refreshPR(owner, repositoryName, number)
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
  return <section className="pr-work">
    <button className="back-link" onClick={() => navigate({ name: 'my-reviews' })}>返回我的审查</button>
    <header className="page-heading"><div><p className="pr-eyebrow">{owner}/{repositoryName} · PR #{number} · {remoteLabel[work.remoteState]}</p><h1>{round.source.title}</h1><p className="page-intro">{round.source.author} · 已阅读 {readCount}/{live.totalFiles} · 待复核文件 {recheckCount} · 待处理问题 {pendingCount}</p></div><button className="clear-button" disabled={busy} onClick={() => void check()}>{busy ? '正在检查…' : '检查 PR 更新'}</button></header>
    <div className="pr-objective"><small>作者说明节选</small><p>{live.body.trim().slice(0, 180) || "作者未填写改动目标，可在问题中记录需要作者说明的内容。"}</p></div>
    <div className="pr-work-toolbar"><span>个人草稿保存在当前浏览器 · {saveError ? '尚未保存' : work.savedAt ? `已保存 ${displayTime(work.savedAt)}` : '尚未保存'}</span><select aria-label="个人关注状态" value={work.interest} onChange={e => commit({ ...current.current!, interest: e.target.value as PRWork['interest'] })}><option value="active">关注这项工作</option><option value="paused">暂停关注</option><option value="ended">结束关注</option></select><a href={live.url} target="_blank" rel="noreferrer">在 GitHub 核对 PR</a><button className="text-button" onClick={() => navigate({ name: 'repository', repositoryId: live.repositoryId })}>项目分析与模型线索</button></div>
    {saveError ? <div className="pr-save-error" role="alert"><p>{saveError}</p><button onClick={() => commit(current.current!)}>重试保存</button><button onClick={() => backup(work)}>导出完整草稿</button></div> : null}
    {readError ? <><FailureNotice error={readError}/><button className="text-button" onClick={() => setAttempt(v => v + 1)}>重新读取当前版本</button></> : null}
    {work.checkError ? <p className="field-error">上次检查失败：{work.checkError}。仍保留此前版本，最近成功检查 {displayTime(work.checkedAt)}。</p> : null}
    {work.remoteState !== 'open' ? <p className="status-note">远端 PR {remoteLabel[work.remoteState]}，当前为历史审查。个人草稿和原结论保留；可主动继续复盘。</p> : null}
    {work.latestSnapshotId !== version ? <div className="pr-update-note"><strong>代码基准或目标版本已有变化，当前仍阅读原版本。</strong><button className="primary-button" onClick={() => switchVersion(work.latestSnapshotId)}>开始复核新版本</button><p>旧意见和结论属于旧代码，不会自动解决；新一轮将提示变动文件与过期证据。</p></div> : null}
    <details className="pr-source"><summary>代码版本与作者原始说明</summary><label>正在阅读的版本<select aria-label="审查代码版本" value={version} onChange={e => switchVersion(e.target.value)}>{Object.values(work.rounds).map(r => <option key={r.source.snapshotId} value={r.source.snapshotId}>{r.source.headSha.slice(0, 12)} · {displayTime(r.source.capturedAt)}</option>)}</select></label><dl><div><dt>基准</dt><dd>{live.baseBranch} · {live.baseSha}</dd></div><div><dt>目标</dt><dd>{live.headBranch} · {live.headSha}</dd></div><div><dt>代码读取于</dt><dd>{displayTime(live.capturedAt)}</dd></div><div><dt>最近检查</dt><dd>{displayTime(work.checkedAt)}</dd></div></dl><h2>作者原始说明</h2><pre className="pr-author-body">{live.body || '作者没有填写说明'}</pre><details><summary>涉及提交（已加载 {live.commits.length}/{live.totalCommits}）</summary><ul>{live.commits.map(c => <li key={c.sha}><a href={`https://github.com/${live.baseRepository}/commit/${c.sha}`} target="_blank" rel="noreferrer">{c.sha.slice(0, 12)}</a> {c.message}</li>)}</ul>{!live.commitsComplete ? <p>提交列表未完整加载，请在 GitHub 核对其余提交；文件阅读不依赖模型。</p> : null}</details></details>
    {round.historyNotice ? <p className="status-note">{round.historyNotice}</p> : null}
    <PRModelClues key={`model:${version}`} source={live} navigate={navigate} modelId={round.modelId} onModelId={id => changeRound(r => ({ ...r, modelId: id }))}/>
    <div className="pr-review-grid">
      <aside className="pr-files"><h2>文件与进度</h2><p>加载 {live.files.length}/{live.totalFiles} 个文件；已阅读不等于确认没有缺陷。</p>{live.files.map(f => <button key={f.path} aria-current={path === f.path ? 'true' : undefined} onClick={() => chooseFile(f.path)}><span>{f.path}</span><small>{changeLabels[f.status] ?? f.status} · +{f.additions} −{f.deletions} · {fileLabel[round.progress[f.path]?.state ?? 'unread']}</small>{round.progress[f.path]?.originSnapshotId !== version ? <small>沿用上轮阅读记录</small> : null}</button>)}{!live.filesComplete ? <p className="field-error">还有 {live.totalFiles - live.files.length} 个文件未覆盖，不能计入已阅读。请在 GitHub 核对超出接口上限的范围。</p> : null}</aside>
      <section className="pr-code" aria-label="PR 代码阅读">
        {file ? <><header><h2>{file.path}</h2>{file.previousPath ? <p>重命名自 {file.previousPath}</p> : null}<div className="panel-actions"><button className="clear-button" disabled={!readable} onClick={() => commit(setFileState(current.current!, version, path, 'read', readable))}>标记已阅读</button><button className="text-button" onClick={() => commit(setFileState(current.current!, version, path, 'recheck', readable))}>需要复查</button><button className="text-button" onClick={() => commit(setFileState(current.current!, version, path, 'uncovered', readable))}>暂未覆盖</button></div></header>
          <p className="form-hint">{file.patchComplete ? '真实 GitHub Diff · 已核对增删行数。' : 'Diff 未完整提供，可能是二进制或过大文件；请读取完整上下文，失败时不能标记已阅读。'} 点击代码行，将该位置关联到右侧当前问题。</p>
          {file.patch ? <Patch file={file} onAnchor={anchor} location={round.location}/> : <p className="quiet-empty">没有可展示的 Diff，未当作空文件处理。</p>}
          <button className="clear-button" disabled={contextBusy} onClick={() => void loadContext()}>{contextBusy ? '正在读取固定版本…' : '加载完整上下文'}</button>{contextError ? <p className="field-error" role="alert">{contextError}</p> : null}
          {[baseContext, headContext].filter((c): c is PRContext => Boolean(c)).map(c => <details key={c.side} open><summary>{c.side === 'base' ? '基准' : '目标'}上下文 · {c.absent ? '该侧不存在此文件' : c.complete ? `${c.totalLines} 行完整文本` : `仅前10000/${c.totalLines}行，未完整覆盖`}</summary><div className="pr-context-lines">{c.content.split('\n').map((line, i) => <button key={i} data-code-line={`${c.side}:${i + 1}`} data-focused={round.location?.side === c.side && round.location.line === i + 1 ? 'true' : undefined} onClick={() => anchor(c.side, i + 1)} aria-label={`关联 ${file.path}:${c.side}:${i + 1}`}><span>{i + 1}</span><code>{line || ' '}</code></button>)}</div></details>)}
        </> : <p>此版本没有可展示的文件，请核对 GitHub 来源。</p>}
      </section>
      <aside className="pr-questions"><div className="section-label"><h2>问题与人工记录</h2><button className="text-button" onClick={() => { const next = question(live); changeRound(r => ({ ...r, questions: [...r.questions, next], selectedQuestionId: next.id })); setSelectedId(next.id) }}>新建问题</button></div><p className="form-hint">作者说明与文件事实生成的核对问题是待验证线索，不是模型定位或已确认缺陷。</p>
        <div className="pr-question-list">{round.questions.map(q => <button key={q.id} aria-pressed={selected?.id === q.id} onClick={() => { setSelectedId(q.id); changeRound(r => ({ ...r, selectedQuestionId: q.id })) }}>{q.body.slice(0, 65) || '未填写的问题'}<small>{reviewStatusLabels[q.status]}{q.requiresRecheck ? ' · 代码变化，待复核' : ''}</small></button>)}</div>
        {selected ? <QuestionEditor key={selected.id + version} value={selected} source={live} onChange={updateQuestion} onJump={anchor => { if (!work.rounds[anchor.snapshotId]) { setContextError('原版本无法读取，原位置已保留'); return } switchVersion(anchor.snapshotId, anchor.path, anchor.line ? { side: anchor.side, line: anchor.line } : undefined) }} work={work}/> : null}
        <label className="pr-note">个人笔记{round.scratchOriginSnapshotId ? <small>沿用原版本 {round.scratchOriginSnapshotId.slice(0, 12)} 的笔记，请结合当前代码核对。</small> : null}<textarea aria-label="个人笔记" value={round.scratch} onChange={e => changeRound(r => ({ ...r, scratch: e.target.value, scratchOriginSnapshotId: undefined }))} placeholder="留下读到哪里、尚待核对什么；不会自动附到对外意见里。"/></label>
      </aside>
    </div>
    <section className="pr-delivery"><h2>输出本轮审查意见</h2><p>尚需处理：{live.totalFiles - readCount} 个未完整阅读文件、{pendingCount} 个未关闭或待复核问题。可继续阅读，或在结论中明确保留。</p>
      <DeliveryForm busy={busy} draft={round.deliveryDraft} onDraft={deliveryDraft => changeRound(r => ({ ...r, deliveryDraft }))} onPrepare={prepareDelivery}/>
      {delivery ? <div className="pr-delivery-preview"><h3>审查意见预览</h3>{!delivery.checked || work.latestSnapshotId !== version ? <label><input type="checkbox" checked={delivery.oldConfirmed} onChange={e => setDelivery({ ...delivery, oldConfirmed: e.target.checked })}/>确认按当前旧版本交付，并保留版本和未覆盖事项说明</label> : null}<textarea readOnly aria-label="审查意见预览" value={delivery.preview}/><button className="primary-button" disabled={busy || ((!delivery.checked || work.latestSnapshotId !== version) && !delivery.oldConfirmed)} onClick={() => void confirmDelivery()}>确认保存本轮结论</button><button className="text-button" onClick={() => setDelivery(null)}>继续审查</button></div> : null}
      {round.conclusion ? <div className="pr-receipt"><h3>{conclusionLabels[round.conclusion.kind]} · {displayTime(round.conclusion.createdAt)}</h3><p>意见属于 {live.headSha.slice(0, 12)}，尚未发送到 GitHub。</p><button className="clear-button" onClick={() => downloadText(`review-${number}-${live.headSha.slice(0, 8)}.md`, round.conclusion!.markdown, 'text/markdown')}>下载 Markdown 意见</button><button className="text-button" onClick={() => navigator.clipboard.writeText(round.conclusion!.markdown).catch(error => setReadError(error))}>复制审查意见</button><details><summary>查看已保存意见</summary><pre>{round.conclusion.markdown}</pre></details></div> : null}
    </section>
    <WorkBackup work={work} onMerge={commit}/>
    <FeedbackCases key={`feedback:${version}`} work={work} version={version}/>
  </section>
}

function Patch({ file, onAnchor, location }: { file: PRFile; onAnchor: (side: 'base' | 'head', line: number) => void; location?: { side: 'base' | 'head'; line: number } }) {
  const lines = parsePatchLines(file.patch!).map((entry, index) => entry.kind === 'hunk' || entry.line === null
    ? <div className="pr-hunk" key={index}>{entry.text}</div>
    : <button className={entry.kind === 'delete' ? 'is-deletion' : entry.kind === 'add' ? 'is-addition' : ''} key={index} data-code-line={`${entry.side}:${entry.line}`} data-focused={location?.side === entry.side && location.line === entry.line ? 'true' : undefined} aria-label={`关联 ${file.path}:${entry.side}:${entry.line}`} onClick={() => onAnchor(entry.side, entry.line!)}><span>{entry.side === 'base' ? entry.line : ''}</span><span>{entry.side === 'head' ? entry.line : ''}</span><code>{entry.text || ' '}</code></button>)
  return <div className="pr-diff" aria-label={`${file.path} Diff`}>{lines}</div>
}

function QuestionEditor({ value: q, source, onChange, onJump, work }: { value: ReviewQuestion; source: PRSnapshot; onChange: (value: ReviewQuestion) => void; onJump: (e: Evidence) => void; work: PRWork }) {
  const [error, setError] = useState('')
  return <div className="pr-question-editor"><p className="pr-source-label">来源：{q.source === 'author' ? '作者原始说明中的核对目标' : q.source === 'change' ? '已加载文件事实，规则生成的核对问题' : '人工提出'} · 原版本 {q.originSnapshotId.slice(0, 12)}</p>
    {q.requiresRecheck ? <p className="warning">相关代码已变化，旧证据可能过期。原问题和判断保留，请人工核对。</p> : null}
    <label>问题、疑问或建议<textarea aria-label="审查问题内容" value={q.body} onChange={e => onChange({ ...q, body: e.target.value })}/></label>
    <label>记录类型<select aria-label="审查记录类型" value={q.kind} onChange={e => onChange({ ...q, kind: e.target.value as ReviewQuestion['kind'] })}><option value="question">待确认的问题</option><option value="finding">人工确认的问题</option><option value="suggestion">一般建议</option></select></label>
    <details><summary>关联实现与测试文件（{q.relatedFiles.length}）</summary>{source.files.map(f => <label key={f.path}><input type="checkbox" checked={q.relatedFiles.includes(f.path)} onChange={e => onChange({ ...q, relatedFiles: e.target.checked ? [...q.relatedFiles, f.path] : q.relatedFiles.filter(p => p !== f.path) })}/>{f.path}</label>)}</details>
    <label>人工判断<textarea aria-label="人工判断" value={q.judgment} onChange={e => onChange({ ...q, judgment: e.target.value })}/></label>
    <label>处理理由<textarea aria-label="问题处理理由" value={q.reason} onChange={e => onChange({ ...q, reason: e.target.value })}/></label>
    <label>处理状态<select aria-label="问题处理状态" value={q.status} onChange={e => { const status = e.target.value as ReviewQuestion['status']; if (status !== 'open' && !q.reason.trim()) { setError('先填写处理理由，原内容会保留'); return } setError(''); onChange({ ...q, status }) }}><option value="open">待核对 / 重新打开</option><option value="resolved">人工标记已解决</option><option value="deferred">暂不处理</option><option value="withdrawn">撤回记录（保留原文）</option></select></label>
    {error ? <p className="field-error">{error}</p> : null}
    {q.requiresRecheck ? <button className="clear-button" disabled={!q.reason.trim()} onClick={() => onChange({ ...q, requiresRecheck: false })}>已人工复核当前版本</button> : null}
    <h3>位置与证据（{q.evidence.length}）</h3>{q.evidence.map((e, index) => <article key={index} className="pr-evidence"><button className="text-button" onClick={() => onJump(e)}>{e.path}:{e.line ?? '整体'} · {e.side === 'head' ? '目标' : '基准'} · 原版本</button><a href={evidenceURL(work.rounds[e.snapshotId]?.source ?? source, e)} target="_blank" rel="noreferrer">核对原代码</a><input aria-label={`证据说明 ${index + 1}`} value={e.note} placeholder="已核对什么，还缺什么证据" onChange={event => onChange({ ...q, evidence: q.evidence.map((a, i) => i === index ? { ...a, note: event.target.value } : a) })}/><button className="text-button" onClick={() => onChange({ ...q, evidence: q.evidence.filter((_, i) => i !== index) })}>移除此证据</button></article>)}
    <label>对线索的反馈<select aria-label="线索反馈" value={q.feedback} onChange={e => onChange({ ...q, feedback: e.target.value as ReviewQuestion['feedback'] })}><option value="">尚未反馈</option><option value="helpful">有帮助</option><option value="irrelevant">无关</option><option value="more-evidence">需要更多证据</option></select></label><input aria-label="线索反馈理由" value={q.feedbackReason} onChange={e => onChange({ ...q, feedbackReason: e.target.value })} placeholder="反馈理由（仅保存在当前浏览器）"/>
  </div>
}

function DeliveryForm({ onPrepare, busy, draft, onDraft }: { onPrepare: (kind: Conclusion, note: string) => Promise<void>; busy: boolean; draft?: { kind: Conclusion; note: string }; onDraft: (value: { kind: Conclusion; note: string }) => void }) {
  const kind = draft?.kind ?? 'changes', note = draft?.note ?? ''
  return <form className="pr-delivery-form" onSubmit={e => { e.preventDefault(); void onPrepare(kind, note) }}><label>本轮结论<select aria-label="本轮结论" value={kind} onChange={e => onDraft({ kind: e.target.value as Conclusion, note })}><option value="changes">建议修改</option><option value="complete">本轮审查完成</option><option value="defer">暂缓并说明原因</option></select></label><label>说明与未完成事项<textarea aria-label="本轮结论说明" required value={note} onChange={e => onDraft({ kind, note: e.target.value })}/></label><button className="primary-button" disabled={busy}>检查版本并预览意见</button></form>
}

function WorkBackup({ work, onMerge }: { work: PRWork; onMerge: (work: PRWork) => unknown }) {
  const [incoming, setIncoming] = useState<PRWork | null>(null), [choices, setChoices] = useState<Record<string, boolean>>({}), [error, setError] = useState('')
  const preview = incoming ? mergeBackup(work, incoming, choices) : null
  return <section className="pr-backups"><h2>个人草稿备份</h2><p>包含此 PR 各版本的个人笔记、问题、反馈和结论。仅在你选择导出时生成本地文件，不上传。</p><button className="clear-button" onClick={() => backup(work)}>导出完整草稿</button><label>选择备份以预览合并<input type="file" accept=".json,application/json" aria-label="导入完整草稿" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 1024 * 1024) throw new Error('备份超过 1 MiB'); const next = parseBackup(await file.text(), work.key); await verifyBackupSources(next); mergeBackup(work, next, {}); setIncoming(next); setChoices({}); setError('') } catch (failure) { setError(message(failure)) } }}/></label>{error ? <p className="field-error">{error}</p> : null}
    {preview ? <div className="pr-merge-preview"><h3>备份合并预览 · {preview.conflicts.length} 处差异</h3><p>默认保留当前判断；备份缺少的笔记和问题不会清空当前记录。新增条目会追加。</p>{preview.conflicts.map(c => <details key={c.key}><summary>{c.label}</summary><p>当前内容</p><pre>{c.current}</pre><p>备份内容</p><pre>{c.incoming}</pre><label><input type="checkbox" checked={choices[c.key] ?? false} onChange={e => setChoices({ ...choices, [c.key]: e.target.checked })}/>对此项采用备份内容</label></details>)}<button className="primary-button" onClick={() => { onMerge(mergeBackup(work, incoming!, choices).work); setIncoming(null) }}>确认合并草稿</button><button className="text-button" onClick={() => setIncoming(null)}>取消恢复</button></div> : null}
  </section>
}

function FeedbackCases({ work, version }: { work: PRWork; version: string }) {
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState('')
  const questions = work.rounds[version].questions.filter(q => q.feedback)
  return <details className="pr-feedback"><summary>预览并导出所选反馈案例</summary><p>反馈不会自动上传、公开给管理员、成为训练标签或修改模型。仅导出你选择的问题、位置、反馈与理由；不会附带个人笔记和其他问题。</p>{questions.map(q => <label key={q.id}><input type="checkbox" checked={selected.includes(q.id)} onChange={e => { setPreview(''); setSelected(e.target.checked ? [...selected, q.id] : selected.filter(id => id !== q.id)) }}/>{q.body.slice(0, 80)}</label>)}<button className="clear-button" disabled={!selected.length} onClick={() => setPreview(JSON.stringify({ format: 'jit-review-feedback-v1', pr: work.rounds[version].source.url, headSha: work.rounds[version].source.headSha, cases: questions.filter(q => selected.includes(q.id)).map(q => ({ question: q.body, source: q.source, evidence: q.evidence, feedback: q.feedback, reason: q.feedbackReason })) }, null, 2))}>预览将导出的字段</button>{preview ? <><textarea aria-label="反馈导出预览" value={preview} readOnly/><button className="primary-button" onClick={() => downloadText('selected-review-feedback.json', preview, 'application/json')}>确认导出所选案例</button></> : null}</details>
}
