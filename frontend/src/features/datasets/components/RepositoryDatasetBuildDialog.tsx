import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  cancelUserDatasetBuild, createUserDatasetBuild, getUserDatasetBuild, listUserDatasetBuilds,
  retryUserDatasetBuild, type DatasetBuildTask,
} from '@/features/datasets/datasetBuildClient'
import {
  DatasetBuildFlow, DatasetBuildRangeField, DatasetBuildTaskSummary,
} from '@/features/datasets/components/DatasetBuildParts'
import {
  buildWindowForRange, rangeIsValid, type DatasetBuildRangeMode,
} from '@/features/datasets/components/DatasetBuildRange'

const ACTIVE = ['queued', 'running']

export function RepositoryDatasetBuildDialog({ open, onOpenChange, onCompleted, onLoginRequired, initialRepositoryUrl, initialBranch, initialTaskId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: (datasetVersion: string) => void
  onLoginRequired: () => void
  initialRepositoryUrl?: string
  initialBranch?: string
  initialTaskId?: string
}) {
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [rangeMode, setRangeMode] = useState<DatasetBuildRangeMode>('all')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [task, setTask] = useState<DatasetBuildTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError('')
    listUserDatasetBuilds(controller.signal).then(items => {
      if (controller.signal.aborted) return
      const selected = (initialTaskId ? items.find(item => item.taskId === initialTaskId) : undefined)
        ?? items.find(item => ACTIVE.includes(item.status))
      if (selected) {
        setTask(selected)
        setRepositoryUrl(selected.repositoryUrl)
        setBranch(selected.branch)
        setRangeMode('custom')
        setSince(selected.since?.slice(0, 10) ?? '')
        setUntil(selected.until?.slice(0, 10) ?? '')
      } else {
        setTask(null)
        setRangeMode('all')
        setSince('')
        setUntil('')
        setRepositoryUrl(initialRepositoryUrl ?? '')
        setBranch(initialBranch ?? 'main')
      }
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '构建任务读取失败')
    })
    return () => controller.abort()
  }, [open, onLoginRequired, initialRepositoryUrl, initialBranch, initialTaskId])

  useEffect(() => {
    if (!open || !task || !ACTIVE.includes(task.status)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      getUserDatasetBuild(task.taskId, controller.signal).then(next => {
        if (!controller.signal.aborted) setTask(next)
      }).catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '构建任务刷新失败')
      })
    }, 1200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, task])

  async function submit() {
    const selectedWindow = buildWindowForRange(rangeMode, since, until)
    if (!repositoryUrl.trim() || !branch.trim() || busy || !rangeIsValid(rangeMode, since, until)) return
    setBusy(true)
    setError('')
    try {
      setTask(await createUserDatasetBuild({
        repositoryUrl: repositoryUrl.trim(),
        branch: branch.trim(),
        ...selectedWindow,
      }))
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
    try { setTask(await cancelUserDatasetBuild(task.taskId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '取消构建失败') }
    finally { setBusy(false) }
  }

  async function retry() {
    if (!task || busy) return
    setBusy(true)
    setError('')
    try { setTask(await retryUserDatasetBuild(task.taskId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '重试构建失败') }
    finally { setBusy(false) }
  }

  const active = task ? ACTIVE.includes(task.status) : false
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto" style={{ width: 'min(92vw, 620px)', maxWidth: 'none' }}>
      <DialogHeader><DialogTitle>从仓库构建数据集</DialogTitle></DialogHeader>
      <div className="grid gap-4">
        <p className="rounded-sm bg-sunken px-3 py-2 text-xs leading-body text-foreground-3">只采集公开仓库，不新建项目、不分析 PR、不训练模型。构建完成后会出现在“我的数据”。</p>
        <DatasetBuildFlow task={task}/>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">公开仓库</span><Input aria-label="公开仓库" value={repositoryUrl} onChange={event => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" disabled={active}/></label>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">分支或提交</span><Input aria-label="构建分支" value={branch} onChange={event => setBranch(event.target.value)} disabled={active}/></label>
        <DatasetBuildRangeField mode={rangeMode} onModeChange={setRangeMode} since={since} until={until}
          onSinceChange={setSince} onUntilChange={setUntil} disabled={active}/>
        {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
        <DatasetBuildTaskSummary task={task}/>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        {task && active ? <Button type="button" variant="destructive" onClick={() => void cancel()} disabled={busy}><LoaderCircle className={`${busy ? 'animate-spin' : 'hidden'}`}/>取消任务</Button> : null}
        {task && ['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button type="button" variant="outline" onClick={() => void retry()} disabled={busy}><LoaderCircle className={`${busy ? 'animate-spin' : 'hidden'}`}/>按原参数重试</Button> : null}
        {task?.status === 'completed' && task.datasetVersion ? <Button type="button" onClick={() => { onCompleted(task.datasetVersion!); onOpenChange(false) }}>查看数据</Button> : <Button type="button" disabled={!repositoryUrl.trim() || !branch.trim() || active || busy || !rangeIsValid(rangeMode, since, until)} onClick={() => void submit()}>{busy ? <LoaderCircle className="animate-spin"/> : undefined}开始构建</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
