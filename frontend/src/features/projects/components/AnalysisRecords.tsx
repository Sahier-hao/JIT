import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertTriangle, Check, GitCompare, Loader, MoreHorizontal, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { displayTime } from '@/lib/domain'
import { ACTIVE_STATUSES, DEGRADE_LABELS, STATUS_LABELS, type SyncError, type SyncView } from '@/features/projects/repositoryContract'
import { JobProgress } from '@/features/projects/components/JobProgress'

export function RecordRow({ job, current, selecting, onOpen, onCompare, onSelect, onDelete, onDetail, onRetry, onOpenPR, openingPR, onCancel, deleteBusy, cancelBusy }: { job: SyncView; current: boolean; selecting: boolean; onOpen: () => void; onCompare?: () => void; onSelect: () => void; onDelete: () => void; onDetail: () => void; onRetry: () => void; onOpenPR?: () => void; openingPR: boolean; onCancel: () => void; deleteBusy: boolean; cancelBusy: boolean }) {
  const active = (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  const completed = job.status === 'completed'
  const isPR = job.sourceKind === 'pr'
  const pendingCancel = active && Boolean(job.cancelRequestedAt)
  const switchable = completed && !current && !isPR
  const title = pendingCancel ? '正在取消' : completed && current ? '当前结果' : switchable ? '设为当前结果' : job.status === 'queued' && job.queuePosition ? `排队第 ${job.queuePosition} 位` : STATUS_LABELS[active ? job.stage : job.status]
  const meta = `${shortTime(job.createdAt)} · ${syncSpan(job)}${switchable ? ' · 已完成' : ''}${isPR ? ' · PR 固定版本' : ''}`
  const shortId = job.syncId.slice(0, 7)
  const text = <div className="min-w-0">
    <p className="flex items-center gap-1.5 text-sm">
      {completed ? current ? <span className="text-accent" aria-label={`当前结果 ${shortId}`}><Pin aria-hidden="true" focusable="false"  size={12} fill="currentColor" strokeWidth={1.6}/></span>
        : isPR ? <span className="text-foreground-4"><GitCompare aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/></span>
          : <span className="text-foreground-4"><Check aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/></span>
        : <span className={cn(active ? 'text-accent' : 'text-rose')}>{active ? <Loader aria-hidden="true" focusable="false"  size={14}/> : <AlertTriangle aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}</span>}
      <span className="truncate font-medium text-foreground">{title}</span>
    </p>
    <p className="mt-0.5 text-xs text-foreground-3">{meta}{selecting && switchable ? ' · 正在切换…' : ''}</p>
  </div>
  return <article className={cn('rounded-sm border p-2.5', current ? 'border-accent bg-accent-soft/40' : 'border-border-soft bg-card')} data-current={current || undefined} aria-label={`分析记录 ${job.syncId}`}>
    <div className="flex items-start justify-between gap-2">
      {switchable ? <Button variant="ghost" type="button" className="h-auto min-w-0 flex-1 whitespace-normal border-0 bg-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" disabled={selecting} onClick={onSelect} aria-label={`将 ${shortId} 设为当前结果`}>{text}</Button> : text}
      <RecordMenu pendingCancel={pendingCancel} onOpen={isPR ? onOpenPR : completed ? onOpen : undefined} openLabel={isPR ? '查看原 PR 快照' : '打开结果'} openBusy={isPR ? openingPR : undefined} onCompare={onCompare} onRetry={!active && !completed && !isPR ? onRetry : undefined} onCancel={active && !pendingCancel ? onCancel : undefined} onDetail={onDetail} onSelect={completed && !current && !isPR ? onSelect : undefined} onDelete={!active ? onDelete : undefined} cancelBusy={cancelBusy} deleteBusy={deleteBusy}/>
    </div>
    {active ? <div className="mt-2"><JobProgress compact status={job.status} stage={job.stage} queuePosition={job.queuePosition} startedAt={job.startedAt} scoresOnly={job.requestedStrategy === 'generic-model'}/></div> : null}
    {job.error ? <p className="mt-1.5 flex items-start gap-1 text-xs text-rose" title={job.error.message}><AlertTriangle aria-hidden="true" focusable="false" strokeWidth={1.5} size={13} className="mt-0.5 shrink-0"/>{failureText(job.error)}</p> : job.status === 'cancelled' ? <p className="mt-1.5 text-xs text-foreground-3">已取消，可用原参数重新分析。</p> : null}
  </article>
}

/** 记录详情：放进浮层，避免在列表里向下展开把卡片撑长。 */
export function RecordDetails({ job, active }: { job: SyncView; active: boolean }) {
  return <dl className="grid gap-2 text-sm">
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 first:border-t-0 first:pt-0"><dt className="text-xs text-foreground-3">范围</dt><dd className="m-0 break-words">{fullHistory(job.since) ? '全部历史' : `${job.since ?? '不限'} — ${job.until ?? '不限'}`}</dd></div>
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">分支</dt><dd className="m-0 break-words">{job.branch}</dd></div>
    {job.algorithmName ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">训练方法</dt><dd className="m-0 break-words">{job.algorithmName}</dd></div> : null}
    {job.startedAt ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">开始执行</dt><dd className="m-0 break-words">{displayTime(job.startedAt)}</dd></div> : null}
    {active && job.deadlineAt ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">执行截止</dt><dd className="m-0 break-words">{displayTime(job.deadlineAt)}</dd></div> : null}
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">数据</dt><dd className="m-0 break-words">{job.datasetVersion ?? '尚未生成'}</dd></div>
    {job.degradeReason ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">模型说明</dt><dd className="m-0 break-words">{DEGRADE_LABELS[job.degradeReason] ?? job.degradeReason}</dd></div> : null}
    {job.requestId ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">请求标识</dt><dd className="m-0 break-all"><code className="font-mono text-xs">{job.requestId}</code></dd></div> : null}
  </dl>
}

export function datasetRange(version?: string | null) {
  if (!version) return '未登记'
  // 同一区间重复采集时后端会在末尾追加短哈希，先剥掉再解析区间。
  const cleaned = version.replace(/-[0-9a-f]{6,}$/, '')
  const range = cleaned.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/)
  return range ? `${range[1]} → ${range[2].slice(5)}` : version
}

/** 记录卡只放一个入口：点开后再选具体动作，避免每行三四个图标。 */
function RecordMenu({ pendingCancel, onOpen, openLabel = '打开结果', openBusy, onCompare, onSelect, onRetry, onCancel, onDetail, onDelete, cancelBusy, deleteBusy }: {
  pendingCancel: boolean
  onOpen?: () => void
  openLabel?: string
  openBusy?: boolean
  onCompare?: () => void
  onSelect?: () => void
  onRetry?: () => void
  onCancel?: () => void
  onDetail: () => void
  onDelete?: () => void
  cancelBusy: boolean
  deleteBusy: boolean
}) {
  const items = [] as { key: string; label: string; danger?: boolean; disabled?: boolean }[]
  if (onOpen) items.push({ key: 'open', label: openLabel, disabled: openBusy })
  if (onCompare) items.push({ key: 'compare', label: '与当前结果对比' })
  if (onSelect) items.push({ key: 'select', label: '设为当前结果' })
  if (onRetry) items.push({ key: 'retry', label: '用这些参数重试' })
  if (onCancel) items.push({ key: 'cancel', label: '取消分析', disabled: cancelBusy })
  if (pendingCancel) items.push({ key: 'pending', label: '正在取消…', disabled: true })
  items.push({ key: 'detail', label: '分析详情' })
  if (onDelete) items.push({ key: 'delete', label: '删除记录', danger: true, disabled: deleteBusy })
  return <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button aria-label="更多操作" title="更多操作" variant="ghost" size="icon-sm" type="button">{<MoreHorizontal aria-hidden="true" focusable="false" strokeWidth={1.5} size={16}/>}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{(items).map(item => <DropdownMenuItem key={item.key} disabled={'disabled' in item && item.disabled === true} variant={'danger' in item && item.danger ? 'destructive' : 'default'} onSelect={() => (key => {
    if (key === 'open') onOpen?.()
    else if (key === 'compare') onCompare?.()
    else if (key === 'select') onSelect?.()
    else if (key === 'retry') onRetry?.()
    else if (key === 'cancel') onCancel?.()
    else if (key === 'detail') onDetail()
    else if (key === 'delete') onDelete?.()
  })(item.key)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
}

/** 失败原因：常见错误给一句人话，原始信息留在详情里。 */
const FAILURE_TEXT: Record<string, string> = {
  DATASET_EXISTS: '同一数据版本已有不同内容，未覆盖；请重试，仍失败请联系维护者',
  REPOSITORY_UNAVAILABLE: '无法读取仓库，检查网络或地址后重试',
  REPOSITORY_CHECK_TIMEOUT: '检查远端仓库超时，可以重试',
  CONFLICT_ACTIVE_SYNC: '已有进行中的分析，结束后再试',
  DATASET_INVALID: '这个范围内没有可分析的提交，调整日期后重试',
  SYNC_TIMEOUT: '分析超过时限，可稍后重试',
  SYNC_INTERRUPTED: '服务停止时分析中断，可以重试',
  SYNC_CANCELLED: '这次分析已取消，可以重试',
}

function failureText(error: SyncError) {
  // DATASET_INVALID 的具体原因（如超过提交上限）由后端给出，优先显示，避免误报成"没有提交"。
  if (error.code === 'DATASET_INVALID' && error.message) return error.message
  return FAILURE_TEXT[error.code] ?? error.message
}

/** 记录的时间跨度：用采集区间，保持一行可读。 */
function syncSpan(job: SyncView) {
  if (fullHistory(job.since)) return '全部历史'
  return `${shortDay(job.since)} → ${shortDay(job.until)}`
}

/** 起点是 1970-01-01 表示未指定起点，即采集全部历史。 */
function fullHistory(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() <= 1970
}

function shortDay(value?: string | null) {
  if (!value) return '不限'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '不限'
}

/** 记录行的短时间戳：月-日 时:分，避免整行被截断。 */
function shortTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
