import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { startDatasetImport, type DatasetImportTask } from '@/features/datasets/datasetImportClient'
import { BenchmarkFieldsDialog } from './BenchmarkFieldsDialog'
import {
  CSV_FORMATS, CSV_HEADER_BYTES, KAMEI_2013_SCHEMA, inspectCsvHeader, missingColumns, type CsvInspection,
} from './datasetImportFormats'

const MAX_FILE_BYTES = 64 * 1024 * 1024

export function DatasetImportDialog({ open, onOpenChange, onStarted, onLoginRequired, backendTooOld }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (task: DatasetImportTask) => void
  onLoginRequired: () => void
  backendTooOld?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [schema, setSchema] = useState('')
  const [inspection, setInspection] = useState<CsvInspection | null>(null)
  const [readError, setReadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const schemaInfo = CSV_FORMATS.find(item => item.value === schema)
  const zipped = file?.name.toLowerCase().endsWith('.zip') ?? false
  const publishedCsv = schema === KAMEI_2013_SCHEMA
  const options = inspection?.formats ?? []
  const needsFormat = options.length > 1
  const unmatched = inspection && !options.length
  const target = unmatched ? schemaInfo ?? inspection.suggestion : undefined
  const missing = target && inspection ? missingColumns(inspection.columns, target) : []
  const canImport = Boolean(file && !busy && !readError && !backendTooOld && (zipped || options.some(item => item.value === schema)))

  useEffect(() => {
    if (!open) return
    setFile(null)
    setName('')
    setSchema('')
    setInspection(null)
    setReadError('')
    setError('')
    if (input.current) input.current.value = ''
  }, [open])

  useEffect(() => {
    if (!open || !file || zipped || !file.size || file.size > MAX_FILE_BYTES) return
    const sample = file.slice(0, CSV_HEADER_BYTES)
    const reader = new FileReader()
    reader.onload = () => {
      const complete = sample.size === file.size
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true })
          .decode(reader.result as ArrayBuffer, { stream: !complete })
      } catch {
        setReadError('CSV 需要使用 UTF-8 编码。')
        return
      }
      try {
        const result = inspectCsvHeader(text, complete)
        setInspection(result)
        setSchema(result.formats.length === 1 ? result.formats[0].value : '')
      } catch (failure) {
        setReadError(failure instanceof Error ? failure.message : 'CSV 表头读取失败。')
      }
    }
    reader.onerror = () => setReadError('无法读取所选文件，请重新选择。')
    reader.readAsArrayBuffer(sample)
    return () => {
      reader.onload = null
      reader.onerror = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
    }
  }, [file, open, zipped])

  async function submit() {
    if (!file || !canImport) return
    setBusy(true)
    setError('')
    try {
      const task = await startDatasetImport(file, {
        zipped, schema, ...(!publishedCsv && name.trim() ? { dataset: name.trim() } : {}),
      })
      onOpenChange(false)
      onStarted(task)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else if (failure instanceof ApiError) setError(failure.details[0]?.reason ?? failure.message)
      else setError(failure instanceof Error ? failure.message : '数据导入失败')
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
    <DialogContent aria-describedby={undefined} showCloseButton={!busy} className="max-h-[90vh] overflow-y-auto" style={{ width: 'min(92vw, 560px)', maxWidth: 'none' }}>
      <DialogHeader><DialogTitle>导入数据集</DialogTitle></DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-2">数据文件</span>
          <Input ref={input} type="file" disabled={busy} accept=".csv,.zip,text/csv,application/zip" aria-label="数据文件" onChange={event => {
            const selected = event.target.files?.[0] ?? null
            setFile(selected)
            setSchema('')
            setInspection(null)
            setReadError(selected?.size === 0 ? '所选文件为空。'
              : selected && selected.size > MAX_FILE_BYTES ? '文件超过 64 MiB。' : '')
            setError('')
          }}/>
          <span className="text-xs text-foreground-3">CSV 或 Kamei 2013 ZIP，最大 64 MiB。</span>
        </label>
        {zipped ? <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken px-3 py-2.5">
          <span className="min-w-0 flex-1 text-xs text-foreground-2">ZIP 内每个项目 CSV 各登记为一个数据版本。相同文件会复用已有版本。</span>
          <BenchmarkFieldsDialog/>
        </div> : null}
        {file && !zipped && !inspection && !readError ? <p role="status" className="text-sm text-foreground-3">正在读取 CSV 表头</p> : null}
        {options.length === 1 ? <p role="status" className="rounded-lg bg-teal-soft px-3 py-2 text-sm text-teal-deep">已识别为 {options[0].label}</p> : null}
        {needsFormat ? <div className="grid gap-1.5">
          <p role="status" className="text-sm text-foreground-2">表头匹配多个规范，请确认数据来源。</p>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">字段规范</span>
            <Select value={schema} disabled={busy} onValueChange={setSchema}>
              <SelectTrigger aria-label="CSV 字段规范"><SelectValue placeholder="选择数据来源"/></SelectTrigger>
              <SelectContent>{options.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <p className="text-xs text-foreground-3">Git v1 和 v2 请对照采集或导出时记录的版本。</p>
        </div> : null}
        {schemaInfo && options.length > 0 && !publishedCsv ? <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-2">数据集名称</span>
          <Input aria-label="数据集名称" disabled={busy} value={name} onChange={event => setName(event.target.value)} placeholder="留空则使用文件名"/>
        </label> : null}
        {publishedCsv ? <div><BenchmarkFieldsDialog/></div> : null}
        {unmatched ? <div className="grid gap-2 rounded-lg border border-border-soft bg-sunken p-3 text-sm">
          <p role="alert">{inspection.error ?? '表头未匹配到可导入的规范。'}</p>
          {!inspection.error ? <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">对照字段规范</span>
            <Select value={target?.value ?? ''} onValueChange={setSchema}>
              <SelectTrigger aria-label="对照字段规范"><SelectValue placeholder="选择要对照的规范"/></SelectTrigger>
              <SelectContent>{CSV_FORMATS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </label> : null}
          {missing.length ? <p className="text-xs text-foreground-2">缺少字段 <code className="break-all font-mono">{missing.join('、')}</code></p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground-3">按实际字段含义整理 CSV 后，重新选择文件。</p>
            {target ? <Button asChild variant="outline" size="sm">
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(target.columns.join(',') + '\r\n')}`}
                download={`${target.value}-template.csv`}>下载表头模板</a>
            </Button> : null}
          </div>
        </div> : null}
        {inspection ? <details className="text-xs text-foreground-3" open={unmatched || undefined}>
          <summary className="cursor-pointer">已读取 {inspection.columns.length} 个列名</summary>
          <code className="mt-1 block break-all font-mono leading-relaxed">{inspection.columns.join('、')}</code>
        </details> : null}
        {busy ? <p className="text-sm text-foreground-3" role="status">正在上传文件，上传完成后可以收起任务。</p> : null}
        {readError || error ? <p className="text-xs text-rose" role="alert">{readError || error}</p> : null}
        {backendTooOld ? <p className="text-xs text-rose" role="alert">当前后端尚未加载导入任务接口，请重启后端。</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="button" disabled={!canImport} onClick={() => void submit()}>{busy ? <><LoaderCircle className="animate-spin" aria-hidden="true"/>上传中</> : '导入'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
