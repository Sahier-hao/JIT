import { Button, Checkbox, Input, InputNumber, Select } from 'antd'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { updateRepository, type UpdateState } from '../repositoryUpdatesClient'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { displayTime } from '../domain'
import { FailureNotice } from '../Feedback'

const LABELS: Record<UpdateState['status'], string> = { idle: '尚未检查仓库', checking: '正在检查远端提交…', analyzing: '发现更新，正在准备新的分析结果…', updated: '新的分析结果已就绪', 'up-to-date': '没有新提交', error: '仓库更新未完成' }
const ERRORS: Record<string, string> = {
  MODEL_DISABLED: '更新模型已停用，请在更新设置中选择可用模型。已有结果仍可查看。',
  DEFAULT_MODEL_REQUIRED: '还没有可用的默认模型，请在更新设置中选择模型，或联系管理员设置。',
  REPOSITORY_UNAVAILABLE: '无法读取仓库，请检查地址、分支或网络后重试。',
  REPOSITORY_CHECK_TIMEOUT: '检查远端仓库超时，请重试。',
  CONFLICT_ACTIVE_SYNC: '项目已有进行中的分析，结束后可重试更新。',
  SYNC_CANCELLED: '这次更新分析已取消，可以重新更新。',
  SYNC_INTERRUPTED: '服务停止时更新未完成，请重试。',
  SYNC_TIMEOUT: '更新分析超过时限，可以在发起分析中缩小范围。',
  DATASET_INVALID: '最近 90 天内没有可分析的提交，或采集数据不可用；可在发起分析中调整日期范围。',
}

export function RepositoryUpdates({ repositoryId, onUpdated }: { repositoryId: string; onUpdated: () => void }) {
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const callback = useRef(onUpdated)
  const [models, setModels] = useState<ModelChoice[]>([])
  const [modelError, setModelError] = useState('')
  const [modelAttempt, setModelAttempt] = useState(0)
  const [branch, setBranch] = useState<string | null>(null)
  const [modelId, setModelId] = useState<string | null>(null)
  const [interval, setIntervalValue] = useState<number | null>(null)
  const [windowDays, setWindowDays] = useState<number | null>(null)
  const [commitLimit, setCommitLimit] = useState<number | null>(null)
  const lastSignature = useRef('')
  useEffect(() => { callback.current = onUpdated }, [onUpdated])
  function accept(value: UpdateState) {
    setState(value)
    const signature = `${value.status}:${value.syncId ?? ''}`
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
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(value => { if (!controller.signal.aborted) { setModels(value); setModelError('') } })
      .catch(() => { if (!controller.signal.aborted) setModelError('模型选项读取失败，重新读取状态可重试。') })
    return () => controller.abort()
  }, [repositoryId, modelAttempt])
  const running = state?.status === 'checking' || state?.status === 'analyzing'
  useEffect(() => {
    if (!running && !state?.enabled) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setAttempt(value => value + 1) }, running ? 1500 : 15000)
    return () => clearInterval(timer)
  }, [running, state?.enabled])

  async function act(action: 'refresh' | 'configure', body?: { enabled?: boolean; branch?: string; modelId?: string; intervalSeconds?: number; windowDays?: number; commitLimit?: number }, check = false) {
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
    void act('configure', { branch: branch ?? state?.branch ?? 'HEAD', intervalSeconds: interval ?? state?.intervalSeconds ?? 300,
      windowDays: windowDays ?? state?.windowDays ?? 90, commitLimit: commitLimit ?? state?.commitLimit ?? 500,
      ...((modelId ?? state?.modelId) ? { modelId: (modelId ?? state?.modelId)! } : {}) }, true)
  }
  const selectedModel = modelId ?? state?.modelId ?? ''
  return <section className="repository-updates" aria-label="仓库更新">
    <div className="update-heading"><div><h2>仓库更新</h2></div>
      {state ? <Button type="primary" disabled={busy || running} onClick={() => void act('refresh')}>{running ? '更新进行中…' : state.status === 'error' ? '重试更新' : '立即更新'}</Button> : null}
    </div>
    {error ? <FailureNotice error={error}/> : null}
    {!state || error ? <Button type="text" disabled={busy} onClick={() => { setAttempt(value => value + 1); setModelAttempt(value => value + 1) }}>重新读取更新状态</Button> : null}
    {state ? <>
      <p role="status" className={`update-status ${state.status === 'error' ? 'is-error' : ''}`}>{LABELS[state.status]}</p>
      {state.status === 'error' ? <p className="field-error">{ERRORS[state.errorCode ?? ''] ?? `更新未完成（${state.errorCode ?? '未知原因'}），请重试；已有分析记录仍可查看。`}</p> : null}
      <dl className="update-facts">
        <div><dt>跟踪分支</dt><dd>{state.branch === 'HEAD' ? `默认分支${state.resolvedBranch ? ` · ${state.resolvedBranch}` : ''}` : state.branch}</dd></div>
        <div><dt>上次成功检查</dt><dd>{state.lastCheckedAt ? displayTime(state.lastCheckedAt) : '尚无成功检查'}</dd></div>
        <div><dt>下次检查</dt><dd>{state.enabled ? state.nextCheckAt ? displayTime(state.nextCheckAt) : '等待调度' : '自动检查已关闭'}</dd></div>
        {state.remoteHead ? <div><dt>远端版本</dt><dd title={state.remoteHead}>{state.remoteHead.slice(0, 12)}</dd></div> : null}
      </dl>
      <Checkbox aria-label="自动检查仓库更新" className="update-toggle" checked={state.enabled} disabled={busy} onChange={event => void act('configure', { enabled: event.target.checked })}>
        自动检查仓库更新<small>服务运行期间每 {state.intervalSeconds / 60} 分钟检查；关闭页面后仍会继续。</small>
      </Checkbox>
      <p className="form-hint">发现新提交后，用固定模型分析最近 {state.windowDays} 天，提交上限 {state.commitLimit} 条。超限时需调整窗口或上限；每次生成独立结果，原分析和审查计划保留。</p>
      <details className="update-settings"><summary><span>更新设置</span></summary><form onSubmit={save}>
        <div className="update-field">
          <span className="pr-field-label">跟踪分支</span>
          <Input aria-label="更新跟踪分支" value={branch ?? state.branch} onChange={event => setBranch(event.target.value)} disabled={busy || running}/>
          <small>HEAD 跟随远端默认分支；也可填写 main 等分支名。</small>
        </div>
        <div className="update-field">
          <span className="pr-field-label">更新模型</span>
          <Select aria-label="更新模型" value={selectedModel} onChange={setModelId} disabled={busy || running} options={[
            { value: '', label: '首次检查使用管理员默认模型', disabled: true },
            ...(selectedModel && !models.some(model => model.modelId === selectedModel) ? [{ value: selectedModel, label: '已保存模型（当前不可用）', disabled: true }] : []),
            ...models.map(model => ({ value: model.modelId, label: model.repositoryPredictionSupported ? model.name : `${model.name}（不可用）`, disabled: !model.repositoryPredictionSupported })),
          ]}/>
          <small>首次检查后固定模型；切换模型会重新生成分析。</small>
        </div>
        <div className="update-field">
          <span className="pr-field-label">检查频率</span>
          <Select aria-label="仓库检查频率" value={interval ?? state.intervalSeconds} onChange={value => setIntervalValue(Number(value))} disabled={busy || running} options={[...new Set([300, 900, 3600, state.intervalSeconds])].sort((a, b) => a - b).map(value => ({ value, label: `每 ${value / 60} 分钟` }))}/>
        </div>
        {modelError ? <p className="field-error">{modelError}<Button type="text" size="small" onClick={() => setModelAttempt(value => value + 1)}>重试模型选项</Button></p> : null}
        <div className="update-field-row">
          <div className="update-field">
            <span className="pr-field-label">时间窗口（天）</span>
            <InputNumber min={1} max={3650} aria-label="更新时间窗口" value={windowDays ?? state.windowDays} onChange={value => setWindowDays(Number(value))} disabled={busy || running}/>
          </div>
          <div className="update-field">
            <span className="pr-field-label">提交上限</span>
            <InputNumber min={1} max={5000} aria-label="更新提交上限" value={commitLimit ?? state.commitLimit} onChange={value => setCommitLimit(Number(value))} disabled={busy || running}/>
          </div>
        </div>
        <div><Button htmlType="submit" disabled={busy || running}>保存并检查</Button></div>
      </form></details>
    </> : null}
  </section>
}