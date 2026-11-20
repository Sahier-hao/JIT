import { useRef, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { AdminModel } from '@/features/admin/adminContracts'

export function supportsRepositoryScoring(model: AdminModel) {
  return model.repositorySchemaCompatible
    ?? ['openstack-six-v1', 'kamei14-git-v2'].includes(model.featureSchemaVersion)
}

export function AdminModelPolicyPanel({ model, busy, saving, update, open }: {
  model: AdminModel
  busy: boolean
  saving: boolean
  update: (id: string, changes: { enabled?: boolean; isDefault?: boolean }) => Promise<void>
  open: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const policyButtonRef = useRef<HTMLButtonElement>(null)
  const compatible = supportsRepositoryScoring(model)
  const ready = model.state === 'ready'

  return <article className="grid min-w-0 gap-4 rounded-xl border border-border-soft bg-card p-5 shadow-sm" aria-label="模型设置">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="break-words text-xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">{model.name}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {model.isDefault ? <span className="rounded-md bg-accent-soft px-2 py-1 text-accent">默认模型</span> : null}
          <span className="rounded-md bg-soft px-2 py-1 text-foreground-2">{model.enabled ? '已启用' : '已停用'}</span>
          <span className="rounded-md bg-soft px-2 py-1 text-foreground-3">{ready ? '上次校验通过' : '不可用'}</span>
        </div>
      </div>
      <Button size="sm" type="button" variant="outline" onClick={open}>查看详情</Button>
    </div>
    {model.validationMessage ? <p className="text-sm text-foreground-3">{model.validationMessage}</p> : null}
    <dl className="grid gap-x-5 gap-y-3 border-t border-border-soft pt-4 text-sm sm:grid-cols-2 [&_dd]:mt-1 [&_dd]:break-words [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-xs [&_dt]:text-foreground-3">
      <div><dt>训练方法</dt><dd>{model.method}</dd></div>
      <div><dt>字段规范</dt><dd>{model.featureSchemaVersion}</dd></div>
      {model.artifactDatasetVersion ? <div className="sm:col-span-2"><dt>训练数据版本</dt><dd>{model.artifactDatasetVersion}</dd></div> : null}
    </dl>
    <section className="grid gap-2 border-t border-border-soft pt-4" aria-label="使用设置">
      <div className="flex flex-wrap items-center gap-2">
        {!model.isDefault ? <Button size="sm" type="button" variant="outline" disabled={busy || !ready || !compatible || !model.enabled}
          onClick={() => void update(model.modelId, { isDefault: true })}>设为默认</Button> : null}
        <Button ref={policyButtonRef} size="sm" type="button" variant="outline" disabled={busy || model.isDefault || (!model.enabled && (!ready || !compatible))}
          onClick={() => model.enabled ? setConfirm(true) : void update(model.modelId, { enabled: true })}>
          {model.enabled ? '停用模型' : '启用模型'}
        </Button>
        {saving ? <span className="text-xs text-foreground-3" role="status">正在保存…</span> : null}
      </div>
      {model.isDefault ? <p className="text-xs text-foreground-3">设立新的默认模型后可停用此模型。</p>
        : ready && !compatible ? <p className="text-xs text-foreground-3">此字段规范不适用于仓库打分。</p> : null}
    </section>
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto"
        onCloseAutoFocus={event => { event.preventDefault(); policyButtonRef.current?.focus() }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words [overflow-wrap:anywhere]">停用「{model.name}」？</AlertDialogTitle>
          <AlertDialogDescription>已完成结果保留。新分析无法选择此模型，尚未开始使用此模型的任务会报告停用原因。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button size="sm" type="button" variant="outline" onClick={() => setConfirm(false)}>取消</Button>
          <Button size="sm" type="button" variant="destructive" disabled={busy} onClick={() => {
            setConfirm(false)
            void update(model.modelId, { enabled: false })
          }}>确认停用</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </article>
}
