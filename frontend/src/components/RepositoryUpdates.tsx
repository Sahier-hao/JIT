import { Icon } from '../Icon'
import { Button, Input, Select, Switch } from '../ui/controls'
import { Dialog } from '../ui/dialog'
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react'
import { updateRepository, type UpdateState } from '../repositoryUpdatesClient'
import { displayTime } from '../domain'
import { FailureNotice } from '../Feedback'
import { cn } from '../lib/utils'

const LABELS: Record<UpdateState['status'], string> = {
  idle: '尚未开启提醒',
  checking: '正在检查远端提交…',
  analyzing: '正在检查远端提交…',
  updated: '有新提交待分析',
  'up-to-date': '没有新提交',
  error: '检查未完成',
}
const SHORT: Record<UpdateState['status'], string> = { idle: '未开启', checking: '检查中', analyzing: '检查中', updated: '有新提交', 'up-to-date': '无新提交', error: '未完成' }
const ERRORS: Record<string, string> = {
  REPOSITORY_UNAVAILABLE: '无法读取仓库，请检查地址、分支或网络后重试。',
  REPOSITORY_CHECK_TIMEOUT: '检查远端仓库超时，请重试。',
  CONFLICT_ACTIVE_SYNC: '项目已有进行中的分析，结束后可重试检查。',
  SYNC_INTERRUPTED: '服务停止时检查未完成，请重试。',
}
const TONE_DOT: Record<string, string> = { active: 'bg-blue', ok: 'bg-teal', alert: 'bg-rose' }

export type UpdateHandle = { refresh: () => void }

/** 分支提醒：只检查追踪分支的新提交并写站内提醒，绝不自动创建分析。 */
export function RepositoryUpdates({ repositoryId, onUpdated, onAnalyze, ref }: { repositoryId: string; onUpdated: () => void; onAnalyze?: (branch: string) => void; ref?: Ref<UpdateHandle> }) {
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const callback = useRef(onUpdated)
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState<string | null>(null)
  const [interval, setIntervalValue] = useState<number | null>(null)
  const lastSignature = useRef('')
  useEffect(() => { callback.current = onUpdated }, [onUpdated])
  function accept(value: UpdateState) {
    setState(value)
    const signature = `${value.status}:${value.remoteHead ?? ''}`
    if (signature !== lastSignature.current) {
      if (lastSignature.current) callback.current()
      lastSignature.current = signature
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    updateRepository(repositoryId, 'read', undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) { accept(value); setError(null) }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [repositoryId, attempt])
  const running = state?.status === 'checking' || state?.status === 'analyzing'
  const checking = state?.status === 'checking'
  useEffect(() => {
    if (!checking && !state?.enabled) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setAttempt(value => value + 1) }, checking ? 2000 : 15000)
    return () => clearInterval(timer)
  }, [checking, state?.enabled])

  async function act(action: 'refresh' | 'configure', body?: { enabled?: boolean; branch?: string; intervalSeconds?: number }, check = false) {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(null)
    try {
      accept(await updateRepository(repositoryId, action, body))
      if (check) accept(await updateRepository(repositoryId, 'refresh'))
    } catch (failure) { setError(failure) }
    finally { locked.current = false; setBusy(false) }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    void act('configure', { branch: branch ?? state?.branch ?? 'HEAD', intervalSeconds: interval ?? state?.intervalSeconds ?? 300 }, true)
  }
  useImperativeHandle(ref, () => ({ refresh: () => { void act('refresh') } }))
  const branchLabel = state?.resolvedBranch ?? (state?.branch === 'HEAD' ? '默认分支' : state?.branch) ?? '默认分支'
  const head = state?.remoteHead?.slice(0, 7)
  const tone = state ? (state.status === 'error' ? 'alert' : state.status === 'checking' || state.status === 'analyzing' || state.status === 'updated' ? 'active' : 'ok') : 'active'
  const detail = state ? {
    idle: '开启后定期检查远端分支，只提醒，不自动分析。',
    checking: `正在读取远端 ${branchLabel} 的最新提交。`,
    analyzing: `正在读取远端 ${branchLabel} 的最新提交。`,
    updated: `远端 ${branchLabel}${head ? ` 在 ${head}` : ''} 有新提交。`,
    'up-to-date': `远端 ${branchLabel}${head ? ` 停在 ${head}` : ''}。`,
    error: '这次检查没有完成，可以重试。',
  }[state.status] : ''
  return <>
    <button type="button" className="inline-flex items-center gap-1.5 rounded-sm border border-border-soft bg-card px-2 py-1 text-xs text-foreground-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span className={cn('size-1.5 rounded-full', TONE_DOT[tone])} aria-hidden="true"/>
      <b className="font-medium">分支提醒</b>
      <span className="text-foreground-3">{state ? SHORT[state.status] : '读取中'}</span>
      <Icon name="chevron" size={13} className="text-foreground-4"/>
    </button>
    <Dialog open={open} onOpenChange={setOpen} title="分支提醒与仓库检查" width={560}>
      {error ? <FailureNotice error={error}/> : null}
      {!state || error ? <div className="grid justify-items-start gap-2">
        <p className="text-sm text-foreground-3">提醒状态暂时不可用。</p>
        <Button size="sm" disabled={busy} onClick={() => setAttempt(value => value + 1)}>重新读取</Button>
      </div> : <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border-soft p-2.5">
          <span className={cn('size-2 rounded-full', TONE_DOT[tone])} aria-hidden="true"/>
          <p role="status" className="text-sm font-medium text-foreground">{LABELS[state.status]}</p>
          <span className="text-xs text-foreground-3">{state.lastCheckedAt ? displayTime(state.lastCheckedAt) : '尚未检查'}</span>
          <Button className="ml-auto" size="sm" variant={state.status === 'error' ? 'danger' : 'secondary'} disabled={busy || running} onClick={() => void act('refresh')}>{running ? '检查中…' : state.status === 'error' ? '重试检查' : '立即检查'}</Button>
        </div>
        <p className="text-xs leading-body text-foreground-3">{state.status === 'error' ? (ERRORS[state.errorCode ?? ''] ?? `检查未完成（${state.errorCode ?? '未知原因'}），请重试；已有分析记录仍可查看。`) : detail}</p>
        {state.status === 'updated' && onAnalyze ? <div className="flex justify-end"><Button variant="primary" size="sm" onClick={() => { setOpen(false); onAnalyze(state.resolvedBranch ?? (state.branch === 'HEAD' ? '' : state.branch)) }}>分析这次更新</Button></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-2 text-xs text-foreground-3">
          <span className="inline-flex items-center gap-2"><Switch ariaLabel="分支提醒" checked={state.enabled} disabled={busy} onCheckedChange={checked => void act('configure', { enabled: checked })}/><span>分支提醒</span></span>
          <span>{`每 ${state.intervalSeconds / 60} 分钟检查一次`}</span>
        </div>
        <form className="grid gap-2 border-t border-border-soft pt-3" onSubmit={save}>
          <p className="text-sm font-semibold text-foreground">提醒设置</p>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">跟踪分支</span>
            <Input aria-label="提醒跟踪分支" value={branch ?? state.branch} onChange={event => setBranch(event.target.value)} disabled={busy || running}/>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">检查频率</span>
            <Select ariaLabel="仓库检查频率" value={interval ?? state.intervalSeconds} onChange={value => setIntervalValue(Number(value))} disabled={busy || running} options={[...new Set([300, 900, 1800, 3600, state.intervalSeconds])].sort((a, b) => a - b).map(value => ({ value, label: `每 ${value / 60} 分钟` }))}/>
          </div>
          <div className="flex justify-end"><Button type="submit" variant="primary" size="sm" disabled={busy || running}>保存并检查</Button></div>
        </form>
      </div>}
    </Dialog>
  </>
}
