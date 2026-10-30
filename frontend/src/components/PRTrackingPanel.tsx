import { useEffect, useRef, useState } from 'react'
import { Button, Select } from '../ui/controls'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { checkTracking, getTracking, projectPRs, updateTracking, type PRTracking, type ProjectPRPage } from '../projectActivityClient'
import { repositoryModels, type ModelChoice } from '../modelClient'

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
  if (!tracking.supported) return <p className="pr-track-unsupported">此项目不是公开 GitHub 来源，无法启用 PR 自动分析；分支分析和风险趋势不受影响。</p>
  const tone = tracking.status === 'error' ? 'alert' : tracking.status === 'checking' ? 'active' : tracking.enabled ? undefined : 'muted'
  return <div className="pr-track">
    <div className="update-status" data-tone={tone}>
      <span className="update-dot" aria-hidden="true"/>
      <p className="update-status-title" role="status">{tracking.enabled ? '自动分析已开启' : '自动分析未开启'}</p>
      <span className="update-status-time">{tracking.enabled ? (tracking.nextCheckAt ? `下次 ${displayTime(tracking.nextCheckAt)}` : watchLabel[tracking.status] ?? tracking.status) : '开启后由后台定期检查'}</span>
      {tracking.enabled ? <Button size="sm" disabled={busy} onClick={() => void action(() => checkTracking(repositoryId))}>立即检查</Button> : null}
    </div>
    <p className="pr-track-desc">后台定期发现开放 PR，把固定的 base/head 快照交给指定模型分析；结果写入站内提醒，不改变项目当前分支结果。</p>
    {tracking.lastCheckedAt ? <p className="pr-track-last">最近检查 {displayTime(tracking.lastCheckedAt)}{tracking.errorCode ? ` · 失败原因 ${tracking.errorCode}` : ''}</p> : null}
    {error && tracking ? <FailureNotice error={error} onRetry={() => setAttempt(value => value + 1)}/> : null}
    <div className="pr-track-fields">
      <div className="pr-track-field">
        <span className="pr-track-label">固定分析模型</span>
        <Select ariaLabel="固定自动分析模型" value={modelId} disabled={busy} onChange={value => { setModelId(value); setConfirm(false) }} placeholder="选择真实兼容模型" options={[
          ...(modelId && !models.some(m => m.modelId === modelId) ? [{ value: modelId, label: `原选模型 ${modelId}（不可用）`, disabled: true }] : []),
          ...models.map(m => ({ value: m.modelId, label: `${m.name} · ${m.modelId}${compatible(m) ? '' : '（不可用）'}`, disabled: !compatible(m) })),
        ]}/>
      </div>
      <div className="pr-track-field">
        <span className="pr-track-label">检查间隔</span>
        <Select ariaLabel="PR 检查间隔" value={cadence} disabled={busy} onChange={value => { setCadence(Number(value)); setConfirm(false) }} options={[...new Set([...INTERVALS, cadence])].sort((a, b) => a - b).map(value => ({ value, label: `${value / 60} 分钟` }))}/>
      </div>
    </div>
    {modelId && !validModel ? <p className="field-error" role="alert">原选模型已不可用，未自动替换。请明确选择 ready、启用且兼容的模型。</p> : null}
    {!validInterval ? <p className="field-error" role="alert">原检查间隔不在可选范围内，请重新选择。</p> : null}
    <div className="pr-track-scope">
      <div>
        <p className="pr-track-scope-title">启用范围</p>
        <p className="pr-track-scope-text">{scope?.checkedAt ? `第 ${scope.page} 页开放 PR ${scope.pullRequests.length} 项，其中非草稿 ${eligible} 项；检查于 ${displayTime(scope.checkedAt)}${scope.hasMore ? '。还有后续页，以上不是完整数量。' : '。'}` : '尚未获取开放 PR 范围。'}</p>
      </div>
      <Button size="sm" disabled={busy} onClick={() => void loadScope()}>更新范围</Button>
    </div>
    {scope?.errorCode ? <p className="field-error" role="alert">开放范围检查失败：{scope.errorCode}，请重试后再启用。</p> : null}
    <div className="pr-track-actions">
      <Button variant="primary" disabled={busy || !validModel || !validInterval || !scope?.checkedAt || Boolean(scope.errorCode)} onClick={() => setConfirm(true)}>{tracking.enabled ? '保存修改' : '启用自动分析'}</Button>
      {tracking.enabled ? <Button disabled={busy} onClick={() => void action(() => updateTracking(repositoryId, { enabled: false }))}>暂停自动分析</Button> : null}
    </div>
    <p className="pr-track-note">只分析开放且非草稿 PR，不回填历史；草稿转为可审查后才纳入。暂停不会取消已提交的任务，服务停止期间不承诺检查。</p>
    {confirm ? <div className="pr-track-confirm" role="alertdialog" aria-label="确认项目 PR 自动分析">
      <strong>{tracking.enabled ? '确认保存自动分析设置？' : '确认使用固定模型分析开放 PR？'}</strong>
      <p>模型 {modelId}，每 {cadence / 60} 分钟检查一次；{tracking.enabled ? '之后新增的版本会按新设置处理' : `首次会处理当前开放非草稿 PR ${eligible} 项${scope?.hasMore ? '（清单尚未取完）' : ''}`}。不会上传个人笔记、问题或阅读进度。</p>
      <div className="pr-track-confirm-actions">
        <Button variant="primary" disabled={busy} onClick={() => void action(() => updateTracking(repositoryId, { enabled: true, modelId, intervalSeconds: cadence, confirmExisting: true }))}>{busy ? '正在保存…' : tracking.enabled ? '确认保存设置' : '确认启用并处理现有开放 PR'}</Button>
        <Button disabled={busy} onClick={() => setConfirm(false)}>取消设置</Button>
      </div>
    </div> : null}
  </div>
}
