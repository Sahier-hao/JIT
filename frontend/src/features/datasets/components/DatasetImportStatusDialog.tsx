import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ApiError } from '@/lib/apiContract'
import { formatDate } from '@/features/admin/adminContracts'
import {
  datasetImportJobsKey, getDatasetImport, importIsActive, importPercent, importStage,
  useDatasetImportJobs, type DatasetImportTask,
} from '@/features/datasets/datasetImportClient'

function ImportProgress({ task }: { task: DatasetImportTask }) {
  return <div className="grid gap-2 rounded-lg border border-border-soft bg-sunken px-4 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong className="text-sm text-foreground">{importStage(task)}</strong>
      {task.total != null ? <span className="text-xs tabular-nums text-foreground-3">
        已处理 {task.processed}/{task.total} 个 CSV
      </span> : null}
    </div>
    {importIsActive(task) || task.status === 'completed'
      ? <Progress value={importPercent(task)} aria-label="导入处理进度"/>
      : null}
    {task.currentFile ? <div className="flex flex-wrap justify-between gap-1.5 text-xs text-foreground-3">
      <span className="break-all">{task.currentFile}</span>
      {task.rowsTotal != null ? <span className="tabular-nums">
        已写入 {task.rowsWritten.toLocaleString('zh-CN')}/{task.rowsTotal.toLocaleString('zh-CN')} 条记录
      </span> : null}
    </div> : null}
  </div>
}

export function DatasetImportStatusDialog({ account, taskId, onClose, onInspect, onHistory, onChooseFile, onViewVersion, onLoginRequired }: {
  account: string | null
  taskId?: string
  onClose: () => void
  onInspect: (taskId: string) => void
  onHistory: () => void
  onChooseFile: () => void
  onViewVersion: (version: string) => void
  onLoginRequired: () => void
}) {
  const history = useDatasetImportJobs(account, !taskId)
  const detail = useQuery({
    queryKey: [...datasetImportJobsKey(account), taskId],
    queryFn: ({ signal }) => getDatasetImport(taskId!, signal),
    enabled: Boolean(account && taskId),
    refetchInterval: query => query.state.data && importIsActive(query.state.data) ? 1500 : false,
    retry: false,
  })
  const current = taskId ? detail : history
  const task = taskId ? detail.data : undefined
  const error = current.error
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) onLoginRequired()
  }, [error, onLoginRequired])

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent aria-describedby={undefined} className="max-h-[88dvh] overflow-y-auto" style={{ width: 'min(92vw, 560px)', maxWidth: 'none' }}>
      <DialogHeader><DialogTitle>{taskId ? '导入任务' : '导入记录'}</DialogTitle></DialogHeader>
      {current.isPending ? <p className="text-sm text-foreground-3" role="status">正在读取导入任务</p> : null}
      {error ? <div className="flex flex-wrap items-center gap-2" role="alert">
        <p className="text-sm text-rose-deep">{error.message}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void current.refetch()}>重新读取</Button>
      </div> : null}
      {task ? <div className="grid gap-3">
        <p className="break-all text-sm font-medium text-foreground">{task.filename}</p>
        <ImportProgress task={task}/>
        {task.error ? <p className="text-sm text-rose-deep" role="alert">{task.error.message}</p> : null}
        {task.status === 'completed' ? <>
          <p className="text-sm text-foreground-2" role="status">
            新登记 {task.createdCount} 个版本 · 复用 {task.versions.length - task.createdCount} 个版本
          </p>
          <div className="grid gap-1" aria-label="导入的数据版本">
            {task.versions.map(item => <Button key={item.version} type="button" variant="outline"
              className="justify-between" onClick={() => onViewVersion(item.version)}>
              <span className="truncate">{item.project ?? item.dataset}</span>
              <span className="flex items-center gap-1 tabular-nums text-foreground-3">
                {item.records.toLocaleString('zh-CN')} 行<ChevronRight size={15} aria-hidden="true"/>
              </span>
            </Button>)}
          </div>
        </> : null}
      </div> : null}
      {!taskId && history.data ? <div className="grid gap-1">
        {history.data.length ? history.data.map(item => <button key={item.taskId} type="button"
          className="grid gap-1 rounded-lg border border-border-soft px-3 py-2 text-left hover:bg-sunken"
          onClick={() => onInspect(item.taskId)}>
          <span className="flex justify-between gap-2 text-sm"><strong className="truncate">{item.filename}</strong>
            <span className="shrink-0 text-foreground-3">{importStage(item)}</span></span>
          {importIsActive(item) ? <Progress inline value={importPercent(item)} aria-label={`${item.filename} 导入进度`}/>
            : <span className="text-xs text-foreground-3">{formatDate(item.createdAt)}</span>}
        </button>) : <p className="text-sm text-foreground-3">还没有导入记录</p>}
      </div> : null}
      <DialogFooter>
        {taskId ? <Button type="button" variant="ghost" onClick={onHistory}><ArrowLeft size={15} aria-hidden="true"/>导入记录</Button> : null}
        {task?.error ? <Button type="button" variant="outline" onClick={onChooseFile}>重新上传</Button> : null}
        <Button type="button" variant={task?.preferredVersion ? 'outline' : 'default'} onClick={onClose}>
          {task && importIsActive(task) ? '后台运行' : '关闭'}
        </Button>
        {task?.preferredVersion ? <Button type="button" onClick={() => onViewVersion(task.preferredVersion!)}>查看数据</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
