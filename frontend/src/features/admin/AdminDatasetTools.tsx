import { useState, type ReactNode } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/apiContract'
import { fetchPrunableDatasets, formatDate, pruneDatasets, type AdminDatasetVersion, type PrunableDatasetVersion } from '@/features/admin/adminContracts'
import { ErrorNotice } from '@/features/admin/AdminShared'
import { compareCuration, deriveCuration, previewCuration, type CurationPreview } from '@/features/datasets/curationClient'
import { CurationPreviewPanel } from '@/features/datasets/components/CurationPreviewPanel'
import { DatasetFact } from '@/features/datasets/DatasetPresentation'
import { asRow, numberText } from '@/features/datasets/mydata/format'

const DEFAULT_RECIPE = JSON.stringify({
  version: 2,
  rules: [{ id: 'quantile-range', field: 'la', lower: 0.05, upper: 0.95 }],
}, null, 2)

function DatasetToolDialog({ title, description, busy, onClose, children }: {
  title: string
  description: string
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-[640px]">
      <DialogHeader className="min-w-0 pr-6">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="break-words [overflow-wrap:anywhere]">{description}</DialogDescription>
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
}

function showFailure(failure: unknown, fallback: string, expired: () => void, setError: (text: string) => void) {
  if (failure instanceof ApiError && failure.status === 401) expired()
  else setError(failure instanceof Error ? failure.message : fallback)
}

export function AdminDatasetCurationDialog({ version, onClose, onDerived, expired }: {
  version: string
  onClose: () => void
  onDerived: (id: string) => void
  expired: () => void
}) {
  const [recipe, setRecipe] = useState(DEFAULT_RECIPE)
  const [preview, setPreview] = useState<CurationPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function curate(derive: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let value: unknown
      try { value = JSON.parse(recipe) } catch { throw new Error('清洗配方不是合法 JSON') }
      if (derive) {
        const result = await deriveCuration(version, value)
        onDerived(result.version)
        onClose()
      } else {
        setPreview(await previewCuration(version, value))
      }
    } catch (failure) { showFailure(failure, '清洗操作失败', expired, setError) }
    finally { setBusy(false) }
  }

  return <DatasetToolDialog title="清洗与派生" description={version} busy={busy} onClose={onClose}>
    <label className="grid gap-2 text-sm text-foreground-3">清洗配方（JSON）
      <Textarea aria-label="清洗配方" value={recipe} disabled={busy} rows={8} className="font-mono text-xs"
        onChange={event => { setRecipe(event.target.value); setPreview(null); setError('') }}/>
    </label>
    <ErrorNotice>{error}</ErrorNotice>
    {preview ? <CurationPreviewPanel key={preview.recipeSha256} preview={preview}/> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void curate(false)}>预览结果</Button>
      <Button type="button" disabled={busy} onClick={() => void curate(true)}>生成新版本</Button>
    </div>
  </DatasetToolDialog>
}

export function AdminDatasetCompareDialog({ selected, versions, onClose, expired }: {
  selected: AdminDatasetVersion
  versions: AdminDatasetVersion[]
  onClose: () => void
  expired: () => void
}) {
  const [other, setOther] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function compare() {
    if (!other || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try { setResult(await compareCuration(selected.version, other)) }
    catch (failure) { showFailure(failure, '版本对比失败', expired, setError) }
    finally { setBusy(false) }
  }

  return <DatasetToolDialog title="对比版本" description={selected.version} busy={busy} onClose={onClose}>
    <label className="grid min-w-0 gap-2 text-sm text-foreground-3">对比派生版本
      <NativeSelect aria-label="对比派生版本" value={other} disabled={busy} className="w-full min-w-0" onChange={event => {
        setOther(event.target.value)
        setResult(null)
        setError('')
      }}>
        <option value="">请选择</option>
        {versions.filter(item => item.version !== selected.version).map(item => <option key={item.version} value={item.version}>{item.version}</option>)}
      </NativeSelect>
    </label>
    <ErrorNotice>{error}</ErrorNotice>
    {result ? <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      {(['source', 'derived'] as const).map(key => {
        const side = asRow(result[key])
        if (!side) return null
        const quality = asRow(side.quality)
        const range = asRow(side.timeRange)
        return <section key={key} className="min-w-0 rounded-lg border border-border-soft p-3">
          <h3 className="mb-2 text-sm font-semibold">{key === 'source' ? '来源版本' : '派生版本'}</h3>
          <dl className="grid gap-2">
            <DatasetFact label="版本">{String(side.version ?? '未记录')}</DatasetFact>
            <DatasetFact label="纳入 / 正例">{numberText(quality?.includedRows)} / {numberText(quality?.positiveLabels)}</DatasetFact>
            {range?.start ? <DatasetFact label="数据范围">{formatDate(range.start)} 至 {formatDate(range.end)}</DatasetFact> : null}
          </dl>
        </section>
      })}
    </div> : null}
    <Button type="button" disabled={!other || busy} className="justify-self-end" onClick={() => void compare()}>{busy ? '正在对比…' : '对比版本'}</Button>
  </DatasetToolDialog>
}

export function AdminDatasetCleanupDialog({ onClose, onChanged, expired }: {
  onClose: () => void
  onChanged: () => void
  expired: () => void
}) {
  const [keep, setKeep] = useState('10')
  const [versions, setVersions] = useState<PrunableDatasetVersion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [confirm, setConfirm] = useState(false)
  const keepCount = Number(keep)
  const validKeep = Boolean(keep.trim()) && Number.isSafeInteger(keepCount) && keepCount >= 0

  async function preview() {
    if (busy || !validKeep) return
    setBusy(true)
    setError('')
    setResult('')
    setVersions(null)
    try { setVersions(await fetchPrunableDatasets(keepCount)) }
    catch (failure) { showFailure(failure, '清理预览失败', expired, setError) }
    finally { setBusy(false) }
  }

  async function clearVersions() {
    if (!versions?.length || !validKeep || busy) return
    setBusy(true)
    setError('')
    try {
      const outcome = await pruneDatasets(versions.map(item => item.version), keepCount)
      const deleted = Array.isArray(outcome.deleted) ? outcome.deleted.length : 0
      const skipped = Array.isArray(outcome.skipped) ? outcome.skipped.length : 0
      setResult(`已删除 ${deleted} 个版本，跳过 ${skipped} 个`)
      setVersions(null)
      onChanged()
    } catch (failure) { showFailure(failure, '清理失败', expired, setError) }
    finally { setConfirm(false); setBusy(false) }
  }

  return <DatasetToolDialog title="清理 PR 版本" description="按保留数量预览可清理的 PR 采集版本。" busy={busy} onClose={onClose}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-foreground-3">保留 PR 版本数
        <Input className="w-32" type="number" min={0} value={keep} disabled={busy}
          onChange={event => { setKeep(event.target.value); setVersions(null); setResult(''); setError('') }}/>
      </label>
      <Button type="button" variant="outline" disabled={busy || !validKeep} onClick={() => void preview()}>预览可清理版本</Button>
    </div>
    <ErrorNotice>{error}</ErrorNotice>
    {result ? <p className="text-sm text-foreground-3" role="status">{result}</p> : null}
    {versions ? versions.length ? <>
      <ul className="grid max-h-52 gap-2 overflow-auto rounded-lg border border-border-soft p-3 text-xs">
        {versions.map(item => <li key={item.version}><code className="break-all">{item.version}</code> · {item.createdAt.slice(0, 10)}</li>)}
      </ul>
      <Button type="button" variant="destructive" className="justify-self-end" onClick={() => setConfirm(true)}>清理 {versions.length} 个版本</Button>
    </> : <p className="text-sm text-foreground-3">没有可清理的版本。</p> : null}
    <AlertDialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open) }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-auto">
        <AlertDialogHeader><AlertDialogTitle>确认清理 PR 数据集？</AlertDialogTitle>
          <AlertDialogDescription>将删除预览中列出的数据集登记、提交记录与文件。此操作不可恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(false)}>取消</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void clearVersions()}>{busy ? '正在清理…' : '确认清理'}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </DatasetToolDialog>
}
