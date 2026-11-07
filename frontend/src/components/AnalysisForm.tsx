/**
 * 发起一次分析：只保留分支与模型来源，其余参数由服务端取默认值。
 *
 * 只负责表单与请求，成功后把作业交回给页面；记录列表与「当前结果」由页面刷新。
 * 表单本身不带展开与收起，由调用方放进对话框里呈现。
 */
import { ArrowRight } from 'lucide-react'
import { Button, Input } from '../ui/controls'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRepositorySync, type SyncForm } from '../apiClient'
import { repositoryModels, trainingMethods, type MethodChoice, type ModelChoice } from '../modelClient'
import { projectsChanged } from '../projectEvents'
import { FailureNotice } from '../Feedback'
import type { SyncStrategy, SyncView } from '../repositoryContract'
import { ModelCardDialog } from './ModelCardDialog'

/** 模型来源把「用哪个现成模型」和「要不要训练」合成一个决定；其余值都是具体模型 ID。 */
const SOURCES = ['auto', 'default', 'train'] as const
type ModelSource = (typeof SOURCES)[number]
type Draft = { branch?: string; choice?: string; algorithm?: string }

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
  const [saved] = useState<Draft>(() => {
    if (initial) return { branch: initial.branch, choice: choiceOf(initial), algorithm: initial.algorithm }
    try { return JSON.parse(sessionStorage.getItem(draftKey) ?? '{}') } catch { return {} }
  })
  const [branch, setBranch] = useState(saved.branch ?? '')
  const [choice, setChoice] = useState(saved.choice ?? 'auto')
  const [algorithm, setAlgorithm] = useState(saved.algorithm ?? '')
  const [methods, setMethods] = useState<MethodChoice[]>([])
  const [methodsLoaded, setMethodsLoaded] = useState(false)
  const [methodsError, setMethodsError] = useState('')
  const [models, setModels] = useState<ModelChoice[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelRevision, setModelRevision] = useState(0)
  const [modelCardOpen, setModelCardOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(items => { if (!controller.signal.aborted) { setModels(items); setModelsLoaded(true); setModelError('') } }).catch(failure => { if (!controller.signal.aborted) setModelError(failure instanceof Error ? failure.message : '模型读取失败') })
    return () => controller.abort()
  }, [modelRevision])
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify({ branch, choice, algorithm })) } catch { /* The form remains usable without storage. */ } }, [draftKey, branch, choice, algorithm])
  useEffect(() => { setModelCardOpen(false) }, [choice])
  useEffect(() => {
    const controller = new AbortController()
    trainingMethods(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setMethods(result.methods); setMethodsLoaded(true); setMethodsError('')
      setAlgorithm(current => current || result.methods.find(item => item.available)?.method || '')
    }).catch(failure => { if (!controller.signal.aborted) setMethodsError(failure instanceof Error ? failure.message : '训练方法读取失败') })
    return () => controller.abort()
  }, [])

  const explicitModel = !isSource(choice)
  const selected = explicitModel ? models.find(model => model.modelId === choice) : undefined
  const defaultModel = models.find(model => model.isDefault)
  const defaultUsable = Boolean(defaultModel?.repositoryPredictionSupported)
  const checkingModel = explicitModel && !modelsLoaded && !modelError
  const defaultUnavailable = choice === 'default' && modelsLoaded && !modelError && !defaultUsable
  const selectionUnavailable = defaultUnavailable || (explicitModel && (!modelsLoaded || !!modelError || !selected?.repositoryPredictionSupported))
  const selectedMethod = methods.find(item => item.method === algorithm)
  const methodUnavailable = !explicitModel && methodsLoaded && !methodsError && !selectedMethod?.available
  const methodPending = !explicitModel && !methodsLoaded && !methodsError
  const blocked = selectionUnavailable || methodUnavailable || methodPending

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current || blocked) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const strategy: SyncStrategy = choice === 'train' ? 'force-train' : choice === 'auto' ? 'auto' : 'generic-model'
      const job = await createRepositorySync({
        repositoryUrl,
        branch,
        strategy,
        ...(explicitModel ? { modelId: choice } : choice === 'default' ? {} : { algorithm }),
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

  return <><form className="analysis-form" onSubmit={submit}>
    <fieldset className="analysis-options" aria-label="分析选项">
      <div className="form-grid">
        <label>分支<Input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/></label>
        <div className="model-source-field">
          <label>模型来源<select aria-label="模型来源" value={choice} onChange={event => setChoice(event.target.value)}>
            <option value="auto">自动：数据足够就训练</option>
            <option value="default" disabled={modelsLoaded && !modelError && !defaultUsable}>使用默认模型{defaultModel ? `：${defaultModel.name}` : ''}</option>
            <option value="train">训练新模型</option>
            {explicitModel && !modelsLoaded && !modelError ? <option value={choice} disabled>正在核对原选模型…</option> : null}
            {explicitModel && modelsLoaded && !selected ? <option value={choice} disabled>原选模型（已不存在）</option> : null}
            {models.length ? <optgroup label="指定已有模型">{models.map(model => <option key={model.modelId} value={model.modelId} disabled={!model.repositoryPredictionSupported}>{model.name}{!model.enabled ? '（已停用）' : !model.repositoryPredictionSupported ? '（不可用）' : model.isDefault ? '（默认）' : ''}</option>)}</optgroup> : null}
          </select></label>
          {explicitModel && selected ? <Button type="button" size="sm" onClick={() => setModelCardOpen(true)}>查看模型卡</Button> : null}
        </div>
        {!explicitModel ? <label>训练方法<select aria-label="训练方法" value={algorithm} onChange={event => setAlgorithm(event.target.value)}>
          {methods.map(item => <option key={item.method} value={item.method} disabled={!item.available}>{item.name}{item.available ? '' : `（${item.reason ?? '不可用'}）`}</option>)}
        </select></label> : null}
        {modelError ? <p className="field-error wide-field" role="alert">模型列表暂时不可用。<Button variant="link" size="sm" onClick={() => setModelRevision(value => value + 1)}>重新读取</Button></p> : null}
        {methodsError ? <p className="field-error wide-field" role="alert">训练方法列表暂时不可用：{methodsError}</p> : null}
        {methodUnavailable ? <p className="field-error wide-field" role="alert">{selectedMethod?.reason ?? '所选训练方法当前不可用，请重新选择。'}</p> : null}
        {defaultUnavailable ? <p role="alert" className="field-error wide-field">{defaultModel ? '默认模型当前不可用，请改选自动或指定已有模型。' : '尚未设置默认模型，请改选自动或指定已有模型。'}</p> : explicitModel && selectionUnavailable && !checkingModel ? <p role="alert" className="field-error wide-field">原选模型已停用或不可用，请重新选择；不会自动替换。</p> : null}
      </div>
    </fieldset>
    {error ? <div className="analysis-form-error"><FailureNotice error={error}/></div> : null}
    <div className="form-submit">
      <div className="form-submit-actions">
        {onCancel ? <Button onClick={onCancel} disabled={busy}>取消</Button> : null}
        <Button type="submit" variant="primary" aria-label="开始分析" loading={busy} disabled={blocked}>{busy ? '正在发起…' : '开始分析'}<ArrowRight size={14}/></Button>
      </div>
    </div>
  </form>
  {explicitModel && selected ? <ModelCardDialog modelId={selected.modelId} open={modelCardOpen} onOpenChange={setModelCardOpen}/> : null}
  </>
}
