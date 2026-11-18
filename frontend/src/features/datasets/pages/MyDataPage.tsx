import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock3, Database, ExternalLink,
  FileArchive, GitBranch, LoaderCircle, Search, ShieldAlert, Trash2, Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  deleteUserDataset, exportDataset, splitPreview,
  userDatasets, useUserRevision, type UserDataset, type UserSplitPreview,
} from '@/features/account/userClient'
import { formatDate, valueLabel, type Row } from '@/features/admin/adminContracts'
import { EmptyState } from '@/components/shared/Feedback'
import { MasterDetailSkeleton } from '@/components/shared/Skeletons'
import type { Route } from '@/app/navigation'
import { DatasetImportDialog } from '@/features/datasets/components/DatasetImportDialog'
import { DatasetCurationDialog } from '@/features/datasets/components/DatasetCurationDialog'
import { RepositoryDatasetBuildDialog } from '@/features/datasets/components/RepositoryDatasetBuildDialog'
import {
  cancelUserDatasetBuild, listUserDatasetBuilds, retryUserDatasetBuild, type DatasetBuildTask,
} from '@/features/datasets/datasetBuildClient'

const DEFAULT_PRESET = 'temporal-70-15-15'
const BUILD_ACTIVE = new Set(['queued', 'running'])
const BUILD_RETRYABLE = new Set(['failed', 'cancelled', 'interrupted'])
const BUILD_STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '构建中', completed: '已完成', failed: '失败',
  cancelled: '已取消', interrupted: '已中断',
}
const BUILD_STAGE_LABELS: Record<string, string> = {
  queued: '等待采集', collecting: '采集中', registering: '登记中',
  completed: '完成', failed: '失败', cancelled: '取消', interrupted: '中断',
}
const EXCLUSION_LABELS: Record<string, string> = {
  empty: '空提交', merges: '合并提交', outsideWindow: '时间窗口外', unparsed: '无法解析',
  noAddedLines: '无新增行', tooManyFiles: '文件过多', tooMuchChurn: '改动过大',
  missingRequiredField: '缺少必需字段',
}
const LABEL_STATUS_LABELS: Record<string, string> = {
  positive: '正例', immature: '未成熟', unobserved: '观察后未见修复', unknown: '状态未知',
}
type DatasetTab = 'mine' | 'shared' | 'builds'

function usageLabel(usage: string): string {
  return usage === 'import' ? 'CSV 导入' : usage === 'pr' ? 'PR 采集' : '仓库采集'
}

function timestampLabel(item: UserDataset): string {
  if (item.timestamps.builtAt) return `构建 ${formatDate(item.timestamps.builtAt)}`
  if (item.timestamps.importedAt) return `导入 ${formatDate(item.timestamps.importedAt)}`
  if (item.timestamps.ownedAt) return `归属 ${formatDate(item.timestamps.ownedAt)}`
  if (item.timestamps.registeredAt) return `登记 ${formatDate(item.timestamps.registeredAt)}`
  return '时间未记录'
}

function asRow(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numberText(value: unknown): string {
  const parsed = numeric(value)
  return parsed == null ? valueLabel(value) : parsed.toLocaleString('zh-CN')
}

function ratioText(part: number | null, total: number | null): string | null {
  if (part == null || total == null || total <= 0) return null
  return `${(part / total * 100).toFixed(1)}%`
}

function bytesText(value: unknown): string {
  const bytes = numeric(value)
  if (bytes == null) return valueLabel(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function commitText(value: unknown): string {
  return typeof value === 'string' ? (value.length > 12 ? value.slice(0, 12) : value) : ''
}

function repositoryLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    return path || url
  } catch {
    return url
  }
}

function matchesQuery(item: UserDataset, query: string): boolean {
  if (!query) return true
  const source = typeof item.source.url === 'string' ? item.source.url : ''
  return `${item.dataset} ${item.version} ${source}`.toLowerCase().includes(query)
}

function DatasetRowList({ items, selected, onSelect }: {
  items: UserDataset[]
  selected: string
  onSelect: (version: string) => void
}) {
  if (!items.length) return <div className="grid justify-items-center gap-2 px-3 py-10 text-center">
    <Database aria-hidden="true" className="text-foreground-4" size={22} strokeWidth={1.5}/>
    <p className="text-xs text-foreground-3">没有匹配的数据版本</p>
  </div>
  return <div className="grid gap-1" role="listbox" aria-label="数据版本">
    {items.map(item => {
      const active = item.version === selected
      return <button key={item.version} type="button" role="option" aria-selected={active}
        className={cn(
          'group relative w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          active ? 'bg-accent-soft/70' : 'hover:bg-sunken',
        )}
        onClick={() => onSelect(item.version)}>
        {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true"/> : null}
        <span className="flex items-start justify-between gap-2">
          <strong className="min-w-0 truncate text-sm font-medium text-foreground">{item.dataset}</strong>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-foreground-4">
            {numberText(item.quality.includedRows)}
            {active ? <ChevronRight aria-hidden="true" size={13}/> : null}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-foreground-3">
          <span>{usageLabel(item.usage)}</span>
          <span className="text-foreground-4">·</span>
          <span>{numberText(item.quality.includedRows)} 行</span>
          <span className="text-foreground-4">·</span>
          <span>{numberText(item.quality.positiveLabels)} 正例</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-foreground-4">{timestampLabel(item)}</span>
      </button>
    })}
  </div>
}

function BuildTaskList({ tasks, busyTaskId, onOpen, onAction }: {
  tasks: DatasetBuildTask[]
  busyTaskId: string
  onOpen: (version: string) => void
  onAction: (task: DatasetBuildTask, action: 'cancel' | 'retry') => void
}) {
  if (!tasks.length) return <div className="grid justify-items-center gap-2 px-3 py-10 text-center">
    <Clock3 aria-hidden="true" className="text-foreground-4" size={22} strokeWidth={1.5}/>
    <p className="text-xs text-foreground-3">暂无构建任务</p>
  </div>
  return <div className="grid gap-2" aria-label="最近构建">
    <p className="px-2 pt-1 text-xs font-medium text-foreground-3">最近构建</p>
    {tasks.slice(0, 8).map(task => {
      const active = BUILD_ACTIVE.has(task.status)
      const retryable = BUILD_RETRYABLE.has(task.status)
      return <div key={task.taskId} className="grid gap-2 rounded-lg border border-border-soft bg-sunken/60 p-3 text-xs">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('size-1.5 shrink-0 rounded-full', task.status === 'completed' ? 'bg-teal' : task.status === 'failed' ? 'bg-rose' : active ? 'bg-amber' : 'bg-foreground-4')} aria-hidden="true"/>
            <strong className="truncate text-sm font-medium text-foreground">{repositoryLabel(task.repositoryUrl)}</strong>
          </span>
          <span className="shrink-0 text-[11px] text-foreground-3">{BUILD_STATUS_LABELS[task.status] ?? task.status}</span>
        </div>
        <span className="truncate text-[11px] text-foreground-4">{task.branch} · {formatDate(task.createdAt)}</span>
        {active ? <span className="text-[11px] text-foreground-3">{BUILD_STAGE_LABELS[task.stage] ?? task.stage}{task.queuePosition ? ` · 队列 ${task.queuePosition}` : ''}</span> : null}
        {task.error ? <span className="break-all text-[11px] text-rose">{task.error.code}</span> : null}
        <div className="flex flex-wrap gap-1.5">
          {task.status === 'completed' && task.datasetVersion ? <Button size="sm" variant="outline" type="button" onClick={() => onOpen(task.datasetVersion!)}>查看数据</Button> : null}
          {active ? <Button size="sm" variant="destructive" type="button" disabled={busyTaskId === task.taskId} onClick={() => onAction(task, 'cancel')}>{busyTaskId === task.taskId ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}取消</Button> : null}
          {retryable ? <Button size="sm" variant="outline" type="button" disabled={busyTaskId === task.taskId} onClick={() => onAction(task, 'retry')}>{busyTaskId === task.taskId ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}重试</Button> : null}
        </div>
      </div>
    })}
  </div>
}

function HeroMetric({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return <div className="min-w-0 px-4 py-3">
    <dt className="text-[11px] font-medium uppercase tracking-[.08em] text-foreground-4">{label}</dt>
    <dd className="m-0 mt-1 flex flex-wrap items-baseline gap-2">
      <strong className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</strong>
      {note ? <span className="text-[11px] text-foreground-3">{note}</span> : null}
    </dd>
  </div>
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0', className)}>
    <dt className="text-[11px] font-medium uppercase tracking-[.08em] text-foreground-4">{label}</dt>
    <dd className="m-0 mt-1 min-w-0 break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{children}</dd>
  </div>
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof Database; children: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card p-5 shadow-sm">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon aria-hidden="true" className="text-accent" size={16} strokeWidth={1.6}/>{title}
    </h2>
    <div className="mt-4">{children}</div>
  </section>
}

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

  const quality = current?.quality ?? {}
  const excluded = asRow(quality.excluded) ?? {}
  const missingFields = asRow(quality.featureMissing) ?? {}
  const rawRows = numeric(quality.rawRows)
  const includedRows = numeric(quality.includedRows)
  const positiveLabels = numeric(quality.positiveLabels)
  const blankLabels = numeric(quality.blankLabels)
  const fieldCount = current?.fieldCount ?? (Object.keys(missingFields).length || null)
  const excludedItems = Object.entries(EXCLUSION_LABELS).flatMap(([key, label]) => {
    const value = numeric(excluded[key])
    return value && value > 0 ? [{ label, value }] : []
  })
  const missingItems = Object.entries(missingFields).flatMap(([label, value]) => {
    const count = numeric(value)
    return count && count > 0 ? [{ label, value: count }] : []
  })
  const observations = current?.labelObservations ?? null
  const maturity = current?.labelMaturity ?? null
  const observedThrough = typeof observations?.observedThroughIso === 'string'
    ? observations.observedThroughIso.slice(0, 10)
    : null
  const maturityDays = numeric(observations?.maturityDays) ?? numeric(maturity?.maturityDays)
  const statusCounts = asRow(maturity?.statusCounts)
  const statusItems = statusCounts ? Object.entries(statusCounts).flatMap(([key, value]) => {
    const count = numeric(value)
    return count == null ? [] : [{ label: LABEL_STATUS_LABELS[key] ?? key, value: count }]
  }) : []
  const sourceUrl = typeof current?.source.url === 'string' ? current.source.url : ''
  const branch = typeof current?.source.branch === 'string' ? current.source.branch : ''
  const head = typeof current?.source.head === 'string'
    ? current.source.head
    : typeof current?.source.revision === 'string' ? current.source.revision : ''
  const curationSource = typeof current?.curation?.sourceVersion === 'string' ? current.curation.sourceVersion : ''
  const recipeHash = typeof current?.curation?.recipeSha256 === 'string' ? current.curation.recipeSha256 : ''
  const manifestHash = typeof current?.integrity.manifestSha256 === 'string' ? current.integrity.manifestSha256 : ''
  const sourceHash = typeof current?.integrity.sourceSha256 === 'string' ? current.integrity.sourceSha256 : ''
  const needsRebuild = preview !== null && !preview.available
    && /成熟声明|mature-observed-v1/.test(preview.reason?.message ?? '')
  const inclusionRatio = ratioText(includedRows, rawRows)
  const inclusionPercent = includedRows != null && rawRows != null && rawRows > 0
    ? Math.max(0, Math.min(100, includedRows / rawRows * 100)) : 0

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
        {current ? <>
          <section className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
            <div className="bg-[linear-gradient(135deg,var(--accent-soft),var(--card)_58%)] px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] font-medium text-foreground-3 shadow-sm">
                    <Database aria-hidden="true" size={13}/>数据版本
                  </div>
                  <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-foreground">{current.dataset}</h2>
                  <code className="mt-1 block break-all font-mono text-[11px] text-foreground-4">{current.version}</code>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] text-foreground-2">{usageLabel(current.usage)}</span>
                    <span className="rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] text-foreground-2">{current.mine ? '我的数据' : '共享数据'}</span>
                    {preview == null
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2.5 py-1 text-[11px] text-foreground-3"><Clock3 aria-hidden="true" size={12}/>检查训练准入</span>
                      : preview.available
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[11px] font-medium text-teal-deep"><CheckCircle2 aria-hidden="true" size={12}/>可用于训练</span>
                        : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate({ name: 'my-training', datasetVersion: current.version })} disabled={!preview?.available} type="button">用于训练</Button>
                  <Button size="sm" onClick={() => exportDataset(current.version)} variant="outline" type="button">导出</Button>
                  {current.mine ? <Button size="sm" variant="outline" onClick={() => setCurationOpen(true)} type="button">清洗数据</Button> : null}
                  {current.mine ? <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy} type="button" aria-label="删除数据版本"><Trash2 aria-hidden="true" size={15}/>删除</Button> : null}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-2 divide-x divide-y divide-border-soft border-t border-border-soft sm:grid-cols-4 sm:divide-y-0">
              <HeroMetric label="原始行数" value={numberText(rawRows)}/>
              <HeroMetric label="纳入行数" value={numberText(includedRows)} note={inclusionRatio}/>
              <HeroMetric label="正例" value={numberText(positiveLabels)} note={ratioText(positiveLabels, includedRows)}/>
              <HeroMetric label="入模字段" value={fieldCount == null ? '未提供' : String(fieldCount)}/>
            </dl>
            {previewError ? <div className="border-t border-rose/20 bg-rose-soft px-5 py-3 text-xs text-rose-deep" role="alert">{previewError}</div>
              : preview && !preview.available ? <div className="flex items-start gap-2 border-t border-rose/20 bg-rose-soft px-5 py-3 text-xs text-rose-deep" role="status"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={14}/><div className="min-w-0"><span>{preview.reason?.message ?? '训练准入未通过'}</span>{needsRebuild && /^https?:\/\//.test(sourceUrl) ? <div className="mt-2"><Button size="sm" variant="outline" type="button" onClick={() => { setBuildSeed({ repositoryUrl: sourceUrl, branch: branch || 'HEAD' }); setBuildOpen(true) }}>重新构建</Button></div> : null}</div></div> : null}
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
            <div className="grid min-w-0 gap-4">
              <DetailSection title="来源与时间" icon={GitBranch}>
                <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <Fact label="来源" className="sm:col-span-2">{usageLabel(current.usage)}{sourceUrl ? <span className="text-foreground-3"> · </span> : null}
                    {sourceUrl ? (/^https?:\/\//.test(sourceUrl)
                      ? <a className="inline-flex max-w-full items-center gap-1 align-bottom text-accent hover:underline" href={sourceUrl} target="_blank" rel="noreferrer"><span className="truncate">{sourceUrl}</span><ExternalLink aria-hidden="true" className="shrink-0" size={12}/></a>
                      : <code className="break-all font-mono text-[11px]">{sourceUrl}</code>) : null}</Fact>
                  <Fact label="字段规范"><code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[11px]">{current.schema}</code></Fact>
                  {branch ? <Fact label="分支">{branch}</Fact> : null}
                  {head ? <Fact label="提交"><code className="font-mono text-[11px]" title={head}>{commitText(head)}</code></Fact> : null}
                  <Fact label="数据范围" className="sm:col-span-2">{formatDate(current.timeRange.start)} — {formatDate(current.timeRange.end)}</Fact>
                  {current.timestamps.builtAt ? <Fact label="构建完成">{formatDate(current.timestamps.builtAt)}</Fact> : null}
                  {current.timestamps.importedAt ? <Fact label="CSV 导入">{formatDate(current.timestamps.importedAt)}</Fact> : null}
                  {!current.timestamps.builtAt && !current.timestamps.importedAt && current.timestamps.registeredAt
                    ? <Fact label="登记时间">{formatDate(current.timestamps.registeredAt)}</Fact> : null}
                  {current.timestamps.ownedAt ? <Fact label="归属登记">{formatDate(current.timestamps.ownedAt)}</Fact> : null}
                </dl>
              </DetailSection>

              <DetailSection title="数据质量" icon={Database}>
                <div className="grid gap-4">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-foreground-3">纳入率</span>
                      <strong className="text-sm font-semibold tabular-nums text-foreground">{inclusionRatio ?? '未计算'}</strong>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-strong" aria-hidden="true">
                      <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${inclusionPercent}%` }}/>
                    </div>
                  </div>
                  {excludedItems.length ? <div className="grid gap-3">
                    {excludedItems.map(item => {
                      const share = rawRows != null && rawRows > 0 ? Math.min(100, item.value / rawRows * 100) : 0
                      return <div key={item.label}>
                        <div className="flex items-center justify-between gap-2 text-xs"><span className="text-foreground-2">{item.label}</span><span className="tabular-nums text-foreground-3">{numberText(item.value)}</span></div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-strong" aria-hidden="true"><span className="block h-full rounded-full bg-amber" style={{ width: `${Math.max(share, 1.5)}%` }}/></div>
                      </div>
                    })}
                  </div> : <p className="rounded-lg bg-teal-soft px-3 py-2 text-xs text-teal-deep">未发现排除记录</p>}
                  {blankLabels ? <p className="text-xs text-foreground-3">空标签 {numberText(blankLabels)} 行</p> : null}
                  <div className="rounded-lg bg-sunken p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground-3">字段缺失</span>
                      <span className="text-[11px] text-foreground-4">{missingItems.length ? `${missingItems.length} 个字段` : '无'}</span>
                    </div>
                    {missingItems.length ? <div className="mt-2 flex flex-wrap gap-1.5">
                      {missingItems.map(item => <span key={item.label} className="rounded-md bg-card px-2 py-1 font-mono text-[11px] text-foreground-2">{item.label} {numberText(item.value)}</span>)}
                    </div> : <p className="mt-2 text-xs text-foreground-3">未发现缺失字段</p>}
                  </div>
                </div>
              </DetailSection>
            </div>

            <div className="grid min-w-0 gap-4">
              <DetailSection title="标签与限制" icon={ShieldAlert}>
                <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <Fact label="标签规则" className="sm:col-span-2">{current.labelRule ?? '未声明'}</Fact>
                  {observedThrough ? <Fact label="观察截止">{observedThrough}</Fact> : null}
                  {maturityDays != null ? <Fact label="成熟期">{maturityDays} 天</Fact> : null}
                  {statusItems.length ? <Fact label="标签状态" className="sm:col-span-2">
                    <span className="flex flex-wrap gap-1.5">{statusItems.map(item => <span key={item.label} className="rounded-md bg-soft px-2 py-1 text-[11px] text-foreground-2">{item.label} {numberText(item.value)}</span>)}</span>
                  </Fact> : null}
                </dl>
                <div className="mt-4 rounded-lg bg-sunken p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground-3"><ShieldAlert aria-hidden="true" size={13}/>限制</div>
                  {current.limitations.length ? <ul className="mt-2 grid gap-2 text-xs leading-relaxed text-foreground-2">
                    {current.limitations.map(item => <li key={item} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground-4" aria-hidden="true"/><span>{item}</span></li>)}
                  </ul> : <p className="mt-2 text-xs text-foreground-3">未提供限制说明。</p>}
                </div>
              </DetailSection>

              <DetailSection title="文件与谱系" icon={FileArchive}>
                <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <Fact label="CSV 文件" className="sm:col-span-2"><span className="break-all font-mono text-[11px]">{valueLabel(current.file.name)}</span></Fact>
                  <Fact label="文件大小">{bytesText(current.file.bytes)}</Fact>
                  <Fact label="CSV SHA-256" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{valueLabel(current.file.sha256)}</code></Fact>
                  {sourceHash ? <Fact label="源文件哈希" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{sourceHash}</code></Fact> : null}
                  {manifestHash ? <Fact label="Manifest" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{manifestHash}</code></Fact> : null}
                  {curationSource ? <Fact label="派生自" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{curationSource}</code></Fact> : null}
                  {recipeHash ? <Fact label="清洗配方" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{recipeHash}</code></Fact> : null}
                </dl>
              </DetailSection>
            </div>
          </div>

        </> : <EmptyState title="选择一个数据版本" description="从左侧查看来源、质量、标签、文件与训练准入。"/>}
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
