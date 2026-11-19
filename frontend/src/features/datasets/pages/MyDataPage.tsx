import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { GitBranch, LoaderCircle, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  deleteUserDataset, exportDataset, splitPreview,
  userDatasets, useUserRevision, type UserDataset, type UserSplitPreview,
} from '@/features/account/userClient'
import { EmptyState } from '@/components/shared/Feedback'
import { MasterDetailSkeleton } from '@/components/shared/Skeletons'
import type { Route } from '@/app/navigation'
import { DatasetImportDialog } from '@/features/datasets/components/DatasetImportDialog'
import { DatasetCurationDialog } from '@/features/datasets/components/DatasetCurationDialog'
import { RepositoryDatasetBuildDialog } from '@/features/datasets/components/RepositoryDatasetBuildDialog'
import {
  cancelUserDatasetBuild, listUserDatasetBuilds, retryUserDatasetBuild, type DatasetBuildTask,
} from '@/features/datasets/datasetBuildClient'
import { BuildTaskList, DatasetRowList } from '@/features/datasets/mydata/DatasetLists'
import { DatasetDetail } from '@/features/datasets/mydata/DatasetDetail'
import {
  BUILD_ACTIVE, DEFAULT_PRESET, matchesQuery, type DatasetTab,
} from '@/features/datasets/mydata/format'

export function MyDataPage({ navigate, onLoginRequired, initialTab, initialTaskId }: {
  navigate: (route: Route) => void
  onLoginRequired: () => void
  initialTab?: 'builds'
  initialTaskId?: string
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [selected, setSelected] = useState('')
  const [preferred, setPreferred] = useState('')
  const [tab, setTab] = useState<DatasetTab>(initialTab ?? 'mine')
  const [query, setQuery] = useState('')
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
  const [curationOpen, setCurationOpen] = useState(false)
  const completedTasks = useRef(new Set<string>())
  const tabInitialized = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    userDatasets('usable', controller.signal).then(value => {
      if (controller.signal.aborted) return
      setDatasets(value)
      if (!tabInitialized.current && !initialTab) {
        setTab(value.some(item => item.mine) ? 'mine' : 'shared')
        tabInitialized.current = true
      }
      setSelected(current => value.find(item => item.version === preferred)?.version
        ?? (value.some(item => item.version === current) ? current : (value.find(item => item.mine) ?? value[0])?.version ?? ''))
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '数据读取失败')
    })
    return () => controller.abort()
  }, [initialTab, onLoginRequired, userRevision, reload, preferred])

  useEffect(() => {
    if (!initialTab) return
    tabInitialized.current = true
    setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (!initialTaskId) return
    tabInitialized.current = true
    setTab('builds')
    setBuildOpen(true)
  }, [initialTaskId])

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
    if (!current) {
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
  }, [current?.version])

  function changeTab(next: DatasetTab) {
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
      setPreferred('')
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

  function imported(dataset: UserDataset) {
    setPreferred(dataset.version)
    setTab('mine')
    setReload(value => value + 1)
    setNotice('CSV 已导入')
  }

  function openBuiltDataset(version: string) {
    setPreferred(version)
    setTab('mine')
    setReload(value => value + 1)
    setNotice('已定位到构建完成的数据')
  }

  const header = <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border-soft pb-4">
    <div className="flex items-baseline gap-3">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">我的数据</h1>
      <span className="text-xs text-foreground-3">自有 {mine.length}/5</span>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload aria-hidden="true" size={15}/>导入 CSV</Button>
      <Button type="button" size="sm" onClick={() => { setBuildSeed(null); setBuildOpen(true) }}><GitBranch aria-hidden="true" size={15}/>从仓库构建</Button>
    </div>
  </header>

  if (datasets === null) return <section className="grid gap-4">
    {header}
    {error ? <div className="grid justify-items-start gap-2"><p className="text-xs text-rose" role="alert">{error}</p><Button onClick={onLoginRequired} variant="outline" type="button">登录后重试</Button></div>
      : <MasterDetailSkeleton label="正在读取我的数据"/>}
  </section>

  return <section className="flex flex-col gap-4 lg:h-[calc(100vh-8.25rem)] lg:overflow-hidden">
    {header}
    {error ? <div className="rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">{error}</div> : null}
    {notice ? <div className="rounded-lg border border-teal/20 bg-teal-soft px-3 py-2 text-xs text-teal-deep" role="status">{notice}</div> : null}
    {taskError ? <div className="rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">{taskError}</div> : null}
    {!datasets.length && tab !== 'builds' ? <EmptyState title="还没有数据" description="导入自己的 CSV，或从任意公开仓库构建数据集；这两条路径都不会自动建立项目或开始训练。"/> : <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[310px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="min-h-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
          <div className="grid gap-2 border-b border-border-soft p-2">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1" role="tablist" aria-label="数据视图">
              {([
                ['mine', '我的', mine.length],
                ['shared', '共享', shared.length],
                ['builds', '构建', buildTasks?.length ?? 0],
              ] as const).map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={cn('rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  tab === id ? 'bg-card text-foreground shadow-sm' : 'text-foreground-3 hover:text-foreground')}
                onClick={() => changeTab(id)}>
                {label}<span className={cn('ml-1 text-[10px]', tab === id ? 'text-foreground-3' : 'text-foreground-4')}>{count}</span>
              </button>)}
            </div>
            {tab !== 'builds' ? <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-4" size={14}/>
              <Input value={query} onChange={event => setQuery(event.target.value)} className="h-8 pl-8 text-xs" placeholder="搜索数据集" aria-label="搜索数据集"/>
            </div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-2">
            {tab === 'builds'
              ? buildTasks === null ? <p className="px-3 py-8 text-center text-xs text-foreground-3">正在读取构建任务…</p>
                : <BuildTaskList tasks={buildTasks} busyTaskId={taskBusy} onOpen={openBuiltDataset} onAction={(task, action) => void actOnBuild(task, action)}/>
              : <DatasetRowList items={visibleDatasets} selected={selected} onSelect={setSelected}/>}
          </div>
          <div className="border-t border-border-soft px-3 py-2 text-[11px] text-foreground-4">每人最多保留 5 个自有版本</div>
        </div>
      </aside>
      <div className="grid min-h-0 min-w-0 auto-rows-max content-start gap-4 overflow-x-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:[scrollbar-gutter:stable]" data-scroll-region="dataset-detail" tabIndex={0} aria-label="数据详情">
        {current ? <DatasetDetail dataset={current} preview={preview} previewError={previewError} busy={busy} actions={{
          onTrain: () => navigate({ name: 'my-training', datasetVersion: current.version }),
          onExport: () => exportDataset(current.version),
          onCuration: () => setCurationOpen(true),
          onDelete: () => setConfirmDelete(true),
          onRebuild: (repositoryUrl, branch) => { setBuildSeed({ repositoryUrl, branch }); setBuildOpen(true) },
        }}/> : <EmptyState title="选择一个数据版本" description="从左侧查看来源、质量、标签、文件与训练准入。"/>}
      </div>
    </div>}
    <DatasetImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={imported} onLoginRequired={onLoginRequired}/>
    <RepositoryDatasetBuildDialog initialTaskId={initialTaskId} open={buildOpen} onOpenChange={open => {
      setBuildOpen(open)
      if (!open) {
        setTaskRevision(value => value + 1)
        setBuildSeed(null)
      }
    }} onCompleted={version => {
      setPreferred(version)
      setTab('mine')
      setReload(value => value + 1)
      setNotice('仓库数据集已完成')
    }} onLoginRequired={onLoginRequired} initialRepositoryUrl={buildSeed?.repositoryUrl} initialBranch={buildSeed?.branch}/>
    <DatasetCurationDialog open={curationOpen} onOpenChange={setCurationOpen} dataset={current} onDerived={version => {
      setPreferred(version)
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
