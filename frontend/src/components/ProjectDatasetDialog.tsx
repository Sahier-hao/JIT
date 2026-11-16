import { useEffect, useState } from 'react'
import { Button } from '../ui/controls'
import { Dialog } from '../ui/dialog'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { downloadProjectDataset, fetchProjectDataset, type ProjectDataset } from '../projectDatasetClient'

const numberText = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  ? value.toLocaleString() : '未提供'

export function ProjectDatasetDialog({ repositoryId, syncId, open, onOpenChange }: {
  repositoryId: string
  syncId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [dataset, setDataset] = useState<ProjectDataset | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  const [downloadBusy, setDownloadBusy] = useState<'' | 'zip' | 'xlsx'>('')
  const [downloadError, setDownloadError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    fetchProjectDataset(repositoryId, syncId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setDataset(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [open, repositoryId, syncId, revision])

  async function download(format: 'zip' | 'xlsx') {
    if (downloadBusy) return
    setDownloadBusy(format)
    setDownloadError(null)
    try {
      await downloadProjectDataset(repositoryId, syncId, format)
    } catch (failure) {
      setDownloadError(failure)
    } finally {
      setDownloadBusy('')
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange} title="本次分析的数据集" width={720}
    footer={<Button onClick={() => onOpenChange(false)}>返回结果</Button>}>
    {error ? <FailureNotice error={error} onRetry={() => { setDataset(null); setError(null); setRevision(value => value + 1) }}/> : dataset ? <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="text-base font-semibold text-foreground">{dataset.datasetId}</h3><p className="mt-0.5 break-all text-xs text-foreground-3">{dataset.version}</p></div>
        <span className="rounded-sm bg-soft px-1.5 py-0.5 text-xs text-foreground-3">{dataset.schema}</span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm"><dt className="text-xs text-foreground-3">时间范围</dt><dd className="m-0 break-words">{displayTime(dataset.timeRange.start)} — {displayTime(dataset.timeRange.end)}</dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm"><dt className="text-xs text-foreground-3">原始 / 纳入</dt><dd className="m-0">{numberText(dataset.quality.rawRows)} / {numberText(dataset.quality.includedRows)}</dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm"><dt className="text-xs text-foreground-3">正例</dt><dd className="m-0">{numberText(dataset.quality.positiveLabels)}</dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm"><dt className="text-xs text-foreground-3">CSV</dt><dd className="m-0 break-words">{dataset.file.name} · {dataset.file.bytes.toLocaleString()} 字节</dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm sm:col-span-2"><dt className="text-xs text-foreground-3">SHA-256</dt><dd className="m-0 break-all"><code className="font-mono text-xs">{dataset.file.sha256}</code></dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm"><dt className="text-xs text-foreground-3">来源</dt><dd className="m-0 break-words">{dataset.source.publisher ?? '未提供'}{dataset.source.branch ? ` · ${dataset.source.branch}` : ''}</dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm"><dt className="text-xs text-foreground-3">修订</dt><dd className="m-0 break-all"><code className="font-mono text-xs">{dataset.source.revision ?? '未提供'}</code></dd></div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 text-sm sm:col-span-2"><dt className="text-xs text-foreground-3">标签规则</dt><dd className="m-0 break-words">{dataset.labelRule ?? '未声明'}</dd></div>
      </dl>
      {dataset.source.url ? <p className="text-xs"><a className="text-accent underline-offset-2 hover:underline" href={dataset.source.url} target="_blank" rel="noreferrer">打开原始来源</a></p> : null}
      {dataset.limitations.length ? <section className="grid gap-1.5" aria-label="数据集限制">
        <h3 className="text-sm font-semibold text-foreground">限制</h3>
        <ul className="list-disc pl-5 text-xs leading-body text-foreground-3">{dataset.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </section> : null}
      <section className="grid gap-2 border-t border-border-soft pt-3" aria-label="下载数据集">
        <h3 className="text-sm font-semibold text-foreground">下载</h3>
        <p className="text-xs leading-body text-foreground-3">CSV 包包含 manifest 和 SHA256SUMS，是完整性核对版本。</p>
        <div className="flex flex-wrap gap-2">
          <Button loading={downloadBusy === 'zip'} disabled={!!downloadBusy} onClick={() => void download('zip')}>下载 CSV 包</Button>
          <Button loading={downloadBusy === 'xlsx'} disabled={!!downloadBusy} onClick={() => void download('xlsx')}>下载 XLSX</Button>
        </div>
        {downloadError ? <FailureNotice error={downloadError} onRetry={() => void download('zip')} retryLabel="重新下载 CSV 包"/> : null}
      </section>
    </div> : <LoadingNotice label="正在核对数据集与文件哈希"/>}
  </Dialog>
}
