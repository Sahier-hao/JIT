import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  cancelDatasetBuild, cancelUserDatasetBuild, createDatasetBuild, createUserDatasetBuild, getDatasetBuild,
  getUserDatasetBuild, retryDatasetBuild, retryUserDatasetBuild, type DatasetBuildTask,
} from '@/features/datasets/datasetBuildClient'
import {
  DatasetBuildFlow, DatasetBuildRangeField, DatasetBuildTaskSummary,
} from '@/features/datasets/components/DatasetBuildParts'
import {
  buildWindowForRange, rangeIsValid, type DatasetBuildRangeMode,
} from '@/features/datasets/components/DatasetBuildRange'

const ACTIVE = ['queued', 'running']

function readBuild(taskId: string, projectId: string | undefined, signal: AbortSignal) {
  return (projectId ? getDatasetBuild(projectId, taskId, signal) : getUserDatasetBuild(taskId, signal)).then(task => {
    if (task.taskId !== taskId) throw new Error('读取的任务与打开的链接不一致')
    return task
  })
}

export function RepositoryDatasetBuildDialog({ open, onOpenChange, onCompleted, onLoginRequired, initialRepositoryUrl, initialBranch, initialTaskId, projectId, onRetried }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: (datasetVersion: string) => void
  onLoginRequired: () => void
  initialRepositoryUrl?: string
  initialBranch?: string
  initialTaskId?: string
  projectId?: string
  onRetried?: (taskId: string) => void
}) {
  const [repositoryUrl, setRepositoryUrl] = useState(initialRepositoryUrl ?? '')
  const [branch, setBranch] = useState(initialBranch ?? 'main')
  const [rangeMode, setRangeMode] = useState<DatasetBuildRangeMode>('all')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [task, setTask] = useState<DatasetBuildTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loadingTask, setLoadingTask] = useState(Boolean(initialTaskId))

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError('')
    setTask(null)
    setRepositoryUrl(initialRepositoryUrl ?? '')
    setBranch(initialBranch ?? 'main')
    setRangeMode('all')
    setSince('')
    setUntil('')
    setLoadingTask(Boolean(initialTaskId))
    if (!initialTaskId) return
    readBuild(initialTaskId, projectId, controller.signal).then(selected => {
      if (controller.signal.aborted) return
      setTask(selected)
      setRepositoryUrl(selected.repositoryUrl)
      setBranch(selected.branch)
      setRangeMode(selected.since || selected.until ? 'custom' : 'all')
      setSince(selected.since?.slice(0, 10) ?? '')
      setUntil(selected.until?.slice(0, 10) ?? '')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '构建任务读取失败')
    }).finally(() => { if (!controller.signal.aborted) setLoadingTask(false) })
    return () => controller.abort()
  }, [open, onLoginRequired, initialRepositoryUrl, initialBranch, initialTaskId, projectId, attempt])

  useEffect(() => {
    if (!open || !task || !ACTIVE.includes(task.status)) return
    const controller = new AbortController()
    const taskId = task.taskId
    let timer: number
    function poll() {
      readBuild(taskId, projectId, controller.signal).then(next => {
        if (!controller.signal.aborted) { setTask(next); setError('') }
      }).catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else {
          setError(failure instanceof Error ? failure.message : '构建任务刷新失败')
          timer = window.setTimeout(poll, 3000)
        }
      })
    }
    timer = window.setTimeout(poll, 1200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, task, projectId, onLoginRequired])

  async function submit() {
    const selectedWindow = buildWindowForRange(rangeMode, since, until)
    if (initialTaskId || !repositoryUrl.trim() || !branch.trim() || busy || !rangeIsValid(rangeMode, since, until)) return
    setBusy(true)
    setError('')
    try {
      const inputs = { branch: branch.trim(), ...selectedWindow }
      setTask(projectId
        ? await createDatasetBuild(projectId, inputs)
        : await createUserDatasetBuild({ repositoryUrl: repositoryUrl.trim(), ...inputs }))
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '仓库采集启动失败')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!task || busy) return
    setBusy(true)
    setError('')
    try { setTask(projectId ? await cancelDatasetBuild(projectId, task.taskId) : await cancelUserDatasetBuild(task.taskId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '取消构建失败') }
    finally { setBusy(false) }
  }

  async function retry() {
    if (!task || busy) return
    setBusy(true)
    setError('')
    try {
      const next = projectId ? await retryDatasetBuild(projectId, task.taskId) : await retryUserDatasetBuild(task.taskId)
      setTask(next)
      if (initialTaskId && next.taskId !== initialTaskId) onRetried?.(next.taskId)
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : '重试构建失败') }
    finally { setBusy(false) }
  }

  const active = task ? ACTIVE.includes(task.status) : false
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
      <DialogHeader>
        <DialogTitle>{initialTaskId ? '数据集构建任务' : '从仓库构建数据集'}</DialogTitle>
        <DialogDescription className={initialTaskId ? 'sr-only' : undefined}>{initialTaskId ? '查看构建进度和结果' : '选择公开仓库、分支和采集范围。'}</DialogDescription>
      </DialogHeader>
      {loadingTask ? <p className="text-sm text-foreground-3" role="status">正在读取构建任务…</p> : null}
      {!loadingTask && (!initialTaskId || task) ? <div className="grid gap-4">
        <DatasetBuildFlow task={task}/>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">公开仓库</span><Input aria-label="公开仓库" value={repositoryUrl} onChange={event => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" readOnly={Boolean(projectId || initialTaskId)} disabled={busy || active}/></label>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">分支或提交</span><Input aria-label="构建分支" value={branch} onChange={event => setBranch(event.target.value)} disabled={busy || active || Boolean(initialTaskId)}/></label>
        <DatasetBuildRangeField mode={rangeMode} onModeChange={setRangeMode} since={since} until={until}
          onSinceChange={setSince} onUntilChange={setUntil} disabled={busy || active || Boolean(initialTaskId)}/>
        <DatasetBuildTaskSummary task={task}/>
      </div> : null}
      {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        {error && initialTaskId && !task ? <Button type="button" onClick={() => setAttempt(value => value + 1)} disabled={loadingTask}>重试读取</Button> : null}
        {task && active ? <Button type="button" variant="destructive" onClick={() => void cancel()} disabled={busy}><LoaderCircle className={`${busy ? 'animate-spin' : 'hidden'}`}/>取消任务</Button> : null}
        {task && ['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button type="button" variant="outline" onClick={() => void retry()} disabled={busy}><LoaderCircle className={`${busy ? 'animate-spin' : 'hidden'}`}/>按原参数重试</Button> : null}
        {task?.status === 'completed' && task.datasetVersion ? <Button type="button" onClick={() => { onCompleted(task.datasetVersion!); onOpenChange(false) }}>查看数据</Button> : !initialTaskId ? <Button type="button" disabled={!repositoryUrl.trim() || !branch.trim() || active || busy || !rangeIsValid(rangeMode, since, until)} onClick={() => void submit()}>{busy ? <LoaderCircle className="animate-spin"/> : null}开始构建</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
