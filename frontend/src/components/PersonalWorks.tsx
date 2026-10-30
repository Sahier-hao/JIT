import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Upload } from 'lucide-react'
import { Button } from '../ui/controls'
import { FailureNotice } from '../Feedback'
import { adoptVersion, parseBackup, readWorks, saveWork, type PRWork } from '../prReview'
import { refreshPR, verifyBackupSources } from '../prReviewClient'
import type { Route } from '../navigation'

const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
const routeFor = (work: PRWork): Route => ({ name: 'pr-work', owner: work.owner, repositoryName: work.name, number: work.number })
const remoteLabel = { open: '开放中', closed: '已关闭', merged: '已合并' }
const shortTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function loadPersonal() { try { return { works: readWorks(), error: '' } } catch (error) { return { works: [], error: message(error) } } }

/**
 * 跨项目个人审查队列：只汇总当前浏览器的工作单状态。
 * 发现新 PR 交给项目 PR 审查；后台更新交给项目自动跟踪，这里只保留手动刷新。
 */
export function PersonalWorks({ navigate }: { navigate: (route: Route) => void }) {
  const [personal, setPersonal] = useState(loadPersonal)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  const restoreInput = useRef<HTMLInputElement>(null)
  const refreshPersonal = () => setPersonal(loadPersonal())
  useEffect(() => {
    window.addEventListener('jit:pr-work-changed', refreshPersonal)
    window.addEventListener('storage', refreshPersonal)
    return () => {
      window.removeEventListener('jit:pr-work-changed', refreshPersonal)
      window.removeEventListener('storage', refreshPersonal)
    }
  }, [])
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
  function status(work: PRWork) {
    const round = work.rounds[work.latestSnapshotId]
    if (work.interest !== 'active' || work.remoteState !== 'open') return '历史与暂停'
    if (work.latestSnapshotId !== work.viewedSnapshotId || Object.values(round.progress).some(p => p.state === 'recheck') || round.questions.some(q => q.requiresRecheck)) return '作者更新待复核'
    if (round.conclusion) return '等待作者处理'
    return Object.values(round.progress).some(p => p.state === 'read') || round.scratch || round.questions.some(q => q.judgment || q.evidence.length) ? '继续审查' : '新关注的工作'
  }
  return <section className="mr personal-works" aria-label="我的审查">
    <div className="mr-toolbar">
      <Button variant="secondary" icon={<RefreshCw size={14}/>} loading={busy} onClick={() => void checkAll()}>{busy ? '正在读取远端…' : '刷新我的工作'}</Button>
    </div>
    {error ? <FailureNotice error={error}/> : null}
    {personal.error ? <p role="alert" className="field-error">{personal.error}。现有存储未被清空。</p> : null}
    {['作者更新待复核', '继续审查', '新关注的工作', '等待作者处理', '历史与暂停'].map(group => {
      const items = personal.works.filter(work => status(work) === group)
      if (!items.length) return null
      return <section key={group} className="mr-group">
        <h2 className="mr-group-head">{group}<span>{items.length}</span></h2>
        <div className="mr-list">{items.map(work => {
          const round = work.rounds[work.latestSnapshotId]
          const read = Object.values(round.progress).filter(p => p.state === 'read').length
          const total = round.source.totalFiles
          const percent = total ? Math.round(read / total * 100) : 0
          const pending = round.questions.filter(q => q.status !== 'resolved').length
          return <article key={work.key} className="mr-row">
            <div className="mr-row-main">
              <h3><span className="mr-row-number">#{work.number}</span> {round.source.title}</h3>
              <p className="mr-row-meta">{work.owner}/{work.name} · {round.source.author} · {remoteLabel[work.remoteState]} · {work.interest === 'paused' ? '已暂停关注' : work.interest === 'ended' ? '已结束关注' : '个人关注'}{work.checkError ? ' · 检查失败，保留此前版本' : ''}</p>
            </div>
            <div className="mr-row-progress">
              <span>{read}/{total} 文件 · {pending} 个未关闭问题</span>
              <div className="mr-bar" role="img" aria-label={`已阅读 ${percent}%`}><i style={{ width: `${percent}%` }}/></div>
            </div>
            <span className="mr-row-time">检查于 {shortTime(work.checkedAt)}</span>
            <Button className="mr-row-action" variant="secondary" size="sm" onClick={() => navigate(routeFor(work))}>{group === '作者更新待复核' ? '核对更新' : group === '新关注的工作' ? '开始审查' : group === '历史与暂停' ? '查看记录' : '继续工作'}</Button>
          </article>
        })}</div>
      </section>
    })}
    {!personal.works.length && !personal.error ? <div className="mr-empty">
      <h2>还没有审查工作</h2>
      <p>到「项目」标签选择一个 PR 审查。工作会按「作者更新待复核 / 继续审查 / 新关注的工作 / 等待作者处理 / 历史与暂停」自动分组；模型暂时不可用时也能阅读代码并留下判断。</p>
    </div> : null}
    <Button className="mr-restore" variant="ghost" size="sm" icon={<Upload size={14}/>} onClick={() => restoreInput.current?.click()} aria-label="从完整草稿备份恢复工作">从完整草稿备份恢复工作</Button>
    <input ref={restoreInput} type="file" hidden accept=".json,application/json" aria-label="恢复工作单备份" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 1024 * 1024) throw new Error('备份超过1 MiB'); const incoming = parseBackup(await file.text()); await verifyBackupSources(incoming); const old = readWorks().find(w => w.key === incoming.key); if (old) { navigate(routeFor(old)); throw new Error('此 PR 已有工作单，请在工作单内预览并合并备份，不覆盖原记录') } const restored = saveWork({ ...incoming, revision: 0 }); navigate(routeFor(restored)) } catch (failure) { setError(failure) } }}/>
  </section>
}
