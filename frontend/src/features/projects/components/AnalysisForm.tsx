import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { FailureNotice } from '@/components/shared/Feedback'
import { ModelCardDialog } from '@/features/models/components/ModelCardDialog'
import { repositoryModels, type ModelChoice } from '@/features/models/modelClient'
import { projectsChanged } from '@/features/projects/projectEvents'
import type { SyncView } from '@/features/projects/repositoryContract'
import { createRepositorySync } from '@/lib/apiClient'

export interface BranchAnalysisSeed {
  branch?: string
  modelId?: string | null
}

interface AnalysisFormProps {
  repositoryUrl: string
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
  onCancel?: () => void
  initial?: BranchAnalysisSeed
}

function readDraft(key: string): { branch?: string; choice?: string } {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    return {
      branch: typeof draft?.branch === 'string' ? draft.branch : undefined,
      choice: typeof draft?.choice === 'string' && !['auto', 'train'].includes(draft.choice) ? draft.choice : undefined,
    }
  } catch {
    return {}
  }
}

function usable(model?: ModelChoice) {
  return Boolean(model?.state === 'ready' && model.enabled && model.repositoryPredictionSupported)
}

export function AnalysisForm({ repositoryUrl, defaultBranch, onStarted, onCancel, initial }: AnalysisFormProps) {
  const draftKey = `jit:analysis-draft:${repositoryUrl}`
  const [saved] = useState(() => initial ? {
    branch: initial.branch, choice: initial.modelId === null ? '' : initial.modelId,
  } : readDraft(draftKey))
  const [branch, setBranch] = useState(saved.branch ?? '')
  const [choice, setChoice] = useState(saved.choice ?? 'default')
  const [models, setModels] = useState<ModelChoice[] | null>(null)
  const [modelError, setModelError] = useState('')
  const [revision, setRevision] = useState(0)
  const [modelCardOpen, setModelCardOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const locked = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(items => {
      if (!controller.signal.aborted) { setModels(items); setModelError('') }
    }).catch(failure => {
      if (!controller.signal.aborted) setModelError(failure instanceof Error ? failure.message : '模型读取失败')
    })
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify({ branch, choice })) } catch { /* 存储不可用时仍可提交 */ }
  }, [draftKey, branch, choice])

  const defaultModel = models?.find(model => model.isDefault)
  const selected = choice === 'default' ? defaultModel : models?.find(model => model.modelId === choice)
  const savedSelection = Boolean(choice && choice !== 'default')
  const blocked = Boolean(modelError) || !usable(selected)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current || blocked || !selected) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const job = await createRepositorySync({
        repositoryUrl, branch, strategy: 'generic-model', modelId: selected.modelId,
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

  return <>
    <form className="grid gap-4" onSubmit={submit}>
      <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2" aria-label="分析选项" disabled={busy}>
        <label className="grid content-start gap-1.5">
          <span className="text-xs font-medium text-foreground-2">分支</span>
          <Input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/>
        </label>
        <div className="grid min-w-0 content-start gap-1.5">
          <label className="grid min-w-0 gap-1.5">
            <span className="text-xs font-medium text-foreground-2">模型来源</span>
            <NativeSelect aria-label="模型来源" value={choice} onChange={event => setChoice(event.target.value)}>
              <option value="" disabled>选择已有模型</option>
              <option value="default" disabled={models !== null && !usable(defaultModel)}>使用默认模型{defaultModel ? `：${defaultModel.name}` : ''}</option>
              {savedSelection && !selected ? <option value={choice} disabled>{models ? '原选模型（已不存在）' : '正在核对原选模型…'}</option> : null}
              {models?.length ? <optgroup label="指定已有模型">{models.map(model =>
                <option key={model.modelId} value={model.modelId} disabled={!usable(model)}>
                  {model.name}{model.enabled ? usable(model) ? '' : '（不可用）' : '（已停用）'}
                </option>)}</optgroup> : null}
            </NativeSelect>
          </label>
          {selected ? <Button type="button" size="sm" className="justify-self-start" onClick={() => setModelCardOpen(true)} variant="ghost">查看模型卡</Button> : null}
        </div>
        {modelError ? <p className="text-xs text-rose sm:col-span-2" role="alert">模型列表暂时不可用。<Button variant="link" size="sm" onClick={() => { setModelError(''); setModels(null); setRevision(value => value + 1) }} type="button">重新读取</Button></p>
          : models && !models.some(usable) ? <p className="text-xs text-rose sm:col-span-2" role="alert">没有可用的兼容模型。可在「我的训练」完成训练并登记模型后再回来。</p>
          : models && savedSelection && !usable(selected) ? <p className="text-xs text-rose sm:col-span-2" role="alert">原选模型已停用或不可用，请重新选择。</p>
          : models && choice === 'default' && !usable(defaultModel) ? <p className="text-xs text-foreground-3 sm:col-span-2">默认模型不可用，请选一个已有模型。</p>
          : null}
      </fieldset>
      {error ? <FailureNotice error={error}/> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft pt-3">
        {onCancel ? <Button onClick={onCancel} disabled={busy} variant="outline" type="button">取消</Button> : null}
        <Button type="submit" aria-label="开始分析" disabled={blocked || busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : null}{busy ? '正在提交…' : '开始分析'}<ArrowRight aria-hidden="true" size={14}/>
        </Button>
      </div>
    </form>
    {selected ? <ModelCardDialog modelId={selected.modelId} open={modelCardOpen} onOpenChange={setModelCardOpen}/> : null}
  </>
}
