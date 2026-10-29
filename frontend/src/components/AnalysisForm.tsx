/**
 * 发起一次指定范围的分析，与持续仓库更新共用分析记录与固定来源。
 *
 * 只负责表单与请求，成功后把作业交回给页面；记录列表与「当前结果」由页面刷新，
 * 这样同一个表单既能用于首次分析，也能用于换了设置再分析一次。
 *
 * 表单本身不带展开与收起，由调用方放进对话框里呈现——分析选项字段多，
 * 放在窄栏里展开会把页面拉得很长。
 */
import { ArrowRight } from 'lucide-react'
import { Button, Input } from '../ui/controls'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRepositorySync, type SyncForm } from '../apiClient'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { projectsChanged } from '../projectEvents'
import { FailureNotice } from '../Feedback'
import type { SyncStrategy, SyncView } from '../repositoryContract'

/** 模型来源把「用哪个现成模型」和「要不要训练」合成一个决定；其余值都是具体模型 ID。 */
const SOURCES = ['auto', 'default', 'train'] as const
type ModelSource = (typeof SOURCES)[number]
type Draft = Partial<SyncForm> & { choice?: string }

function choiceOf(form: { strategy?: SyncStrategy; modelId?: string }): string {
  if (form.modelId) return form.modelId
  if (form.strategy === 'force-train') return 'train'
  if (form.strategy === 'generic-model') return 'default'
  return 'auto'
}

function isSource(choice: string): choice is ModelSource {
  return (SOURCES as readonly string[]).includes(choice)
}

export interface AnalysisFormProps {
  repositoryUrl: string
  /** 系统已知的分支，用作输入框占位。 */
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
  /** 提供后表单底部出现「取消」，用于关闭承载它的对话框。 */
  onCancel?: () => void
  initial?: Partial<SyncForm>
}

export function AnalysisForm({ repositoryUrl, defaultBranch, onStarted, onCancel, initial }: AnalysisFormProps) {
  const draftKey = `jit:analysis-draft:${repositoryUrl}`
  const [saved] = useState<Draft>(() => { if (initial) return initial; try { return JSON.parse(sessionStorage.getItem(draftKey) ?? '{}') } catch { return {} } })
  const [branch, setBranch] = useState(saved.branch ?? '')
  const [since, setSince] = useState(saved.since ?? '')
  const [until, setUntil] = useState(saved.until ?? '')
  const [commitLimit, setCommitLimit] = useState(saved.commitLimit ?? '500')
  const [choice, setChoice] = useState(() => saved.choice ?? choiceOf(saved))
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(saved.until))
  const [models, setModels] = useState<ModelChoice[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelRevision, setModelRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(items => { if (!controller.signal.aborted) { setModels(items); setModelsLoaded(true); setModelError('') } }).catch(failure => { if (!controller.signal.aborted) setModelError(failure instanceof Error ? failure.message : '模型读取失败') })
    return () => controller.abort()
  }, [modelRevision])
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify({ branch, since, until, commitLimit, choice })) } catch { /* The form remains usable without storage. */ } }, [draftKey, branch, since, until, commitLimit, choice])

  const explicitModel = !isSource(choice)
  const selected = explicitModel ? models.find(model => model.modelId === choice) : undefined
  const defaultModel = models.find(model => model.isDefault)
  const defaultUsable = Boolean(defaultModel?.repositoryPredictionSupported)
  const checkingModel = explicitModel && !modelsLoaded && !modelError
  const defaultUnavailable = choice === 'default' && modelsLoaded && !modelError && !defaultUsable
  const selectionUnavailable = defaultUnavailable || (explicitModel && (!modelsLoaded || !!modelError || !selected?.repositoryPredictionSupported))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current || selectionUnavailable) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const strategy: SyncStrategy = choice === 'train' ? 'force-train' : choice === 'auto' ? 'auto' : 'generic-model'
      const job = await createRepositorySync({
        repositoryUrl,
        branch,
        since,
        until,
        commitLimit,
        strategy,
        ...(explicitModel ? { modelId: choice } : {}),
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

  return <form className="analysis-form" onSubmit={submit}>
    <fieldset className="analysis-options" aria-label="分析选项">
      <div className="form-grid">
        <label>分支<Input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/></label>
        <label>提交上限<Input aria-label="提交上限" type="number" min="1" max="5000" value={commitLimit} onChange={event => setCommitLimit(event.target.value)}/></label>
        <label>起始日期<Input aria-label="起始日期" type="date" value={since} onChange={event => setSince(event.target.value)}/></label>
        <p className="form-hint wide-field">起始日期留空时按最近 90 天采集；结束日期在「高级选项」里，留空表示今天。范围越窄，可训练样本越少，自动策略更容易降级用默认模型。</p>
        <details className="advanced-options wide-field" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
          <summary>高级选项<span>{until ? `结束日期：${until}` : '结束日期默认今天'}</span></summary>
          <label>结束日期<Input aria-label="结束日期" type="date" value={until} onChange={event => setUntil(event.target.value)}/></label>
        </details>
        <label className="wide-field">模型来源<select aria-label="模型来源" value={choice} onChange={event => setChoice(event.target.value)}>
          <option value="auto">自动（数据足够就训练，不足用默认模型）</option>
          <option value="default" disabled={modelsLoaded && !modelError && !defaultUsable}>使用默认模型{defaultModel ? `：${defaultModel.name}` : ''}</option>
          <option value="train">强制训练新模型</option>
          {explicitModel && !modelsLoaded && !modelError ? <option value={choice} disabled>正在核对原选模型…</option> : null}
          {explicitModel && modelsLoaded && !selected ? <option value={choice} disabled>原选模型（已不存在）</option> : null}
          {models.length ? <optgroup label="指定已有模型">{models.map(model => <option key={model.modelId} value={model.modelId} disabled={!model.repositoryPredictionSupported}>{model.name}{!model.enabled ? '（已停用）' : !model.repositoryPredictionSupported ? '（当前不可用于仓库分析）' : model.isDefault ? '（默认）' : ''}</option>)}</optgroup> : null}
        </select></label>
        <p className="form-hint wide-field">{modelError ? '默认模型设置暂时无法读取，请重试。' : !modelsLoaded ? '正在读取模型设置…' : defaultModel ? `管理员默认模型：${defaultModel.name}${!defaultModel.repositoryPredictionSupported ? '（当前不可用，请改选其他模型或联系管理员）' : ''}。` : '尚未设置默认模型，请管理员登记兼容模型。'}</p>
        {defaultUnavailable ? <p role="alert" className="field-error wide-field">{defaultModel ? '管理员默认模型当前不可用，请改选「自动」或指定已有模型，或联系管理员。' : '尚未设置默认模型，请改选「自动」或指定已有模型；或请管理员登记兼容模型。'}</p> : explicitModel && selectionUnavailable && !checkingModel ? <p role="alert" className="field-error wide-field">原选模型已停用或不可用，请改选自动、默认模型或其他现有模型；不会自动替换。</p> : null}
        {modelError ? <p className="field-error wide-field" role="alert">模型列表暂时不可用。<Button variant="link" size="sm" onClick={() => setModelRevision(value => value + 1)}>重新读取模型</Button></p> : <p className="form-hint wide-field">{!modelsLoaded ? '正在读取模型列表…' : models.length ? `${models.filter(model => model.repositoryPredictionSupported).length} 个模型可用于仓库分析。` : '尚无已登记模型，可按策略训练；现成模型需要管理员先校验登记。'}<Button variant="link" size="sm" onClick={() => setModelRevision(value => value + 1)}>刷新模型</Button></p>}
      </div>
    </fieldset>
    {error ? <div className="analysis-form-error"><FailureNotice error={error}/></div> : null}
    <div className="form-submit">
      <div className="form-submit-actions">
        {onCancel ? <Button onClick={onCancel} disabled={busy}>取消</Button> : null}
        <Button type="submit" variant="primary" aria-label="开始分析" loading={busy} disabled={selectionUnavailable}>{busy ? '正在发起…' : '开始分析'}<ArrowRight size={14}/></Button>
      </div>
    </div>
  </form>
}
