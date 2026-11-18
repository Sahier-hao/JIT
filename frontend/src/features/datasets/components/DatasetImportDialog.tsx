import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { importUserDataset, type UserDataset } from '@/features/account/userClient'

const SCHEMAS = [
  {
    value: 'kamei14-benchmark-v1',
    label: 'Kamei 14 维（发布者标签）',
    description: '公开 Kamei 基准的 14 个提交级特征，标签来自发布者的 bugcount。适合复现公开数据，不包含我们的成熟观察证据。',
    columns: 'commit_id、author_date、bugcount、ns、nd、nf、entropy、la、ld、lt、fix、ndev、age、nuc、exp、rexp、sexp',
  },
  {
    value: 'openstack-six-v1',
    label: 'OpenStack 6 维',
    description: '最精简的 6 维特征，兼容既有 OpenStack 模型，数据和训练都最快。',
    columns: 'commit_id、author_date、bugcount、ns、nd、nf、ent、la、ld',
  },
  {
    value: 'kamei14-v1',
    label: 'Kamei 原始列（12 个入模字段）',
    description: '原始 Kamei 列名，fix 来自 fixcount。固定原始快照缺少 lt、rexp，所以不是完整的 14 个入模字段。',
    columns: 'commit_id、author_date、bugcount、fixcount、ns、nd、nf、ent、la、ld、ndev、age、nuc、aexp、asexp',
  },
  {
    value: 'kamei14-git-v1',
    label: 'Git 14 维 v1',
    description: '由本项目 Git 采集器生成的 14 维提交特征。旧版可能没有逐提交成熟声明，导入后只能查看/清洗，不能直接正式训练。',
    columns: 'commit_id、author_date、bugcount、ns、nd、nf、entropy、la、ld、lt、fix、ndev、age、nuc、exp、rexp、sexp',
  },
  {
    value: 'kamei14-git-v2',
    label: 'Git 14 维 v2（当前）',
    description: '当前仓库采集口径。若 CSV 额外带 label_status、observed_through_epoch、maturity_days，就可以做成熟准入和正式训练。',
    columns: 'commit_id、author_date、bugcount、ns、nd、nf、entropy、la、ld、lt、fix、ndev、age、nuc、exp、rexp、sexp；成熟三列必须同时提供',
  },
]

export function DatasetImportDialog({ open, onOpenChange, onImported, onLoginRequired }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (dataset: UserDataset) => void
  onLoginRequired: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [schema, setSchema] = useState('kamei14-benchmark-v1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const schemaInfo = SCHEMAS.find(item => item.value === schema) ?? SCHEMAS[0]

  useEffect(() => {
    if (!open) return
    setFile(null)
    setName('')
    setSchema('kamei14-benchmark-v1')
    setError('')
    if (input.current) input.current.value = ''
  }, [open])

  async function submit() {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const dataset = await importUserDataset(file, {
        filename: file.name,
        schema,
        ...(name.trim() ? { dataset: name.trim() } : {}),
      })
      onImported(dataset)
      onOpenChange(false)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : 'CSV 导入失败')
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto" style={{ width: 'min(92vw, 560px)', maxWidth: 'none' }}>
      <DialogHeader><DialogTitle>导入 CSV</DialogTitle></DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-2">CSV 文件</span>
          <Input ref={input} type="file" accept=".csv,text/csv" aria-label="CSV 文件" onChange={event => {
            const selected = event.target.files?.[0] ?? null
            setFile(selected)
          }}/>
          <span className="text-xs text-foreground-3">最大 64 MiB；原始文件会按校验值保存，不覆盖已有版本。</span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-2">数据集名称</span>
          <Input aria-label="数据集名称" value={name} onChange={event => setName(event.target.value)} placeholder="留空则按文件名生成账户私有名称"/>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-2">字段规范</span>
          <Select value={schema} onValueChange={setSchema}>
            <SelectTrigger aria-label="CSV 字段规范"><SelectValue/></SelectTrigger>
            <SelectContent>{SCHEMAS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <div className="grid gap-1 rounded-lg bg-sunken p-3 text-xs leading-relaxed text-foreground-3">
          <strong className="text-foreground-2">{schemaInfo.label}</strong>
          <p>{schemaInfo.description}</p>
          <p><span className="text-foreground-4">列：</span><code className="break-all font-mono text-[11px]">{schemaInfo.columns}</code></p>
        </div>
        <p className="rounded-sm bg-sunken px-3 py-2 text-xs leading-body text-foreground-3">导入不会补造观察窗口或成熟标签；缺少这些证据的 SZZ 数据可以查看和导出，但不能直接进入训练。</p>
        {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="button" disabled={!file || busy} onClick={() => void submit()}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}导入</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
