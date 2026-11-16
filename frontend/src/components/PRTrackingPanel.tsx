import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEffect, useRef, useState } from 'react'

import { FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { checkTracking, getTracking, projectPRs, updateTracking, type PRTracking, type ProjectPRPage } from '../projectActivityClient'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { cn } from '../lib/utils'

const INTERVALS = [300, 600, 900, 1800, 3600]
const watchLabel: Record<string, string> = { idle: '等待下次检查', checking: '正在检查远端', error: '上次检查失败' }

/** PR 自动分析设置：后台发现开放 PR 并固定快照分析，个人草稿与笔记不参与。 */
export function PRTrackingPanel({ repositoryId, onTracking }: { repositoryId: string; onTracking?: (value: PRTracking) => void }) {
  const [tracking, setTracking] = useState<PRTracking | null>(null)
  const [models, setModels] = useState<ModelChoice[]>([])
  const [scope, setScope] = useState<ProjectPRPage | null>(null)
  const [modelId, setModelId] = useState('')
  const [cadence, setCadence] = useState(300)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const lock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    Promise.all([getTracking(repositoryId, controller.signal), repositoryModels(controller.signal), projectPRs(repositoryId, 'open', 1, false, controller.signal)])
      .then(([config, choices, list]) => { if (controller.signal.aborted) return; setTracking(config); onTracking?.(config); setModels(choices); setScope(list); setModelId(config.modelId ?? ''); setCadence(config.intervalSeconds || 300) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [repositoryId, attempt, onTracking])
  const compatible = (m: ModelChoice) => m.state === 'ready' && m.enabled && m.repositoryPredictionSupported
  const validModel = models.some(m => m.modelId === modelId && compatible(m))
  const validInterval = INTERVALS.includes(cadence)
  const eligible = scope?.pullRequests.filter(p => p.remoteState === 'open' && !p.draft).length ?? 0
  async function action(run: () => Promise<PRTracking>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const value = await run()
      setTracking(value); onTracking?.(value); setConfirm(false)
      if (value.enabled) {
        try { setScope(await projectPRs(repositoryId, 'open', 1, false)) } catch { /* 范围刷新失败不影响已保存的设置 */ }
      }
    } catch (failure) {
      setError(failure)
    } finally {
      lock.current = false; setBusy(false)
    }
  }
  async function loadScope() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null); setConfirm(false)
    try { setScope(await projectPRs(repositoryId, 'open', 1, true)) } catch (failure) { setError(failure) } finally { lock.current = false; setBusy(false) }
  }
  if (error && !tracking) return <FailureNotice error={error} onRetry={() => setAttempt(value => value + 1)}/>
  if (!tracking) return <LoadingNotice label="正在读取 PR 自动分析设置"/>
  if (!tracking.supported) return <p className="text-xs leading-body text-foreground-3">此项目不是公开 GitHub 来源，无法启用 PR 自动分析；分支分析和风险趋势不受影响。</p>
  const tone = tracking.status === 'error' ? 'bg-rose' : tracking.status === 'checking' ? 'bg-blue' : tracking.enabled ? 'bg-teal' : 'bg-foreground-4'
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border-soft p-2.5">
      <span className={cn('size-2 rounded-full', tone)} aria-hidden="true"/>
      <p className="text-sm font-medium text-foreground" role="status" data-testid="update-status-title">{tracking.enabled ? '自动分析已开启' : '自动分析未开启'}</p>
      <span className="text-xs text-foreground-3">{tracking.enabled ? (tracking.nextCheckAt ? `下次 ${displayTime(tracking.nextCheckAt)}` : watchLabel[tracking.status] ?? tracking.status) : '开启后由后台定期检查'}</span>
      {tracking.enabled ? <Button className="ml-auto" size="sm" disabled={busy} onClick={() => void action(() => checkTracking(repositoryId))} variant="outline" type="button">立即检查</Button> : null}
    </div>
    {tracking.lastCheckedAt ? <p className="text-xs text-foreground-3">最近检查 {displayTime(tracking.lastCheckedAt)}{tracking.errorCode ? ` · 失败原因 ${tracking.errorCode}` : ''}</p> : null}
    {error && tracking ? <FailureNotice error={error} onRetry={() => setAttempt(value => value + 1)}/> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">固定分析模型</span>
        <Select value={modelId == null ? '' : String(modelId)} onValueChange={nextValue => (value => { setModelId(value); setConfirm(false) })(nextValue === '__jit_empty__' ? '' : nextValue)} disabled={busy}><SelectTrigger aria-label="固定自动分析模型"><SelectValue placeholder={"选择真实兼容模型"}/></SelectTrigger><SelectContent>{([
          ...(modelId && !models.some(m => m.modelId === modelId) ? [{ value: modelId, label: `原选模型 ${modelId}（不可用）`, disabled: true }] : []),
          ...models.map(m => ({ value: m.modelId, label: `${m.name} · ${m.modelId}${compatible(m) ? '' : '（不可用）'}`, disabled: !compatible(m) })),
        ]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">检查间隔</span>
        <Select value={cadence == null ? '' : String(cadence)} onValueChange={nextValue => (value => { setCadence(Number(value)); setConfirm(false) })(nextValue === '__jit_empty__' ? '' : nextValue)} disabled={busy}><SelectTrigger aria-label="PR 检查间隔"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([...new Set([...INTERVALS, cadence])].sort((a, b) => a - b).map(value => ({ value, label: `${value / 60} 分钟` }))).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    {modelId && !validModel ? <p className="text-xs text-rose" role="alert">原选模型已不可用，未自动替换。请明确选择 ready、启用且兼容的模型。</p> : null}
    {!validInterval ? <p className="text-xs text-rose" role="alert">原检查间隔不在可选范围内，请重新选择。</p> : null}
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-sm border border-border-soft p-2.5">
      <div className="grid gap-0.5">
        <p className="text-sm font-medium text-foreground-2">启用范围</p>
        <p className="text-xs leading-body text-foreground-3">{scope?.checkedAt ? `第 ${scope.page} 页开放 PR ${scope.pullRequests.length} 项，其中非草稿 ${eligible} 项；检查于 ${displayTime(scope.checkedAt)}${scope.hasMore ? '。还有后续页，以上不是完整数量。' : '。'}` : '尚未获取开放 PR 范围。'}</p>
      </div>
      <Button size="sm" disabled={busy} onClick={() => void loadScope()} variant="outline" type="button">更新范围</Button>
    </div>
    {scope?.errorCode ? <p className="text-xs text-rose" role="alert">开放范围检查失败：{scope.errorCode}，请重试后再启用。</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button variant='default' disabled={busy || !validModel || !validInterval || !scope?.checkedAt || Boolean(scope.errorCode)} onClick={() => setConfirm(true)} type="button">{tracking.enabled ? '保存修改' : '启用自动分析'}</Button>
      {tracking.enabled ? <Button disabled={busy} onClick={() => void action(() => updateTracking(repositoryId, { enabled: false }))} variant="outline" type="button">暂停自动分析</Button> : null}
    </div>
    <p className="text-xs text-foreground-3">只分析开放且非草稿 PR；暂停不会取消已提交的任务。</p>
    {confirm ? <AlertDialog open onOpenChange={open => { if (!open) setConfirm(false); }}><AlertDialogContent aria-label="确认项目 PR 自动分析" aria-describedby={undefined}>
      <strong className="text-sm font-semibold text-foreground">{tracking.enabled ? '确认保存自动分析设置？' : '确认使用固定模型分析开放 PR？'}</strong>
      <p className="text-xs leading-body text-foreground-2">模型 {modelId}，每 {cadence / 60} 分钟检查一次；{tracking.enabled ? '之后新增的版本会按新设置处理' : `首次会处理当前开放非草稿 PR ${eligible} 项${scope?.hasMore ? '（清单尚未取完）' : ''}`}。不会上传个人笔记、问题或阅读进度。</p>
      <div className="flex flex-wrap gap-2">
        <Button variant='default' disabled={busy} onClick={() => void action(() => updateTracking(repositoryId, { enabled: true, modelId, intervalSeconds: cadence, confirmExisting: true }))} type="button">{busy ? '正在保存…' : tracking.enabled ? '确认保存设置' : '确认启用并处理现有开放 PR'}</Button>
        <Button disabled={busy} onClick={() => setConfirm(false)} variant="outline" type="button">取消设置</Button>
      </div>
    </AlertDialogContent></AlertDialog> : null}
  </div>
}
