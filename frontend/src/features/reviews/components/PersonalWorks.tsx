import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { LoaderCircle, RefreshCw, Upload } from 'lucide-react'

import { useEffect, useRef, useState } from 'react'

import { FailureNotice } from '@/components/shared/Feedback'
import { adoptVersion, hasLegacyWorks, legacyImportReceipt, legacyWorksHash, markLegacyImported, mergeBackup, parseBackupInfo, readLegacyWorks, readWorks, remoteStateLabels as remoteLabel, saveWork, type PRWork } from '@/features/reviews/prReview'
import { refreshPR, verifyBackupSources } from '@/features/reviews/prReviewClient'
import { canWriteReview, useReviewAccount } from '@/features/reviews/reviewAccount'
import type { Route } from '@/app/navigation'

const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
const routeFor = (work: PRWork): Route => ({ name: 'pr-work', owner: work.owner, repositoryName: work.name, number: work.number })
const shortTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function loadPersonal(account: string | null) {
  if (!account) return { works: [] as PRWork[], error: '登录身份尚未确认，个人工作单暂不可读' }
  try { return { works: readWorks(account), error: '' } } catch (error) { return { works: [], error: message(error) } }
}

/**
 * 跨项目个人审查队列：只汇总当前浏览器中当前账户的工作单状态。
 * 发现新 PR 交给项目 PR 审查；后台更新交给项目自动跟踪，这里只保留手动刷新。
 */
export function PersonalWorks({ navigate }: { navigate: (route: Route) => void }) {
  const reviewAccount = useReviewAccount()
  const account = reviewAccount.account
  const [personal, setPersonal] = useState(() => loadPersonal(account))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [legacy, setLegacy] = useState<{ hash: string; entries: { work: PRWork; exists: boolean; conflicts: number }[] } | null>(null)
  const [legacyError, setLegacyError] = useState('')
  const [legacyResult, setLegacyResult] = useState('')
  const lock = useRef(false)
  const restoreInput = useRef<HTMLInputElement>(null)
  const accountRef = useRef(account)
  const generationRef = useRef(reviewAccount.generation)
  accountRef.current = account
  generationRef.current = reviewAccount.generation
  const refreshPersonal = () => setPersonal(loadPersonal(account))
  useEffect(() => {
    setPersonal(loadPersonal(account))
    setLegacy(null); setLegacyError(''); setLegacyResult('')
  }, [account, reviewAccount.generation])
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ account?: string }>).detail
      if (!detail?.account || detail.account === accountRef.current) refreshPersonal()
    }
    window.addEventListener('jit:pr-work-changed', changed)
    window.addEventListener('storage', refreshPersonal)
    return () => {
      window.removeEventListener('jit:pr-work-changed', changed)
      window.removeEventListener('storage', refreshPersonal)
    }
  }, [account])
  async function checkAll() {
    if (lock.current || !account) return
    const capturedAccount = account, capturedGeneration = reviewAccount.generation
    lock.current = true; setBusy(true); setError(null)
    try {
      for (const item of readWorks(capturedAccount).filter(w => w.interest === 'active')) {
        if (accountRef.current !== capturedAccount || generationRef.current !== capturedGeneration || !canWriteReview(reviewAccount)) break
        try {
          const result = await refreshPR(item.owner, item.name, item.number)
          if (accountRef.current !== capturedAccount || generationRef.current !== capturedGeneration) break
          const latest = readWorks(capturedAccount).find(w => w.key === item.key) ?? item
          saveWork(capturedAccount, { ...adoptVersion(latest, result.snapshot), checkedAt: result.checkedAt, remoteState: result.remoteState, checkError: '' })
        } catch (failure) {
          if (accountRef.current !== capturedAccount || generationRef.current !== capturedGeneration) break
          const latest = readWorks(capturedAccount).find(w => w.key === item.key) ?? item
          saveWork(capturedAccount, { ...latest, checkError: message(failure) })
        }
      }
      refreshPersonal()
    } catch (failure) { setError(failure) }
    finally { lock.current = false; setBusy(false) }
  }
  function status(work: PRWork) {
    const round = work.rounds[work.latestSnapshotId]
    if (work.interest !== 'active' || work.remoteState !== 'open') return '历史与暂停'
    if (work.latestSnapshotId !== work.viewedSnapshotId || Object.values(round.progress).some(p => p.state === 'recheck') || round.questions.some(q => q.requiresRecheck)) return '作者更新待复核'
    if (round.conclusion) return '等待作者处理'
    return Object.values(round.progress).some(p => p.state === 'read') || round.scratch || round.questions.some(q => q.judgment || q.evidence.length) ? '继续审查' : '新关注的工作'
  }
  const groups = ['作者更新待复核', '继续审查', '新关注的工作', '等待作者处理', '历史与暂停']
  const counts = groups.map(group => personal.works.filter(work => status(work) === group).length)
  const total = personal.works.length
  function previewLegacy() {
    if (!account) return
    try {
      const works = readLegacyWorks()
      const current = readWorks(account)
      setLegacy({
        hash: legacyWorksHash(),
        entries: works.map(work => {
          const existing = current.find(item => item.key === work.key)
          const conflicts = existing ? mergeBackup(existing, { ...work, revision: 0 }, {}).conflicts.length : 0
          return { work, exists: Boolean(existing), conflicts }
        }),
      })
      setLegacyError(''); setLegacyResult('')
    } catch (failure) { setLegacyError(message(failure)) }
  }
  function importLegacy() {
    if (!account || !legacy) return
    let imported = 0
    const failures: string[] = []
    for (const { work: source } of legacy.entries) {
      try {
        const current = readWorks(account).find(work => work.key === source.key)
        const merged = current ? mergeBackup(current, { ...source, revision: 0 }, {}).work
          : { ...source, revision: 0 }
        saveWork(account, merged)
        imported += 1
      } catch (failure) {
        failures.push(`${source.owner}/${source.name}#${source.number}：${message(failure)}`)
      }
    }
    if (failures.length) {
      setLegacyError(`部分工作单未导入：${failures.join('；')}`)
      setLegacyResult(`已导入 ${imported} 个工作单到 ${account}；原旧数据未删除`)
    } else {
      markLegacyImported(account, legacy.hash)
      setLegacy(null)
      setLegacyResult(`已导入 ${imported} 个工作单到 ${account}；原旧数据保留在浏览器中`)
    }
    refreshPersonal()
  }
  const legacyAvailable = Boolean(account) && hasLegacyWorks()
    && legacyImportReceipt(account ?? '') !== legacyWorksHash()
  return <section className="grid gap-4" aria-label="我的审查">
    <WorkspacePageHeader title="我的审查" actions={<>
      <Button variant='outline' size="sm" onClick={() => void checkAll()} disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <RefreshCw aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}{busy ? '正在读取远端…' : '刷新我的工作'}</Button>
      {legacyAvailable ? <Button variant="ghost" size="sm" onClick={previewLegacy} type="button">{<Upload aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}导入本机旧工作单</Button> : null}
    </>}/>
    {legacy ? <section className="grid gap-2 rounded-sm border border-amber/30 bg-amber-soft p-3 text-xs text-amber-deep" aria-label="旧工作单导入">
      <h2 className="text-sm font-semibold">导入本机旧工作单到 {account}</h2>
      <p className="leading-body">{legacy.entries.length} 个旧工作单；原数据不会删除，也不会自动归给其他账户。</p>
      <ul className="grid gap-0.5 pl-4 list-disc">{legacy.entries.map(({ work, exists, conflicts }) => <li key={work.key}>{work.owner}/{work.name}#{work.number}{exists ? ` · 已有工作单，${conflicts} 处差异按当前判断合并` : ' · 新建到当前账户'}</li>)}</ul>
      {legacyError ? <p role="alert" className="text-rose">{legacyError}</p> : null}
      <Button variant='default' size="sm" onClick={importLegacy} type="button">确认导入</Button>{' '}
      <Button variant="ghost" size="sm" onClick={() => setLegacy(null)} type="button">取消</Button>
    </section> : null}
    {legacyResult ? <p role="status">{legacyResult}</p> : null}
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-soft bg-border-soft sm:grid-cols-3 lg:grid-cols-6" aria-label="审查队列概览">
      {groups.map((group, index) => <div key={group} className="grid gap-0.5 bg-card px-3 py-2.5">
        <span className="text-xs text-foreground-3">{group}</span>
        <span className="text-xl font-semibold tabular-nums text-foreground">{counts[index]}</span>
      </div>)}
      <div className="grid gap-0.5 bg-card px-3 py-2.5">
        <span className="text-xs text-foreground-3">关注中的工作</span>
        <span className="text-xl font-semibold tabular-nums text-foreground">{total}</span>
      </div>
    </div>
    {error ? <FailureNotice error={error}/> : null}
    {personal.error ? <p role="alert" className="text-xs text-rose">{personal.error}。现有存储未被清空。</p> : null}
    {groups.map(group => {
      const items = personal.works.filter(work => status(work) === group)
      if (!items.length) return null
      return <section key={group} className="grid gap-2">
        <h2 className="flex items-baseline justify-between text-sm font-semibold text-foreground">{group}<span className="text-xs font-normal text-foreground-4">{items.length}</span></h2>
        <div className="overflow-hidden rounded-md border border-border-soft">
          <div className="hidden grid-cols-[minmax(0,1fr)_180px_140px_120px] gap-3 bg-sunken px-3 py-1.5 text-xs text-foreground-3 sm:grid" aria-hidden="true">
            <span>工作</span><span>进度</span><span>检查</span><span>动作</span>
          </div>
          {items.map(work => {
          const round = work.rounds[work.latestSnapshotId]
          const read = Object.values(round.progress).filter(p => p.state === 'read').length
          const total = round.source.totalFiles
          const percent = total ? Math.round(read / total * 100) : 0
          const pending = round.questions.filter(q => q.status !== 'resolved').length
          return <article key={work.key} className="grid gap-2 border-t border-border-soft p-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_180px_140px_120px] sm:items-center sm:gap-3">
            <div className="grid min-w-0 gap-0.5">
              <h3 className="truncate text-sm font-medium text-foreground"><span className="font-mono text-xs text-foreground-3">#{work.number}</span> {round.source.title}</h3>
              <p className="truncate text-xs text-foreground-3">{work.owner}/{work.name} · {round.source.author} · {remoteLabel[work.remoteState]} · {work.interest === 'paused' ? '已暂停关注' : work.interest === 'ended' ? '已结束关注' : '个人关注'}{work.checkError ? ' · 检查失败，保留此前版本' : ''}</p>
            </div>
            <div className="grid gap-1 text-xs text-foreground-3">
              <span>{read}/{total} 文件 · {pending} 个未关闭问题</span>
              <div className="h-1 overflow-hidden rounded-full bg-strong" role="img" aria-label={`已阅读 ${percent}%`}><i className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }}/></div>
            </div>
            <span className="text-xs text-foreground-4">检查于 {shortTime(work.checkedAt)}</span>
            <Button className="justify-self-start" variant='outline' size="sm" onClick={() => navigate(routeFor(work))} type="button">{group === '作者更新待复核' ? '核对更新' : group === '新关注的工作' ? '开始审查' : group === '历史与暂停' ? '查看记录' : '继续工作'}</Button>
          </article>
        })}</div>
      </section>
    })}
    {!personal.works.length && !personal.error ? <div className="grid justify-items-center gap-1 rounded-md border border-dashed border-border p-8 text-center">
      <h2 className="text-sm font-semibold text-foreground">还没有审查工作</h2>
      <p className="text-xs text-foreground-3">到「项目」选择一个 PR 开始审查。</p>
    </div> : null}
    <Button className="justify-self-start" variant="ghost" size="sm" onClick={() => restoreInput.current?.click()} aria-label="从完整草稿备份恢复工作" type="button">{<Upload aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}从完整草稿备份恢复工作</Button>
    <input ref={restoreInput} type="file" hidden accept=".json,application/json" aria-label="恢复工作单备份" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 1024 * 1024) throw new Error('备份超过1 MiB'); const info = parseBackupInfo(await file.text()); const incoming = info.work; if (info.accountHint && info.accountHint !== account && !window.confirm(`备份归属 ${info.accountHint}，将导入当前账户 ${account}。继续？`)) return; await verifyBackupSources(incoming); const old = readWorks(account ?? '').find(w => w.key === incoming.key); if (old) { navigate(routeFor(old)); throw new Error('此 PR 已有工作单，请在工作单内预览并合并备份，不覆盖原记录') } const restored = saveWork(account ?? '', { ...incoming, revision: 0 }); navigate(routeFor(restored)) } catch (failure) { setError(failure) } }}/>
  </section>
}
