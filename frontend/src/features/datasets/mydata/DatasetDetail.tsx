import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AlertTriangle, CheckCircle2, Clock3, Database, ExternalLink, FileArchive,
  GitBranch, ShieldAlert, Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDate, valueLabel } from '@/features/admin/adminContracts'
import type { UserDataset, UserSplitPreview } from '@/features/account/userClient'
import { labelMaturityItems } from '@/lib/datasetMaturity'
import {
  EXCLUSION_LABELS, asRow, bytesText, commitText, numeric, numberText,
  ratioText, usageLabel,
} from '@/features/datasets/mydata/format'

const MATURITY_REASON = /成熟声明|mature-observed-v1/

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

/** 单个数据版本的可读详情：来源、质量、标签、文件谱系与训练准入。 */
export function DatasetDetail({ dataset, preview, previewError, busy, actions }: {
  dataset: UserDataset
  preview: UserSplitPreview | null
  previewError: string
  busy: boolean
  actions: {
    onTrain: () => void
    onExport: () => void
    onCuration: () => void
    onDelete: () => void
    onRebuild: (repositoryUrl: string, branch: string) => void
  }
}) {
  const quality = dataset.quality ?? {}
  const excluded = asRow(quality.excluded) ?? {}
  const missingFields = asRow(quality.featureMissing) ?? {}
  const rawRows = numeric(quality.rawRows)
  const includedRows = numeric(quality.includedRows)
  const positiveLabels = numeric(quality.positiveLabels)
  const blankLabels = numeric(quality.blankLabels)
  const fieldCount = dataset.fieldCount ?? (Object.keys(missingFields).length || null)
  const excludedItems = Object.entries(EXCLUSION_LABELS).flatMap(([key, label]) => {
    const value = numeric(excluded[key])
    return value && value > 0 ? [{ label, value }] : []
  })
  const missingItems = Object.entries(missingFields).flatMap(([label, value]) => {
    const count = numeric(value)
    return count && count > 0 ? [{ label, value: count }] : []
  })
  const observations = dataset.labelObservations ?? null
  const maturity = dataset.labelMaturity ?? null
  const observedThrough = typeof observations?.observedThroughIso === 'string'
    ? observations.observedThroughIso.slice(0, 10)
    : null
  const maturityDays = numeric(observations?.maturityDays) ?? numeric(maturity?.maturityDays)
  const statusItems = labelMaturityItems(asRow(maturity?.statusCounts))
  const sourceUrl = typeof dataset.source.url === 'string' ? dataset.source.url : ''
  const branch = typeof dataset.source.branch === 'string' ? dataset.source.branch : ''
  const head = typeof dataset.source.head === 'string'
    ? dataset.source.head
    : typeof dataset.source.revision === 'string' ? dataset.source.revision : ''
  const curationSource = typeof dataset.curation?.sourceVersion === 'string' ? dataset.curation.sourceVersion : ''
  const recipeHash = typeof dataset.curation?.recipeSha256 === 'string' ? dataset.curation.recipeSha256 : ''
  const manifestHash = typeof dataset.integrity.manifestSha256 === 'string' ? dataset.integrity.manifestSha256 : ''
  const sourceHash = typeof dataset.integrity.sourceSha256 === 'string' ? dataset.integrity.sourceSha256 : ''
  const needsRebuild = preview !== null && !preview.available
    && MATURITY_REASON.test(preview.reason?.message ?? '')
  const inclusionRatio = ratioText(includedRows, rawRows)
  const inclusionPercent = includedRows != null && rawRows != null && rawRows > 0
    ? Math.max(0, Math.min(100, includedRows / rawRows * 100)) : 0

  return <>
    <section className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="bg-[linear-gradient(135deg,var(--accent-soft),var(--card)_58%)] px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] font-medium text-foreground-3 shadow-sm">
              <Database aria-hidden="true" size={13}/>数据版本
            </div>
            <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-foreground">{dataset.dataset}</h2>
            <code className="mt-1 block break-all font-mono text-[11px] text-foreground-4">{dataset.version}</code>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] text-foreground-2">{usageLabel(dataset.usage)}</span>
              <span className="rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] text-foreground-2">{dataset.mine ? '我的数据' : '共享数据'}</span>
              {preview == null
                ? <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2.5 py-1 text-[11px] text-foreground-3"><Clock3 aria-hidden="true" size={12}/>检查训练准入</span>
                : preview.available
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[11px] font-medium text-teal-deep"><CheckCircle2 aria-hidden="true" size={12}/>可用于训练</span>
                  : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={actions.onTrain} disabled={!preview?.available} type="button">用于训练</Button>
            <Button size="sm" onClick={actions.onExport} variant="outline" type="button">导出</Button>
            {dataset.mine ? <Button size="sm" variant="outline" onClick={actions.onCuration} type="button">清洗数据</Button> : null}
            {dataset.mine ? <Button size="sm" variant="ghost" onClick={actions.onDelete} disabled={busy} type="button" aria-label="删除数据版本"><Trash2 aria-hidden="true" size={15}/>删除</Button> : null}
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
        : preview && !preview.available ? <div className="flex items-start gap-2 border-t border-rose/20 bg-rose-soft px-5 py-3 text-xs text-rose-deep" role="status"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={14}/><div className="min-w-0"><span>{preview.reason?.message ?? '训练准入未通过'}</span>{needsRebuild && /^https?:\/\//.test(sourceUrl) ? <div className="mt-2"><Button size="sm" variant="outline" type="button" onClick={() => actions.onRebuild(sourceUrl, branch || 'HEAD')}>重新构建</Button></div> : null}</div></div> : null}
    </section>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
      <div className="grid min-w-0 gap-4">
        <DetailSection title="来源与时间" icon={GitBranch}>
          <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Fact label="来源" className="sm:col-span-2">{usageLabel(dataset.usage)}{sourceUrl ? <span className="text-foreground-3"> · </span> : null}
              {sourceUrl ? (/^https?:\/\//.test(sourceUrl)
                ? <a className="inline-flex max-w-full items-center gap-1 align-bottom text-accent hover:underline" href={sourceUrl} target="_blank" rel="noreferrer"><span className="truncate">{sourceUrl}</span><ExternalLink aria-hidden="true" className="shrink-0" size={12}/></a>
                : <code className="break-all font-mono text-[11px]">{sourceUrl}</code>) : null}</Fact>
            <Fact label="字段规范"><code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[11px]">{dataset.schema}</code></Fact>
            {branch ? <Fact label="分支">{branch}</Fact> : null}
            {head ? <Fact label="提交"><code className="font-mono text-[11px]" title={head}>{commitText(head)}</code></Fact> : null}
            <Fact label="数据范围" className="sm:col-span-2">{formatDate(dataset.timeRange.start)} — {formatDate(dataset.timeRange.end)}</Fact>
            {dataset.timestamps.builtAt ? <Fact label="构建完成">{formatDate(dataset.timestamps.builtAt)}</Fact> : null}
            {dataset.timestamps.importedAt ? <Fact label="CSV 导入">{formatDate(dataset.timestamps.importedAt)}</Fact> : null}
            {!dataset.timestamps.builtAt && !dataset.timestamps.importedAt && dataset.timestamps.registeredAt
              ? <Fact label="登记时间">{formatDate(dataset.timestamps.registeredAt)}</Fact> : null}
            {dataset.timestamps.ownedAt ? <Fact label="归属登记">{formatDate(dataset.timestamps.ownedAt)}</Fact> : null}
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
            <Fact label="标签规则" className="sm:col-span-2">{dataset.labelRule ?? '未声明'}</Fact>
            {observedThrough ? <Fact label="观察截止">{observedThrough}</Fact> : null}
            {maturityDays != null ? <Fact label="成熟期">{maturityDays} 天</Fact> : null}
            {statusItems.length ? <Fact label="标签状态" className="sm:col-span-2">
              <span className="flex flex-wrap gap-1.5">{statusItems.map(item => <span key={item.label} className="rounded-md bg-soft px-2 py-1 text-[11px] text-foreground-2">{item.label} {numberText(item.value)}</span>)}</span>
            </Fact> : null}
          </dl>
          <div className="mt-4 rounded-lg bg-sunken p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground-3"><ShieldAlert aria-hidden="true" size={13}/>限制</div>
            {dataset.limitations.length ? <ul className="mt-2 grid gap-2 text-xs leading-relaxed text-foreground-2">
              {dataset.limitations.map(item => <li key={item} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground-4" aria-hidden="true"/><span>{item}</span></li>)}
            </ul> : <p className="mt-2 text-xs text-foreground-3">未提供限制说明。</p>}
          </div>
        </DetailSection>

        <DetailSection title="文件与谱系" icon={FileArchive}>
          <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Fact label="CSV 文件" className="sm:col-span-2"><span className="break-all font-mono text-[11px]">{valueLabel(dataset.file.name)}</span></Fact>
            <Fact label="文件大小">{bytesText(dataset.file.bytes)}</Fact>
            <Fact label="CSV SHA-256" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{valueLabel(dataset.file.sha256)}</code></Fact>
            {sourceHash ? <Fact label="源文件哈希" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{sourceHash}</code></Fact> : null}
            {manifestHash ? <Fact label="Manifest" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{manifestHash}</code></Fact> : null}
            {curationSource ? <Fact label="派生自" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{curationSource}</code></Fact> : null}
            {recipeHash ? <Fact label="清洗配方" className="sm:col-span-2"><code className="break-all font-mono text-[11px]">{recipeHash}</code></Fact> : null}
          </dl>
        </DetailSection>
      </div>
    </div>
  </>
}
