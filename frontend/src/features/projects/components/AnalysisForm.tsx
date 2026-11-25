import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FailureNotice } from '@/components/shared/Feedback'
import { ModelCardDialog } from '@/features/models/components/ModelCardDialog'
import { ModelSelect, usableModel } from '@/features/models/components/ModelSelect'
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
      choice: typeof draft?.choice === 'string' && draft.choice && !['auto', 'train', 'default'].includes(draft.choice)
        ? draft.choice : undefined,
    }
  } catch {
    return {}
  }
}

export function AnalysisForm({ repositoryUrl, defaultBranch, onStarted, onCancel, initial }: AnalysisFormProps) {
  const draftKey = `jit:analysis-draft:${repositoryUrl}`
  const [saved] = useState(() => initial ? {
    branch: initial.branch, choice: initial.modelId ?? undefined,
  } : readDraft(draftKey))
  const [branch, setBranch] = useState(saved.branch ?? '')
  const [choice, setChoice] = useState(saved.choice ?? '')
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

  const selected = models?.find(model => model.modelId === choice)
  const savedSelection = Boolean(saved.choice)
  const blocked = Boolean(modelError) || !usableModel(selected)

  // 没有原选模型时自动落到默认模型，再退到第一个可选模型；原选模型不可用时不静默替换。
  useEffect(() => {
    if (!models || choice) return
    const preferred = models.find(model => model.isDefault && usableModel(model)) ?? models.find(usableModel)
    if (preferred) setChoice(preferred.modelId)
  }, [models, choice])

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

  const noneUsable = models !== null && !models.some(usableModel)
  return <>
    <form className="grid gap-4" onSubmit={submit}>
      <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2" aria-label="分析选项" disabled={busy}>
        <label className="grid content-start gap-1.5">
          <span className="text-xs font-medium text-foreground-2">分支</span>
          <Input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/>
        </label>
        <div className="grid min-w-0 content-start gap-1.5">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-xs font-medium text-foreground-2">模型</span>
            <ModelSelect models={models ?? []} value={choice} onValueChange={setChoice} label="模型来源"
              disabled={busy || models === null}
              placeholder={models === null ? '正在读取模型' : noneUsable ? '没有可用模型' : '选择模型'}
              missingLabel={models === null ? '正在核对原选模型…' : '原选模型（已停用或不可用）'}/>
          </div>
          {selected ? <Button type="button" size="sm" className="justify-self-start" onClick={() => setModelCardOpen(true)} variant="ghost">查看模型卡</Button> : null}
        </div>
        {modelError ? <p className="text-xs text-rose sm:col-span-2" role="alert">模型列表暂时不可用。<Button variant="link" size="sm" onClick={() => { setModelError(''); setModels(null); setRevision(value => value + 1) }} type="button">重新读取</Button></p>
          : noneUsable ? <p className="text-xs text-rose sm:col-span-2" role="alert">没有可用的模型。可在「我的训练」完成训练并登记模型，或请管理员开放模型。</p>
          : models && savedSelection && !usableModel(selected) ? <p className="text-xs text-rose sm:col-span-2" role="alert">原选模型已停用、未开放或不可用，请重新选择。</p>
          : models && !choice ? <p className="text-xs text-foreground-3 sm:col-span-2">请选择一个模型。</p>
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
