import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ModelSelect, usableModel } from '@/features/models/components/ModelSelect'
import { repositoryModels, type ModelChoice } from '@/features/models/modelClient'
import { analyzeAllProjectPRs, projectPROpenCount, type PRBatch, type PRBatchScope } from '@/features/projects/projectActivityClient'

type ScopeKind = 'all' | 'limit' | 'page'

export function PRBatchLauncher({ repositoryId, modelId, openPage, onStarted, variant = 'outline' }: {
  repositoryId: string
  modelId?: string
  openPage?: number
  onStarted: (batch: PRBatch) => void
  variant?: 'default' | 'outline'
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [readError, setReadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [models, setModels] = useState<ModelChoice[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [openCount, setOpenCount] = useState<number | null>(null)
  const [scopeKind, setScopeKind] = useState<ScopeKind>('all')
  const [limitText, setLimitText] = useState('50')

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setReadError('')
    const load = async () => {
      const [catalog, count] = await Promise.allSettled([
        repositoryModels(controller.signal),
        projectPROpenCount(repositoryId, controller.signal),
      ])
      if (controller.signal.aborted) return
      setOpenCount(count.status === 'fulfilled' ? count.value : null)
      if (catalog.status === 'fulfilled') {
        const usable = catalog.value.filter(usableModel)
        setModels(usable)
        const preferred = usable.find(model => model.modelId === modelId) ?? usable.find(model => model.isDefault) ?? usable[0]
        setSelectedModel(previous => previous || preferred?.modelId || '')
      } else {
        setModels([])
        setReadError(catalog.reason instanceof Error ? catalog.reason.message : '读取模型失败')
      }
      setLoading(false)
    }
    void load()
    return () => controller.abort()
  }, [open, repositoryId, modelId, attempt])

  const limit = Number(limitText)
  const limitValid = Number.isInteger(limit) && limit >= 1 && limit <= 500
  const effectiveKind = scopeKind === 'page' && openPage == null ? 'all' : scopeKind
  const scope: PRBatchScope = effectiveKind === 'limit' ? { kind: 'limit', limit }
    : effectiveKind === 'page' && openPage != null ? { kind: 'page', page: openPage }
    : { kind: 'all' }
  const valid = scope.kind !== 'limit' || limitValid
  const modelAvailable = models.some(model => model.modelId === selectedModel)

  async function submit() {
    if (loading || submitting || !modelAvailable || !valid) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const batch = await analyzeAllProjectPRs(repositoryId, selectedModel, scope)
      setOpen(false)
      onStarted(batch)
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : '提交批量分析失败')
    } finally {
      setSubmitting(false)
    }
  }

  return <Dialog open={open} onOpenChange={next => {
    if (submitting) return
    if (next) {
      setLoading(true)
      setSubmitError('')
      setSelectedModel('')
      setScopeKind('all')
    }
    setOpen(next)
  }}>
    <DialogTrigger asChild><Button variant={variant} type="button">批量分析 PR</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>批量分析 PR</DialogTitle>
        <DialogDescription>用同一个模型给选中的开放 PR 逐个评分，方便安排审查顺序。</DialogDescription>
      </DialogHeader>
      {loading ? <p role="status" className="text-sm text-foreground-3">正在读取模型和开放 PR 数量…</p>
        : readError ? <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-rose">{readError}</p>
          <Button variant="outline" size="sm" type="button" onClick={() => setAttempt(value => value + 1)}>重试读取模型</Button>
        </div>
        : <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            模型
            <ModelSelect models={models} value={modelAvailable ? selectedModel : ''} onValueChange={setSelectedModel}
              label="批量分析模型" disabled={submitting || models.length === 0}
              placeholder={models.length ? '选择模型' : '没有可用模型'}/>
          </label>
          <label className="grid gap-1.5 text-sm">
            范围
            <Select value={effectiveKind} onValueChange={value => setScopeKind(value as ScopeKind)} disabled={submitting}>
              <SelectTrigger aria-label="批量分析范围"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部开放 PR</SelectItem>
                <SelectItem value="limit">前 N 个开放 PR</SelectItem>
                {openPage != null ? <SelectItem value="page">开放列表第 {openPage} 页（整页）</SelectItem> : null}
              </SelectContent>
            </Select>
          </label>
          {scope.kind === 'limit' ? <label className="grid gap-1.5 text-sm">
            数量（1–500）
            <Input aria-label="批量分析数量" aria-invalid={!limitValid} min={1} max={500} value={limitText}
              onChange={event => setLimitText(event.target.value)} disabled={submitting} type="number"/>
          </label> : null}
          <p className="text-xs text-foreground-3">{openCount == null ? '开放 PR 数量暂不可用' : `开放 PR 共 ${openCount} 个`}
            {openCount != null && scope.kind === 'limit' && limitValid ? ` · 预计处理 ${Math.min(openCount, limit)} 个` : ''}
          </p>
        </div>}
      {submitError ? <p role="alert" className="text-sm text-rose">{submitError}</p> : null}
      <DialogFooter>
        <Button variant="outline" type="button" disabled={submitting} onClick={() => setOpen(false)}>取消</Button>
        <Button type="button" disabled={loading || submitting || !modelAvailable || !valid} onClick={() => void submit()}>
          {submitting ? '正在提交…' : '提交批量分析'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
