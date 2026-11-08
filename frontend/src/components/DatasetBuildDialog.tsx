import { useEffect, useState } from 'react'
import { Button, Input } from '../ui/controls'
import { Dialog } from '../ui/dialog'
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
  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title="从当前项目构建数据集"
    width={620}
    footer={<>
      <Button onClick={() => onOpenChange(false)}>关闭</Button>
      {task && active ? <Button danger loading={busy} onClick={() => void cancel()}>取消任务</Button> : null}
      {task && ['failed', 'cancelled', 'interrupted'].includes(task.status) ? <Button loading={busy} onClick={() => void retry()}>按原参数重试</Button> : null}
      {task?.status === 'completed' && task.datasetName && task.datasetVersion ? <>
        <Button onClick={openDataset}>进入管理工作区查看并训练</Button>
      </> : <Button variant="primary" loading={busy} disabled={!branch.trim() || active} onClick={() => void submit()}>{task ? '用当前参数重新构建' : '开始构建'}</Button>}
    </>}
  >
    <div className="dataset-build-dialog">
      <p className="status-note">只采集公开仓库并登记 Kamei 14 维数据集。不会训练模型、给提交评分或修改项目当前结果。</p>
      <label><span>公开仓库</span><Input value={`已绑定当前项目：${repositoryId.slice(0, 8)}`} disabled readOnly/></label>
      <label><span>分支或提交</span><Input aria-label="数据集构建分支" value={branch} onChange={event => setBranch(event.target.value)} disabled={active}/></label>
      <div className="dataset-build-range">
        <label><span>开始日期（可选）</span><Input aria-label="数据集构建开始日期" type="date" value={since} onChange={event => setSince(event.target.value)} disabled={active}/></label>
        <label><span>结束日期（可选）</span><Input aria-label="数据集构建结束日期" type="date" value={until} min={since || undefined} onChange={event => setUntil(event.target.value)} disabled={active}/></label>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {task ? <section className="dataset-build-task" aria-label="数据集构建任务状态">
        <div className="dataset-build-status">
          <strong>{STATUS_LABELS[task.status] ?? task.status}</strong>
          <span>{STAGE_LABELS[task.stage] ?? task.stage}{task.queuePosition ? ` · 队列 ${task.queuePosition}` : ''}</span>
        </div>
        {task.error ? <div className="admin-error-box" role="alert"><strong>{task.error.code}</strong><p>{task.error.message}</p></div> : null}
        {task.status === 'completed' ? <>
          <dl>
            <div><dt>数据版本</dt><dd><code>{task.datasetVersion}</code></dd></div>
            <div><dt>来源</dt><dd>{task.reused ? '复用同内容版本' : '新登记版本'}</dd></div>
            <div><dt>提交上限</dt><dd>{task.commitLimit.toLocaleString()}</dd></div>
            {task.quality ? <div><dt>纳入 / 正例</dt><dd>{String(task.quality.includedRows ?? '未知')} / {String(task.quality.positiveLabels ?? '未知')}</dd></div> : null}
            <div><dt>来源版本</dt><dd><code>{task.headCommit?.slice(0, 12) ?? '未记录'}</code></dd></div>
          </dl>
          <p className="status-note">数据集已冻结。查看数据集详情并选择训练需要管理员会话；系统不会自动训练或替换当前模型。</p>
        </> : null}
      </section> : null}
      <details>
        <summary>范围与标签限制</summary>
        <p>标签使用行级 SZZ（修复关键词与 issue 引用，删除行回溯到引入提交）；未关联 issue 的修复、纯新增修复与改写历史仍可能漏标。空范围或无法登记的来源会失败，不生成空数据集。命令不接受上传 CSV 或服务器文件路径。</p>
      </details>
    </div>
  </Dialog>
}
