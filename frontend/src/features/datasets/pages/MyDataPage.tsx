import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { GitBranch, LoaderCircle, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/apiContract'
import {
  deleteUserDataset, exportDataset, splitPreview,
  userDatasets, useUserRevision, type UserDataset, type UserSplitPreview,
} from '@/features/account/userClient'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import type { Route } from '@/app/navigation'
import { DatasetImportDialog } from '@/features/datasets/components/DatasetImportDialog'
import { DatasetImportStatusDialog } from '@/features/datasets/components/DatasetImportStatusDialog'
import { datasetImportJobsKey, useDatasetImportJobs, type DatasetImportTask } from '@/features/datasets/datasetImportClient'
import { DatasetCurationDialog } from '@/features/datasets/components/DatasetCurationDialog'
import { RepositoryDatasetBuildDialog } from '@/features/datasets/components/RepositoryDatasetBuildDialog'
import { useRepository } from '@/features/projects/repositoryWorkspace'
import {
  cancelUserDatasetBuild, listUserDatasetBuilds, retryUserDatasetBuild, type DatasetBuildTask,
} from '@/features/datasets/datasetBuildClient'
import { BuildTaskList, DatasetRowList } from '@/features/datasets/mydata/DatasetLists'
import { DatasetDetail } from '@/features/datasets/mydata/DatasetDetail'
import {
  BUILD_ACTIVE, DEFAULT_PRESET, matchesQuery, type DatasetTab,
} from '@/features/datasets/mydata/format'

export function MyDataPage({ account = null, navigate, onLoginRequired, initialTab, initialTaskId, buildProjectId, importHistory, importTaskId }: {
  account?: string | null
  navigate: (route: Route, replace?: boolean) => void
  onLoginRequired: () => void
  initialTab?: 'builds'
  initialTaskId?: string
  buildProjectId?: string
  importHistory?: boolean
  importTaskId?: string
}) {
  const queryClient = useQueryClient()
  const importJobs = useDatasetImportJobs(account)
  const latestImported = importJobs.data?.find(task => task.status === 'completed')?.taskId
  const importBackendTooOld = importJobs.error instanceof ApiError && [404, 405].includes(importJobs.error.status)
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [selected, setSelected] = useState('')
  const [preferred, setPreferred] = useState<{ version: string; fromBuild?: boolean } | null>(null)
  const [tab, setTab] = useState<DatasetTab>(initialTab ?? 'mine')
  const [query, setQuery] = useState('')
  const [datasetLimit, setDatasetLimit] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<UserSplitPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState(false)
  const [taskBusy, setTaskBusy] = useState('')
  const [taskError, setTaskError] = useState('')
  const [buildTasks, setBuildTasks] = useState<DatasetBuildTask[] | null>(null)
  const [taskRevision, setTaskRevision] = useState(0)
  const userRevision = useUserRevision()
  const [reload, setReload] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [buildOpen, setBuildOpen] = useState(false)
  const [buildSeed, setBuildSeed] = useState<{ repositoryUrl: string; branch: string } | null>(null)
  const projectSeed = useRepository(buildOpen && buildProjectId && !initialTaskId ? buildProjectId : '')
  const [curationOpen, setCurationOpen] = useState(false)
  const completedTasks = useRef(new Set<string>())
  const tabInitialized = useRef(false)
  const viewingDatasets = tab !== 'builds'

  useEffect(() => {
    if (!viewingDatasets) return
    const controller = new AbortController()
    userDatasets('usable', controller.signal).then(({ datasets: items, limit }) => {
      if (controller.signal.aborted) return
      setDatasets(items)
      setDatasetLimit(limit)
      setError('')
      if (!tabInitialized.current) {
        setTab(items.some(item => item.mine) ? 'mine' : 'shared')
        tabInitialized.current = true
      }
      const requested = items.find(item => item.version === preferred?.version)
      if (preferred?.fromBuild) {
        if (requested) {
          setTab(requested.mine ? 'mine' : 'shared')
          setNotice('已打开构建完成的数据')
        } else {
          setSelected('')
          setNotice('当前账户的数据列表中没有这份构建产物。')
          return
        }
      }
      setSelected(current => requested?.version
        ?? (items.some(item => item.version === current) ? current : (items.find(item => item.mine) ?? items[0])?.version ?? ''))
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else {
        if (preferred?.fromBuild) setNotice('')
        setError(failure instanceof Error ? failure.message : '数据读取失败')
      }
    })
    return () => controller.abort()
  }, [viewingDatasets, onLoginRequired, userRevision, reload, preferred, latestImported])

  useEffect(() => {
    if (!initialTab) return
    tabInitialized.current = true
    setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (!initialTaskId && !buildProjectId) return
    tabInitialized.current = true
    setTab('builds')
    setBuildSeed(null)
    setBuildOpen(true)
  }, [initialTaskId, buildProjectId])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    async function load() {
      try {
        const items = await listUserDatasetBuilds(controller.signal)
        if (controller.signal.aborted) return
        setBuildTasks(items)
        setTaskError('')
        let newlyCompleted = false
        for (const item of items) {
          if (item.status === 'completed' && item.datasetVersion && !completedTasks.current.has(item.taskId)) {
            completedTasks.current.add(item.taskId)
            newlyCompleted = true
          }
        }
        if (newlyCompleted) setReload(value => value + 1)
        if (items.some(item => BUILD_ACTIVE.has(item.status))) timer = setTimeout(load, 3000)
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setTaskError(failure instanceof Error ? failure.message : '构建任务读取失败')
      }
    }
    void load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [onLoginRequired, reload, taskRevision, userRevision])

  const current = useMemo(() => datasets?.find(item => item.version === selected) ?? null, [datasets, selected])
  const mine = useMemo(() => datasets?.filter(item => item.mine) ?? [], [datasets])
  const shared = useMemo(() => datasets?.filter(item => !item.mine) ?? [], [datasets])
  const normalizedQuery = query.trim().toLowerCase()
  const visibleDatasets = useMemo(() => (tab === 'mine' ? mine : tab === 'shared' ? shared : [])
    .filter(item => matchesQuery(item, normalizedQuery)), [mine, normalizedQuery, shared, tab])

  useEffect(() => {
    if (!current || tab === 'builds') {
      setPreview(null)
      setPreviewError('')
      return
    }
    const controller = new AbortController()
    setPreview(null)
    setPreviewError('')
    splitPreview(current.version, DEFAULT_PRESET, controller.signal).then(value => {
      if (!controller.signal.aborted) setPreview(value)
    }).catch(failure => {
      if (!controller.signal.aborted) setPreviewError(failure instanceof Error ? failure.message : '训练准入读取失败')
    })
    return () => controller.abort()
  }, [current?.version, tab])

  function changeTab(next: DatasetTab) {
    tabInitialized.current = true
    setPreferred(null)
    setTab(next)
    if (next === 'builds') return
    const pool = next === 'mine' ? mine : shared
    setSelected(pool.some(item => item.version === selected) ? selected : pool[0]?.version ?? '')
  }

  async function removeVersion() {
    if (!current) return
    setBusy(true)
    setError('')
    setNotice('')
    setConfirmDelete(false)
    try {
      await deleteUserDataset(current.version)
      setPreferred(null)
      setReload(value => value + 1)
      setPreview(null)
      setNotice('数据版本已删除')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  async function actOnBuild(task: DatasetBuildTask, action: 'cancel' | 'retry') {
    setTaskBusy(task.taskId)
    setTaskError('')
    try {
      await (action === 'cancel' ? cancelUserDatasetBuild(task.taskId) : retryUserDatasetBuild(task.taskId))
      setTaskRevision(value => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setTaskError(failure instanceof Error ? failure.message : '构建任务操作失败')
    } finally {
      setTaskBusy('')
    }
  }

  function openImportTask(taskId?: string) {
    navigate({ name: 'my-data', view: 'imports', ...(taskId ? { taskId } : {}) })
  }

  function importStarted(task: DatasetImportTask) {
    const key = datasetImportJobsKey(account)
    queryClient.setQueryData([...key, task.taskId], task)
    queryClient.setQueryData<DatasetImportTask[]>(key, items =>
      [task, ...(items ?? []).filter(item => item.taskId !== task.taskId)])
    void queryClient.invalidateQueries({ queryKey: key })
    openImportTask(task.taskId)
  }

  function openImportedVersion(version: string) {
    setPreferred({ version })
    setQuery('')
    setTab('mine')
    setReload(value => value + 1)
    navigate({ name: 'my-data' }, true)
  }

  function openBuiltDataset(version: string) {
    setError('')
    setPreferred({ version, fromBuild: true })
    setTab('mine')
    setNotice('正在定位构建产物…')
  }

  function closeBuild() {
    setBuildOpen(false)
    setBuildSeed(null)
    setTaskRevision(value => value + 1)
    if (buildProjectId || initialTaskId) navigate({ name: 'my-data' }, true)
  }

  const waitingForProject = Boolean(buildProjectId && !initialTaskId && !projectSeed.repository)
  const buildDialog = buildOpen && !waitingForProject ? <RepositoryDatasetBuildDialog
    key={initialTaskId ?? buildProjectId ?? 'new'}
    open={buildOpen}
    initialTaskId={initialTaskId}
    projectId={buildProjectId}
    onOpenChange={open => { if (!open) closeBuild() }}
    onCompleted={openBuiltDataset}
    onRetried={taskId => navigate({ name: 'my-data', view: 'builds', taskId, ...(buildProjectId ? { buildProjectId } : {}) }, true)}
    onLoginRequired={onLoginRequired}
    initialRepositoryUrl={projectSeed.repository?.url ?? buildSeed?.repositoryUrl}
    initialBranch={projectSeed.repository ? projectSeed.repository.defaultBranch ?? 'HEAD' : buildSeed?.branch}
  /> : null
  const projectStatus = buildOpen && waitingForProject ? <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-3">
    {projectSeed.state === 'error' ? <>
      <p role="alert">项目读取失败。{projectSeed.error}</p>
      <Button type="button" variant="outline" size="sm" onClick={projectSeed.retry}>重试读取项目</Button>
    </> : <p role="status">正在读取项目仓库…</p>}
    <Button type="button" variant="ghost" size="sm" onClick={closeBuild}>取消预填</Button>
  </div> : null

  const header = <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border-soft pb-4">
    <div className="flex items-baseline gap-3">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">我的数据</h1>
      {datasets ? <span className="text-xs text-foreground-3">自有 {mine.length}{datasetLimit != null ? `/${datasetLimit}` : ''}</span> : null}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={() => openImportTask()}>导入记录</Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload aria-hidden="true" size={15}/>导入数据集</Button>
      <Button type="button" size="sm" onClick={() => { setBuildSeed(null); setBuildOpen(true) }}><GitBranch aria-hidden="true" size={15}/>从仓库构建</Button>
    </div>
  </header>

  return <section className="flex flex-col gap-4 lg:h-[calc(100vh-8.25rem)] lg:overflow-hidden">
    {header}
    {projectStatus}
    {notice ? <div className="rounded-lg border border-teal/20 bg-teal-soft px-3 py-2 text-xs text-teal-deep" role="status">{notice}</div> : null}
    {viewingDatasets && error ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep">
      <p role="alert">{error}</p>
      <Button onClick={() => { setError(''); setReload(value => value + 1) }} variant="outline" size="sm" type="button">重新读取数据</Button>
    </div> : null}
    {!viewingDatasets && taskError ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep">
      <p role="alert">{taskError}</p>
      <Button onClick={() => { setTaskError(''); setTaskRevision(value => value + 1) }} variant="outline" size="sm" type="button">重新读取任务</Button>
    </div> : null}
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[310px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="min-h-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
          <div className="grid gap-2 border-b border-border-soft p-2">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1" role="tablist" aria-label="数据视图">
              {([
                ['mine', '我的', datasets ? mine.length : null],
                ['shared', '共享', datasets ? shared.length : null],
                ['builds', '构建', buildTasks?.length ?? null],
              ] as const).map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={cn('rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  tab === id ? 'bg-card text-foreground shadow-sm' : 'text-foreground-3 hover:text-foreground')}
                onClick={() => changeTab(id)}>
                {label}{count !== null ? <span className={cn('ml-1 text-[10px]', tab === id ? 'text-foreground-3' : 'text-foreground-4')}>{count}</span> : null}
              </button>)}
            </div>
            {viewingDatasets && Boolean(datasets?.length) ? <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-4" size={14}/>
              <Input value={query} onChange={event => setQuery(event.target.value)} className="h-8 pl-8 text-xs" placeholder="搜索数据集" aria-label="搜索数据集"/>
            </div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-2">
            {tab === 'builds'
              ? buildTasks === null ? taskError ? null : <LoadingNotice label="正在读取构建任务" prefix={false}/>
                : <BuildTaskList tasks={buildTasks} busyTaskId={taskBusy} onOpen={openBuiltDataset}
                  onInspect={taskId => navigate({ name: 'my-data', view: 'builds', taskId })}
                  onAction={(task, action) => void actOnBuild(task, action)}/>
              : datasets === null ? error ? null : <LoadingNotice label="正在读取我的数据" prefix={false}/>
              : datasets.length ? <DatasetRowList items={visibleDatasets} selected={selected} onSelect={version => { setPreferred(null); setSelected(version) }}/> : null}
          </div>
        </div>
      </aside>
      <div className="grid min-h-0 min-w-0 auto-rows-max content-start gap-4 overflow-x-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:[scrollbar-gutter:stable]" data-scroll-region="dataset-detail" tabIndex={0} role="region" aria-label={tab === 'builds' ? '构建任务' : '数据详情'}>
        {tab === 'builds' ? <EmptyState title="构建任务" description="选择任务查看进度、重试或打开已生成的数据。"/> : current ? <DatasetDetail dataset={current} preview={preview} previewError={previewError} busy={busy} actions={{
          onTrain: () => navigate({ name: 'my-training', datasetVersion: current.version }),
          onPredict: () => navigate({ name: 'my-predictions', datasetVersion: current.version }),
          onExport: () => exportDataset(current.version),
          onCuration: () => setCurationOpen(true),
          onDelete: () => setConfirmDelete(true),
          onRebuild: (repositoryUrl, branch) => { setBuildSeed({ repositoryUrl, branch }); setBuildOpen(true) },
        }}/> : datasets?.length === 0 ? <EmptyState title="还没有数据" description="可以导入 CSV、Kamei 2013 ZIP，或从公开仓库构建。"/>
          : datasets ? <EmptyState title="选择一个数据版本"/> : null}
      </div>
    </div>
    <DatasetImportDialog open={importOpen} onOpenChange={setImportOpen} onStarted={importStarted}
      onLoginRequired={onLoginRequired} backendTooOld={importBackendTooOld}/>
    {importHistory ? <DatasetImportStatusDialog account={account} taskId={importTaskId} onLoginRequired={onLoginRequired}
      onClose={() => navigate({ name: 'my-data' }, true)} onInspect={openImportTask} onHistory={() => openImportTask()}
      onChooseFile={() => { navigate({ name: 'my-data' }, true); setImportOpen(true) }}
      onViewVersion={openImportedVersion}/> : null}
    {buildDialog}
    <DatasetCurationDialog key={`${current?.version ?? 'none'}:${curationOpen ? 'open' : 'closed'}`} open={curationOpen} onOpenChange={setCurationOpen} dataset={current} onDerived={version => {
      setPreferred({ version })
      setTab('mine')
      setReload(value => value + 1)
      setNotice('已生成清洗版本')
    }} onLoginRequired={onLoginRequired}/>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent className="max-h-[90vh] overflow-auto" style={{ width: 'min(92vw, 460px)', maxWidth: 'none' }}>
        <AlertDialogHeader><AlertDialogTitle>删除这个数据版本？</AlertDialogTitle><AlertDialogDescription>会删除该版本的登记、提交特征和文件，无法恢复；被模型或分析引用的版本会被拒绝。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><Button onClick={() => setConfirmDelete(false)} variant="outline" type="button">取消</Button><Button variant="destructive" onClick={() => void removeVersion()} disabled={busy} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}确认删除</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}
