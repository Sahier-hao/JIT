import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, GitBranch, ShieldAlert } from 'lucide-react'
import type { Route } from '@/app/navigation'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ApiError } from '@/lib/apiContract'
import { labelMaturityText } from '@/lib/datasetMaturity'
import { formatDate, setAdminDatasetSharing, type AdminDatasetVersion } from '@/features/admin/adminContracts'
import { ErrorNotice } from '@/features/admin/AdminShared'
import { AdminDatasetCompareDialog, AdminDatasetCurationDialog } from '@/features/admin/AdminDatasetTools'
import { AdminDatasetTrainingDialog } from '@/features/admin/AdminDatasetTrainingDialog'
import { exportCuration } from '@/features/datasets/curationClient'
import { DatasetFact, DatasetMetric, DatasetSection } from '@/features/datasets/DatasetPresentation'
import { previewDatasetSplit, type SplitPreview } from '@/features/datasets/splitClient'
import { asRow, bytesText, EXCLUSION_LABELS, numberText, numeric, ratioText, usageLabel } from '@/features/datasets/mydata/format'

const REFERENCE_LABELS: Record<string, string> = {
  model: '模型', analysis: '项目分析', trend: '风险趋势', 'dataset-build': '构建任务',
}

function AuditFacts({ title, facts }: { title: string; facts: Array<[string, unknown]> }) {
  const recorded = facts.filter(([, value]) => (typeof value === 'string' && Boolean(value)) || typeof value === 'number')
  if (!recorded.length) return null
  return <details className="group min-w-0 rounded-xl border border-border-soft bg-card">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground marker:content-none">
      {title}<ChevronDown aria-hidden="true" size={15} className="shrink-0 text-foreground-3 group-open:rotate-180"/>
    </summary>
    <div className="border-t border-border-soft p-4">
      <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {recorded.map(([label, value]) => <DatasetFact key={label} label={label}>{typeof value === 'number' ? numberText(value) : String(value)}</DatasetFact>)}
      </dl>
    </div>
  </details>
}

export function AdminDatasetDetailPage({ selected, versions, onSelect, onShared, onDerived, navigate, expired }: {
  selected: AdminDatasetVersion
  versions: AdminDatasetVersion[]
  onSelect: (item: AdminDatasetVersion) => void
  onShared: (id: string, shared: boolean) => void
  onDerived: (id: string) => void
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [tool, setTool] = useState<'training' | 'curation' | 'compare' | null>(null)
  const [sharingBusy, setSharingBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [trainingPreview, setTrainingPreview] = useState<SplitPreview | null>(null)
  const [trainingError, setTrainingError] = useState('')
  const [trainingBusy, setTrainingBusy] = useState(false)
  const closeTool = () => setTool(null)

  async function checkTraining(): Promise<SplitPreview | null> {
    if (trainingPreview) return trainingPreview
    setTrainingBusy(true)
    setTrainingError('')
    const controller = new AbortController()
    try {
      const preview = await previewDatasetSplit(selected.version, 'temporal-70-15-15', controller.signal)
      setTrainingPreview(preview)
      return preview
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setTrainingError(failure instanceof Error ? failure.message : '训练准入读取失败')
      return null
    } finally {
      setTrainingBusy(false)
    }
  }

  async function updateSharing(next: boolean) {
    if (sharingBusy || selected.owners.length) return
    if (next && !trainingPreview?.available) {
      const checked = await checkTraining()
      if (!checked?.available) {
        setError(checked?.reason?.message ?? (trainingError || '训练准入检查未通过'))
        return
      }
    }
    setSharingBusy(true)
    setError('')
    try {
      const result = await setAdminDatasetSharing(selected.version, next)
      onShared(result.version, result.shared)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '共享状态更新失败')
    } finally { setSharingBusy(false) }
  }

  async function exportVersion() {
    setExporting(true)
    setError('')
    try { await exportCuration(selected.version) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '导出失败') }
    finally { setExporting(false) }
  }

  const { quality, source, szz, label, labelObservations: observations } = selected
  const signals = asRow(szz.fixSignals)
  const lookup = asRow(szz.issueLookup)
  const counts = asRow(observations?.counts)
  const szzNumber = (key: string) => szz[key] ?? asRow(szz.unresolved)?.[key]
  const rawRows = numeric(quality.rawRows)
  const includedRows = numeric(quality.includedRows)
  const positives = numeric(quality.positiveLabels)
  const observedUntil = typeof observations?.observedThroughIso === 'string' ? observations.observedThroughIso.slice(0, 10) : null
  const maturityDays = numeric(observations?.maturityDays) ?? numeric(label.maturityDays)
  const missing = Object.entries(asRow(quality.featureMissing) ?? {}).filter(([, count]) => (numeric(count) ?? 0) > 0)
  const excluded = Object.entries(asRow(quality.excluded) ?? {}).filter(([, count]) => (numeric(count) ?? 0) > 0)
  const sourceUrl = typeof source.url === 'string' ? source.url : null
  return <>
    <section className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm" aria-label="数据版本概览">
      <div className="grid gap-4 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">{selected.dataset}</h2>
            <p className="mt-1 text-xs text-foreground-3">{usageLabel(selected.usage)} · {selected.schema}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="button" onClick={() => setTool('training')}>用于训练</Button>
            <Button size="sm" type="button" variant="outline" disabled={exporting} onClick={() => void exportVersion()}>{exporting ? '正在导出…' : '导出'}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" type="button" variant="ghost">更多操作 <ChevronDown aria-hidden="true" size={14}/></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTool('curation')}>清洗与派生</DropdownMenuItem>
                <DropdownMenuItem disabled={versions.length < 2} onSelect={() => setTool('compare')}>对比版本</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid min-w-0 max-w-lg flex-1 gap-1">
            <span className="text-xs font-medium text-foreground-3">版本</span>
            {versions.length === 1 ? <code className="break-all py-1 text-xs text-foreground-2">{selected.version}</code>
              : <Select value={selected.version} onValueChange={id => {
              const item = versions.find(candidate => candidate.version === id)
              if (item) onSelect(item)
            }}>
              <SelectTrigger aria-label="数据集版本" className="h-8 w-full min-w-0 max-w-full font-mono text-xs [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"><SelectValue/></SelectTrigger>
              <SelectContent position="popper" className="max-w-[min(85vw,44rem)]">
                {versions.map(item => <SelectItem key={item.version} value={item.version}>{item.version}</SelectItem>)}
              </SelectContent>
            </Select>}
          </div>
          <div className="flex min-h-8 flex-wrap items-center gap-2 text-xs">
            {selected.owners.length ? <span title={selected.owners.join('、')} className="text-foreground-3">用户自有版本</span> : <label className="flex items-center gap-2 text-foreground-2">
              <span>开放给普通用户</span>
              <Switch aria-label="开放给普通用户" checked={selected.shared} disabled={sharingBusy || trainingBusy} onCheckedChange={next => void updateSharing(next)}/>
            </label>}
          </div>
        </div>
        {selected.owners.length ? null : <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs">
          {trainingBusy ? <span className="text-foreground-3">检查训练准入…</span>
            : trainingPreview?.available ? <span className="inline-flex items-center gap-1 text-teal-deep"><CheckCircle2 aria-hidden="true" size={13}/>可用于训练</span>
            : trainingPreview ? <span className="inline-flex items-center gap-1 text-rose-deep" title={trainingPreview.reason?.message ?? trainingError}><AlertTriangle aria-hidden="true" size={13}/>不可训练</span>
            : <button type="button" className="text-xs text-accent underline-offset-2 hover:underline" onClick={() => void checkTraining()}>检查训练准入</button>}
          {trainingPreview?.reason?.message ? <span className="min-w-0 break-words text-rose-deep [overflow-wrap:anywhere]">· {trainingPreview.reason.message}</span> : null}
          {trainingError ? <span className="text-rose-deep">· {trainingError}</span> : null}
        </div>}
        <ErrorNotice>{error}</ErrorNotice>
      </div>
      <dl className="grid grid-cols-2 divide-x divide-border-soft border-t border-border-soft sm:grid-cols-4 [&>div:nth-child(n+3)]:max-sm:border-t [&>div:nth-child(n+3)]:max-sm:border-border-soft">
        <DatasetMetric label="原始行数" value={numberText(rawRows)}/>
        <DatasetMetric label="纳入行数" value={numberText(includedRows)} note={ratioText(includedRows, rawRows)}/>
        <DatasetMetric label="正例" value={numberText(positives)} note={ratioText(positives, includedRows)}/>
        <DatasetMetric label="空标签" value={numberText(quality.blankLabels)}/>
      </dl>
    </section>

    <div className="grid min-w-0 gap-3 2xl:grid-cols-2 2xl:items-start">
      <DatasetSection title="来源与时间" icon={GitBranch}>
        <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {sourceUrl ? <DatasetFact label="来源" className="sm:col-span-2">
            {/^(https?):\/\//i.test(sourceUrl) ? <a className="text-accent underline-offset-2 hover:underline" href={sourceUrl} target="_blank" rel="noreferrer">{sourceUrl}</a> : sourceUrl}
          </DatasetFact> : null}
          <DatasetFact label="数据起点">{formatDate(selected.timeRange.start)}</DatasetFact>
          <DatasetFact label="数据终点">{formatDate(selected.timeRange.end)}</DatasetFact>
          {typeof source.branch === 'string' && source.branch ? <DatasetFact label="分支">{source.branch}</DatasetFact> : null}
        </dl>
      </DatasetSection>
      <DatasetSection title="标签与限制" icon={ShieldAlert}>
        <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <DatasetFact label="标签规则">{selected.labelRule ?? '未声明'}</DatasetFact>
          <DatasetFact label="标签成熟">{labelMaturityText(selected.labelMaturity)}</DatasetFact>
          {observedUntil ? <DatasetFact label="观察截止">{observedUntil}</DatasetFact> : null}
          {maturityDays !== null ? <DatasetFact label="成熟期">{maturityDays} 天</DatasetFact> : null}
        </dl>
        {observations?.truncated === true || szz.truncated === true ? <p className="mt-3 text-xs text-amber-deep">缺陷证据覆盖不完整，部分提交未完成回溯。</p> : null}
        {selected.limitations.length ? <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground-3">
          {selected.limitations.map(item => <li key={item}>{item}</li>)}
        </ul> : null}
      </DatasetSection>
    </div>

    <AuditFacts title="数据质量与排除" facts={[
      ...missing.map(([field, count]): [string, unknown] => [`字段缺失 · ${field}`, count]),
      ...excluded.map(([reason, count]): [string, unknown] => [EXCLUSION_LABELS[reason] ?? reason, count]),
    ]}/>
    <AuditFacts title="标签回溯明细" facts={[
      ['修复提交', szzNumber('fixCommits')], ['被标为引入', szzNumber('labeledCommits')], ['证据对数', szzNumber('evidencePairs')],
      ['修复信号 · Issue', signals?.issue], ['修复信号 · 关键词', signals?.keyword],
      ['Issue 查询成功', lookup?.succeeded], ['Issue 查询失败', lookup?.failed], ['Issue 查询不可用', lookup?.unavailable],
      ['未回溯行区间', szzNumber('unresolvedRanges')], ['跳过文件', szzNumber('skippedFiles')],
      ['排除文件', szzNumber('skippedExcluded')], ['空白变动', szzNumber('skippedWhitespace')],
      ['仅文档', szzNumber('skippedDocsOnly')], ['元数据行', szzNumber('skippedNoiseLines')],
      ['窗口外引入', szzNumber('outsideWindow')], ['观察协议', observations?.protocol],
      ['原始样本', counts?.originalRecords], ['成熟合格样本', counts?.eligibleRecords], ['未成熟排除', counts?.excludedImmature],
      ['历史覆盖', observations?.historyStatus], ['标签版本', observations?.version ?? label.rule],
    ]}/>
    <AuditFacts title="文件、归属与引用" facts={[
      ['发布者', source.publisher], ['修订', source.revision], ['HEAD', source.head], ['来源分析', selected.sourceSyncId],
      ['CSV SHA-256', selected.file.sha256], ['文件大小', selected.file.bytes == null ? null : bytesText(selected.file.bytes)],
      ['描述文件', selected.manifestPath], ['所有者', selected.owners.length ? selected.owners.join('、') : '管理员管理'],
      ['引用', selected.references.length ? selected.references.map(item => REFERENCE_LABELS[item] ?? item).join('、') : '无'],
    ]}/>

    {tool === 'training' ? <AdminDatasetTrainingDialog selected={selected} onClose={closeTool} navigate={navigate} expired={expired}/> : null}
    {tool === 'curation' ? <AdminDatasetCurationDialog version={selected.version} onClose={closeTool} onDerived={onDerived} expired={expired}/> : null}
    {tool === 'compare' ? <AdminDatasetCompareDialog selected={selected} versions={versions} onClose={closeTool} expired={expired}/> : null}
  </>
}
