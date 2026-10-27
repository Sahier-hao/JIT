/**
 * 发起一次指定范围的分析，与持续仓库更新共用分析记录与固定来源。
 *
 * 只负责表单与请求，成功后把作业交回给页面；记录列表与「当前结果」由页面刷新，
 * 这样同一个表单既能用于首次分析，也能用于换了设置再分析一次。
 *
 * 分析选项默认收起，收起时用参数摘要说明这次会用哪些设置。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRepositorySync, type SyncForm } from '../apiClient'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { projectsChanged } from '../projectEvents'
import { FailureNotice } from '../Feedback'
import { Icon } from '../Icon'
import { STRATEGY_LABELS, type SyncStrategy, type SyncView } from '../repositoryContract'

const STRATEGIES: SyncStrategy[] = ['auto', 'generic-model', 'force-train']

export interface AnalysisFormProps {
  repositoryUrl: string
  /** 系统已知的分支，用作输入框占位。 */
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
  initial?: Partial<SyncForm>
}

export function AnalysisForm({ repositoryUrl, defaultBranch, onStarted, initial }: AnalysisFormProps) {
  const draftKey = `jit:analysis-draft:${repositoryUrl}`
  const [saved] = useState<Partial<SyncForm>>(() => { if (initial) return initial; try { return JSON.parse(sessionStorage.getItem(draftKey) ?? '{}') } catch { return {} } })
  const [branch, setBranch] = useState(saved.branch ?? '')
  const [since, setSince] = useState(saved.since ?? '')
  const [until, setUntil] = useState(saved.until ?? '')
  const [commitLimit, setCommitLimit] = useState(saved.commitLimit ?? '500')
  const [strategy, setStrategy] = useState<SyncStrategy>(saved.strategy ?? 'auto')
  const [modelId, setModelId] = useState(saved.modelId ?? '')
  const [models, setModels] = useState<ModelChoice[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelRevision, setModelRevision] = useState(0)
  const [open, setOpen] = useState(Boolean(initial))
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(items => { if (!controller.signal.aborted) { setModels(items); setModelsLoaded(true); setModelError('') } }).catch(failure => { if (!controller.signal.aborted) setModelError(failure instanceof Error ? failure.message : '模型读取失败') })
    return () => controller.abort()
  }, [modelRevision])
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify({ branch, since, until, commitLimit, strategy, modelId })) } catch { /* The form remains usable without storage. */ } }, [draftKey, branch, since, until, commitLimit, strategy, modelId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current || selectionUnavailable) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const job = await createRepositorySync({
        repositoryUrl,
        branch,
        since,
        until,
        commitLimit,
        strategy: modelId ? 'generic-model' : strategy,
        ...(modelId ? { modelId } : {}),
      })
      projectsChanged()
      onStarted(job)
    } catch (failure) {
      setError(failure)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  const selected = models.find(model => model.modelId === modelId)
  const defaultModel = models.find(model => model.isDefault)
  const selectionUnavailable = !!modelId && (!modelsLoaded || !!modelError || !selected?.repositoryPredictionSupported)
  const summary = [
    branch ? `分支 ${branch}` : defaultBranch ? `分支默认 ${defaultBranch}` : '默认分支',
    since || until ? `${since || '不限'} 至 ${until || '不限'}` : '最近 90 天',
    `最多 ${commitLimit || '500'} 条`,
    modelId ? models.find(model => model.modelId === modelId)?.name ?? '指定模型' : STRATEGY_LABELS[strategy],
  ]

  return <form className="analysis-form" onSubmit={submit}>
    <div className="analysis-card" data-open={open}>
      <button
        type="button"
        className="analysis-disclosure-toggle"
        aria-expanded={open}
        aria-controls="analysis-fields"
        onClick={() => setOpen(value => !value)}
      >
        <span className="analysis-disclosure-title"><Icon name="sliders"/>分析选项</span>
        <span className="analysis-disclosure-chips">{summary.map(item => <span key={item}>{item}</span>)}</span>
        <span className="analysis-disclosure-chevron" aria-hidden><Icon name="chevron"/></span>
      </button>
      <div className="analysis-disclosure-body" id="analysis-fields" hidden={!open}>
        <fieldset className="analysis-options" aria-label="分析选项">
          <p className="analysis-options-hint">不填就按默认：默认分支、最近 90 天、最多 500 个提交、自动选择模型策略。</p>
          <div className="form-grid">
            <label>分支<input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/></label>
            <label>提交上限<input aria-label="提交上限" type="number" min="1" max="5000" value={commitLimit} onChange={event => setCommitLimit(event.target.value)}/></label>
            <label>起始日期<input aria-label="起始日期" type="date" value={since} onChange={event => setSince(event.target.value)}/></label>
            <label>结束日期<input aria-label="结束日期" type="date" value={until} onChange={event => setUntil(event.target.value)}/></label>
            <label className="wide-field">分析模型<select aria-label="分析模型" value={modelId} onChange={event => { setModelId(event.target.value); if (event.target.value) setStrategy('generic-model') }}><option value="">按策略使用默认模型</option>{modelId && modelsLoaded && !selected ? <option value={modelId} disabled>原选模型（已不存在）</option> : null}{models.map(model => <option key={model.modelId} value={model.modelId} disabled={!model.repositoryPredictionSupported}>{model.name}{!model.enabled ? '（已停用）' : !model.repositoryPredictionSupported ? '（当前不可用于仓库分析）' : model.isDefault ? '（默认）' : ''}</option>)}</select></label>
            <p className="form-hint wide-field">{modelError ? '默认模型设置暂时无法读取，请重试。' : !modelsLoaded ? '正在读取模型设置…' : defaultModel ? `管理员默认模型：${defaultModel.name}${!defaultModel.repositoryPredictionSupported ? '（当前不可用，请明确选择其他模型或联系管理员）' : ''}。` : '尚未设置默认模型，请管理员登记兼容模型。'}明确选择优先；自动策略数据不足时使用提交任务时的默认模型。</p>
            {modelId && !modelsLoaded && !modelError ? <p role="status" className="form-hint wide-field">正在核对原选模型…</p> : selectionUnavailable ? <p role="alert" className="field-error wide-field">原选模型已停用或不可用，请刷新后重新选择。不会自动替换。</p> : null}
            {modelError ? <p className="field-error" role="alert">模型列表暂时不可用。<button type="button" className="text-button" onClick={() => setModelRevision(value => value + 1)}>重新读取模型</button></p> : <p className="form-hint">{!modelsLoaded ? '正在读取模型列表…' : models.length ? `${models.filter(model => model.repositoryPredictionSupported).length} 个模型可用于仓库分析。` : '尚无已登记模型，可按策略训练；现成模型需要管理员先校验登记。'}<button type="button" className="text-button" onClick={() => setModelRevision(value => value + 1)}>刷新模型</button></p>}
            {!modelId ? <label className="wide-field">模型策略<select aria-label="模型策略" value={strategy} onChange={event => setStrategy(event.target.value as SyncStrategy)}>{STRATEGIES.map(value => <option key={value} value={value}>{STRATEGY_LABELS[value]}</option>)}</select></label> : null}
          </div>
        </fieldset>
      </div>
      {error ? <div className="analysis-form-error"><FailureNotice error={error}/></div> : null}
      <div className="form-submit">
        <p>{since || until ? '按所选日期范围分析' : '默认分析最近 90 天'}，最多 {commitLimit || '500'} 个提交。发起后会新增一条记录，当前结果不会被覆盖。</p>
        <button className="primary-button" type="submit" disabled={busy || selectionUnavailable}>{busy ? '正在发起…' : '开始分析'}<Icon name="arrow"/></button>
      </div>
    </div>
  </form>
}
