import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { datasetRows, type DatasetRowsPage } from '@/features/account/userClient'
import { numberText } from '@/features/datasets/mydata/format'

const PAGE_SIZE = 50

/** 只读数据明细：表头固定、横向滚动、按页读取，单元格截断并保留完整值。 */
export function DatasetRowsTable({ version, onLoginRequired }: { version: string; onLoginRequired?: () => void }) {
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<DatasetRowsPage | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setPage(null)
    setError('')
    datasetRows(version, offset, PAGE_SIZE, controller.signal)
      .then(result => { if (!controller.signal.aborted) setPage(result) })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired?.()
        else setError(failure instanceof Error ? failure.message : '数据明细读取失败')
      })
    return () => controller.abort()
  }, [version, offset, attempt, onLoginRequired])

  const total = page?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(pages, Math.floor(offset / PAGE_SIZE) + 1)

  return <div className="grid gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-foreground-3">
        {page ? `${numberText(page.total)} 行 · ${page.columns.length} 列` : '正在读取数据明细…'}
        <span className="ml-2 text-foreground-4">只读，按行分页</span>
      </p>
      <div className="flex items-center gap-1.5" role="group" aria-label="数据明细分页">
        <Button size="sm" variant="outline" type="button" disabled={current <= 1 || !page}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft aria-hidden="true"/>上一页</Button>
        <span className="min-w-20 text-center text-xs tabular-nums text-foreground-3">第 {current} / {pages} 页</span>
        <Button size="sm" variant="outline" type="button" disabled={current >= pages || !page}
          onClick={() => setOffset(offset + PAGE_SIZE)}>下一页<ChevronRight aria-hidden="true"/></Button>
      </div>
    </div>
    {error ? <p className="text-xs text-rose" role="alert">{error}
      <Button size="sm" variant="link" type="button" onClick={() => setAttempt(value => value + 1)}>重试</Button>
    </p> : !page ? <p className="flex items-center gap-2 py-8 text-xs text-foreground-3" role="status"><LoaderCircle className="animate-spin" aria-hidden="true" size={14}/>正在读取数据明细…</p>
      : <div className="max-h-[420px] overflow-auto rounded-lg border border-border-soft">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <caption className="sr-only">{version} 的数据行，共 {page.total} 行</caption>
          <thead className="sticky top-0 z-10 bg-card text-foreground-3">
            <tr className="border-b border-border-soft">
              <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-normal tabular-nums text-foreground-4">#</th>
              {page.columns.map(column => <th key={column} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">{column}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {page.rows.length ? page.rows.map((row, index) => <tr key={`${offset + index}`} className="hover:bg-sunken/60">
              <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-right font-normal tabular-nums text-foreground-4">{offset + index + 1}</th>
              {page.columns.map((column, columnIndex) => {
                const value = row[columnIndex] ?? ''
                return <td key={column} className="max-w-[260px] truncate px-2 py-1.5 font-mono text-[11px] text-foreground-2" title={value}>{value}</td>
              })}
            </tr>) : <tr><td colSpan={page.columns.length + 1} className="px-2 py-6 text-center text-xs text-foreground-3">这一页没有数据行。</td></tr>}
          </tbody>
        </table>
      </div>}
  </div>
}
