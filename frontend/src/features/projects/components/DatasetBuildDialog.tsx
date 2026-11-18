import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEffect, useState } from 'react'


import type { Route } from '@/app/navigation'
import {
  cancelDatasetBuild, createDatasetBuild, getDatasetBuild, listDatasetBuilds, retryDatasetBuild,
  type DatasetBuildTask,
} from '@/features/datasets/datasetBuildClient'
import {
  DatasetBuildFlow, DatasetBuildRangeField, DatasetBuildTaskSummary,
} from '@/features/datasets/components/DatasetBuildParts'
import {
  buildWindowForRange, rangeIsValid, type DatasetBuildRangeMode,
} from '@/features/datasets/components/DatasetBuildRange'

const ACTIVE = ['queued', 'running']

export function DatasetBuildDialog({
  repositoryId, defaultBranch, initialTaskId, open, onOpenChange, navigate,
}: {
  repositoryId: string
  defaultBranch: string | null
  initialTaskId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  navigate: (route: Route) => void
}) {
  const [branch, setBranch] = useState(defaultBranch ?? 'HEAD')
  const [rangeMode, setRangeMode] = useState<DatasetBuildRangeMode>('all')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [task, setTask] = useState<DatasetBuildTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    listDatasetBuilds(repositoryId, controller.signal).then(items => {
      if (controller.signal.aborted) return
      const selectedTask = (initialTaskId ? items.find(item => item.taskId === initialTaskId) : undefined)
        ?? items.find(item => ACTIVE.includes(item.status)) ?? null
      setTask(selectedTask)
      if (selectedTask) {
        setBranch(selectedTask.branch)
        setRangeMode(selectedTask.since || selectedTask.until ? 'custom' : 'all')
        setSince(selectedTask.since?.slice(0, 10) ?? '')
        setUntil(selectedTask.until?.slice(0, 10) ?? '')
      } else {
        setBranch(defaultBranch ?? 'HEAD')
        setRangeMode('all')
        setSince('')
        setUntil('')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '读取数据集构建任务失败')
    })
    return () => controller.abort()
  }, [defaultBranch, initialTaskId, open, repositoryId])

  useEffect(() => {
    if (!open || !task || !ACTIVE.includes(task.status)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      getDatasetBuild(repositoryId, task.taskId, controller.signal)
        .then(next => { if (!controller.signal.aborted) setTask(next) })
        .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '刷新构建任务失败') })
    }, 1000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, repositoryId, task])

  async function submit() {
    const selectedWindow = buildWindowForRange(rangeMode, since, until)
    if (!branch.trim() || busy || !rangeIsValid(rangeMode, since, until)) return
    setBusy(true); setError('')
    try {
      const started = await createDatasetBuild(repositoryId, {
        branch: branch.trim(), ...selectedWindow,
      })
      setTask(started)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '启动数据集构建失败')
    } finally { setBusy(false) }
  }

  async function cancel() {
    if (!task || busy) return
    setBusy(true); setError('')
    try { setTask(await cancelDatasetBuild(repositoryId, task.taskId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '取消数据集构建失败') }
    finally { setBusy(false) }
  }

  async function retry() {
    if (!task || busy) return
    setBusy(true); setError('')
    try { setTask(await retryDatasetBuild(repositoryId, task.taskId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '重试数据集构建失败') }
    finally { setBusy(false) }
  }

  function openDataset() {
    if (!task?.datasetName || !task.datasetVersion) return
    onOpenChange(false)
    navigate({
      name: 'admin', view: 'datasets',
      resourceId: task.datasetName, version: task.datasetVersion,
    })
  }

  const active = task ? ACTIVE.includes(task.status) : false
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${620}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"从当前项目构建数据集"}</DialogTitle></DialogHeader><div className="grid gap-3">
      <p className="text-xs leading-body text-foreground-3">只采集公开仓库并登记 Kamei 14 维数据集。不会训练模型、给提交评分或修改项目当前结果。</p>
      <DatasetBuildFlow task={task}/>
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">公开仓库</span><Input value={`已绑定当前项目：${repositoryId.slice(0, 8)}`} disabled readOnly/></label>
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">分支或提交</span><Input aria-label="数据集构建分支" value={branch} onChange={event => setBranch(event.target.value)} disabled={active}/></label>
      <DatasetBuildRangeField mode={rangeMode} onModeChange={setRangeMode} since={since} until={until}
        onSinceChange={setSince} onUntilChange={setUntil} disabled={active} labelPrefix="数据集构建"/>
      {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      <DatasetBuildTaskSummary task={task}/>
    </div><DialogFooter>{<>
      <Button onClick={() => onOpenChange(false)} variant="outline" type="button">关闭</Button>
      {task && active ? <Button onClick={() => void cancel()} variant="destructive" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}取消任务</Button> : null}
      {task && ['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button onClick={() => void retry()} variant="outline" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}按原参数重试</Button> : null}
      {task?.status === 'completed' && task.datasetName && task.datasetVersion ? <>
        <Button onClick={openDataset} variant="outline" type="button">查看数据</Button>
      </> : <Button variant='default' disabled={Boolean(!branch.trim() || active || !rangeIsValid(rangeMode, since, until)) || Boolean(busy)} onClick={() => void submit()} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}{task ? '用当前参数重新构建' : '开始构建'}</Button>}
    </>}</DialogFooter></DialogContent></Dialog>
}
