import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEffect, useState } from 'react'


import type { Route } from '../navigation'
import {
  cancelDatasetBuild, createDatasetBuild, getDatasetBuild, listDatasetBuilds, retryDatasetBuild,
  type DatasetBuildTask,
} from '../datasetBuildClient'

const ACTIVE = ['queued', 'running']
const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '构建中', completed: '已完成', failed: '失败',
  cancelled: '已取消', interrupted: '已中断',
}
const STAGE_LABELS: Record<string, string> = {
  queued: '等待单工作器', collecting: '采集中', registering: '登记中',
  completed: '完成', failed: '失败', cancelled: '取消', interrupted: '中断',
}

export function DatasetBuildDialog({
  repositoryId, defaultBranch, open, onOpenChange, navigate,
}: {
  repositoryId: string
  defaultBranch: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  navigate: (route: Route) => void
}) {
  const [branch, setBranch] = useState(defaultBranch ?? 'HEAD')
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
      const latest = items.find(item => ACTIVE.includes(item.status)) ?? items[0] ?? null
      setTask(latest)
      if (latest) {
        setBranch(latest.branch)
        setSince(latest.since?.slice(0, 10) ?? '')
        setUntil(latest.until?.slice(0, 10) ?? '')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '读取数据集构建任务失败')
    })
    return () => controller.abort()
  }, [open, repositoryId])

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
    if (!branch.trim() || busy) return
    setBusy(true); setError('')
    try {
      const started = await createDatasetBuild(repositoryId, {
        branch: branch.trim(), ...(since ? { since } : {}), ...(until ? { until } : {}),
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
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">公开仓库</span><Input value={`已绑定当前项目：${repositoryId.slice(0, 8)}`} disabled readOnly/></label>
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">分支或提交</span><Input aria-label="数据集构建分支" value={branch} onChange={event => setBranch(event.target.value)} disabled={active}/></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">开始日期（可选）</span><Input aria-label="数据集构建开始日期" type="date" value={since} onChange={event => setSince(event.target.value)} disabled={active}/></label>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">结束日期（可选）</span><Input aria-label="数据集构建结束日期" type="date" value={until} min={since || undefined} onChange={event => setUntil(event.target.value)} disabled={active}/></label>
      </div>
      {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      {task ? <section className="grid gap-2 rounded-sm border border-border-soft p-3" aria-label="数据集构建任务状态">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm font-semibold text-foreground">{STATUS_LABELS[task.status] ?? task.status}</strong>
          <span className="text-xs text-foreground-3">{STAGE_LABELS[task.stage] ?? task.stage}{task.queuePosition ? ` · 队列 ${task.queuePosition}` : ''}</span>
        </div>
        {task.error ? <div className="rounded-sm border border-rose/30 bg-rose-soft p-2 text-xs text-rose-deep" role="alert"><strong>{task.error.code}</strong><p className="mt-0.5">{task.error.message}</p></div> : null}
        {task.status === 'completed' ? <>
          <dl className="grid gap-1.5 sm:grid-cols-2">
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-sm"><dt className="text-xs text-foreground-3">数据版本</dt><dd className="m-0 break-all"><code className="font-mono text-xs">{task.datasetVersion}</code></dd></div>
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-sm"><dt className="text-xs text-foreground-3">来源</dt><dd className="m-0">{task.reused ? '复用同内容版本' : '新登记版本'}</dd></div>
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-sm"><dt className="text-xs text-foreground-3">提交上限</dt><dd className="m-0">{task.commitLimit.toLocaleString()}</dd></div>
            {task.quality ? <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-sm"><dt className="text-xs text-foreground-3">纳入 / 正例</dt><dd className="m-0">{String(task.quality.includedRows ?? '未知')} / {String(task.quality.positiveLabels ?? '未知')}</dd></div> : null}
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-sm sm:col-span-2"><dt className="text-xs text-foreground-3">来源版本</dt><dd className="m-0 break-all"><code className="font-mono text-xs">{task.headCommit?.slice(0, 12) ?? '未记录'}</code></dd></div>
          </dl>
          <p className="text-xs leading-body text-foreground-3">数据集已冻结。查看数据集详情并选择训练需要管理员会话；系统不会自动训练或替换当前模型。</p>
        </> : null}
      </section> : null}
      <details className="rounded-sm border border-border-soft">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground-2">范围与标签限制</summary>
        <p className="border-t border-border-soft p-3 text-xs leading-body text-foreground-3">标签使用完整 SZZ（优先 issue/PR 关联，关键词兜底，删除行回溯到引入提交）；未关联 issue、纯新增修复与改写历史仍可能漏标。空范围或无法登记的来源会失败，不生成空数据集。命令不接受上传 CSV 或服务器文件路径。</p>
      </details>
    </div><DialogFooter>{<>
      <Button onClick={() => onOpenChange(false)} variant="outline" type="button">关闭</Button>
      {task && active ? <Button onClick={() => void cancel()} variant="destructive" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}取消任务</Button> : null}
      {task && ['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button onClick={() => void retry()} variant="outline" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}按原参数重试</Button> : null}
      {task?.status === 'completed' && task.datasetName && task.datasetVersion ? <>
        <Button onClick={openDataset} variant="outline" type="button">进入管理工作区查看并训练</Button>
      </> : <Button variant='default' disabled={Boolean(!branch.trim() || active) || Boolean(busy)} onClick={() => void submit()} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}{task ? '用当前参数重新构建' : '开始构建'}</Button>}
    </>}</DialogFooter></DialogContent></Dialog>
}
